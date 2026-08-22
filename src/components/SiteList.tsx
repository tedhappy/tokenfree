import { useState, useMemo, useEffect } from 'react';

export interface ModelDef {
  id: string;
  name: string;
  color: string;
}

export interface SiteItem {
  id: string;
  name: string;
  url: string;
  affUrl?: string;
  multiplier: number | null;
  bonus: string;
  models: string[];
  tags: string[];
  summary: string;
  status: 'stable' | 'unstable' | 'offline';
  network?: 'direct' | 'proxy' | 'unknown';
  tools?: string[];
}

interface UptimeEntry {
  lastCheck: number;
  up: boolean;
  latencyMs: number | null;
  uptime24h: number | null;
  checks: number;
}

interface Props {
  initialSites: SiteItem[];
  models: ModelDef[];
}

const statusMap = {
  stable: { label: '稳定', color: '#22c55e' },
  unstable: { label: '不稳定', color: '#f59e0b' },
  offline: { label: '已失效', color: '#ef4444' },
} as const;

function multiplierColor(m: number | null): string {
  if (m === null) return 'var(--c-t2)';
  if (m <= 0.1) return '#22c55e';
  if (m <= 0.5) return '#eab308';
  return '#f97316';
}

function affEnabled(): boolean {
  if (typeof window === 'undefined') return true; // SSR 阶段默认开启
  return localStorage.getItem('tf-aff') !== '0';
}

export default function SiteList({ initialSites, models }: Props) {
  const [query, setQuery] = useState('');
  const [activeModel, setActiveModel] = useState<string | null>(null);
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [favOnly, setFavOnly] = useState(false);
  const [sortBy, setSortBy] = useState<'default' | 'multiplier'>('default');
  const [view, setView] = useState<'card' | 'table'>('card');
  const [uptime, setUptime] = useState<Record<string, UptimeEntry>>({});
  const [favs, setFavs] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetch('/api/uptime')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setUptime(d))
      .catch(() => {});
    try {
      setFavs(new Set(JSON.parse(localStorage.getItem('tf-favs') || '[]')));
    } catch {}
    // ⌘K / Ctrl+K 聚焦搜索
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        document.querySelector<HTMLInputElement>('input[type="text"]')?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const toggleFav = (id: string) => {
    setFavs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      localStorage.setItem('tf-favs', JSON.stringify([...next]));
      return next;
    });
  };

  const usedModels = useMemo(() => {
    const counts = new Map<string, number>();
    initialSites.forEach((s) => s.models.forEach((m) => counts.set(m, (counts.get(m) || 0) + 1)));
    return models.filter((m) => counts.has(m.id));
  }, [initialSites, models]);

  const usedTags = useMemo(() => {
    const counts = new Map<string, number>();
    initialSites.forEach((s) => s.tags.forEach((t) => counts.set(t, (counts.get(t) || 0) + 1)));
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t).slice(0, 12);
  }, [initialSites]);

  const filtered = useMemo(() => {
    let list = initialSites;
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.summary.toLowerCase().includes(q) ||
          s.bonus.toLowerCase().includes(q) ||
          s.tags.some((t) => t.toLowerCase().includes(q))
      );
    }
    if (activeModel) list = list.filter((s) => s.models.includes(activeModel));
    if (activeTag) list = list.filter((s) => s.tags.includes(activeTag));
    if (favOnly) list = list.filter((s) => favs.has(s.id));
    if (sortBy === 'multiplier') {
      list = [...list].sort((a, b) => {
        if (a.multiplier === null && b.multiplier === null) return 0;
        if (a.multiplier === null) return 1;
        if (b.multiplier === null) return -1;
        return a.multiplier - b.multiplier;
      });
    }
    return list;
  }, [initialSites, query, activeModel, activeTag, favOnly, favs, sortBy]);

  const chipCls = (active: boolean) =>
    `shrink-0 text-xs px-3 py-1.5 rounded-full border transition-colors ${
      active
        ? 'bg-accent-muted border-accent/40 text-accent'
        : 'border-border text-text-secondary hover:border-border-hover hover:text-text-primary'
    }`;

  const goHref = (site: SiteItem) =>
    site.url
      ? `/go?url=${encodeURIComponent((affEnabled() && site.affUrl) || site.url)}&id=${encodeURIComponent(site.id)}`
      : null;

  return (
    <div>
      {/* 筛选栏 */}
      <div className="sticky top-14 z-40 -mx-4 sm:-mx-6 px-4 sm:px-6 py-3 bg-bg/80 backdrop-blur-md border-y border-border mb-6">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35" />
            </svg>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索站点名称、标签或优惠…（⌘K）"
              className="w-full bg-bg-secondary border border-border rounded-lg pl-9 pr-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/50 transition-colors"
            />
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as 'default' | 'multiplier')}
              className="bg-bg-secondary border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent/50"
            >
              <option value="default">默认排序</option>
              <option value="multiplier">倍率从低到高</option>
            </select>
            <div className="flex rounded-lg border border-border overflow-hidden">
              <button
                onClick={() => setView('card')}
                className={`px-2.5 py-2 text-xs ${view === 'card' ? 'bg-accent-muted text-accent' : 'text-text-muted hover:text-text-secondary'}`}
                title="卡片视图"
              >
                ▦
              </button>
              <button
                onClick={() => setView('table')}
                className={`px-2.5 py-2 text-xs ${view === 'table' ? 'bg-accent-muted text-accent' : 'text-text-muted hover:text-text-secondary'}`}
                title="表格视图"
              >
                ☰
              </button>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 mt-3 overflow-x-auto">
          <button onClick={() => setActiveModel(null)} className={chipCls(activeModel === null)}>全部</button>
          {usedModels.map((m) => (
            <button
              key={m.id}
              onClick={() => setActiveModel(activeModel === m.id ? null : m.id)}
              className={chipCls(activeModel === m.id)}
              style={activeModel === m.id ? { backgroundColor: `${m.color}26`, borderColor: `${m.color}99`, color: m.color } : undefined}
            >
              {m.name}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 mt-2 overflow-x-auto">
          <button
            onClick={() => setFavOnly(!favOnly)}
            className={`shrink-0 text-xs px-2.5 py-1 rounded-full border transition-colors ${
              favOnly ? 'bg-accent-muted border-accent/40 text-accent' : 'border-border-dashed text-text-muted hover:text-text-secondary'
            }`}
            style={favOnly ? undefined : { borderStyle: 'dashed' }}
          >
            ★ 我的收藏{favs.size > 0 ? `(${favs.size})` : ''}
          </button>
          {usedTags.map((t) => (
            <button
              key={t}
              onClick={() => setActiveTag(activeTag === t ? null : t)}
              className={`shrink-0 text-xs px-2.5 py-1 rounded-full border transition-colors ${
                activeTag === t
                  ? 'bg-accent-muted border-accent/40 text-accent'
                  : 'border-border-dashed text-text-muted hover:text-text-secondary'
              }`}
              style={activeTag === t ? undefined : { borderStyle: 'dashed' }}
            >
              #{t}
            </button>
          ))}
        </div>
      </div>

      <p className="text-xs text-text-muted mb-4">
        共 {filtered.length} 个结果
        {activeModel && `（${usedModels.find((m) => m.id === activeModel)?.name}）`}
        {activeTag && ` #${activeTag}`}
        {favOnly && ' ★'}
      </p>

      {filtered.length === 0 ? (
        <div className="py-16 text-center text-text-muted text-sm">没有找到匹配的站点</div>
      ) : view === 'table' ? (
        <div className="rounded-xl border border-border overflow-x-auto bg-bg-secondary">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-text-muted border-b border-border">
                <th className="px-4 py-3 font-normal"></th>
                <th className="px-4 py-3 font-normal">站点</th>
                <th className="px-4 py-3 font-normal">倍率</th>
                <th className="px-4 py-3 font-normal">简介</th>
                <th className="px-4 py-3 font-normal">模型</th>
                <th className="px-4 py-3 font-normal"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((site) => {
                const live = uptime[site.id];
                const dotColor = live ? (live.up ? '#22c55e' : '#ef4444') : statusMap[site.status].color;
                const href = goHref(site);
                return (
                  <tr key={site.id} className="border-b border-border last:border-0 hover:bg-bg-tertiary/50 transition-colors">
                    <td className="px-4 py-2.5">
                      <button onClick={() => toggleFav(site.id)} className={favs.has(site.id) ? 'text-accent' : 'text-text-muted hover:text-text-secondary'} title="收藏">
                        {favs.has(site.id) ? '★' : '☆'}
                      </button>
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <span className="inline-block w-1.5 h-1.5 rounded-full mr-2 align-middle" style={{ background: dotColor }} />
                      <a href={`/site/${site.id}`} className="font-medium hover:text-accent transition-colors">{site.name}</a>
                    </td>
                    <td className="px-4 py-2.5 font-mono whitespace-nowrap" style={{ color: multiplierColor(site.multiplier) }}>
                      {site.multiplier !== null ? `${site.multiplier}x` : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-text-secondary max-w-xs truncate">{site.summary}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex gap-1">
                        {site.models.slice(0, 3).map((mid) => {
                          const m = models.find((x) => x.id === mid);
                          return m ? (
                            <span key={mid} className="text-xs px-1.5 py-0.5 rounded" style={{ color: m.color }}>{m.name}</span>
                          ) : null;
                        })}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {href && (
                        <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="text-xs px-2.5 py-1 rounded bg-accent-muted text-accent hover:bg-accent hover:text-white transition-colors whitespace-nowrap">
                          访问
                        </a>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((site) => {
            const st = statusMap[site.status];
            const live = uptime[site.id];
            const dotColor = live ? (live.up ? '#22c55e' : '#ef4444') : st.color;
            const dotTitle = live ? (live.up ? `在线 · ${live.latencyMs ?? '?'}ms` : '监测不可达') : st.label;
            const href = goHref(site);
            return (
              <div key={site.id} className="group relative p-5 rounded-xl bg-bg-secondary border border-border hover:border-border-hover transition-colors">
                <button
                  onClick={() => toggleFav(site.id)}
                  className={`absolute top-3 right-3 text-sm leading-none transition-colors ${favs.has(site.id) ? 'text-accent' : 'text-text-muted opacity-0 group-hover:opacity-100 hover:text-accent'}`}
                  title="收藏"
                >
                  {favs.has(site.id) ? '★' : '☆'}
                </button>
                <div className="flex items-start justify-between gap-3 mb-2 pr-6">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: dotColor }} title={dotTitle} />
                    <a href={`/site/${site.id}`} className="font-medium text-text-primary truncate hover:text-accent transition-colors">
                      {site.name}
                    </a>
                    {site.network === 'direct' && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded border border-status-stable/30 text-status-stable shrink-0">直连</span>
                    )}
                    {site.network === 'proxy' && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded border border-status-unstable/30 text-status-unstable shrink-0">代理</span>
                    )}
                  </div>
                  {site.multiplier !== null && (
                    <span className="text-sm font-mono font-medium shrink-0" style={{ color: multiplierColor(site.multiplier) }}>
                      {site.multiplier}x
                    </span>
                  )}
                </div>
                <p className="text-sm text-text-secondary leading-relaxed line-clamp-2 mb-3">{site.summary}</p>
                {site.bonus && <p className="text-xs text-status-stable/90 mb-3 truncate">🎁 {site.bonus}</p>}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex flex-wrap gap-1.5 min-w-0">
                    {site.models.slice(0, 4).map((mid) => {
                      const model = models.find((mm) => mm.id === mid);
                      if (!model) return null;
                      return (
                        <span key={mid} className="text-xs px-2 py-0.5 rounded-full border" style={{ borderColor: `${model.color}30`, color: model.color }}>
                          {model.name}
                        </span>
                      );
                    })}
                    {site.models.length > 4 && (
                      <span className="text-xs px-2 py-0.5 rounded-full border border-border text-text-muted">+{site.models.length - 4}</span>
                    )}
                  </div>
                  {href && (
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      className="shrink-0 text-xs px-3 py-1.5 rounded-lg bg-accent-muted text-accent hover:bg-accent hover:text-white transition-colors"
                    >
                      访问 →
                    </a>
                  )}
                </div>
                {!href && <p className="text-xs text-text-muted mt-2">链接待补充</p>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
