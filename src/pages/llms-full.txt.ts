import type { APIRoute } from 'astro';
import { getAllSites, TOOLS } from '../utils/sites';
import modelsJson from '../data/models.json';

// llms-full.txt：全量数据文本版（AI 爬虫与检索友好的完整内容）
export const GET: APIRoute = async ({ site }) => {
  const base = (site || 'https://www.tokenfree.wiki').toString().replace(/\/$/, '');
  const sites = await getAllSites();
  const models = modelsJson as any[];
  const modelName = (id: string) => models.find((m) => m.id === id)?.name || id;
  const today = new Date().toISOString().slice(0, 10);

  const sections: string[] = [];
  sections.push(`# TokenFree AI Token 中转站导航 — 完整数据\n# 数据日期: ${today} | 站点: ${base}\n`);

  sections.push(`## 收录站点（${sites.length}）\n`);
  for (const s of sites) {
    const lines = [
      `### ${s.name}${s.isFeatured ? '（编辑精选）' : ''}`,
      `- 状态: ${{ stable: '稳定', unstable: '不稳定', offline: '已失效' }[s.status]} | 核验日期: ${s.verifiedAt}`,
      `- 网址: ${s.url}`,
      s.multiplier !== null ? `- 倍率: ${s.multiplier}x` : '- 倍率: 未知',
      s.models.length ? `- 支持模型: ${s.models.map(modelName).join('、')}` : '',
      s.tags.length ? `- 标签: ${s.tags.join('、')}` : '',
      s.network && s.network !== 'unknown' ? `- 网络: ${s.network === 'direct' ? '国内直连' : '需代理'}` : '',
      s.tools?.length ? `- 工具兼容: ${s.tools.map((t) => TOOLS.find((x) => x.id === t)?.name || t).join('、')}` : '',
      `- 简介: ${s.summary}`,
      s.description ? `- 详情: ${s.description}` : '',
      ...(s.events?.length ? s.events.slice().reverse().map((e) => `- 日志 ${e.date}: ${e.text}`) : []),
      `- 详情页: ${base}/site/${s.id}`,
    ].filter(Boolean);
    sections.push(lines.join('\n') + '\n');
  }

  sections.push(`## 免责声明\n本站仅提供信息索引，不参与任何中转站的运营。中转站存在跑路风险，请谨慎充值。数据来自公开渠道与用户投稿，编辑核验。`);

  return new Response(sections.join('\n'), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
