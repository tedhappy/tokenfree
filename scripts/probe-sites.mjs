// 站点 API 端点探测：验证 apiBase 可用性与工具兼容线索
// 用法：node scripts/probe-sites.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sites = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/data/sites.json'), 'utf-8'));

const TIMEOUT = 8000;

async function probe(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
  const start = Date.now();
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 TokenFree-Probe/1.0' },
    });
    const text = await res.text().catch(() => '');
    return { status: res.status, ms: Date.now() - start, body: text.slice(0, 300) };
  } catch (e) {
    return { status: 0, ms: Date.now() - start, err: e.name };
  } finally {
    clearTimeout(timer);
  }
}

const results = [];
const queue = [...sites];
async function worker() {
  while (queue.length) {
    const site = queue.shift();
    const host = site.url.replace(/^https?:\/\//, '').split('/')[0];
    const origin = `https://${host}`;
    const [home, apiStatus, models, messages] = await Promise.all([
      probe(origin),
      probe(`${origin}/api/status`),
      probe(`${origin}/v1/models`),
      probe(`${origin}/v1/messages`),
    ]);
    // New API 指纹：/api/status 返回 JSON 且含 version/success 字段
    let fingerprint = '';
    try {
      const j = JSON.parse(apiStatus.body);
      if (j && (j.version || j.success !== undefined || j.data?.version))
        fingerprint = j.data?.version || j.version || 'newapi';
    } catch {}
    const modelsOk = [401, 403].includes(models.status); // 401/403 = 端点存在但需鉴权
    const messagesOk = [401, 403, 405].includes(messages.status);
    results.push({
      id: site.id, host,
      home: home.status, latency: home.ms,
      newapi: fingerprint || (apiStatus.status === 404 ? '' : `status:${apiStatus.status}`),
      models: models.status, modelsOk,
      messages: messages.status, messagesOk,
    });
    console.log(
      `${site.id.padEnd(14)} home=${String(home.status).padEnd(3)} ${String(home.ms).padStart(5)}ms  newapi=${(fingerprint || '-').toString().padEnd(8)} models=${models.status}${modelsOk ? '✓' : ' '}  messages=${messages.status}${messagesOk ? '✓' : ' '}`
    );
  }
}
await Promise.all(Array.from({ length: 4 }, worker));
fs.writeFileSync(path.join(ROOT, '.probe-results.json'), JSON.stringify(results, null, 2));
console.log('\nsaved .probe-results.json');
