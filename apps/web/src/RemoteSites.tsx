import { useEffect, useMemo, useState } from 'react';
import { api } from './api';

type Snapshot = {
  id: string; provider: string; periodStart: string; periodEnd: string;
  metrics: Record<string, number | null>; capturedAt: string;
} | null;
type ActiveEvent = {
  id: string; articleId: string; hypothesis: string; actionType: string;
  changedAt?: string | null; evaluateAfter?: string | null;
} | null;
type RemoteSite = {
  id: string; name: string; repository: string; productionUrl: string;
  deploymentProvider: string; status: string;
  ga4PropertyId: string | null; searchConsoleProperty: string | null;
  localProjectId: string | null;
  digest: {
    generatedAt: string; articleCount: number; deferredCount?: number;
    latestSiteGsc: Snapshot; latestSiteGa4: Snapshot;
    activeOptimizations: Array<{
      id: string; articleId: string; hypothesis: string; actionType: string;
      changedAt?: string | null; evaluateAfter?: string | null;
    }>;
    warnings: string[];
  } | null;
};
type Response = { generatedAt: string; sites: RemoteSite[] };

const when = (value?: string | null) => value ? new Date(value).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
const num = (value?: number | null) => value == null ? '—' : Number(value).toLocaleString('ja-JP');

export function RemoteSitesOverview() {
  const [sites, setSites] = useState<RemoteSite[]>([]);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('active');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState('');
  const load = async () => {
    setLoading(true); setError('');
    try {
      const data = await api<Response>('/api/remote-sites');
      setSites(data.sites); setUpdatedAt(data.generatedAt);
    } catch (e) { setError(e instanceof Error ? e.message : 'サイト情報を取得できませんでした'); } finally { setLoading(false); }
  };
  // No background polling: every view costs Firestore reads, so remote
  // readers refresh manually. The endpoint itself is bounded (one list plus
  // one digest read per site).
  useEffect(() => { void load(); }, []);
  const visible = useMemo(() => sites.filter(site => {
    const matchesSearch = `${site.name} ${site.productionUrl}`.toLowerCase().includes(query.toLowerCase());
    const attention = site.status !== 'active' || (site.digest?.activeOptimizations.length ?? 0) > 0;
    const matchesFilter = filter === 'all' || filter === 'attention' && attention || filter === 'active' && (site.status === 'active' || attention);
    return matchesSearch && matchesFilter;
  }).sort((a, b) => Number((b.digest?.activeOptimizations.length ?? 0) > 0) - Number((a.digest?.activeOptimizations.length ?? 0) > 0) || a.name.localeCompare(b.name, 'ja')), [sites, query, filter]);

  const gscText = (snapshot: Snapshot) => snapshot ? `clicks ${num(snapshot.metrics.clicks)} · ${snapshot.periodStart}〜${snapshot.periodEnd}` : '—';
  const ga4Text = (snapshot: Snapshot) => snapshot ? `sessions ${num(snapshot.metrics.sessions)} · ${snapshot.periodStart}〜${snapshot.periodEnd}` : '—';
  const activeText = (event: ActiveEvent) => event ? `${event.actionType} · 評価 ${when(event.evaluateAfter)}` : 'なし';

  return <div className="corePage">
    <div className="coreTitleRow"><div><p className="coreEyebrow">REMOTE SITE CONTROL</p><h1>サイト運用（リモート）</h1><p>Firestoreのregistryと投影digestを読み取り専用で表示します。変更操作はMCPまたはローカルから行います。</p></div><span className="countBadge">{loading ? '更新中' : `${visible.length} / ${sites.length} sites · ${when(updatedAt)}`}</span></div>
    {error && <div className="coreError">{error}<div><button onClick={() => void load()}>再試行</button></div></div>}
    <div className="coreToolbar"><input value={query} onChange={e => setQuery(e.target.value)} placeholder="サイト名・URLを検索" aria-label="サイトを検索" /><div className="segmented"><button className={filter === 'active' ? 'active' : ''} onClick={() => setFilter('active')}>稼働中</button><button className={filter === 'attention' ? 'active' : ''} onClick={() => setFilter('attention')}>要対応</button><button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>すべて</button></div><button onClick={() => void load()} disabled={loading}>更新</button></div>
    {loading && !sites.length ? <div className="dashboardSkeleton" aria-label="サイト情報を読み込み中"><span /><span /><span /></div> : <><div className="siteListHeader"><span>サイト</span><span>記事registry</span><span>GSC</span><span>GA4</span><span>検証中の仮説</span><span>状態</span></div>
    <div className="siteList">{visible.map(site => <details className={`siteRow ${(site.digest?.activeOptimizations.length ?? 0) > 0 ? 'attention' : ''}`} key={site.id}><summary><span className="siteName"><i className={`stateDot ${site.status === 'active' ? 'good' : 'warn'}`} /><span><b>{site.name}</b><small>{site.productionUrl}</small></span></span><span><b>{site.digest ? num(site.digest.articleCount) : '—'}</b><small>{site.digest ? `digest ${when(site.digest.generatedAt)}${site.digest.deferredCount ? ` · 未登録${site.digest.deferredCount}` : ''}` : 'digestなし'}</small></span><span><b>{site.digest ? gscText(site.digest.latestSiteGsc).split(' · ')[0] : '—'}</b><small>GSC clicks</small></span><span><b>{site.digest ? ga4Text(site.digest.latestSiteGa4).split(' · ')[0] : '—'}</b><small>GA4 sessions</small></span><span><b>{(site.digest?.activeOptimizations.length ?? 0) > 0 ? site.digest!.activeOptimizations.length : '—'}</b><small>{site.digest?.activeOptimizations[0] ? activeText(site.digest.activeOptimizations[0]) : '仮説なし'}</small></span><span><i className={`togglePill ${site.status === 'active' ? 'on' : 'off'}`}>{site.status}</i></span></summary><div className="siteExpanded"><div><h3>計測</h3><p>GSC：{site.digest ? gscText(site.digest.latestSiteGsc) : '—'}</p><p>GA4：{site.digest ? ga4Text(site.digest.latestSiteGa4) : '—'}</p><small>{site.searchConsoleProperty ?? 'GSC未登録'} · {site.ga4PropertyId ?? 'GA4未登録'}</small></div><div><h3>検証中の仮説</h3>{(site.digest?.activeOptimizations ?? []).length ? site.digest!.activeOptimizations.map(event => <p key={event.id}>{event.hypothesis}<br /><small>{event.actionType} · 変更 {when(event.changedAt)} · 評価 {when(event.evaluateAfter)}</small></p>) : <p>なし</p>}</div><div><h3>登録</h3><p>{site.repository}</p><small>status: {site.status} · {site.deploymentProvider}</small></div></div></details>)}</div></>}
  </div>;
}
