import rawSites from '../data/sites.json';

export interface Site {
  id: string;
  name: string;
  url: string;
  multiplier: number | null;
  bonus: string;
  models: string[];
  category?: string;
  tags: string[];
  summary: string;
  description?: string;
  status: 'stable' | 'unstable' | 'offline';
  isFeatured: boolean;
  sortOrder: number;
  verifiedAt: string;
  createdAt: string;
  updatedAt: string;
}

const sites = rawSites as Site[];

export async function getFilteredSites(): Promise<Site[]> {
  return [...sites]
    .filter((s) => s.status !== 'offline')
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

export async function getSiteCount(): Promise<number> {
  return sites.filter((s) => s.status !== 'offline').length;
}
