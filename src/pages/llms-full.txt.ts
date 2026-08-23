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
      `### ${s.name}${s.isFeatured ? '（编辑精选）' : ''}${s.award ? `｜获奖理由：${s.award}` : ''}`,
      `- 状态: ${{ stable: '稳定', unstable: '不稳定', offline: '已失效' }[s.status]} | 核验日期: ${s.verifiedAt}`,
      `- 网址: ${s.url}`,
      s.multiplier !== null ? `- 倍率: ${s.multiplier}x${s.topupRate ? `（充值 1:${s.topupRate}，实际约 ${(s.multiplier * s.topupRate / 7.2).toFixed(2)}x）` : ''}` : '- 倍率: 未知',
      s.bonus ? `- 注册赠送: ${s.bonus}` : '',
      s.apiBase ? `- API Base: ${s.apiBase}` : '',
      s.models.length ? `- 支持模型: ${s.models.map(modelName).join('、')}` : '',
      s.tags.length ? `- 标签: ${s.tags.join('、')}` : '',
      s.network && s.network !== 'unknown' ? `- 网络: ${s.network === 'direct' ? '国内直连' : '需代理'}` : '',
      s.tools?.length ? `- 工具兼容: ${s.tools.map((t) => TOOLS.find((x) => x.id === t)?.name || t).join('、')}` : '',
      `- 简介: ${s.summary}`,
      s.description ? `- 详情: ${s.description}` : '',
      s.notice?.text ? `- 站点公告（收录于 ${s.notice.fetchedAt}）: ${s.notice.text.replace(/\s+/g, ' ').slice(0, 200)}` : '',
      ...(s.events?.length ? s.events.slice().reverse().map((e) => `- 日志 ${e.date}: ${e.text}`) : []),
      `- 详情页: ${base}/site/${s.id}`,
    ].filter(Boolean);
    sections.push(lines.join('\n') + '\n');
  }

  sections.push(`## 新手指南（FAQ 全文）\n`);
  const faqs: Array<[string, string]> = [
    ['什么是 AI API 中转站？', '中转站（relay）是在你和官方 API（OpenAI、Anthropic 等）之间的转发服务：你把 base_url 指向中转站，用它的 key 调用，它再转发到官方。好处是免去外币支付和网络问题，通常价格更低（倍率 < 1）。正常官转倍率在 0.7-1.5 之间。'],
    ['倍率（multiplier）是什么意思？', '倍率是相对官方定价的折扣系数。0.4x 表示按官方价的 40% 计费；0.01x 即 1%。注意部分站点充值比例不是 1:1（如 1 元 = 0.1 刀），实际成本要乘上充值比例。'],
    ['怎么使用中转站？', '注册账号 → 在后台生成 API Key → 把客户端的 base_url 换成中转站地址。支持 OpenAI 格式的客户端都可以直接用。部分站点区分分组，注册后先看清自己所在的分组倍率。'],
    ['怎么避免被坑？', '谨慎充值先小额试用；同时注册 2-3 家互为备份；关注站点运营时长和社区口碑；免费额度大的新站风险也大，重要数据别走不可信渠道。'],
    ['免费额度/签到送的刀是真的吗？', '多数是真的，但部分站点送的"刀"按高倍率计费、需要进群/做任务才发放、或限速限模型。看到"注册送 100 刀"先看清倍率和限制。'],
    ['中转站会跑路吗？', '会。中转站本质是灰色生意，跑路、被封、停服都常见。本站用实时监测标记站点可达性，但监测只能说明"站点能打开"，不能保证"不跑路"。原则：不充值超过你能承受损失的金额。'],
    ['本站数据怎么来的，可信吗？', '站点信息每天核验：可达性、API 端点状态直接探测；倍率和模型列表直接读取站点官方定价接口，与人工记录不一致时保留原值并提醒复核；新站收录前人工审核；核验记录在站点详情页公开可查。数据仅供参考，不构成担保。'],
  ];
  for (const [q, a] of faqs) sections.push(`问：${q}\n答：${a}\n`);

  sections.push(`## 免责声明\n本站仅提供信息索引，不参与任何中转站的运营。中转站存在跑路风险，请谨慎充值。数据来自公开渠道与用户投稿，编辑核验。\n\n## 引用建议\n引用本站数据请注明来源 TokenFree（${base}）与数据日期 ${today}。`);

  return new Response(sections.join('\n'), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
