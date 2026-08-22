import rawSites from '../data/sites.json';

export type Network = 'direct' | 'proxy' | 'unknown';

export interface Site {
  id: string;
  name: string;
  url: string;
  /** 可选推广链接：设置后 /go 跳转用它（返佣），前台展示仍用 url 域名 */
  affUrl?: string;
  multiplier: number | null;
  bonus: string;
  models: string[];
  category?: string;
  tags: string[];
  summary: string;
  description?: string;
  status: 'stable' | 'unstable' | 'offline';
  /** 网络可达性：direct=国内直连 proxy=需代理 unknown=未验证 */
  network?: Network;
  /** 兼容工具：claude-code / cursor / codex-cli / cline */
  tools?: string[];
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
