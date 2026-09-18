import { useEffect, useMemo, useState } from 'react';
import { api } from './api';

type Site = { id: string; name: string; productionUrl: string; status: string; digest: { articleCount: number } | null };
type Article = {
  id: string; title?: string | null; canonicalUrl?: string | null; status?: string | null;
  repoPath?: string | null; slug?: string | null; updatedAt?: string | null;
};

const when = (value?: string | null) => value ? new Date(value).toLocaleString('ja-JP', { year: 'numeric', month: 'numeric', day: 'numeric' }) : '—';

export function RemoteArticlesOverview() {
  const [sites, setSites] = useState<Site[]>([]);
  const [siteId, setSiteId] = useState('');
  const [items, setItems] = useState<Article[]>([]);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const loadSites = async () => {
    try {
      const data = await api<{ sites: Site[] }>('/api/remote-sites');
      setSites(data.sites);
      if (!siteId && data.sites.length) setSiteId(data.sites[0].id);
    } catch (e) { setError(e instanceof Error ? e.message : 'サイト一覧を取得できませんでした'); }
  };
  const loadArticles = async (target = siteId, statusFilter = status) => {
    if (!target) return;
    setLoading(true); setError('');
    try {
      const params = new URLSearchParams({ siteId: target, limit: '100' });
      if (statusFilter) params.set('status', statusFilter);
      const data = await api<{ items: Article[] }>(`/api/remote-articles?${params}`);
      setItems(data.items);
    } catch (e) { setError(e instanceof Error ? e.message : '記事一覧を取得できませんでした'); } finally { setLoading(false); }
  };
  useEffect(() => { void (async () => { await loadSites(); })(); }, []);
  useEffect(() => { void loadArticles(); }, [siteId, status]);
  const visible = useMemo(() => items.filter(item => !query || `${item.title ?? ''} ${item.canonicalUrl ?? ''}`.toLowerCase().includes(query.toLowerCase())), [items, query]);
  const selected = sites.find(site => site.id === siteId);

  return <div className="corePage">
    <div className="coreTitleRow"><div><p className="coreEyebrow">REMOTE ARTICLE REGISTRY</p><h1>記事登録</h1><p>registryのメタ情報のみ表示します（最新100件）。本文はGitHubのサイトリポジトリにあります。</p></div><span className="countBadge">{visible.length}件</span></div>
    {error && <div className="coreError">{error}<div><button onClick={() => void loadArticles()}>再試行</button></div></div>}
    <div className="coreToolbar"><input value={query} onChange={e => setQuery(e.target.value)} placeholder="タイトル・URLを検索" aria-label="記事を検索" /><select value={siteId} onChange={e => setSiteId(e.target.value)} aria-label="サイトを選択">{sites.map(site => <option key={site.id} value={site.id}>{site.name}（{site.digest ? site.digest.articleCount : '—'}件）</option>)}</select><select value={status} onChange={e => setStatus(e.target.value)} aria-label="状態で絞り込み"><option value="">すべての状態</option><option value="draft">draft</option><option value="published">published</option><option value="paused">paused</option><option value="archived">archived</option></select><button onClick={() => { void loadSites(); void loadArticles(); }} disabled={loading}>更新</button></div>
    {selected && <p><small>{selected.productionUrl} · {selected.status}</small></p>}
    {loading ? <div className="dashboardSkeleton" aria-label="記事を読み込み中"><span /><span /><span /></div> : <div className="articleTableWrap"><table className="articleTable"><thead><tr><th>記事</th><th>状態</th><th>repoPath</th><th>更新</th></tr></thead><tbody>{visible.map(article => <tr key={article.id}><td><b>{article.title || '(無題)'}</b>{article.canonicalUrl && <small><a href={article.canonicalUrl} target="_blank" rel="noreferrer">{article.canonicalUrl}</a></small>}</td><td>{article.status ?? '—'}</td><td><small>{article.repoPath ?? '—'}</small></td><td>{when(article.updatedAt)}</td></tr>)}{!visible.length && <tr><td colSpan={4}>記事がありません。</td></tr>}</tbody></table></div>}
  </div>;
}
