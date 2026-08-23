import type { APIRoute } from 'astro';
import { getFilteredSites } from '../utils/sites';

// 构建时生成 sitemap.xml（零依赖，含 lastmod 便于搜索引擎与 AI 工具调度重抓）
export const GET: APIRoute = async ({ site }) => {
  const base = site || 'https://tokenfree.example.com';
  const sites = await getFilteredSites();
  const today = new Date().toISOString().slice(0, 10);
  // 首页/榜单新鲜度 = 最近一次站点数据更新
  const latestUpdate = sites.reduce((m, s) => (s.updatedAt > m ? s.updatedAt : m), today);
  const pages: Array<{ loc: string; priority: string; changefreq: string; lastmod: string }> = [
    { loc: '/', priority: '1.0', changefreq: 'daily', lastmod: latestUpdate },
    { loc: '/recommend', priority: '0.6', changefreq: 'monthly', lastmod: today },
    { loc: '/faq', priority: '0.7', changefreq: 'monthly', lastmod: today },
    { loc: '/submit', priority: '0.4', changefreq: 'yearly', lastmod: today },
    { loc: '/about', priority: '0.5', changefreq: 'monthly', lastmod: today },
    ...sites.map((s) => ({
      loc: `/site/${s.id}`,
      priority: '0.8',
      changefreq: 'daily' as const,
      lastmod: s.updatedAt || today,
    })),
  ];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${pages
  .map(
    (p) => `  <url>
    <loc>${new URL(p.loc, base).href}</loc>
    <lastmod>${p.lastmod}</lastmod>
    <changefreq>${p.changefreq}</changefreq>
    <priority>${p.priority}</priority>
  </url>`
  )
  .join('\n')}
</urlset>`;
  return new Response(xml, { headers: { 'Content-Type': 'application/xml' } });
};
