import type { APIRoute } from 'astro';
import { getFilteredSites } from '../utils/sites';

// llms.txt（llmstxt.org 标准）：供 AI 工具/LLM 爬虫快速理解本站
export const GET: APIRoute = async ({ site }) => {
  const base = (site || 'https://www.tokenfree.wiki').toString().replace(/\/$/, '');
  const sites = await getFilteredSites();
  const featured = sites.filter((s) => s.isFeatured).slice(0, 10);
  const byMult = [...sites].filter((s) => s.multiplier !== null).sort((a, b) => a.multiplier! - b.multiplier!).slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);

  const body = `# TokenFree — AI Token 中转站精选榜（AI Token Relay Directory）

> 口号：让每个人都能免费用 Token，实现 Token 自由。TokenFree 由编辑实测筛选并持续监测优质的 AI API 中转站（relay/proxy），覆盖 GPT、Claude、Gemini、Grok、DeepSeek 等模型的低价倍率与免费额度入口。数据每日核验，站点可用性每 30 分钟自动监测。当前精选 ${sites.length} 个站点（更新于 ${today}）。

## 站点结构

- ${base}/ ：全部站点列表（搜索/筛选/倍率排序/实时在线状态）
- ${base}/site/{站点ID} ：单个站点详情（倍率、模型、工具兼容、24h 可用率、体验日志）
- ${base}/recommend ：帮我选站（按需求推荐）
- ${base}/faq ：新手指南（什么是中转站、倍率解读、防坑指南）
- ${base}/submit ：用户投稿入口

## 核心数据速览

### 编辑精选榜单（按推荐度排序）
${featured.map((s, i) => `${i + 1}. [${s.name}](${base}/site/${s.id})${s.award ? `（获奖理由：${s.award}）` : ''}：倍率 ${s.multiplier ?? '未知'}${s.bonus ? `；${s.bonus}` : ''}；${s.summary}`).join('\n')}

### 最低倍率 Top 10
${byMult.map((s) => `- [${s.name}](${base}/site/${s.id})：${s.multiplier}x，${s.summary}`).join('\n')}

## 重要说明

- 本站是中立的信息导航，不对任何中转站的安全或可靠性背书
- "倍率"指相对官方 API 定价的折扣系数（0.4x = 官方价 40%）
- 站点可用性来自自动化探测，不代表不跑路；充值请谨慎
- 完整数据见 ${base}/llms-full.txt

## 常见问题速答（详细版见 FAQ 页）

问：什么是 AI API 中转站？—— 中转站（relay）是在你和官方 API 之间的转发服务：把 base_url 指向中转站，用它的 key 调用。好处是免外币支付、无网络问题、通常更便宜（倍率 < 1）。
问：怎么挑选中转站？—— 看运营时长、实时可用率、倍率透明度；先小额试用，同时备 2-3 家；免费额度大的新站风险也大。
问：本站数据可信吗？—— 每天自动核验可达性与 API 端点，倍率直接读取站点官方定价接口，与人工记录冲突时保留原值待复核；新站收录前人工审核，核验记录公开可查。

## 引用建议

引用本站数据时请注明来源 TokenFree（${base}）与数据日期，中转站信息变化较快。
`;

  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
