import rawSites from '../data/sites.json';

export type Network = 'direct' | 'proxy' | 'unknown';

export interface Site {
  id: string;
  name: string;
  url: string;
  /** 可选推广链接：设置后 /go 跳转用它（返佣），前台展示仍用 url 域名 */
  affUrl?: string;
  multiplier: number | null;
  /** 每充值 1 刀额度所需人民币（如 7.5），用于折算实际倍率 */
  topupRate?: number | null;
  bonus: string;
  /** 注册邀请码/兑换口令，前台一键复制 */
  inviteCode?: string;
  models: string[];
  category?: string;
  tags: string[];
  summary: string;
  description?: string;
  /** 英文详细描述（可选，EN 模式下替换 description） */
  descriptionEn?: string;
  /** 英文简介（可选，EN 模式下替换 summary） */
  summaryEn?: string;
  /** 榜单获奖理由（如"最佳白嫖"），榜单卡片缎带展示 */
  award?: string;
  /** 获奖理由英文 */
  awardEn?: string;
  /** 注册赠送英文 */
  bonusEn?: string;
  /** 域名注册日（RDAP 注册局记录），用于计算已运营时长 */
  domainRegisteredAt?: string;
  /** API Base URL（注册后客户端配置用），设置后详情页展示一键复制 */
  apiBase?: string;
  status: 'stable' | 'unstable' | 'offline';
  /** 网络可达性：direct=国内直连 proxy=需代理 unknown=未验证 */
  network?: Network;
  /** 兼容工具：claude-code / cursor / codex-cli / cline */
  tools?: string[];
  /** 体验日志：[{date:'2026-08-22', text:'调价到0.02x'}]，按日期倒序展示 */
  events?: Array<{ date: string; text: string }>;
  /** 站点公告（自动同步自 /api/notice，fetchedAt 为抓取日期） */
  notice?: { text: string; fetchedAt: string } | null;
  /** 最近一次自动核验的原始结果（延迟/标题/模型数/最低分组倍率） */
  autoInfo?: Record<string, any> | null;
  isFeatured: boolean;
  sortOrder: number;
  verifiedAt: string;
  createdAt: string;
  updatedAt: string;
}

// 归一化：补齐旧数据的扩展字段
function normalize(s: any): Site {
  return {
    network: 'unknown',
    tools: [],
    affUrl: '',
    bonus: '',
    events: [],
    inviteCode: '',
    topupRate: null,
    award: '',
    apiBase: '',
    summaryEn: '',
    descriptionEn: '',
    notice: null,
    autoInfo: null,
    ...s,
  };
}

const sites = (rawSites as any[]).map(normalize);

export async function getFilteredSites(): Promise<Site[]> {
  return [...sites]
    .filter((s) => s.status !== 'offline')
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

export async function getAllSites(): Promise<Site[]> {
  return sites;
}

export function goUrl(site: Site): string {
  const target = site.affUrl || site.url;
  return `/go?url=${encodeURIComponent(target)}&id=${encodeURIComponent(site.id)}`;
}

/** 判断站点是否有"免费额度/赠送"（用于"免费额度"筛选）。
 *  依据：注册赠送字段非空，或简介/标签里出现赠送相关关键词。 */
export function hasFreeCredit(site: { bonus?: string; summary?: string; tags?: string[] }): boolean {
  return Boolean(site.bonus) || /送|签到|免费|公益/.test((site.summary || '') + (site.tags || []).join(''));
}

export type AgeUnit = 'day' | 'month' | 'year';

/** 收录时长（按 createdAt 计算，用于"已收录 X 天/个月/年"信任徽章）：
 *  不足 1 天返回 null（不展示徽章），杜绝未满月虚标为"1 个月" */
export function ageParts(dateStr?: string): { n: number; unit: AgeUnit } | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (days < 1) return null;
  if (days < 30) return { n: days, unit: 'day' };
  const months = Math.floor(days / 30);
  if (months < 12) return { n: months, unit: 'month' };
  return { n: Math.floor(months / 12), unit: 'year' };
}

export const AGE_UNIT_ZH: Record<AgeUnit, string> = { day: '天', month: '个月', year: '年' };
export const AGE_UNIT_EN: Record<AgeUnit, string> = { day: 'd', month: 'mo', year: 'yr' };

export const TOOLS: Array<{ id: string; name: string }> = [
  { id: 'claude-code', name: 'Claude Code' },
  { id: 'cursor', name: 'Cursor' },
  { id: 'codex-cli', name: 'Codex CLI' },
  { id: 'cline', name: 'Cline' },
];
