import { useState, useMemo } from 'react';

export interface ModelDef {
  id: string;
  name: string;
  color: string;
}

export interface SiteItem {
  id: string;
  name: string;
  url: string;
  multiplier: number | null;
  bonus: string;
  models: string[];
  tags: string[];
  summary: string;
  status: 'stable' | 'unstable' | 'offline';
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
  if (m === null) return '#8888a0';
  if (m <= 0.1) return '#22c55e';
  if (m <= 0.5) return '#eab308';
  return '#f97316';
}

export default function SiteList({ initialSites, models }: Props) {
  const [query, setQuery] = useState('');
  const [activeModel, setActiveModel] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<'default' | 'multiplier'>('default');

  const usedModels = useMemo(() => {
    const counts = new Map<string, number>();
    initialSites.forEach((s) => s.models.forEach((m) => counts.set(m, (counts.get(m) || 0) + 1)));
    return models.filter((m) => counts.has(m.id));
  }, [initialSites, models]);

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
    if (activeModel) {
      list = list.filter((s) => s.models.includes(activeModel));
    }
    if (sortBy === 'multiplier') {
      list = [...list].sort((a, b) => {
        if (a.multiplier === null && b.multiplier === null) return 0;
        if (a.multiplier === null) return 1;
        if (b.multiplier === null) return -1;
        return a.multiplier - b.multiplier;
      });
    }
    return list;
  }, [initialSites, query, activeModel, sortBy]);

  return (
    <div>
      {/* 筛选栏 */}
      <div className="sticky top-14 z-40 -mx-4 sm:-mx-6 px-4 sm:px-6 py-3 bg-bg/80 backdrop-blur-md border-y border-border mb-6">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted"
              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35" />
            </svg>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索站点名称、标签或优惠…"
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
          </div>
        </div>
        <div className="flex items-center gap-2 mt-3 overflow-x-auto">
          <button
            onClick={() => setActiveModel(null)}
            className={`shrink-0 text-xs px-3 py-1.5 rounded-full border transition-colors ${
              activeModel === null
                ? 'bg-accent-muted border-accent/40 text-accent'
                : 'border-border text-text-secondary hover:border-border-hover hover:text-text-primary'
            }`}
          >
            全部
          </button>
          {usedModels.map((m) => (
            <button
              key={m.id}
              onClick={() => setActiveModel(activeModel === m.id ? null : m.id)}
              className={`shrink-0 text-xs px-3 py-1.5 rounded-full border transition-colors ${
                activeModel === m.id
                  ? 'text-white'
                  : 'border-border text-text-secondary hover:border-border-hover hover:text-text-primary'
              }`}
              style={activeModel === m.id ? { backgroundColor: `${m.color}30`, borderColor: `${m.color}80`, color: m.color } : undefined}
            >
              {m.name}
            </button>
          ))}
        </div>
      </div>

      {/* 结果计数 */}
      <p className="text-xs text-text-muted mb-4">
        共 {filtered.length} 个结果
        {activeModel && `（${usedModels.find((m) => m.id === activeModel)?.name}）`}
      </p>

      {/* 站点列表 */}
      {filtered.length === 0 ? (
        <div className="py-16 text-center text-text-muted text-sm">
          没有找到匹配的站点
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((site) => {
            const st = statusMap[site.status];
            const goHref = site.url
              ? `/go?url=${encodeURIComponent(site.url)}&id=${encodeURIComponent(site.id)}`
              : null;
            const inner = (
              <>
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span
                      className="w-1.5 h-1.5 rounded-full shrink-0"
                      style={{ backgroundColor: st.color }}
                      title={st.label}
                    />
                    <h3 className="font-medium text-text-primary truncate group-hover:text-accent transition-colors">
                      {site.name}
                    </h3>
                  </div>
                  {site.multiplier !== null && (
                    <span
                      className="text-sm font-mono font-medium shrink-0"
                      style={{ color: multiplierColor(site.multiplier) }}
                    >
                      {site.multiplier}x
                    </span>
                  )}
                </div>
                <p className="text-sm text-text-secondary leading-relaxed line-clamp-2 mb-3">
                  {site.summary}
                </p>
                {site.bonus && (
                  <p className="text-xs text-status-stable/90 mb-3 truncate">🎁 {site.bonus}</p>
                )}
                <div className="flex flex-wrap gap-1.5">
                  {site.models.slice(0, 4).map((mid) => {
                    const model = models.find((mm) => mm.id === mid);
                    if (!model) return null;
                    return (
                      <span
                        key={mid}
                        className="text-xs px-2 py-0.5 rounded-full border"
                        style={{ borderColor: `${model.color}30`, color: model.color }}
                      >
                        {model.name}
                      </span>
                    );
                  })}
                  {site.models.length > 4 && (
                    <span className="text-xs px-2 py-0.5 rounded-full border border-border text-text-muted">
                      +{site.models.length - 4}
                    </span>
                  )}
                </div>
              </>
            );
            return goHref ? (
              <a
                key={site.id}
                href={goHref}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="group block p-5 rounded-xl bg-bg-secondary border border-border hover:border-border-hover transition-colors"
              >
                {inner}
              </a>
            ) : (
              <div
                key={site.id}
                className="group block p-5 rounded-xl bg-bg-secondary border border-border border-dashed opacity-70"
                title="链接待补充"
              >
                {inner}
                <p className="text-xs text-text-muted mt-2">链接待补充</p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
