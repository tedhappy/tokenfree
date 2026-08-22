import type { APIRoute } from 'astro';
import { getFilteredSites } from '../utils/sites';

// 构建时生成 sitemap.xml（零依赖）
export const GET: APIRoute = async ({ site }) => {
  const base = site || 'https://tokenfree.example.com';
  const sites = await getFilteredSites();
  const pages: Array<{ loc: string; priority: string; changefreq: string }> = [
    { loc: '/', priority: '1.0', changefreq: 'daily' },
    { loc: '/recommend', priority: '0.6', changefreq: 'monthly' },
    { loc: '/faq', priority: '0.6', changefreq: 'monthly' },
    { loc: '/submit', priority: '0.4', changefreq: 'yearly' },
    { loc: '/about', priority: '0.5', changefreq: 'monthly' },
    ...sites.map((s) => ({ loc: `/site/${s.id}`, priority: '0.7', changefreq: 'daily' as const })),
  ];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${pages
  .map(
    (p) => `  <url>
    <loc>${new URL(p.loc, base).href}</loc>
    <changefreq>${p.changefreq}</changefreq>
    <priority>${p.priority}</priority>
  </url>`
  )
  .join('\n')}
</urlset>`;
  return new Response(xml, { headers: { 'Content-Type': 'application/xml' } });
};
