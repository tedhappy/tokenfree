import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serveStatic } from '@hono/node-server/serve-static';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'src', 'data');
const SITES_FILE = path.join(DATA_DIR, 'sites.json');
const MODELS_FILE = path.join(DATA_DIR, 'models.json');
const CLICKS_FILE = path.join(DATA_DIR, 'clicks.json');
const UPTIME_FILE = path.join(DATA_DIR, 'uptime.json');
const SUBMISSIONS_FILE = path.join(DATA_DIR, 'submissions.json');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');

// ---- 加载 .env（简单实现，已有环境变量优先；便于服务器免敲 export）----
try {
  const envText = fs.readFileSync(path.join(ROOT, '.env'), 'utf-8');
  for (const line of envText.split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
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

async function checkSite(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), MONITOR_TIMEOUT_MS);
  const start = Date.now();
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: ctrl.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 TokenFree-Monitor/1.0' },
    });
    // 2xx/3xx/401/403 都算站点活着（登录墙不代表挂了）
    const ok = res.status < 500;
    return { ok, ms: Date.now() - start };
  } catch {
    return { ok: false, ms: Date.now() - start };
  } finally {
    clearTimeout(timer);
  }
}

async function runMonitor() {
  if (monitoring) return { skipped: true };
  monitoring = true;
  try {
    const sites = readJson(SITES_FILE, []).filter((s) => s.status !== 'offline' && s.url);
    let done = 0;
    const queue = [...sites];
    const worker = async () => {
      while (queue.length) {
        const site = queue.shift();
        const { ok, ms } = await checkSite(site.url);
        const rec =
          uptime.get(site.id) || { checks: [], lastCheck: 0 };
        rec.checks.push({ t: Date.now(), ok, ms });
        if (rec.checks.length > 60) rec.checks = rec.checks.slice(-60); // 保留约30小时历史
        rec.lastCheck = Date.now();
        uptime.set(site.id, rec);
        done++;
      }
    };
    await Promise.all(Array.from({ length: MONITOR_CONCURRENCY }, worker));
    persistUptime();
    return { ok: true, checked: done, at: new Date().toISOString() };
  } finally {
    monitoring = false;
  }
}

function uptimeSummary() {
  const out = {};
  for (const [siteId, rec] of uptime.entries()) {
    const recent = rec.checks.slice(-48); // 约24小时
    const upCount = recent.filter((c) => c.ok).length;
    const lastOk = [...rec.checks].reverse().find((c) => c.ok);
    const lastFail = [...rec.checks].reverse().find((c) => !c.ok);
    out[siteId] = {
      lastCheck: rec.lastCheck,
      up: lastOk && (!lastFail || lastOk.t >= lastFail.t),
      latencyMs: lastOk ? lastOk.ms : null,
      uptime24h: recent.length ? upCount / recent.length : null,
      checks: recent.length,
    };
  }
  return out;
}

const app = new Hono();
app.use('/api/*', cors());

// ---- 认证 ----
app.post('/api/login', async (c) => {
  const ip = clientIp(c);
  const rec = loginAttempts.get(ip);
  if (rec && rec.lockedUntil > Date.now()) {
    return c.json({ error: '尝试次数过多，请 15 分钟后再试' }, 429);
  }
  const { password } = await c.req.json().catch(() => ({}));
  const ok =
    ADMIN_PASSWORD &&
    typeof password === 'string' &&
    password.length === ADMIN_PASSWORD.length &&
    crypto.timingSafeEqual(Buffer.from(password), Buffer.from(ADMIN_PASSWORD));
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
app.get('/api/sites', (c) => {
  if (!authed(c)) return c.json({ error: '未授权' }, 401);
  return c.json(readJson(SITES_FILE, []));
});

app.post('/api/sites', async (c) => {
  if (!authed(c)) return c.json({ error: '未授权' }, 401);
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
  return c.json(site, 201);
});

app.put('/api/sites/:id', async (c) => {
  if (!authed(c)) return c.json({ error: '未授权' }, 401);
  const id = c.req.param('id');
  const updated = await c.req.json();
  const sites = readJson(SITES_FILE, []);
  const idx = sites.findIndex((s) => s.id === id);
  if (idx === -1) return c.json({ error: '站点不存在' }, 404);
  updated.id = id;
  updated.updatedAt = new Date().toISOString().slice(0, 10);
  sites[idx] = { ...sites[idx], ...updated };
  writeJson(SITES_FILE, sites);
  return c.json(sites[idx]);
});

app.delete('/api/sites/:id', (c) => {
  if (!authed(c)) return c.json({ error: '未授权' }, 401);
  const id = c.req.param('id');
  let sites = readJson(SITES_FILE, []);
  const before = sites.length;
  sites = sites.filter((s) => s.id !== id);
  if (sites.length === before) return c.json({ error: '站点不存在' }, 404);
  writeJson(SITES_FILE, sites);
  return c.json({ ok: true });
});

// ---- 模型标签 ----
app.get('/api/models', (c) => {
  if (!authed(c)) return c.json({ error: '未授权' }, 401);
  return c.json(readJson(MODELS_FILE, []));
});

app.put('/api/models', async (c) => {
  if (!authed(c)) return c.json({ error: '未授权' }, 401);
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

// ---- 监测（公开读 + 鉴权触发）----
app.get('/api/uptime', (c) => c.json(uptimeSummary()));

app.post('/api/monitor/run', (c) => {
  if (!authed(c)) return c.json({ error: '未授权' }, 401);
  const result = runMonitor();
  return result.then((r) => c.json(r));
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
  if (!authed(c)) return c.json({ error: '未授权' }, 401);
  return c.json(readJson(SUBMISSIONS_FILE, []));
});

app.delete('/api/submissions/:id', (c) => {
  if (!authed(c)) return c.json({ error: '未授权' }, 401);
  const id = c.req.param('id');
  let subs = readJson(SUBMISSIONS_FILE, []);
  const before = subs.length;
  subs = subs.filter((s) => s.id !== id);
  if (subs.length === before) return c.json({ error: '不存在' }, 404);
  writeJson(SUBMISSIONS_FILE, subs);
  return c.json({ ok: true });
});

// ---- 统计（含监测合并视图）----
app.get('/api/stats', (c) => {
  if (!authed(c)) return c.json({ error: '未授权' }, 401);
  const sites = readJson(SITES_FILE, []);
  const clicks = readJson(CLICKS_FILE, {});
  const up = uptimeSummary();
  // 连续失败 3 次以上且从未成功的站点 → 疑似失效
  const suspect = sites
    .filter((s) => s.status !== 'offline' && up[s.id] && !up[s.id].up && (up[s.id].checks || 0) >= 3)
    .map((s) => ({ id: s.id, name: s.name, checks: up[s.id].checks }));
  return c.json({
    total: sites.length,
    stable: sites.filter((s) => s.status === 'stable').length,
    unstable: sites.filter((s) => s.status === 'unstable').length,
    offline: sites.filter((s) => s.status === 'offline').length,
    featured: sites.filter((s) => s.isFeatured).length,
    clicks,
    uptime: up,
    suspect,
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
  if (!authed(c)) return c.json({ error: '未授权' }, 401);
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

// ---- 配置（公告/社群/AFF，公开读 + 鉴权写）----
app.get('/api/config', (c) => c.json(readJson(CONFIG_FILE, {})));

app.put('/api/config', async (c) => {
  if (!authed(c)) return c.json({ error: '未授权' }, 401);
  const cfg = await c.req.json();
  if (typeof cfg !== 'object' || !cfg) return c.json({ error: '格式错误' }, 400);
  writeJson(CONFIG_FILE, cfg);
  return c.json({ ok: true });
});

// ---- 数据导出备份（鉴权）----
app.get('/api/export', (c) => {
  if (!authed(c)) return c.json({ error: '未授权' }, 401);
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
app.use('/admin/*', serveStatic({ root: './public' }));
app.use('/*', serveStatic({ root: './dist' }));

// 启动监测定时器
if (MONITOR_INTERVAL_MIN > 0) {
  setInterval(() => runMonitor().catch(() => {}), MONITOR_INTERVAL_MIN * 60_000);
  // 启动 30 秒后跑第一轮
  setTimeout(() => runMonitor().catch(() => {}), 30_000);
}

console.log(`[admin] listening on http://0.0.0.0:${PORT} (monitor every ${MONITOR_INTERVAL_MIN}min)`);
serve({ fetch: app.fetch, port: PORT, hostname: HOST });
