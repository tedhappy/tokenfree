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

// ---- 配置：环境变量优先，缺省值仅供本机调试，生产务必设置 ADMIN_PASSWORD ----
const PORT = Number(process.env.PORT || 4321);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const SESSION_TTL_HOURS = 24;

if (!ADMIN_PASSWORD && process.env.NODE_ENV === 'production') {
  console.error('[fatal] 生产环境必须设置 ADMIN_PASSWORD 环境变量');
  process.exit(1);
}

// ---- 会话存储（内存即可，单管理员重启可接受）----
const sessions = new Map(); // token -> expiresAt

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

// ---- 登录速率限制：每 IP 连续失败 5 次锁定 15 分钟 ----
const loginAttempts = new Map(); // ip -> { count, lockedUntil }
const MAX_ATTEMPTS = 5;
const LOCK_MS = 15 * 60 * 1000;

function clientIp(c) {
  return (
    c.req.header('x-forwarded-for')?.split(',')[0].trim() ||
    c.req.header('x-real-ip') ||
    'unknown'
  );
}

function loginBlocked(ip) {
  const rec = loginAttempts.get(ip);
  return !!rec && rec.lockedUntil > Date.now();
}

function recordFail(ip) {
  const rec = loginAttempts.get(ip) || { count: 0, lockedUntil: 0 };
  rec.count += 1;
  if (rec.count >= MAX_ATTEMPTS) {
    rec.lockedUntil = Date.now() + LOCK_MS;
    rec.count = 0;
  }
  loginAttempts.set(ip, rec);
}

function recordSuccess(ip) {
  loginAttempts.delete(ip);
}

const app = new Hono();

app.use('/api/*', cors());

// ---- 认证 ----
app.post('/api/login', async (c) => {
  const ip = clientIp(c);
  if (loginBlocked(ip)) {
    return c.json({ error: '尝试次数过多，请 15 分钟后再试' }, 429);
  }
  const { password } = await c.req.json().catch(() => ({}));
  const ok =
    ADMIN_PASSWORD &&
    typeof password === 'string' &&
    password.length === ADMIN_PASSWORD.length &&
    crypto.timingSafeEqual(Buffer.from(password), Buffer.from(ADMIN_PASSWORD));
  if (!ok) {
    recordFail(ip);
    return c.json({ error: '密码错误' }, 401);
  }
  recordSuccess(ip);
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
  if (!auth(c.req.header('Authorization')?.replace('Bearer ', ''))) {
    return c.json({ error: '未授权' }, 401);
  }
  return c.json(readJson(SITES_FILE, []));
});

app.post('/api/sites', async (c) => {
  if (!auth(c.req.header('Authorization')?.replace('Bearer ', ''))) {
    return c.json({ error: '未授权' }, 401);
  }
  const site = await c.req.json();
  const sites = readJson(SITES_FILE, []);
  if (!site.name || typeof site.name !== 'string') {
    return c.json({ error: 'name 必填' }, 400);
  }
  site.id = site.id || crypto.randomUUID().slice(0, 8);
  site.createdAt = site.createdAt || new Date().toISOString().slice(0, 10);
  site.updatedAt = new Date().toISOString().slice(0, 10);
  sites.push(site);
  writeJson(SITES_FILE, sites);
  return c.json(site, 201);
});

app.put('/api/sites/:id', async (c) => {
  if (!auth(c.req.header('Authorization')?.replace('Bearer ', ''))) {
    return c.json({ error: '未授权' }, 401);
  }
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
  if (!auth(c.req.header('Authorization')?.replace('Bearer ', ''))) {
    return c.json({ error: '未授权' }, 401);
  }
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
  if (!auth(c.req.header('Authorization')?.replace('Bearer ', ''))) {
    return c.json({ error: '未授权' }, 401);
  }
  return c.json(readJson(MODELS_FILE, []));
});

app.put('/api/models', async (c) => {
  if (!auth(c.req.header('Authorization')?.replace('Bearer ', ''))) {
    return c.json({ error: '未授权' }, 401);
  }
  const models = await c.req.json();
  if (!Array.isArray(models)) return c.json({ error: '格式错误' }, 400);
  writeJson(MODELS_FILE, models);
  return c.json({ ok: true });
});

// ---- 点击统计（前台 /go 调用，无需鉴权）----
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

app.get('/api/stats', (c) => {
  if (!auth(c.req.header('Authorization')?.replace('Bearer ', ''))) {
    return c.json({ error: '未授权' }, 401);
  }
  const sites = readJson(SITES_FILE, []);
  const clicks = readJson(CLICKS_FILE, {});
  return c.json({
    total: sites.length,
    stable: sites.filter((s) => s.status === 'stable').length,
    unstable: sites.filter((s) => s.status === 'unstable').length,
    offline: sites.filter((s) => s.status === 'offline').length,
    featured: sites.filter((s) => s.isFeatured).length,
    clicks,
  });
});

// ---- 重建前台（触发 npm run build，加锁防并发）----
let building = false;

function runBuild() {
  return new Promise((resolve, reject) => {
    // shell:true 兼容 Windows（.cmd 必须经 shell）与 Linux
    const child = spawn('npm run build', {
      cwd: ROOT,
      stdio: 'ignore',
      shell: true,
    });
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
  if (!auth(c.req.header('Authorization')?.replace('Bearer ', ''))) {
    return c.json({ error: '未授权' }, 401);
  }
  if (building) {
    return c.json({ error: '已有构建在进行中' }, 409);
  }
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

// ---- 静态托管：admin 页面 + 构建后的前台 ----
app.use('/admin/*', serveStatic({ root: './public' }));
app.use('/*', serveStatic({ root: './dist' }));

console.log(`[admin] listening on http://0.0.0.0:${PORT}`);
serve({ fetch: app.fetch, port: PORT });
