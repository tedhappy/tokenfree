// ============================================================
// 自动采集器：从同类导航站抓取中转站候选 → 探测验证 → 写入投稿审核队列
// 人工审核后才进入正式榜单（复用现有投稿审核流，不自动发布）
//
// 用法：
//   - 服务内定时：COLLECT_INTERVAL_HOURS（默认 24，0 关闭），见 server/index.js
//   - 管理端手动触发：POST /api/collect/run（需登录）
//   - 独立运行：node server/collect.js（写入同一份 submissions.json）
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'src', 'data');
const SITES_FILE = path.join(DATA_DIR, 'sites.json');
const SUBMISSIONS_FILE = path.join(DATA_DIR, 'submissions.json');
const SEEN_FILE = path.join(DATA_DIR, 'collect-seen.json'); // 已采集过的 host，避免拒审后反复入库

const PROBE_TIMEOUT_MS = 8000;
const PROBE_CONCURRENCY = 6;
const MAX_NEW_PER_RUN = 20; // 单次最多入库数，防止刷屏审核队列

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmp, file);
}

function hostOf(url) {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return '';
  }
}

// 解码常见 HTML 实体（站名/简介里会出现 &#x27; &amp; 等）
function decodeEntities(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;|&apos;/gi, "'");
}

// ---------- 数据源适配器 ----------
// 每个适配器返回统一结构：{ name, url, tags[], lines[], disabled }
const SOURCES = [
  {
    id: 'freetokennav',
    label: 'FreeTokenNav',
    url: 'https://freetokennav.com/',
    // 卡片结构（2026-08 实测）：article.site-card > h3 站名 + span.tag 标签 + p 简介 + /go/?url=base64 跳转
    async fetch() {
      const res = await fetch(this.url, {
        signal: AbortSignal.timeout(15000),
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) TokenFree-Collector/1.0' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();
      const items = [];
      for (const m of html.matchAll(/<article class="site-card([^"]*)"([\s\S]*?)<\/article>/g)) {
        const cls = m[1];
        const body = m[2];
        const name = (body.match(/<h3>([^<]+)<\/h3>/) || [])[1]?.trim();
        const link = (body.match(/href="\/go\/\?url=([^"]+)"/) || [])[1];
        if (!name || !link) continue;
        let url = '';
        try {
          url = Buffer.from(decodeURIComponent(link), 'base64').toString('utf-8');
        } catch {
          continue;
        }
        if (!/^https?:\/\//i.test(url)) continue;
        // 去掉竞品的推广参数（aff/invite 等），只保留中性的注册路径
        const clean = url.split('?')[0];
        items.push({
          name: decodeEntities(name),
          url: clean,
          tags: [...body.matchAll(/<span class="tag[^"]*">([^<]+)<\/span>/g)].map((t) => decodeEntities(t[1].trim())),
          lines: [...body.matchAll(/<p>([^<]+)<\/p>/g)].map((p) => decodeEntities(p[1].trim())),
          disabled: cls.includes('disabled-card'),
        });
      }
      return items;
    },
  },
];

// ---------- 探测验证 ----------
async function probe(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
  const start = Date.now();
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 TokenFree-Collector/1.0' },
    });
    return { status: res.status, ms: Date.now() - start };
  } catch {
    return { status: 0, ms: Date.now() - start };
  } finally {
    clearTimeout(timer);
  }
}

/** 一个候选是否像"可用的 OpenAI 兼容中转站"：
 *  首页可访问 + /v1/models 返回 401/403/405（端点存在、需鉴权） */
async function verifyCandidate(item) {
  const origin = new URL(item.url).origin;
  const [home, models] = await Promise.all([probe(origin), probe(`${origin}/v1/models`)]);
  const homeOk = home.status > 0 && home.status < 500;
  const modelsOk = [401, 403, 405].includes(models.status);
  return { homeOk, modelsOk, latencyMs: home.ms };
}

// ---------- 主流程 ----------
let collecting = false; // 并发锁：手动触发与定时任务撞车时跳过本次

export async function runCollect({ maxNew = MAX_NEW_PER_RUN } = {}) {
  if (collecting) return { skipped: true, savedAt: new Date().toISOString() };
  collecting = true;
  try {
    return await doRunCollect({ maxNew });
  } finally {
    collecting = false;
  }
}

async function doRunCollect({ maxNew }) {
  const result = { sources: [], fetched: 0, candidates: 0, skippedKnown: 0, verified: 0, rejected: 0, added: 0, savedAt: new Date().toISOString() };

  // 1. 拉取所有数据源
  const items = [];
  for (const src of SOURCES) {
    try {
      const list = await src.fetch();
      result.sources.push({ id: src.id, ok: true, items: list.length });
      items.push(...list);
    } catch (e) {
      result.sources.push({ id: src.id, ok: false, error: String(e.message || e) });
    }
  }
  result.fetched = items.length;

  // 2. 去重：已在榜单 / 已在投稿队列 / 已采集过 / 竞品标注失效
  const sites = readJson(SITES_FILE, []);
  const subs = readJson(SUBMISSIONS_FILE, []);
  const seen = readJson(SEEN_FILE, {});
  const knownHosts = new Set([
    ...sites.map((s) => hostOf(s.url)),
    ...subs.map((s) => hostOf(s.url)),
    ...Object.keys(seen),
  ]);

  const fresh = items.filter((it) => {
    const h = hostOf(it.url);
    if (it.disabled) return false;
    if (!h || knownHosts.has(h)) return false;
    return true;
  });
  result.candidates = fresh.length;
  result.skippedKnown = items.length - fresh.length;

  // 3. 逐个探测验证（限制并发）
  const queue = [...fresh];
  const admitted = [];
  const worker = async () => {
    while (queue.length && admitted.length < maxNew) {
      const it = queue.shift();
      const host = hostOf(it.url);
      seen[host] = new Date().toISOString(); // 无论过不过，都记录避免反复探测
      const v = await verifyCandidate(it);
      if (v.homeOk && v.modelsOk) {
        admitted.push({ ...it, ...v });
      } else {
        result.rejected++;
      }
    }
  };
  await Promise.all(Array.from({ length: PROBE_CONCURRENCY }, worker));
  result.verified = admitted.length;

  // 4. 写入投稿队列（等待人工审核，复用现有后台"投稿"页）
  //    简介只保留干净文案（收录时直接可用）；探测信息放 contact（仅编辑可见）
  if (admitted.length) {
    for (const it of admitted) {
      const summary = (it.lines.join('；').slice(0, 160) || '（待补充）');
      subs.unshift({
        id: crypto.randomUUID().slice(0, 8),
        name: it.name,
        url: it.url,
        summary,
        contact: `探测：延迟${it.latencyMs}ms · API端点可达`,
        ip: 'collector',
        submittedAt: new Date().toISOString(),
      });
    }
    writeJson(SUBMISSIONS_FILE, subs.slice(0, 200));
    result.added = admitted.length;
  }
  writeJson(SEEN_FILE, seen);
  return result;
}

// 独立运行：node server/collect.js
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCollect()
    .then((r) => {
      console.log('[collector]', JSON.stringify(r, null, 2));
      for (const s of r.sources) {
        if (!s.ok) console.error(`[collector] 数据源 ${s.id} 拉取失败: ${s.error}`);
      }
      process.exit(r.fetched === 0 && r.sources.every((s) => !s.ok) ? 1 : 0);
    })
    .catch((e) => {
      console.error('[collector] 运行失败:', e);
      process.exit(1);
    });
}
