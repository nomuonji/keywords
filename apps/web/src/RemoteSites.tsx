import { useEffect, useMemo, useState } from 'react';
import { api } from './api';

type PlanningDigest = {
  siteId: string;
  repository?: string;
  productionUrl?: string;
  generatedAt: string;
  measurementEnd?: string | null;
  inventoryCount?: number | null;
  selectedCount?: number | null;
  notObservedInComplete90dGscCount?: number | null;
  statuses?: Record<string, unknown> | null;
} | null;

type RemoteSite = {
  id: string;
  name: string;
  repository: string;
  productionUrl: string;
  deploymentProvider: string;
  status: string;
  ga4PropertyId: string | null;
  searchConsoleProperty: string | null;
  localProjectId: string | null;
  planningDigest: PlanningDigest;
};

type Response = {
  generatedAt: string;
  sites: RemoteSite[];
  semantics?: { scope?: string; siteMonitor?: string; analytics?: string };
};

const when = (value?: string | null) => value
  ? new Date(value).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  : '—';
const num = (value?: number | null) => value == null ? '—' : Number(value).toLocaleString('ja-JP');
const ageDays = (value?: string | null) => value ? Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 86400000)) : null;
const freshness = (value?: string | null) => {
  const days = ageDays(value);
  if (days == null) return { label: '未取得', tone: 'bad' };
  if (days <= 2) return { label: 'fresh', tone: 'good' };
  if (days <= 7) return { label: `${days}日前`, tone: 'warn' };
  return { label: `${days}日前`, tone: 'bad' };
};

function statusSummary(value?: Record<string, unknown> | null) {
  if (!value) return [];
  return Object.entries(value).slice(0, 4).map(([key, item]) => ({
    key,
    value: typeof item === 'string' ? item : typeof item === 'boolean' ? (item ? 'ok' : 'ng') : JSON.stringify(item)
  }));
}

export function RemoteSitesOverview() {
  const [sites, setSites] = useState<RemoteSite[]>([]);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('managed');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState('');
  const load = async () => {
    setLoading(true); setError('');
    try {
      const data = await api<Response>('/api/remote-sites');
      setSites(data.sites); setUpdatedAt(data.generatedAt);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'サイト情報を取得できませんでした');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void load(); }, []);

  const visible = useMemo(() => sites.filter(site => {
    const matchesSearch = `${site.name} ${site.productionUrl} ${site.repository}`.toLowerCase().includes(query.toLowerCase());
    const digestAge = ageDays(site.planningDigest?.generatedAt);
    const attention = site.status !== 'active' || !site.planningDigest || (digestAge != null && digestAge > 7);
    const matchesFilter = filter === 'all'
      || filter === 'attention' && attention
      || filter === 'managed' && site.status === 'active';
    return matchesSearch && matchesFilter;
  }).sort((a, b) => {
    const aa = !a.planningDigest || (ageDays(a.planningDigest.generatedAt) ?? 99) > 7 ? 1 : 0;
    const bb = !b.planningDigest || (ageDays(b.planningDigest.generatedAt) ?? 99) > 7 ? 1 : 0;
    return bb - aa || a.name.localeCompare(b.name, 'ja');
  }), [sites, query, filter]);

  const activeCount = sites.filter(site => site.status === 'active').length;
  const freshCount = sites.filter(site => site.planningDigest && (ageDays(site.planningDigest.generatedAt) ?? 99) <= 2).length;

  return <div className="corePage">
    <div className="coreTitleRow">
      <div>
        <p className="coreEyebrow">AGENT-MANAGED SITES</p>
        <h1>Sites Operator</h1>
        <p>ここにあるサイトだけがエージェント運営対象です。site-monitor は人間用の全体一覧で、Agentの判断元には使いません。</p>
      </div>
      <span className="countBadge">{loading ? '更新中' : `${activeCount} managed · ${freshCount} fresh`}</span>
    </div>

    <section className="remoteSummaryStrip" aria-label="Sites Operator status">
      <div><small>管理対象</small><strong>{activeCount}</strong><span>active sites</span></div>
      <div><small>planning data</small><strong>{freshCount}</strong><span>2日以内</span></div>
      <div><small>データ取得</small><strong>外部化</strong><span>UI / ChatGPTはGoogleを叩かない</span></div>
      <div><small>DB read</small><strong>bounded</strong><span>registry + digest list</span></div>
    </section>

    {error && <div className="coreError">{error}<div><button onClick={() => void load()}>再試行</button></div></div>}

    <div className="coreToolbar">
      <input value={query} onChange={e => setQuery(e.target.value)} placeholder="サイト名・URL・repoを検索" aria-label="サイトを検索" />
      <div className="segmented">
        <button className={filter === 'managed' ? 'active' : ''} onClick={() => setFilter('managed')}>管理対象</button>
        <button className={filter === 'attention' ? 'active' : ''} onClick={() => setFilter('attention')}>要確認</button>
        <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>すべて</button>
      </div>
      <button onClick={() => void load()} disabled={loading}>更新</button>
    </div>

    {loading && !sites.length ? <div className="dashboardSkeleton" aria-label="サイト情報を読み込み中"><span /><span /><span /></div> : <>
      <div className="managedSiteHeader"><span>サイト</span><span>計測</span><span>記事inventory</span><span>分析対象</span><span>90d未観測</span><span>状態</span></div>
      <div className="managedSiteList">
        {visible.map(site => {
          const digest = site.planningDigest;
          const fresh = freshness(digest?.generatedAt);
          const digestStatuses = statusSummary(digest?.statuses);
          const attention = !digest || fresh.tone !== 'good' || site.status !== 'active';
          return <details className={`managedSiteRow ${attention ? 'attention' : ''}`} key={site.id}>
            <summary>
              <span className="siteName"><i className={`stateDot ${site.status === 'active' ? 'good' : 'warn'}`} /><span><b>{site.name}</b><small>{site.productionUrl}</small></span></span>
              <span><b className={`${fresh.tone}Text`}>{fresh.label}</b><small>{digest ? `digest ${when(digest.generatedAt)}` : 'planning digestなし'}</small></span>
              <span><b>{num(digest?.inventoryCount)}</b><small>registered pages</small></span>
              <span><b>{num(digest?.selectedCount)}</b><small>compact digest</small></span>
              <span><b>{num(digest?.notObservedInComplete90dGscCount)}</b><small>complete 90d GSC</small></span>
              <span><i className={`togglePill ${site.status === 'active' ? 'on' : 'off'}`}>{site.status}</i></span>
            </summary>
            <div className="managedSiteExpanded">
              <div>
                <h3>PLANNING DATA</h3>
                <p>measurement end: <b>{digest?.measurementEnd ?? '—'}</b></p>
                <p>generated: <b>{when(digest?.generatedAt)}</b></p>
                {digestStatuses.length ? <div className="miniStatusList">{digestStatuses.map(item => <span key={item.key}><small>{item.key}</small><b>{item.value}</b></span>)}</div> : <small>status metadataなし</small>}
              </div>
              <div>
                <h3>SOURCE OF TRUTH</h3>
                <p>{site.repository}</p>
                <small>Git = 記事本文 / code</small><br />
                <small>Sites Operator = planning data / task history</small>
              </div>
              <div>
                <h3>ANALYTICS</h3>
                <p>{site.searchConsoleProperty ?? 'GSC未登録'}</p>
                <p>{site.ga4PropertyId ?? 'GA4未登録'}</p>
                <small>取得は外部measurement job。UI表示ではGoogle APIを呼びません。</small>
              </div>
            </div>
          </details>;
        })}
        {!visible.length && <div className="composedEmpty"><strong>条件に一致するサイトはありません</strong><p>Sites Operator registryの絞り込みを変更してください。</p></div>}
      </div>
    </>}
    <p className="remoteFootnote">画面表示は自動ポーリングしません。Firestore readを増やさないため、必要なときだけ「更新」で再読込します。最終表示更新 {when(updatedAt)}</p>
  </div>;
}
