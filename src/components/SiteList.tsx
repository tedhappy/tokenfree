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
  /** 每充值 1 刀额度所需人民币（如 7.5），与 multiplier 组合可算实际倍率 */
  topupRate?: number | null;
  bonus: string;
  /** 注册邀请码/兑换口令 */
  inviteCode?: string;
  models: string[];
  tags: string[];
  summary: string;
  /** 英文简介（可选，EN 模式下替换 summary） */
  summaryEn?: string;
  /** 榜单获奖理由（如"最佳白嫖"） */
  award?: string;
  /** 英文获奖理由 / 注册赠送 */
  awardEn?: string;
  bonusEn?: string;
  status: 'stable' | 'unstable' | 'offline';
  network?: 'direct' | 'proxy' | 'unknown';
  tools?: string[];
  isFeatured?: boolean;
  createdAt?: string;
}

interface UptimeEntry {
  lastCheck: number;
  up: boolean;
  latencyMs: number | null;
  /** API 端点（/v1/models）最近一次探测：true/false，null=无法判断 */
  apiUp?: boolean | null;
  uptime24h: number | null;
  checks: number;
}

interface Props {
  initialSites: SiteItem[];
  models: ModelDef[];
}

const statusMap = {
  stable: { label: ['稳定', 'Stable'], color: '#22c55e' },
  unstable: { label: ['不稳定', 'Unstable'], color: '#f59e0b' },
  offline: { label: ['已失效', 'Offline'], color: '#ef4444' },
} as const;

// 官方美元汇率参考，用于把充值汇率折算成实际倍率
const USD_CNY = 7.2;

// 界面文案：[中文, English]，语言在挂载后读取（避免 SSR 水合不一致）
const UI = {
  searchPh: ['搜索站点名称、标签或优惠…（⌘K）', 'Search name, tag or bonus… (⌘K)'],
  all: ['全部', 'All'],
  sortDefault: ['编辑榜单', 'Editor ranking'],
  sortMult: ['倍率从低到高', 'Multiplier low→high'],
  sortHot: ['热度优先', 'Most visited'],
  sortNew: ['最新收录', 'Recently added'],
  multAll: ['倍率不限', 'Any multiplier'],
  freeOnly: ['有免费额度', 'Has free credits'],
  reset: ['重置', 'Reset'],
  fav: ['我的收藏', 'Favorites'],
  results: ['个结果', 'results'],
  empty: ['没有找到匹配的站点', 'No matching sites'],
  emptyCta: ['清空筛选条件', 'Clear filters'],
  pending: ['链接待补充', 'URL pending'],
  visit: ['访问 →', 'Visit →'],
  direct: ['直连', 'Direct'],
  proxy: ['代理', 'Proxy'],
  online: ['在线', 'up'],
  apiDown: ['网页在线 · API 异常', 'web up · API down'],
  unreachable: ['监测不可达', 'Unreachable'],
  cardView: ['卡片视图', 'Card view'],
  tableView: ['表格视图', 'Table view'],
  compare: ['对比', 'Compare'],
  compareBar: ['已选', 'selected'],
  compareGo: ['开始对比 →', 'Compare →'],
  compareClear: ['清空', 'Clear'],
  compareTitle: ['站点对比', 'Compare sites'],
  cName: ['站点', 'Site'],
  cMult: ['标称倍率', 'Multiplier'],
  cReal: ['实际倍率*', 'Real*'],
  cStatus: ['状态', 'Status'],
  cLatency: ['延迟', 'Latency'],
  cUptime: ['24h 可用率', '24h uptime'],
  cBonus: ['注册赠送', 'Bonus'],
  cInvite: ['邀请码', 'Invite code'],
  cNet: ['网络', 'Network'],
  cModels: ['模型', 'Models'],
  cAge: ['收录时长', 'Listed'],
  realNote: ['* 实际倍率 = 标称倍率 × 充值汇率 ÷ 7.2（美元参考汇率），折算后真实成本，仅供参考', '* Real = multiplier × top-up rate ÷ 7.2 (ref. USD rate)'],
  copy: ['复制', 'Copy'],
  copied: ['已复制 ✓', 'Copied ✓'],
  close: ['关闭', 'Close'],
  filter: ['筛选', 'Filter'],
  months: ['已收录', 'Listed'],
  monthsUnit: ['个月', 'mo'],
  dayUnit: ['天', 'd'],
  yearUnit: ['年', 'yr'],
  hot: ['次访问', 'visits'],
  cSummary: ['简介', 'Summary'],
  cRealShort: ['实际倍率', 'Real'],
  visitShort: ['访问', 'Visit'],
} as const;

// 快捷标签预设：优先展示高频筛选维度
const PRESET_TAGS = ['签到', '邀请', '生图', '稳定'];

// 站点头像：按名称哈希取色，首字母做徽章
const AVATAR_COLORS = ['#7c5cfc', '#3b82f6', '#06b6d4', '#10b981', '#f59e0b', '#f97316', '#ec4899', '#8b5cf6'];
function avatarColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

function multiplierColor(m: number | null): string {
  if (m === null) return 'var(--c-t2)';
  if (m <= 0.1) return '#22c55e';
  if (m <= 0.5) return '#eab308';
  return '#f97316';
}

/** 实际倍率：标称倍率 × 充值汇率（元/刀）÷ 官方汇率 */
function realMultiplier(site: SiteItem): number | null {
  if (site.multiplier === null || !site.topupRate || site.topupRate <= 0) return null;
  return (site.multiplier * site.topupRate) / USD_CNY;
}

/** 收录时长：不足 1 天返回 null，杜绝未满月虚标为"1 个月" */
function ageParts(dateStr?: string): { n: number; unit: 'day' | 'month' | 'year' } | null {
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

/** 站龄文案：zh "3 天 / 2 个月 / 1 年"，en "3 d / 2 mo / 1 yr" */
function ageText(p: { n: number; unit: string } | null, lang: 0 | 1): string {
  if (!p) return '';
  const units = lang
    ? { day: 'd', month: 'mo', year: 'yr' }
    : { day: '天', month: '个月', year: '年' };
  return `${p.n} ${units[p.unit as 'day']}`;
}

/** 实时状态展示：不可达(红) > 网页在线但API异常(黄) > 在线(绿) */
function liveState(live: UptimeEntry | undefined, lang: 0 | 1): { color: string; label: string } | null {
  if (!live) return null;
  if (!live.up) return { color: '#ef4444', label: UI.unreachable[lang] };
  if (live.apiUp === false) return { color: '#f59e0b', label: UI.apiDown[lang] };
  return { color: '#22c55e', label: UI.online[lang] };
}

function Avatar({ name }: { name: string }) {
  const c = avatarColor(name);
  const initial = name.trim().charAt(0).toUpperCase();
  return (
    <span
      className="w-10 h-10 text-base rounded-xl shrink-0 flex items-center justify-center font-semibold select-none"
      style={{ backgroundColor: `${c}24`, color: c }}
      aria-hidden="true"
    >
      {initial}
    </span>
  );
}

export default function SiteList({ initialSites, models }: Props) {
  const [query, setQuery] = useState('');
  const [activeModel, setActiveModel] = useState<string | null>(null);
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [favOnly, setFavOnly] = useState(false);
  const [freeOnly, setFreeOnly] = useState(false);
  const [maxMult, setMaxMult] = useState<number | null>(null);
  const [sortBy, setSortBy] = useState<'default' | 'multiplier' | 'hot' | 'new'>('default');
  const [view, setView] = useState<'card' | 'table'>('card');
  const [showFilters, setShowFilters] = useState(false);
  const [uptime, setUptime] = useState<Record<string, UptimeEntry>>({});
  const [hot, setHot] = useState<Record<string, number>>({});
  const [favs, setFavs] = useState<Set<string>>(new Set());
  const [compare, setCompare] = useState<Set<string>>(new Set());
  const [showCompare, setShowCompare] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [lang, setLang] = useState<0 | 1>(0); // 0=zh 1=en

  useEffect(() => {
    setLang(localStorage.getItem('tf-lang') === 'en' ? 1 : 0);
    // 支持 /?q=关键词 直达搜索（搜索引擎站内搜索入口 / 外链分享）
    const q = new URLSearchParams(location.search).get('q');
    if (q) setQuery(q.slice(0, 60));
    fetch('/api/uptime')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setUptime(d))
      .catch(() => {});
    fetch('/api/hot')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setHot(d))
      .catch(() => {});
    try {
      setFavs(new Set(JSON.parse(localStorage.getItem('tf-favs') || '[]')));
    } catch {}
    try {
      setCompare(new Set(JSON.parse(localStorage.getItem('tf-compare') || '[]')));
    } catch {}
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        document.querySelector<HTMLInputElement>('input[type="text"]')?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const t = (key: keyof typeof UI) => UI[key][lang];

  const toggleFav = (id: string) => {
    setFavs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      localStorage.setItem('tf-favs', JSON.stringify([...next]));
      return next;
    });
  };

  const toggleCompare = (id: string) => {
    setCompare((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < 4) next.add(id); // 最多对比 4 个
      localStorage.setItem('tf-compare', JSON.stringify([...next]));
      return next;
    });
  };

  const copyInvite = (site: SiteItem) => {
    if (!site.inviteCode) return;
    navigator.clipboard?.writeText(site.inviteCode).then(() => {
      setCopiedId(site.id);
      setTimeout(() => setCopiedId(null), 1500);
    }).catch(() => {});
  };

  // 榜单默认序（精选优先）下的名次：仅在用户未搜索/筛选/改排序时展示
  const rankMap = useMemo(() => {
    const m = new Map<string, number>();
    [...initialSites]
      .sort((a, b) => Number(b.isFeatured ?? false) - Number(a.isFeatured ?? false))
      .forEach((s, i) => m.set(s.id, i + 1));
    return m;
  }, [initialSites]);
  const isDefaultOrder = !query.trim() && !activeModel && !activeTag && !favOnly && sortBy === 'default';

  const usedModels = useMemo(() => {
    const counts = new Map<string, number>();
    initialSites.forEach((s) => s.models.forEach((m) => counts.set(m, (counts.get(m) || 0) + 1)));
    return models.filter((m) => counts.has(m.id));
  }, [initialSites, models]);

  const usedTags = useMemo(() => {
    const counts = new Map<string, number>();
    initialSites.forEach((s) => s.tags.forEach((t) => counts.set(t, (counts.get(t) || 0) + 1)));
    return [...counts.entries()]
      .sort((a, b) => {
        const pa = PRESET_TAGS.indexOf(a[0]);
        const pb = PRESET_TAGS.indexOf(b[0]);
        if (pa >= 0 || pb >= 0) return (pa < 0 ? 99 : pa) - (pb < 0 ? 99 : pb);
        return b[1] - a[1];
      })
      .map(([t]) => t)
      .slice(0, 12);
  }, [initialSites]);

  const filtered = useMemo(() => {
    let list = initialSites;
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.summary.toLowerCase().includes(q) ||
          (s as any).description?.toLowerCase().includes(q) ||
          s.bonus.toLowerCase().includes(q) ||
          (s.inviteCode || '').toLowerCase().includes(q) ||
          s.tags.some((t) => t.toLowerCase().includes(q))
      );
    }
    if (activeModel) list = list.filter((s) => s.models.includes(activeModel));
    if (activeTag) list = list.filter((s) => s.tags.includes(activeTag));
    if (favOnly) list = list.filter((s) => favs.has(s.id));
    if (freeOnly) list = list.filter((s) => s.bonus || /送|签到|免费|公益/.test(s.summary));
    if (maxMult !== null) list = list.filter((s) => s.multiplier !== null && s.multiplier <= maxMult);
    if (sortBy === 'default') {
      // 榜单默认序：精选优先（保持原有相对顺序）
      list = [...list].sort((a, b) => Number(b.isFeatured ?? false) - Number(a.isFeatured ?? false));
    }
    if (sortBy === 'multiplier') {
      list = [...list].sort((a, b) => {
        if (a.multiplier === null && b.multiplier === null) return 0;
        if (a.multiplier === null) return 1;
        if (b.multiplier === null) return -1;
        return a.multiplier - b.multiplier;
      });
    }
    if (sortBy === 'hot') {
      list = [...list].sort((a, b) => (hot[b.id] || 0) - (hot[a.id] || 0));
    }
    if (sortBy === 'new') {
      list = [...list].sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1));
    }
    return list;
  }, [initialSites, query, activeModel, activeTag, favOnly, favs, freeOnly, maxMult, sortBy, hot]);

  const compareSites = initialSites.filter((s) => compare.has(s.id));
  const activeFilterCount =
    (activeModel ? 1 : 0) + (activeTag ? 1 : 0) + (favOnly ? 1 : 0) + (freeOnly ? 1 : 0) + (maxMult !== null ? 1 : 0);

  const clearAll = () => {
    setQuery('');
    setActiveModel(null);
    setActiveTag(null);
    setFavOnly(false);
    setFreeOnly(false);
    setMaxMult(null);
  };

  const chipCls = (active: boolean) =>
    `shrink-0 text-xs px-3 py-1.5 rounded-full border transition-colors ${
      active
        ? 'bg-accent-muted border-accent/40 text-accent'
        : 'border-border text-text-secondary hover:border-border-hover hover:text-text-primary'
    }`;

  const goHref = (site: SiteItem) =>
    site.url
      ? `/go?url=${encodeURIComponent(site.affUrl || site.url)}&id=${encodeURIComponent(site.id)}`
      : null;

  const summaryOf = (s: SiteItem) => (lang === 1 && s.summaryEn ? s.summaryEn : s.summary);

  return (
    <div>
      {/* 工具栏：搜索 + 排序始终可见，筛选条件折叠 */}
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
              placeholder={t('searchPh')}
              className="w-full bg-bg-secondary border border-border rounded-lg pl-9 pr-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/50 transition-colors"
            />
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`px-3 py-2 rounded-lg border text-sm transition-colors ${
                showFilters || activeFilterCount > 0
                  ? 'bg-accent-muted border-accent/40 text-accent'
                  : 'border-border text-text-secondary hover:text-text-primary'
              }`}
            >
              ⚙ {t('filter')}{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
            </button>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as 'default' | 'multiplier' | 'hot' | 'new')}
              className="bg-bg-secondary border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent/50"
            >
              <option value="default">{t('sortDefault')}</option>
              <option value="multiplier">{t('sortMult')}</option>
              <option value="hot">{t('sortHot')}</option>
              <option value="new">{t('sortNew')}</option>
            </select>
            <div className="flex rounded-lg border border-border overflow-hidden">
              <button
                onClick={() => setView('card')}
                className={`px-2.5 py-2 text-xs ${view === 'card' ? 'bg-accent-muted text-accent' : 'text-text-muted hover:text-text-secondary'}`}
                title={t('cardView')}
              >
                ▦
              </button>
              <button
                onClick={() => setView('table')}
                className={`px-2.5 py-2 text-xs ${view === 'table' ? 'bg-accent-muted text-accent' : 'text-text-muted hover:text-text-secondary'}`}
                title={t('tableView')}
              >
                ☰
              </button>
            </div>
          </div>
        </div>
        {showFilters && (
          <div>
            <div className="flex items-center gap-2 mt-3 overflow-x-auto">
              <button onClick={() => setActiveModel(null)} className={chipCls(activeModel === null)}>{t('all')}</button>
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
            {/* 倍率区间快筛（本站核心决策维度） */}
            <div className="flex items-center gap-2 mt-2 overflow-x-auto">
              <span className="shrink-0 text-xs text-text-muted pr-1">⚡</span>
              <button onClick={() => setMaxMult(null)} className={chipCls(maxMult === null)}>{t('multAll')}</button>
              {[0.01, 0.1, 0.5].map((m) => (
                <button key={m} onClick={() => setMaxMult(maxMult === m ? null : m)} className={chipCls(maxMult === m)}>
                  ≤{m}x
                </button>
              ))}
              <button
                onClick={() => setFreeOnly(!freeOnly)}
                className={`shrink-0 text-xs px-3 py-1.5 rounded-full border transition-colors ${
                  freeOnly ? 'bg-status-stable/15 border-status-stable/40 text-status-stable' : 'border-border text-text-secondary hover:border-border-hover hover:text-text-primary'
                }`}
              >
                🎁 {t('freeOnly')}
              </button>
            </div>
            <div className="flex items-center gap-2 mt-2 overflow-x-auto">
              <button
                onClick={() => setFavOnly(!favOnly)}
                className={`shrink-0 text-xs px-2.5 py-1 rounded-full border transition-colors ${
                  favOnly ? 'bg-accent-muted border-accent/40 text-accent' : 'border-border-dashed text-text-muted hover:text-text-secondary'
                }`}
                style={favOnly ? undefined : { borderStyle: 'dashed' }}
              >
                ★ {t('fav')}{favs.size > 0 ? `(${favs.size})` : ''}
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
              {(activeModel || activeTag || favOnly || freeOnly || maxMult !== null) && (
                <button
                  onClick={clearAll}
                  className="shrink-0 text-xs px-2.5 py-1 rounded-full border border-border text-text-muted hover:text-status-unstable hover:border-status-unstable/40 transition-colors"
                >
                  ✕ {t('reset')}
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      <p className="text-xs text-text-muted mb-4">
        {filtered.length} {t('results')}
        {activeModel && `（${usedModels.find((m) => m.id === activeModel)?.name}）`}
        {activeTag && ` #${activeTag}`}
        {favOnly && ' ★'}
      </p>

      {filtered.length === 0 ? (
        <div className="py-16 text-center">
          <p className="text-text-muted text-sm mb-4">{t('empty')}</p>
          <button onClick={clearAll} className="text-sm px-4 py-2 rounded-lg border border-accent/40 text-accent hover:bg-accent-muted transition-colors">
            {t('emptyCta')}
          </button>
        </div>
      ) : view === 'table' ? (
        <div className="rounded-xl border border-border overflow-x-auto bg-bg-secondary">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-text-muted border-b border-border">
                <th className="px-4 py-3 font-normal"></th>
                <th className="px-4 py-3 font-normal">{t('cName')}</th>
                <th className="px-4 py-3 font-normal">{t('cMult')}</th>
                <th className="px-4 py-3 font-normal">{t('cRealShort')}</th>
                <th className="px-4 py-3 font-normal">{t('cSummary')}</th>
                <th className="px-4 py-3 font-normal">{t('cModels')}</th>
                <th className="px-4 py-3 font-normal"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((site) => {
                const live = uptime[site.id];
                const ls = liveState(live, lang);
                const dotColor = ls ? ls.color : statusMap[site.status].color;
                const real = realMultiplier(site);
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
                      {live?.up && live.latencyMs != null && <span className="text-xs font-mono text-text-muted mr-1.5 align-middle">{live.latencyMs}ms</span>}
                      <a href={`/site/${site.id}`} className="font-medium hover:text-accent transition-colors">{site.name}</a>
                    </td>
                    <td className="px-4 py-2.5 font-mono font-bold text-base whitespace-nowrap" style={{ color: multiplierColor(site.multiplier) }}>
                      {site.multiplier !== null ? `${site.multiplier}x` : '—'}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-sm whitespace-nowrap">
                      {real !== null ? <span className="px-1.5 py-0.5 rounded" style={{ color: multiplierColor(real), backgroundColor: `${multiplierColor(real)}14` }}>≈{real.toFixed(2)}x</span> : '—'}
                    </td>
                    <td className="px-4 py-2.5 text-text-secondary max-w-xs truncate">{summaryOf(site)}</td>
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
                          {t('visitShort')}
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
            const ls = liveState(live, lang);
            const dotColor = ls ? ls.color : st.color;
            const dotTitle = ls
              ? (live!.up && live!.latencyMs != null
                  ? `${ls.label} · ${live!.latencyMs}ms`
                  : ls.label)
              : st.label[lang];
            const href = goHref(site);
            const real = realMultiplier(site);
            const inCompare = compare.has(site.id);
            const rank = rankMap.get(site.id);
            const age = ageParts(site.createdAt);
            const hotCount = hot[site.id] || 0;
            return (
              <div
                key={site.id}
                className={`group relative p-5 pt-6 rounded-2xl bg-bg-secondary border transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl hover:shadow-black/25 ${
                  site.isFeatured
                    ? 'border-accent/30 hover:border-accent/50 bg-gradient-to-br from-accent/[0.06] to-transparent'
                    : 'border-border hover:border-accent/30'
                }`}
              >
                <button
                  onClick={() => toggleFav(site.id)}
                  className={`absolute top-3.5 right-3.5 p-1.5 -m-1.5 text-sm leading-none transition-all ${
                    favs.has(site.id)
                      ? 'text-accent opacity-100'
                      // 移动端无 hover：常显半透明；桌面端保持悬停浮现
                      : 'text-text-muted opacity-50 md:opacity-0 md:group-hover:opacity-100 hover:text-accent'
                  }`}
                  title="收藏"
                >
                  {favs.has(site.id) ? '★' : '☆'}
                </button>

                {/* 获奖理由缎带 / 精选标记 */}
                {site.award && (
                  <span className="absolute top-0 left-5 -translate-y-1/2 text-xs font-medium px-2.5 py-0.5 rounded-full bg-accent text-white shadow-sm">
                    🏆 {lang && site.awardEn ? site.awardEn : site.award}
                  </span>
                )}
                {!site.award && site.isFeatured && (
                  <span className="absolute top-0 left-5 -translate-y-1/2 text-xs font-medium px-2.5 py-0.5 rounded-full bg-accent text-white shadow-sm">
                    ⭐ {lang ? 'Featured' : '精选'}
                  </span>
                )}

                <div className="flex items-start gap-3 pr-6 mb-2.5">
                  {isDefaultOrder && rank !== undefined && (
                    <span className={`shrink-0 self-center w-7 text-center text-xl font-bold font-mono select-none ${rank <= 3 ? 'text-accent' : 'text-text-muted/50'}`}>
                      {rank}
                    </span>
                  )}
                  <Avatar name={site.name} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <a href={`/site/${site.id}`} className="font-semibold text-text-primary truncate hover:text-accent transition-colors">
                        {site.name}
                      </a>
                    </div>
                    {/* 信任/状态 meta 行：状态 · 延迟 · 网络（API 异常升级为黄色告警块） */}
                    <div className="flex items-center gap-2 flex-wrap mt-1">
                      <span
                        className={`flex items-center gap-1 text-xs ${live?.up && live.apiUp === false ? 'px-1.5 py-0.5 rounded-md' : ''}`}
                        style={
                          live?.up && live.apiUp === false
                            ? { color: dotColor, backgroundColor: `${dotColor}1f` }
                            : { color: dotColor }
                        }
                        title={dotTitle}
                      >
                        <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: dotColor }} />
                        {ls ? ls.label : st.label[lang]}
                      </span>
                      {live?.up && live.latencyMs != null && (
                        <span className="text-xs font-mono text-text-muted">⚡{live.latencyMs}ms</span>
                      )}
                      {site.network === 'direct' && <span className="text-xs text-status-stable">{t('direct')}</span>}
                      {site.network === 'proxy' && <span className="text-xs text-status-unstable">{t('proxy')}</span>}
                      {age && (
                        <span className="text-xs text-text-muted" title={site.createdAt}>
                          {t('months')} {ageText(age, lang)}
                        </span>
                      )}
                      {hotCount > 0 && (
                        <span className="text-xs text-text-muted" title={lang ? 'total visits' : '累计访问'}>
                          🔥 {hotCount}
                        </span>
                      )}
                    </div>
                  </div>
                  {site.multiplier !== null && (
                    <div className="shrink-0 text-right">
                      <span
                        className="block text-lg font-mono font-bold px-2.5 py-1 rounded-lg"
                        style={{
                          color: multiplierColor(site.multiplier),
                          backgroundColor: `${multiplierColor(site.multiplier)}1a`,
                        }}
                      >
                        {site.multiplier}x
                      </span>
                      {real !== null && (
                        <span className="block text-xs font-mono mt-1 text-text-muted" title={t('realNote')}>
                          {lang ? 'real' : '实际'} ≈{real.toFixed(2)}x
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {site.bonus ? (
                  <p className="text-sm text-status-stable/90 mb-1.5">🎁 {lang && site.bonusEn ? site.bonusEn : site.bonus}</p>
                ) : null}
                <p className="text-[15px] text-text-secondary leading-relaxed line-clamp-2 mb-3 min-h-[2.5rem]">{summaryOf(site)}</p>

                {site.inviteCode ? (
                  <button
                    onClick={() => copyInvite(site)}
                    className="mb-3 inline-flex items-center gap-1 text-xs font-mono px-2 py-1 rounded border border-accent/30 bg-accent-muted/50 text-accent hover:bg-accent-muted transition-colors"
                  >
                    🎫 {site.inviteCode} · {copiedId === site.id ? t('copied') : t('copy')}
                  </button>
                ) : null}

                <div className="flex items-center justify-between gap-2">
                  <div className="flex flex-wrap gap-1.5 min-w-0">
                    {site.models.slice(0, 4).map((mid) => {
                      const model = models.find((mm) => mm.id === mid);
                      if (!model) return null;
                      return (
                        <span key={mid} className="text-xs px-2 py-0.5 rounded-md" style={{ color: model.color, backgroundColor: `${model.color}12` }}>
                          {model.name}
                        </span>
                      );
                    })}
                    {site.models.length > 4 && (
                      <span className="text-xs px-2 py-0.5 rounded-md bg-bg-tertiary text-text-muted">+{site.models.length - 4}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => toggleCompare(site.id)}
                      className={`text-xs px-2.5 py-2 m-[-4px] rounded-lg border transition-colors ${
                        inCompare
                          ? 'bg-accent text-white border-accent'
                          // 移动端无 hover：常显半透明；桌面端保持悬停浮现
                          : 'border-border text-text-muted opacity-60 md:opacity-0 md:group-hover:opacity-100 hover:text-accent hover:border-accent/40'
                      }`}
                      title={t('compare')}
                    >
                      ⇄
                    </button>
                    {href && (
                      <a
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer nofollow"
                        className="shrink-0 text-sm px-3.5 py-2 rounded-lg bg-accent-muted text-accent hover:bg-accent hover:text-white transition-colors font-medium"
                      >
                        {t('visit')}
                      </a>
                    )}
                  </div>
                </div>
                {!href && <p className="text-xs text-text-muted mt-2">{t('pending')}</p>}
              </div>
            );
          })}
        </div>
      )}

      {/* 对比浮条 + 对比弹层 */}
      {compare.size > 0 && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-4 py-2.5 rounded-xl bg-bg-secondary border border-accent/30 shadow-2xl shadow-black/40">
          <span className="text-xs text-text-secondary">
            {t('compareBar')} {compare.size}/4：{compareSites.map((s) => s.name).join('、')}
          </span>
          <button onClick={() => setShowCompare(true)} disabled={compare.size < 2} className="text-xs px-3 py-1.5 rounded-lg bg-accent text-white hover:bg-accent-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
            {t('compareGo')}
          </button>
          <button onClick={() => { setCompare(new Set()); localStorage.removeItem('tf-compare'); }} className="text-xs text-text-muted hover:text-text-primary">
            {t('compareClear')}
          </button>
        </div>
      )}
      {showCompare && compareSites.length >= 2 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => setShowCompare(false)}>
          <div className="w-full max-w-3xl max-h-[80vh] overflow-auto rounded-2xl bg-bg-secondary border border-border p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-text-primary">{t('compareTitle')}</h3>
              <button onClick={() => setShowCompare(false)} className="text-text-muted hover:text-text-primary text-xl leading-none">{t('close')} ✕</button>
            </div>
            <table className="w-full text-sm">
              <tbody>
                {(
                  [
                    ['cName', (s: SiteItem) => <a key="n" href={`/site/${s.id}`} className="font-semibold text-accent hover:underline">{s.name}</a>],
                    ['cMult', (s: SiteItem) => <span key="m" className="font-mono font-bold text-base" style={{ color: multiplierColor(s.multiplier) }}>{s.multiplier !== null ? `${s.multiplier}x` : '—'}</span>],
                    ['cReal', (s: SiteItem) => { const r = realMultiplier(s); return <span key="r" className="font-mono text-base">{r !== null ? `≈${r.toFixed(2)}x` : '—'}</span>; }],
                    ['cStatus', (s: SiteItem) => { const ls = liveState(uptime[s.id], lang); const c = ls ? ls.color : statusMap[s.status].color; const label = ls ? ls.label : statusMap[s.status].label[lang]; return <span key="s" style={{ color: c }}>● {label}</span>; }],
                    ['cLatency', (s: SiteItem) => <span key="l" className="font-mono text-base">{uptime[s.id]?.up ? (uptime[s.id].latencyMs != null ? `${uptime[s.id].latencyMs}ms` : '—') : '—'}</span>],
                    ['cUptime', (s: SiteItem) => <span key="u" className="font-mono text-base">{uptime[s.id]?.uptime24h != null ? `${Math.round(uptime[s.id].uptime24h! * 100)}%` : '—'}</span>],
                    ['cAge', (s: SiteItem) => { const a = ageParts(s.createdAt); return <span key="a" className="font-mono">{a ? ageText(a, lang) : '—'}</span>; }],
                    ['cBonus', (s: SiteItem) => <span key="b" className="text-status-stable text-xs">{s.bonus || '—'}</span>],
                    ['cInvite', (s: SiteItem) => (s.inviteCode ? <button key="i" onClick={() => copyInvite(s)} className="font-mono text-xs px-2 py-0.5 rounded border border-accent/30 text-accent hover:bg-accent-muted">{copiedId === s.id ? t('copied') : s.inviteCode}</button> : <span key="i" className="text-text-muted">—</span>)],
                    ['cNet', (s: SiteItem) => (s.network === 'direct' ? t('direct') : s.network === 'proxy' ? t('proxy') : '—')],
                    ['cModels', (s: SiteItem) => s.models.map((mid) => models.find((x) => x.id === mid)?.name || mid).join(' / ') || '—'],
                  ] as Array<[keyof typeof UI, (s: SiteItem) => any]>
                ).map(([key, render]) => (
                  <tr key={key} className="border-b border-border last:border-0">
                    <td className="py-2.5 pr-4 text-xs text-text-muted whitespace-nowrap align-top">{t(key)}</td>
                    {compareSites.map((s) => (
                      <td key={s.id} className="py-2.5 px-3 text-text-secondary">{render(s)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-4 text-xs text-text-muted leading-relaxed">{t('realNote')}</p>
          </div>
        </div>
      )}
    </div>
  );
}
