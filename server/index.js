import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serveStatic } from '@hono/node-server/serve-static';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { runCollect } from './collect.js';
import { runEnrich } from './enrich.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'src', 'data');
const SITES_FILE = path.join(DATA_DIR, 'sites.json');
const MODELS_FILE = path.join(DATA_DIR, 'models.json');
const CLICKS_FILE = path.join(DATA_DIR, 'clicks.json');
const UPTIME_FILE = path.join(DATA_DIR, 'uptime.json');
const SUBMISSIONS_FILE = path.join(DATA_DIR, 'submissions.json');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const AUDIT_FILE = path.join(DATA_DIR, 'audit.json');

// ---- 业务数据兜底：运行时三件套缺失时用 .seed.json 生成，避免全新环境报错 ----
// 服务器/本地已有运行时文件则保持不变，绝不覆盖业务数据
const DATA_SEED_PAIRS = [
  [SITES_FILE, path.join(DATA_DIR, 'sites.seed.json')],
  [CONFIG_FILE, path.join(DATA_DIR, 'config.seed.json')],
  [MODELS_FILE, path.join(DATA_DIR, 'models.seed.json')],
];
for (const [runtime, seed] of DATA_SEED_PAIRS) {
  if (fs.existsSync(runtime)) continue;
  if (fs.existsSync(seed)) {
    fs.copyFileSync(seed, runtime);
    console.log(`[data] 生成空缺数据文件 ${path.basename(runtime)}（来自 seed）`);
  } else {
    console.error(`[data] 缺少 ${path.basename(runtime)} 且无 ${path.basename(seed)} 可兜底`);
  }
}

// ---- 加载 .env（.env 优先，覆盖 pm2/Shell 缓存的旧值）----
function parseEnvValue(raw) {
  let val = String(raw ?? '').trim();
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
    return val.slice(1, -1);
  }
  return val;
}
try {
  const envText = fs.readFileSync(path.join(ROOT, '.env'), 'utf-8');
  for (const line of envText.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const m = trimmed.match(/^([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (m) process.env[m[1]] = parseEnvValue(m[2]);
  }
} catch {}

// ---- 配置 ----
const PORT = Number(process.env.PORT || 4321);
// HOST=127.0.0.1 时仅本机可访问（Nginx 反代场景推荐，避免绕过 CDN 直连源站）
const HOST = process.env.HOST || '0.0.0.0';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const SESSION_TTL_HOURS = 24;
const MONITOR_INTERVAL_MIN = Number(process.env.MONITOR_INTERVAL_MIN || 30);
const MONITOR_TIMEOUT_MS = 8000;
const MONITOR_CONCURRENCY = 8;
// 自动采集：从同类导航站抓取候选进投稿队列（小时，0 关闭；默认每天一次）
const COLLECT_INTERVAL_HOURS = Number(process.env.COLLECT_INTERVAL_HOURS ?? 24);
// 自动核验/信息回填后是否自动重建前台（默认开；关闭后需手动点「重建前台」）
const REBUILD_ON_CHANGE = process.env.REBUILD_ON_CHANGE !== '0';

if (!ADMIN_PASSWORD && process.env.NODE_ENV === 'production') {
  console.error('[fatal] 生产环境必须设置 ADMIN_PASSWORD 环境变量');
  process.exit(1);
}

// ---- 通用 ----
const sessions = new Map();
const loginAttempts = new Map();
const submitAttempts = new Map(); // ip -> timestamps[]
const MAX_LOGIN_FAILS = 5;
const LOCK_MS = 15 * 60 * 1000;
const SUBMIT_LIMIT_PER_HOUR = 5;

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

// ---- 操作审计日志（记录管理员关键操作，支持追溯）----
function logAudit(action, target, detail = '') {
  try {
    const logs = readJson(AUDIT_FILE, []);
    logs.unshift({
      time: new Date().toISOString().replace('T', ' ').slice(0, 19),
      action,
      target,
      detail,
    });
    writeJson(AUDIT_FILE, logs.slice(0, 500)); // 最多保留 500 条
  } catch {}
}

function newToken() {
  return crypto.randomBytes(32).toString('hex');
}

function auth(token) {
  if (!token) return false;
  const exp = sessions.get(token);
  if (!exp) return false;
  if (Date.now() > exp) {
    sessions.delete(token);
    return false;
  }
  return true;
}

function authed(c) {
  return auth(c.req.header('Authorization')?.replace('Bearer ', ''));
}

function clientIp(c) {
  return (
    c.req.header('x-forwarded-for')?.split(',')[0].trim() ||
    c.req.header('x-real-ip') ||
    'unknown'
  );
}

// ============================================================
// 可用性监测：周期性探测各站点，记录历史，供前台实时状态
// ============================================================
const uptime = new Map(); // siteId -> { checks: [{t, ok, ms}], lastCheck }
try {
  const saved = readJson(UPTIME_FILE, {});
  for (const [k, v] of Object.entries(saved)) uptime.set(k, v);
} catch {}

let monitoring = false;

function persistUptime() {
  const obj = {};
  for (const [k, v] of uptime.entries()) obj[k] = v;
  writeJson(UPTIME_FILE, obj);
}

async function timedFetch(url, timeoutMs = MONITOR_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const start = Date.now();
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: ctrl.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 TokenFree-Monitor/1.0' },
    });
    return { res, ms: Date.now() - start };
  } finally {
    clearTimeout(timer);
  }
}

/** 探测 /v1/models 判断 API 端点是否正常：
 *  401/403/405 = 端点存在且鉴权正常（true）；5xx = 端点存在但故障（false）；
 *  404/超时/非 JSON 的 200 = 无法判断（null） */
async function checkApiEndpoint(origin) {
  try {
    const { res } = await timedFetch(`${origin}/v1/models`, 6000);
    if ([401, 403, 405].includes(res.status)) return true;
    if (res.status >= 500) return false;
    if (res.status === 200) {
      const ct = res.headers.get('content-type') || '';
      return ct.includes('json') ? true : null; // HTML 200 多为 SPA 兜底，不算
    }
    return null;
  } catch {
    return null;
  }
}

async function checkSite(url) {
  const origin = new URL(url).origin;
  const [home, api] = await Promise.all([
    timedFetch(url).then(({ res, ms }) => ({ ok: res.status < 500, ms })).catch(() => ({ ok: false, ms: null })),
    checkApiEndpoint(origin),
  ]);
  return { ok: home.ok, ms: home.ms, api };
}

async function runMonitor() {
  if (monitoring) return { skipped: true };
  monitoring = true;
  try {
    const sites = readJson(SITES_FILE, []).filter((s) => s.status !== 'offline' && s.url);
    // 清理已下架/删除站点的陈旧监测记录，避免污染全站在线率
    const liveIds = new Set(sites.map((s) => s.id));
    let pruned = false;
    for (const id of [...uptime.keys()]) {
      if (!liveIds.has(id)) {
        uptime.delete(id);
        pruned = true;
      }
    }
    let done = 0;
    const queue = [...sites];
    const worker = async () => {
      while (queue.length) {
        const site = queue.shift();
        const { ok, ms, api } = await checkSite(site.url);
        const rec =
          uptime.get(site.id) || { checks: [], lastCheck: 0 };
        rec.checks.push({ t: Date.now(), ok, ms, api });
        if (rec.checks.length > 336) rec.checks = rec.checks.slice(-336); // 保留约 7 天历史（30 分钟间隔）
        rec.lastCheck = Date.now();
        uptime.set(site.id, rec);
        done++;
      }
    };
    await Promise.all(Array.from({ length: MONITOR_CONCURRENCY }, worker));
    persistUptime();
    return { ok: true, checked: done, pruned: pruned ? true : undefined, at: new Date().toISOString() };
  } finally {
    monitoring = false;
  }
}

function uptimeSummary() {
  // 只输出当前榜单内站点的数据（防止历史遗留记录影响前台聚合）
  const currentIds = new Set(readJson(SITES_FILE, []).map((s) => s.id));
  const out = {};
  for (const [siteId, rec] of uptime.entries()) {
    if (!currentIds.has(siteId)) continue;
    const recent = rec.checks.slice(-48); // 约24小时
    const upCount = recent.filter((c) => c.ok).length;
    const lastOk = [...rec.checks].reverse().find((c) => c.ok);
    const lastFail = [...rec.checks].reverse().find((c) => !c.ok);
    // API 端点状态：取最近一次可判断的探测结果
    const lastApi = [...rec.checks].reverse().find((c) => c.api === true || c.api === false);
    out[siteId] = {
      lastCheck: rec.lastCheck,
      up: lastOk && (!lastFail || lastOk.t >= lastFail.t),
      latencyMs: lastOk ? lastOk.ms : null,
      apiUp: lastApi ? lastApi.api : null,
      uptime24h: recent.length ? upCount / recent.length : null,
      checks: recent.length,
    };
  }
  return out;
}

const app = new Hono();
app.use('/api/*', cors());

// 统一鉴权中间件：除公开接口（登录/登出/点击/投稿/只读监测/公开配置）外，其余 /api 均需 Bearer token。
// 集中收敛既有的逐条 authed 校验，新增管理路由默认鉴权，规避遗漏。
const PUBLIC_API = [
  { m: 'POST', p: '/api/login' },
  { m: 'POST', p: '/api/logout' },
  { m: 'POST', p: '/api/click' },
  { m: 'POST', p: '/api/submit' },
  { m: 'GET', p: '/api/hot' },
  { m: 'GET', p: '/api/uptime' },
  { m: 'GET', p: '/api/uptime/history/' },
  { m: 'GET', p: '/api/config' },
];
app.use('/api/*', async (c, next) => {
  const method = c.req.method;
  const path = c.req.path;
  const isPublic = PUBLIC_API.some((r) => {
    if (r.m !== method) return false;
    return r.p.endsWith('/') ? path.startsWith(r.p) : path === r.p;
  });
  if (!isPublic && !authed(c)) return c.json({ error: '未授权' }, 401);
  await next();
});

// ---- 认证 ----
app.post('/api/login', async (c) => {
  const ip = clientIp(c);
  const rec = loginAttempts.get(ip);
  if (rec && rec.lockedUntil > Date.now()) {
    return c.json({ error: '尝试次数过多，请 15 分钟后再试' }, 429);
  }
  const { password } = await c.req.json().catch(() => ({}));
  // timingSafeEqual 字节数不等会抛异常，先比字节长度（多字节密码也安全返回 401）
  const pwdBuf = typeof password === 'string' ? Buffer.from(password) : null;
  const admBuf = Buffer.from(ADMIN_PASSWORD);
  const ok = Boolean(pwdBuf) && pwdBuf.length === admBuf.length && crypto.timingSafeEqual(pwdBuf, admBuf);
  if (!ok) {
    const r = loginAttempts.get(ip) || { count: 0, lockedUntil: 0 };
    r.count += 1;
    if (r.count >= MAX_LOGIN_FAILS) {
      r.lockedUntil = Date.now() + LOCK_MS;
      r.count = 0;
    }
    loginAttempts.set(ip, r);
    return c.json({ error: '密码错误' }, 401);
  }
  loginAttempts.delete(ip);
  const token = newToken();
  sessions.set(token, Date.now() + SESSION_TTL_HOURS * 3600 * 1000);
  return c.json({ token });
});

app.post('/api/logout', (c) => {
  const token = c.req.header('Authorization')?.replace('Bearer ', '');
  if (token) sessions.delete(token);
  return c.json({ ok: true });
});

// ---- 站点 CRUD ----
// 避雷榜已下线，旧链接 301 回首页
app.get('/blacklist', (c) => c.redirect('/', 301));

app.get('/api/sites', (c) => {
  return c.json(readJson(SITES_FILE, []));
});

app.post('/api/sites', async (c) => {
  const site = await c.req.json();
  if (!site.name || typeof site.name !== 'string') {
    return c.json({ error: 'name 必填' }, 400);
  }
  const sites = readJson(SITES_FILE, []);
  site.id = site.id || crypto.randomUUID().slice(0, 8);
  site.createdAt = site.createdAt || new Date().toISOString().slice(0, 10);
  site.updatedAt = new Date().toISOString().slice(0, 10);
  sites.push(site);
  writeJson(SITES_FILE, sites);
  logAudit('新增站点', site.name, `id=${site.id}`);
  return c.json(site, 201);
});

app.put('/api/sites/:id', async (c) => {
  const id = c.req.param('id');
  const updated = await c.req.json();
  const sites = readJson(SITES_FILE, []);
  const idx = sites.findIndex((s) => s.id === id);
  if (idx === -1) return c.json({ error: '站点不存在' }, 404);
  updated.id = id;
  updated.updatedAt = new Date().toISOString().slice(0, 10);
  sites[idx] = { ...sites[idx], ...updated };
  writeJson(SITES_FILE, sites);
  logAudit('更新站点', sites[idx].name, `id=${id}`);
  return c.json(sites[idx]);
});

app.delete('/api/sites/:id', (c) => {
  const id = c.req.param('id');
  let sites = readJson(SITES_FILE, []);
  const target = sites.find((s) => s.id === id);
  const before = sites.length;
  sites = sites.filter((s) => s.id !== id);
  if (sites.length === before) return c.json({ error: '站点不存在' }, 404);
  writeJson(SITES_FILE, sites);
  logAudit('删除站点', target?.name || id, `id=${id}`);
  return c.json({ ok: true });
});

// ---- 模型标签 ----
app.get('/api/models', (c) => {
  return c.json(readJson(MODELS_FILE, []));
});

app.put('/api/models', async (c) => {
  const models = await c.req.json();
  if (!Array.isArray(models)) return c.json({ error: '格式错误' }, 400);
  writeJson(MODELS_FILE, models);
  return c.json({ ok: true });
});

// ---- 点击统计（公开）----
app.post('/api/click', async (c) => {
  const { siteId } = await c.req.json().catch(() => ({}));
  if (typeof siteId !== 'string' || siteId.length > 64) {
    return c.json({ error: 'invalid' }, 400);
  }
  const clicks = readJson(CLICKS_FILE, {});
  clicks[siteId] = (clicks[siteId] || 0) + 1;
  writeJson(CLICKS_FILE, clicks);
  return c.json({ ok: true });
});

// 热度（公开读）：各站点累计点击数
app.get('/api/hot', (c) => c.json(readJson(CLICKS_FILE, {})));

// ---- 外链跳转：服务端直接 302（无中间页），同步计点击 ----
app.get('/go', async (c) => {
  const raw = c.req.query('url') || '';
  const siteId = c.req.query('id') || '';
  let target = '';
  try { target = decodeURIComponent(raw); } catch { target = raw; }
  if (!/^https?:\/\//i.test(target)) return c.redirect('/', 302);
  if (siteId && siteId.length <= 64) {
    try {
      const clicks = readJson(CLICKS_FILE, {});
      clicks[siteId] = (clicks[siteId] || 0) + 1;
      writeJson(CLICKS_FILE, clicks);
    } catch {}
  }
  return c.redirect(target, 302);
});

// ---- 监测（公开读 + 鉴权触发）----
app.get('/api/uptime', (c) => c.json(uptimeSummary()));

// 单站监测历史（最近 7 天），详情页趋势图用
app.get('/api/uptime/history/:id', (c) => {
  const id = c.req.param('id');
  const rec = uptime.get(id);
  if (!rec) return c.json({ checks: [] });
  return c.json({ checks: rec.checks.slice(-336).map(({ t, ok, ms, api }) => ({ t, ok, ms, api })) });
});

app.post('/api/monitor/run', (c) => {
  const result = runMonitor();
  return result.then((r) => c.json(r));
});

// ---- 自动采集（鉴权触发；结果进投稿队列）----
app.post('/api/collect/run', (c) => {
  return runCollect()
    .then((r) => c.json(r))
    .catch((e) => c.json({ error: e.message }, 500));
});

// ---- 站点信息自动核验/回填（鉴权触发；有变化时自动重建前台）----
app.post('/api/enrich/run', (c) => {
  return runEnrich({ rebuild: tryRebuild })
    .then((r) => c.json(r))
    .catch((e) => c.json({ error: e.message }, 500));
});

// ---- 投稿（公开提交 + 鉴权管理）----
app.post('/api/submit', async (c) => {
  const ip = clientIp(c);
  const now = Date.now();
  const list = (submitAttempts.get(ip) || []).filter((t) => now - t < 3600_000);
  if (list.length >= SUBMIT_LIMIT_PER_HOUR) {
    return c.json({ error: '提交过于频繁，请 1 小时后再试' }, 429);
  }
  list.push(now);
  submitAttempts.set(ip, list);

  const body = await c.req.json().catch(() => ({}));
  // 蜜罐字段：机器人常规会填，人类不可见
  if (body.website) return c.json({ ok: true });

  const name = String(body.name || '').trim();
  const url = String(body.url || '').trim();
  const summary = String(body.summary || '').trim();
  const contact = String(body.contact || '').trim().slice(0, 100);

  if (!name || name.length > 50) return c.json({ error: '请填写站点名称（50字内）' }, 400);
  if (!/^https?:\/\/.{4,}/i.test(url)) return c.json({ error: '请填写正确的站点 URL' }, 400);
  if (!summary || summary.length > 200) return c.json({ error: '请填写简介（200字内）' }, 400);

  const submissions = readJson(SUBMISSIONS_FILE, []);
  if (submissions.some((s) => s.url === url)) {
    return c.json({ error: '该 URL 已在投稿队列中' }, 409);
  }
  submissions.unshift({
    id: crypto.randomUUID().slice(0, 8),
    name,
    url,
    summary,
    contact,
    ip,
    submittedAt: new Date().toISOString(),
  });
  writeJson(SUBMISSIONS_FILE, submissions.slice(0, 200));
  return c.json({ ok: true });
});

app.get('/api/submissions', (c) => {
  return c.json(readJson(SUBMISSIONS_FILE, []));
});

/** 校验投稿字段，返回错误文案或 null */
function validateSubmissionFields(body, subs, excludeId = null) {
  const name = String(body.name || '').trim();
  const url = String(body.url || '').trim();
  const summary = String(body.summary || '').trim();
  const contact = String(body.contact || '').trim().slice(0, 100);
  if (!name || name.length > 50) return '请填写站点名称（50字内）';
  if (!/^https?:\/\/.{4,}/i.test(url)) return '请填写正确的站点 URL';
  if (!summary || summary.length > 200) return '请填写简介（200字内）';
  if (subs.some((s) => s.url === url && s.id !== excludeId)) return '该 URL 已在投稿队列中';
  return null;
}

app.put('/api/submissions/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const subs = readJson(SUBMISSIONS_FILE, []);
  const idx = subs.findIndex((s) => s.id === id);
  if (idx < 0) return c.json({ error: '不存在' }, 404);
  const err = validateSubmissionFields(body, subs, id);
  if (err) return c.json({ error: err }, 400);
  const prev = subs[idx];
  subs[idx] = {
    ...prev,
    name: String(body.name || '').trim(),
    url: String(body.url || '').trim(),
    summary: String(body.summary || '').trim(),
    contact: String(body.contact || '').trim().slice(0, 100),
  };
  writeJson(SUBMISSIONS_FILE, subs);
  logAudit('编辑投稿', prev.name, `id=${id}`);
  return c.json({ ok: true, submission: subs[idx] });
});

app.delete('/api/submissions/:id', (c) => {
  const id = c.req.param('id');
  const reason = c.req.query('reason');
  let subs = readJson(SUBMISSIONS_FILE, []);
  const target = subs.find((s) => s.id === id);
  const before = subs.length;
  subs = subs.filter((s) => s.id !== id);
  if (subs.length === before) return c.json({ error: '不存在' }, 404);
  writeJson(SUBMISSIONS_FILE, subs);
  logAudit(reason === 'approved' ? '收录投稿' : '丢弃投稿', target?.name || id, `id=${id}`);
  return c.json({ ok: true });
});

// ---- 统计（含监测合并视图）----
app.get('/api/stats', (c) => {
  const sites = readJson(SITES_FILE, []);
  const clicks = readJson(CLICKS_FILE, {});
  const up = uptimeSummary();
  // 连续失败 3 次以上且从未成功的站点 → 疑似失效
  const suspect = sites
    .filter((s) => s.status !== 'offline' && up[s.id] && !up[s.id].up && (up[s.id].checks || 0) >= 3)
    .map((s) => ({ id: s.id, name: s.name, checks: up[s.id].checks }));
  // 推广链接待补：唯一需要人工操作的字段（去对应站注册拿自己的 aff 码）
  const affPending = sites
    .filter((s) => s.status !== 'offline' && s.url && !s.affUrl)
    .map((s) => ({ id: s.id, name: s.name, url: s.url }));
  return c.json({
    total: sites.length,
    stable: sites.filter((s) => s.status === 'stable').length,
    unstable: sites.filter((s) => s.status === 'unstable').length,
    offline: sites.filter((s) => s.status === 'offline').length,
    featured: sites.filter((s) => s.isFeatured).length,
    submissionsCount: readJson(SUBMISSIONS_FILE, []).length,
    clicks,
    uptime: up,
    suspect,
    affPending,
    monitor: { intervalMin: MONITOR_INTERVAL_MIN, pending: monitoring },
  });
});

// ---- 重建前台 ----
let building = false;

function runBuild() {
  return new Promise((resolve, reject) => {
    const child = spawn('npm run build', { cwd: ROOT, stdio: 'ignore', shell: true });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('构建超时（120s）'));
    }, 120_000);
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error('构建失败，退出码 ' + code));
    });
  });
}

app.post('/api/rebuild', async (c) => {
  if (building) return c.json({ error: '已有构建在进行中' }, 409);
  building = true;
  try {
    await runBuild();
    return c.json({ ok: true });
  } catch (e) {
    return c.json({ error: e.message }, 500);
  } finally {
    building = false;
  }
});

// 数据有变化时重建前台（供自动任务用；受 REBUILD_ON_CHANGE 控制）
async function tryRebuild() {
  if (!REBUILD_ON_CHANGE) return;
  if (building) throw new Error('已有构建在进行中');
  building = true;
  try {
    await runBuild();
  } finally {
    building = false;
  }
}

// ---- 配置（公告/社群/AFF，公开读 + 鉴权写）----
app.get('/api/config', (c) => c.json(readJson(CONFIG_FILE, {})));

app.put('/api/config', async (c) => {
  const cfg = await c.req.json();
  if (typeof cfg !== 'object' || !cfg) return c.json({ error: '格式错误' }, 400);
  writeJson(CONFIG_FILE, cfg);
  logAudit('更新配置', 'config.json', cfg.announcements ? `公告 ${cfg.announcements.length} 条` : '');
  return c.json({ ok: true });
});

// ---- 操作审计日志（鉴权）----
app.get('/api/audit', (c) => {
  return c.json(readJson(AUDIT_FILE, []));
});

// ---- 数据导出备份（鉴权）----
app.get('/api/export', (c) => {
  return c.json({
    exportedAt: new Date().toISOString(),
    sites: readJson(SITES_FILE, []),
    models: readJson(MODELS_FILE, []),
    config: readJson(CONFIG_FILE, {}),
    clicks: readJson(CLICKS_FILE, {}),
    uptime: readJson(UPTIME_FILE, {}),
    submissions: readJson(SUBMISSIONS_FILE, []),
  });
});

// ---- 静态托管 ----
// favicon 每次更新后浏览器可能长期使用本地缓存，禁止缓存以确保换图标后立即生效
app.use('/favicon.svg', async (c, next) => {
  await next();
  c.res.headers.set('Cache-Control', 'no-cache, must-revalidate');
});
app.use('/admin/*', serveStatic({ root: './public' }));
app.use('/*', serveStatic({ root: './dist' }));

// 启动监测定时器
if (MONITOR_INTERVAL_MIN > 0) {
  setInterval(() => runMonitor().catch(() => {}), MONITOR_INTERVAL_MIN * 60_000);
  // 启动 30 秒后跑第一轮
  setTimeout(() => runMonitor().catch(() => {}), 30_000);
}

// 启动自动采集 + 信息核验定时器（结果进投稿队列 / 回填站点数据，等待人工审核）
if (COLLECT_INTERVAL_HOURS > 0) {
  const dailyJob = async () => {
    try {
      const c = await runCollect();
      console.log(`[collector] 定时采集：+${c.added} 个候选入投稿队列`);
    } catch (e) {
      console.error('[collector] 定时采集失败:', e.message);
    }
    try {
      const e = await runEnrich({ rebuild: tryRebuild });
      const msg = `核验 ${e.checked} 站，${e.changed.length} 站有更新，共 ${e.eventsAdded} 条记录${e.rebuildTriggered ? '，已重建前台' : ''}`;
      console.log(`[enrich] ${msg}`);
    } catch (e) {
      console.error('[enrich] 定时核验失败:', e.message);
    }
  };
  setInterval(dailyJob, COLLECT_INTERVAL_HOURS * 3600_000);
  // 启动 5 分钟后跑第一轮，避开启动高峰
  setTimeout(dailyJob, 5 * 60_000);
}

console.log(
  `[admin] listening on http://0.0.0.0:${PORT} (monitor every ${MONITOR_INTERVAL_MIN}min, collect every ${COLLECT_INTERVAL_HOURS}h)`
);
serve({ fetch: app.fetch, port: PORT, hostname: HOST });
