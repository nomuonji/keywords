import { useEffect, useMemo, useState } from 'react';
import { api } from './api';

type PendingEvent = {
  id: string; articleId: string; hypothesis: string; actionType: string;
  changedAt?: string | null; evaluateAfter?: string | null;
};
type SiteDigest = {
  generatedAt: string;
  activeOptimizations: PendingEvent[];
} | null;
type Site = { id: string; name: string; productionUrl: string; status: string; digest: SiteDigest };
type Article = { id: string; title?: string | null; canonicalUrl?: string | null; status?: string | null };

const when = (value?: string | null) => value ? new Date(value).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric' }) : '—';
const daysLeft = (value?: string | null) => {
  if (!value) return '—';
  const days = Math.ceil((Date.parse(value) - Date.now()) / 86400000);
  return days <= 0 ? '評価期' : `あと${days}日`;
};

export function RemoteOperationsOverview() {
  const [sites, setSites] = useState<Site[]>([]);
  const [titles, setTitles] = useState<Record<string, { title: string; url: string }>>({});
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState('');
  const load = async () => {
    setLoading(true); setError('');
    try {
      const data = await api<{ generatedAt: string; sites: Site[] }>('/api/remote-sites');
      setSites(data.sites); setUpdatedAt(data.generatedAt);
      const withPending = data.sites.filter(site => (site.digest?.activeOptimizations.length ?? 0) > 0);
      const resolved: Record<string, { title: string; url: string }> = {};
      for (const site of withPending) {
        try {
          const articles = await api<{ items: Article[] }>(`/api/remote-articles?siteId=${encodeURIComponent(site.id)}&limit=100`);
          for (const article of articles.items) resolved[article.id] = { title: article.title ?? article.id, url: article.canonicalUrl ?? '' };
        } catch { /* digest stays usable without titles */ }
      }
      setTitles(resolved);
    } catch (e) { setError(e instanceof Error ? e.message : '取得できませんでした'); } finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);
  const pending = useMemo(() => sites.flatMap(site => (site.digest?.activeOptimizations ?? []).map(event => ({ site, event }))).sort((a, b) => String(a.event.evaluateAfter ?? '').localeCompare(String(b.event.evaluateAfter ?? ''))), [sites]);

  return <div className="corePage">
    <div className="coreTitleRow"><div><p className="coreEyebrow">REMOTE DAILY CONTROL</p><h1>検証待ちの仮説</h1><p>実施済み・未評価の最適化だけを表示します（読み取り専用）。新規の判断はMCPで行います。</p></div><span className="countBadge">{loading ? '更新中' : `${pending.length}件検証待ち · ${when(updatedAt)}`}</span></div>
    {error && <div className="coreError">{error}<div><button onClick={() => void load()}>再試行</button></div></div>}
    <div className="coreToolbar"><button onClick={() => void load()} disabled={loading}>更新</button></div>
    {loading && !sites.length ? <div className="dashboardSkeleton" aria-label="読み込み中"><span /><span /><span /></div> : pending.length ? <div className="siteList">{pending.map(({ site, event }) => <details className="siteRow attention" key={event.id}><summary><span className="siteName"><i className="stateDot warn" /><span><b>{titles[event.articleId]?.title ?? event.articleId}</b><small>{site.name} · {event.actionType}</small></span></span><span><b>{daysLeft(event.evaluateAfter)}</b><small>評価予定 {when(event.evaluateAfter)}</small></span></summary><div className="siteExpanded"><div><h3>仮説</h3><p>{event.hypothesis}</p><small>変更 {when(event.changedAt)}{titles[event.articleId]?.url ? <> · <a href={titles[event.articleId].url} target="_blank" rel="noreferrer">記事を開く</a></> : null}</small></div></div></details>)}</div> : <p className="coreEmpty">検証待ちの仮説はありません。</p>}
  </div>;
}
