// ============================================================
// 站点信息自动核验/采集：从站点自身的公开接口抓真实数据并回填 sites.json
//
// 数据源（全部为站点公开接口，非猜测）：
//   - GET /            → 在线状态、延迟、<title>（站点自称名称）
//   - GET /api/pricing → 模型列表 + 分组倍率（New API 系公开接口）
//   - GET /api/notice  → 站点公告
//
// 回填策略（真实性优先）：
//   - multiplier 为空 → 用最低正分组倍率自动补全（记录来源事件）
//   - multiplier 与采集值冲突 → 不覆盖，记"待人工确认"事件
//   - models → 只做并集增长（自动发现新模型类别），不自动删减
//   - notice → 文本变化时更新（详情页展示，标注自动同步）
//   - 每站写入 autoInfo（最近一次自动核验的原始结果）
//
// 用法：服务内每日定时（跟在采集器后）、POST /api/enrich/run 手动触发、
//       node server/enrich.js 独立运行
// ============================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SITES_FILE = path.join(ROOT, 'src', 'data', 'sites.json');

const PROBE_TIMEOUT_MS = 8000;
const SITE_CONCURRENCY = 3;
const MAX_EVENTS = 50;
const NOTICE_MAX_CHARS = 500;

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
    return new URL(url).host;
  } catch {
    return '';
  }
}

async function fetchText(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
  const start = Date.now();
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 TokenFree-Enrich/1.0' },
    });
    const text = await res.text().catch(() => '');
    return { status: res.status, ms: Date.now() - start, text };
  } catch {
    return { status: 0, ms: Date.now() - start, text: '' };
  } finally {
    clearTimeout(timer);
  }
}

function isJsonMaybe(s) {
  return s && !/^\s*</.test(s) && /[{[]/.test(s.slice(0, 5));
}

// ---------- 域名注册日（RDAP 注册局记录，用于"已运营 N 天"）----------
// 返回可注册主域：www.guyscode.com → guyscode.com，ai.xxx.com → xxx.com
function registrable(host) {
  let h = host.replace(/^www\./, '');
  const labels = h.split('.');
  if (labels.length > 2) h = labels.slice(-2).join('.');
  return h;
}

async function lookupDomainRegistration(host) {
  const domain = registrable(host);
  const tld = domain.split('.').pop();
  const endpoints = [`https://rdap.org/domain/${domain}`];
  if (['com', 'net', 'cc'].includes(tld)) endpoints.unshift(`https://rdap.verisign.com/${tld}/v1/domain/${domain}`);
  if (tld === 'cn') endpoints.unshift(`https://rdap.cnnic.cn/domain/${domain}`);
  for (const url of endpoints) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(10000),
        headers: { Accept: 'application/rdap+json', 'User-Agent': 'TokenFree-Enrich/1.0' },
      });
      if (!res.ok) continue;
      const j = await res.json().catch(() => null);
      const reg = j?.events?.find((e) => e.eventAction === 'registration');
      if (reg?.eventDate) return reg.eventDate.slice(0, 10);
    } catch {}
  }
  console.warn(`[enrich] RDAP 域名注册日查询失败 domain=${domain}`);
  return null;
}

// ---------- 模型名 → 站点模型标签（保守映射：只认明确命名的） ----------
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

// ---------- 单站采集 ----------
async function enrichSite(site) {
  const origin = new URL(site.url).origin;
  const [home, pricing, notice] = await Promise.all([
    fetchText(origin),
    fetchText(`${origin}/api/pricing`),
    fetchText(`${origin}/api/notice`),
  ]);

  const info = {
    checkedAt: new Date().toISOString(),
    up: home.status > 0 && home.status < 500,
    latencyMs: home.status > 0 ? home.ms : null,
    title: '',
    modelsDetected: 0,
    minRatio: null,
    freeGroup: false,
    noticeUpdated: false,
  };
  const title = home.text.match(/<title[^>]*>([^<]{1,120})<\/title>/i);
  if (title) info.title = title[1].trim();

  // /api/pricing：模型列表 + 分组倍率（仅接受合法 JSON，防 SPA 兜底 HTML）
  let modelNames = [];
  if (isJsonMaybe(pricing.text)) {
    try {
      const j = JSON.parse(pricing.text);
      const list = Array.isArray(j.data) ? j.data : [];
      modelNames = list.map((m) => String(m.model_name || '')).filter(Boolean);
      const ratioObj = j.group_ratio && typeof j.group_ratio === 'object'
        ? j.group_ratio
        : j.usable_group && typeof j.usable_group === 'object'
          ? j.usable_group
          : null;
      if (ratioObj) {
        const vals = Object.values(ratioObj).map(Number).filter((v) => Number.isFinite(v));
        const positives = vals.filter((v) => v > 0);
        if (positives.length) info.minRatio = Math.min(...positives);
        info.freeGroup = vals.some((v) => v === 0);
      }
    } catch (e) {
      console.warn(`[enrich] pricing JSON 解析失败 site=${site.id} url=${origin}/api/pricing:`, String(e.message || e));
    }
  }
  info.modelsDetected = modelNames.length;

  // /api/notice：纯文本或 {content}。仅接受 HTTP 200 且非 HTML 兜底/错误页
  let noticeText = '';
  if (notice.status === 200) {
    if (isJsonMaybe(notice.text)) {
      try {
        const j = JSON.parse(notice.text);
        noticeText = String(j.content ?? j.data ?? j.notice ?? '').trim();
      } catch (e) {
        console.warn(`[enrich] notice JSON 解析失败 site=${site.id} url=${origin}/api/notice:`, String(e.message || e));
      }
    } else if (!/^\s*</.test(notice.text)) {
      noticeText = notice.text.trim();
    }
  }
  if (/<\/?(html|!doctype|head|body|script)/i.test(noticeText)) noticeText = '';
  if (/^\s*(40[0-9]|not found|error|forbidden)/i.test(noticeText)) noticeText = '';
  if (noticeText.length > 10) noticeText = noticeText.slice(0, NOTICE_MAX_CHARS);
  else noticeText = '';

  return { info, modelNames, noticeText };
}

// ---------- 主流程 ----------
// options.rebuild: () => Promise<void>，数据有变化时由调用方触发重建前台
let enriching = false; // 并发锁：手动触发与定时任务撞车时跳过本次

export async function runEnrich({ rebuild } = {}) {
  if (enriching) return { skipped: true, savedAt: new Date().toISOString() };
  enriching = true;
  try {
    return await doRunEnrich({ rebuild });
  } finally {
    enriching = false;
  }
}

async function doRunEnrich({ rebuild }) {
  const sites = readJson(SITES_FILE, []);
  const report = { checked: 0, up: 0, changed: [], eventsAdded: 0, rebuildTriggered: false, savedAt: new Date().toISOString() };
  const queue = sites.filter((s) => s.status !== 'offline' && s.url);

  const worker = async () => {
    while (queue.length) {
      const site = queue.shift();
      report.checked++;
      let r;
      try {
        r = await enrichSite(site);
      } catch {
        r = { info: { ...nullStub(), checkedAt: new Date().toISOString() }, modelNames: [], noticeText: '' };
      }
      if (r.info.up) report.up++;
      site.autoInfo = r.info;

      // 域名注册日：仅在缺失时查询（查到即永久缓存）
      if (!site.domainRegisteredAt) {
        const host = hostOf(site.url);
        if (host) {
          const regDate = await lookupDomainRegistration(host);
          if (regDate) site.domainRegisteredAt = regDate;
        }
      }

      const changes = [];
      const today = new Date().toISOString().slice(0, 10);
      site.events = Array.isArray(site.events) ? site.events : [];

      // 1. 倍率：为空自动补全；冲突则提示人工确认（绝不静默覆盖编辑值）
      if (r.info.minRatio != null) {
        const collected = Number(r.info.minRatio.toFixed(4));
        if (site.multiplier == null) {
          site.multiplier = collected;
          changes.push(`倍率核验：最低分组 ${collected}x${r.info.freeGroup ? '（另有免费分组）' : ''}`);
        } else if (Math.abs(site.multiplier - collected) / Math.max(site.multiplier, collected) > 0.1) {
          changes.push(`倍率核验：站点最低分组为 ${collected}x，与记录 ${site.multiplier}x 不一致，待复核`);
        }
      }

      // 2. 模型标签：只增不减
      if (r.modelNames.length > 0) {
        const detected = tagsFromModelNames(r.modelNames);
        const before = new Set(site.models || []);
        const added = detected.filter((t) => !before.has(t));
        if (added.length && detected.length) {
          site.models = [...new Set([...(site.models || []), ...detected])];
          changes.push(`模型核验：新增 ${added.join('、')} 标签（站点共 ${r.modelNames.length} 个模型）`);
        }
      }

      // 3. 站点公告：文本变化才更新
      if (r.noticeText && r.noticeText !== (site.notice && site.notice.text)) {
        site.notice = { text: r.noticeText, fetchedAt: today };
        report.noticeChanged = (report.noticeChanged || 0) + 1;
        changes.push('站点公告已收录');
      }

      // 4. 不可达提醒（连续由监测负责，这里只记录本次核验事实）
      if (!r.info.up) {
        changes.push(`核验不可达（${r.info.latencyMs == null ? '超时/网络错误' : 'HTTP 异常'}）`);
      }

      // 状态型事件去重：同文本已存在则不重复追加（如"待人工确认"不应每天刷屏）
      const existing = new Set(site.events.map((e) => e.text));
      for (const text of changes) {
        if (existing.has(text)) continue;
        site.events.push({ date: today, text });
      }
      const addedCount = changes.filter((t) => !existing.has(t)).length;
      report.eventsAdded += addedCount;
      if (addedCount) {
        site.events = site.events.slice(-MAX_EVENTS);
        site.updatedAt = today;
        report.changed.push({ id: site.id, name: site.name, changes: changes.filter((t) => !existing.has(t)) });
      }
    }
  };
  await Promise.all(Array.from({ length: SITE_CONCURRENCY }, worker));

  if (report.checked) writeJson(SITES_FILE, sites);
  if (report.changed.length && typeof rebuild === 'function') {
    try {
      await rebuild();
      report.rebuildTriggered = true;
    } catch (e) {
      report.rebuildError = String(e.message || e);
    }
  }
  return report;
}

function nullStub() {
  return { up: false, latencyMs: null, title: '', modelsDetected: 0, minRatio: null, freeGroup: false, noticeUpdated: false };
}

// 独立运行：node server/enrich.js
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runEnrich()
    .then((r) => {
      console.log('[enrich]', JSON.stringify(r, null, 2));
      if (r.changed.length) console.log('提示：数据有变化，独立运行不会自动重建前台，请在后台点「重建前台」或通过服务定时任务运行。');
    })
    .catch((e) => {
      console.error('[enrich] 运行失败:', e);
      process.exit(1);
    });
}
