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
  /** API Base URL（注册后客户端配置用），设置后详情页展示一键复制 */
  apiBase?: string;
  status: 'stable' | 'unstable' | 'offline';
  /** 网络可达性：direct=国内直连 proxy=需代理 unknown=未验证 */
  network?: Network;
  /** 兼容工具：claude-code / cursor / codex-cli / cline */
  tools?: string[];
  /** 体验日志：[{date:'2026-08-22', text:'调价到0.02x'}]，按日期倒序展示 */
  events?: Array<{ date: string; text: string }>;
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

export function getSiteBySlug(slug: string): Site | undefined {
  return sites.find((s) => s.id === slug);
}

export async function getSiteCount(): Promise<number> {
  return sites.filter((s) => s.status !== 'offline').length;
}

export function goUrl(site: Site): string {
  const target = site.affUrl || site.url;
  return `/go?url=${encodeURIComponent(target)}&id=${encodeURIComponent(site.id)}`;
}

/** 收录时长（月）：按 createdAt 计算，用于"已收录 X 个月"信任徽章 */
export function monthsSince(dateStr?: string): number {
  if (!dateStr) return 0;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return 0;
  return Math.max(1, Math.floor((Date.now() - d.getTime()) / (30 * 24 * 3600 * 1000)));
}

export const TOOLS: Array<{ id: string; name: string }> = [
  { id: 'claude-code', name: 'Claude Code' },
  { id: 'cursor', name: 'Cursor' },
  { id: 'codex-cli', name: 'Codex CLI' },
  { id: 'cline', name: 'Cline' },
];

export const NETWORK_LABEL: Record<Network, string> = {
  direct: '国内直连',
  proxy: '需代理',
  unknown: '',
};
