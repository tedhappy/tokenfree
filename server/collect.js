// ============================================================
// 自动采集器：从同类导航站抓取中转站候选 → 深度探测 → 写入投稿审核队列
// 人工审核后才进入正式榜单（复用现有投稿审核流，不自动发布）
//
// 采集时自动探测：在线状态、延迟、模型列表、倍率、标签、工具兼容等
// 审核时所有字段自动填充，管理员只需填写推广URL
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
const SEEN_FILE = path.join(DATA_DIR, 'collect-seen.json');

const PROBE_TIMEOUT_MS = 8000;
const DEEP_PROBE_TIMEOUT_MS = 10000;
const PROBE_CONCURRENCY = 6;
const MAX_NEW_PER_RUN = 20;

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

function isJsonMaybe(s) {
  return s && !/^\s*</.test(s) && /[{[]/.test(s.slice(0, 5));
}

// 模型名 → 标签（保守映射）
const MODEL_TAG_RULES = [
  ['gpt', /gpt|chatgpt|(^|[^a-z0-9])o[134](-|$)|codex|davinci/i],
  ['claude', /claude|anthropic/i],
  ['gemini', /gemini|gemma|imagen/i],
  ['grok', /grok/i],
  ['deepseek', /deepseek/i],
  ['qwen', /qwen|qwq/i],
  ['llama', /llama/i],
  ['mistral', /mistral|mixtral/i],
];

function tagsFromModelNames(names) {
  const tags = new Set();
  for (const n of names) {
    for (const [tag, re] of MODEL_TAG_RULES) {
      if (re.test(n)) tags.add(tag);
    }
  }
  return [...tags];
}

// ---------- 数据源适配器 ----------
// 每个适配器返回统一结构：{ name, url, tags[], lines[], disabled, sourceId }
const SOURCES = [
  {
    id: 'freetokennav',
    label: 'FreeTokenNav',
    url: 'https://freetokennav.com/',
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
        const clean = url.split('?')[0];
        items.push({
          name: decodeEntities(name),
          url: clean,
          tags: [...body.matchAll(/<span class="tag[^"]*">([^<]+)<\/span>/g)].map((t) => decodeEntities(t[1].trim())),
          lines: [...body.matchAll(/<p>([^<]+)<\/p>/g)].map((p) => decodeEntities(p[1].trim())),
          disabled: cls.includes('disabled-card'),
          sourceId: 'freetokennav',
        });
      }
      return items;
    },
  },
  {
    id: 'openrouter-nav',
    label: 'OpenRouter类导航',
    url: 'https://api.openrouter.ai/api/v1/models',
    async fetch() {
      // 从 OpenRouter 公开 API 获取模型列表，提取关联的中转站
      const res = await fetch(this.url, {
        signal: AbortSignal.timeout(15000),
        headers: { 'User-Agent': 'TokenFree-Collector/1.0' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json().catch(() => null);
      if (!j?.data) return [];
      // OpenRouter 本身不是导航站，但可以作为模型名参考源
      return [];
    },
  },
  {
    id: 'ai-api-nav',
    label: 'AI-API导航站',
    url: 'https://api.v1relay.com/',
    async fetch() {
      const res = await fetch(this.url, {
        signal: AbortSignal.timeout(15000),
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) TokenFree-Collector/1.0' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();
      const items = [];
      // 通用卡片提取：匹配常见导航站结构
      // 模式1：<a href="https://xxx">站名</a> + 简介
      for (const m of html.matchAll(/<a[^>]*href="(https?:\/\/[^"]+)"[^>]*>([^<]{2,40})<\/a>/gi)) {
        const url = m[1];
        const name = decodeEntities(m[2].trim());
        const host = hostOf(url);
        if (!host || host.includes('github.com') || host.includes('google.com')) continue;
        items.push({ name, url: url.split('?')[0], tags: [], lines: [], disabled: false, sourceId: 'ai-api-nav' });
      }
      return items;
    },
  },
  {
    id: 'chat-api-hub',
    label: 'ChatAPI聚合站',
    url: 'https://chatapihub.com/',
    async fetch() {
      const res = await fetch(this.url, {
        signal: AbortSignal.timeout(15000),
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) TokenFree-Collector/1.0' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();
      const items = [];
      // 匹配常见导航站的站点卡片
      const cardRegex = /<(?:div|section|article)[^>]*class="[^"]*(?:card|site|item)[^"]*"[\s\S]*?<\/(?:div|section|article)>/gi;
      for (const card of html.matchAll(cardRegex)) {
        const body = card[0];
        const nameM = body.match(/<(?:h[2-6]|strong|b)[^>]*>([^<]{2,40})<\//);
        const linkM = body.match(/href="(https?:\/\/[^"]+)"/);
        if (!nameM || !linkM) continue;
        const name = decodeEntities(nameM[1].trim());
        const url = linkM[1].split('?')[0];
        const tags = [...body.matchAll(/<(?:span|tag)[^>]*>([^<]{1,20})<\//g)].map(t => decodeEntities(t[1].trim()));
        items.push({ name, url, tags, lines: [], disabled: false, sourceId: 'chat-api-hub' });
      }
      return items;
    },
  },
  {
    id: 'relay-list',
    label: 'RelayList导航',
    url: 'https://relaylist.com/',
    async fetch() {
      const res = await fetch(this.url, {
        signal: AbortSignal.timeout(15000),
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) TokenFree-Collector/1.0' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();
      const items = [];
      // JSON-LD 或内嵌数据
      for (const m of html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) {
        try {
          const j = JSON.parse(m[1]);
          const list = Array.isArray(j) ? j : j.itemListElement || [];
          for (const item of list) {
            const url = item.url || item.item?.url;
            const name = item.name || item.item?.name;
            if (url && name) items.push({ name, url: url.split('?')[0], tags: [], lines: [], disabled: false, sourceId: 'relay-list' });
          }
        } catch {}
      }
      // 备选：通用链接提取
      if (items.length === 0) {
        for (const m of html.matchAll(/href="(https?:\/\/(?!.*(?:github|google|twitter|telegram)\.com)[^"]+)"[^>]*>\s*([^<]{2,30})\s*<\//gi)) {
          items.push({ name: decodeEntities(m[2].trim()), url: m[1].split('?')[0], tags: [], lines: [], disabled: false, sourceId: 'relay-list' });
        }
      }
      return items;
    },
  },
  {
    id: 'free-api-nav',
    label: 'FreeAPI导航',
    url: 'https://freeapi.dev/',
    async fetch() {
      const res = await fetch(this.url, {
        signal: AbortSignal.timeout(15000),
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) TokenFree-Collector/1.0' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();
      const items = [];
      // 提取所有外链到 API 中转站
      for (const m of html.matchAll(/href="(https?:\/\/(?!.*(?:github|google|twitter|telegram|discord|npmjs)\.com)[^"]*\/(?:register|signup|login)?)"[^>]*>\s*([^<]{2,40})\s*<\//gi)) {
        const url = m[1].split('?')[0];
        const name = decodeEntities(m[2].trim());
        if (!name || name.length < 2) continue;
        items.push({ name, url, tags: [], lines: [], disabled: false, sourceId: 'free-api-nav' });
      }
      return items;
    },
  },
];

// ---------- 深度探测：采集站点详细信息 ----------
async function deepProbe(url) {
  const origin = new URL(url).origin;
  const result = {
    latencyMs: null,
    modelsDetected: 0,
    modelNames: [],
    minRatio: null,
    freeGroup: false,
    tags: [],
    network: 'unknown',
    title: '',
    bonus: '',
    tools: [],
  };

  // 首页探测
  const home = await fetchText(origin);
  result.latencyMs = home.ms;
  if (home.status > 0 && home.status < 500) {
    const titleM = home.text.match(/<title[^>]*>([^<]{1,120})<\/title>/i);
    if (titleM) result.title = titleM[1].trim();
    result.network = 'unknown';
  }

  // /api/pricing：模型列表 + 分组倍率
  const pricing = await fetchText(`${origin}/api/pricing`);
  if (isJsonMaybe(pricing.text)) {
    try {
      const j = JSON.parse(pricing.text);
      const list = Array.isArray(j.data) ? j.data : [];
      result.modelNames = list.map((m) => String(m.model_name || '')).filter(Boolean);
      result.modelsDetected = result.modelNames.length;
      result.tags = tagsFromModelNames(result.modelNames);

      const ratioObj = j.group_ratio && typeof j.group_ratio === 'object'
        ? j.group_ratio
        : j.usable_group && typeof j.usable_group === 'object'
          ? j.usable_group
          : null;
      if (ratioObj) {
        const vals = Object.values(ratioObj).map(Number).filter((v) => Number.isFinite(v));
        const positives = vals.filter((v) => v > 0);
        if (positives.length) result.minRatio = Math.min(...positives);
        result.freeGroup = vals.some((v) => v === 0);
      }
    } catch {}
  }

  // 工具兼容检测
  const toolChecks = [
    { id: 'cursor', path: '/api/v1/chat/completions', method: 'POST', body: '{"model":"gpt-3.5-turbo","messages":[{"role":"user","content":"hi"}],"max_tokens":1}' },
    { id: 'claude-code', path: '/v1/messages', method: 'POST', body: '{"model":"claude-3-haiku-20240307","messages":[{"role":"user","content":"hi"}],"max_tokens":1}' },
  ];
  for (const tc of toolChecks) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 5000);
      const res = await fetch(`${origin}${tc.path}`, {
        method: tc.method,
        signal: ctrl.signal,
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'TokenFree-Collector/1.0' },
        body: tc.body,
      });
      clearTimeout(timer);
      // 401/403/405 = 端点存在且鉴权正常
      if ([401, 403, 405].includes(res.status)) {
        result.tools.push(tc.id);
      }
    } catch {}
  }

  return result;
}

async function fetchText(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), DEEP_PROBE_TIMEOUT_MS);
  const start = Date.now();
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 TokenFree-Collector/1.0' },
    });
    const text = await res.text().catch(() => '');
    return { status: res.status, ms: Date.now() - start, text };
  } catch {
    return { status: 0, ms: Date.now() - start, text: '' };
  } finally {
    clearTimeout(timer);
  }
}

// ---------- 探测验证（快速） ----------
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

async function verifyCandidate(item) {
  const origin = new URL(item.url).origin;
  const [home, models] = await Promise.all([probe(origin), probe(`${origin}/v1/models`)]);
  const homeOk = home.status > 0 && home.status < 500;
  const modelsOk = [401, 403, 405].includes(models.status);
  return { homeOk, modelsOk, latencyMs: home.ms };
}

// ---------- 主流程 ----------
let collecting = false;

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

  // 2. 去重：按 host 去重，同一 host 只保留第一个
  const sites = readJson(SITES_FILE, []);
  const subs = readJson(SUBMISSIONS_FILE, []);
  const seen = readJson(SEEN_FILE, {});
  const knownHosts = new Set([
    ...sites.map((s) => hostOf(s.url)),
    ...subs.map((s) => hostOf(s.url)),
    ...Object.keys(seen),
  ]);

  const fresh = [];
  const seenHosts = new Set();
  for (const it of items) {
    const h = hostOf(it.url);
    if (it.disabled || !h || knownHosts.has(h) || seenHosts.has(h)) continue;
    seenHosts.add(h);
    fresh.push(it);
  }
  result.candidates = fresh.length;
  result.skippedKnown = items.length - fresh.length;

  // 3. 逐个探测验证 + 深度采集（限制并发）
  const queue = [...fresh];
  const admitted = [];
  const worker = async () => {
    while (queue.length && admitted.length < maxNew) {
      const it = queue.shift();
      const host = hostOf(it.url);
      seen[host] = new Date().toISOString();
      const v = await verifyCandidate(it);
      if (v.homeOk && v.modelsOk) {
        // 快速验证通过后，进行深度探测采集详细信息
        let deep = {};
        try {
          deep = await deepProbe(it.url);
        } catch {}
        admitted.push({ ...it, ...v, deep });
      } else {
        result.rejected++;
      }
    }
  };
  await Promise.all(Array.from({ length: PROBE_CONCURRENCY }, worker));
  result.verified = admitted.length;

  // 4. 写入投稿队列（包含所有探测到的字段）
  if (admitted.length) {
    for (const it of admitted) {
      const summary = (it.lines.join('；').slice(0, 160) || it.deep.title || '（待补充）');
      const deep = it.deep || {};
      subs.unshift({
        id: crypto.randomUUID().slice(0, 8),
        // 基本信息
        name: it.name,
        url: it.url,
        summary,
        // 自动探测的字段（审核时自动填充）
        multiplier: deep.minRatio ?? null,
        models: deep.tags || [],
        tags: it.tags || [],
        tools: deep.tools || [],
        network: deep.network || 'unknown',
        bonus: deep.bonus || '',
        apiBase: `${new URL(it.url).origin}/v1`,
        // 探测元信息
        contact: `来源: ${it.sourceId || 'unknown'} · 延迟${it.latencyMs}ms · 模型${deep.modelsDetected || 0}个${deep.freeGroup ? ' · 含免费分组' : ''}`,
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
