import { useEffect, useMemo, useState } from 'react';
import { api } from './api';

type SeoTask = {
  id: string;
  siteId: string;
  repo: string;
  taskType: 'revise'|'merge'|'delete'|'internal_links'|'technical'|'new_article';
  status: 'proposed'|'issued'|'in_progress'|'completed'|'cancelled'|'superseded';
  priority: 'high'|'medium'|'low';
  title: string;
  targetUrls: string[];
  articleCount: number;
  issueNumber: number | null;
  issueUrl: string | null;
  issueState: 'open'|'closed'|null;
  resultCommitSha: string | null;
  executionSummary: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  lastHistory?: { at?: string; actor?: string; event?: string; detail?: string } | null;
};

type TaskResponse = {
  generatedAt: string;
  policyVersion: string;
  taskCount: number;
  tasks: SeoTask[];
};

type Site = { id: string; name: string; productionUrl: string; status: string };
type SitesResponse = { sites: Site[] };

const when = (value?: string | null) => value
  ? new Date(value).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  : '—';
const statusLabel: Record<string,string> = {
  proposed: 'Issue待ち',
  issued: 'Issue発行済み',
  in_progress: '実行中',
  completed: '完了',
  cancelled: '取消',
  superseded: '差替'
};
const typeLabel: Record<string,string> = {
  revise: '改稿',
  merge: '統合',
  delete: '削除',
  internal_links: '内部リンク',
  technical: '技術修正',
  new_article: '新規記事'
};
const statusTone = (status: SeoTask['status']) => {
  if (status === 'completed') return 'good';
  if (status === 'cancelled' || status === 'superseded') return 'muted';
  if (status === 'in_progress') return 'live';
  if (status === 'proposed') return 'warn';
  return 'open';
};

export function RemoteOperationsOverview() {
  const [tasks, setTasks] = useState<SeoTask[]>([]);
  const [sites, setSites] = useState<Record<string, Site>>({});
  const [filter, setFilter] = useState<'open'|'completed'|'all'>('open');
  const [typeFilter, setTypeFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [policyVersion, setPolicyVersion] = useState('');
  const [updatedAt, setUpdatedAt] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true); setError('');
    try {
      const [taskData, siteData] = await Promise.all([
        api<TaskResponse>('/api/remote-seo-tasks?limit=60'),
        api<SitesResponse>('/api/remote-sites?limit=100')
      ]);
      setTasks(taskData.tasks);
      setPolicyVersion(taskData.policyVersion);
      setUpdatedAt(taskData.generatedAt);
      setSites(Object.fromEntries(siteData.sites.map(site => [site.id, site])));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'SEOタスクを取得できませんでした');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void load(); }, []);

  const visible = useMemo(() => tasks.filter(task => {
    const open = ['proposed','issued','in_progress'].includes(task.status);
    const statusMatch = filter === 'all' || filter === 'open' && open || filter === 'completed' && task.status === 'completed';
    const typeMatch = typeFilter === 'all' || task.taskType === typeFilter;
    const site = sites[task.siteId];
    const haystack = `${task.title} ${task.repo} ${site?.name ?? ''} ${task.targetUrls.join(' ')}`.toLowerCase();
    return statusMatch && typeMatch && haystack.includes(query.toLowerCase());
  }), [tasks, sites, filter, typeFilter, query]);

  const openCount = tasks.filter(task => ['proposed','issued','in_progress'].includes(task.status)).length;
  const issuedCount = tasks.filter(task => task.status === 'issued' && task.issueState === 'open').length;
  const runningCount = tasks.filter(task => task.status === 'in_progress').length;
  const completedCount = tasks.filter(task => task.status === 'completed').length;

  return <div className="corePage">
    <div className="coreTitleRow">
      <div>
        <p className="coreEyebrow">SEO ISSUE CONTROL</p>
        <h1>Issue Queue</h1>
        <p>ChatGPT plannerがSites Operatorのplanning digestを読み、GitHub Issueへ落とした作業だけを追います。実装は別Agentが担当します。</p>
      </div>
      <span className="countBadge">{loading ? '更新中' : `${openCount} open · policy v${policyVersion}`}</span>
    </div>

    <section className="remoteSummaryStrip">
      <div><small>未完了</small><strong>{openCount}</strong><span>proposed / issued / running</span></div>
      <div><small>GitHub Issue</small><strong>{issuedCount}</strong><span>open</span></div>
      <div><small>実行中</small><strong>{runningCount}</strong><span>executor working</span></div>
      <div><small>完了</small><strong>{completedCount}</strong><span>tracked result</span></div>
    </section>

    <aside className="operatorFlowNotice">
      <span>measurement job</span><i>→</i><span>planning digest</span><i>→</i><span>ChatGPT planner</span><i>→</i><span>GitHub Issue</span><i>→</i><span>executor</span>
    </aside>

    {error && <div className="coreError">{error}<div><button onClick={() => void load()}>再試行</button></div></div>}

    <div className="coreToolbar">
      <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Issue・repo・URLを検索" aria-label="SEOタスクを検索" />
      <div className="segmented">
        <button className={filter === 'open' ? 'active' : ''} onClick={() => setFilter('open')}>未完了</button>
        <button className={filter === 'completed' ? 'active' : ''} onClick={() => setFilter('completed')}>完了</button>
        <button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>すべて</button>
      </div>
      <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} aria-label="作業種別">
        <option value="all">全タイプ</option>
        {Object.entries(typeLabel).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
      </select>
      <button onClick={() => void load()} disabled={loading}>更新</button>
    </div>

    {loading && !tasks.length ? <div className="dashboardSkeleton" aria-label="SEOタスクを読み込み中"><span /><span /><span /></div> :
      <div className="seoTaskList">
        {visible.map(task => {
          const site = sites[task.siteId];
          return <details className={`seoTaskRow priority-${task.priority}`} key={task.id}>
            <summary>
              <span className={`taskStatusPill ${statusTone(task.status)}`}>{statusLabel[task.status] ?? task.status}</span>
              <span className="seoTaskTitle"><b>{task.title}</b><small>{site?.name ?? task.siteId} · {task.repo}</small></span>
              <span><b>{typeLabel[task.taskType] ?? task.taskType}</b><small>{task.priority}</small></span>
              <span><b>{task.issueNumber ? `#${task.issueNumber}` : '—'}</b><small>{task.issueState ?? 'Issue未発行'}</small></span>
              <span><b>{when(task.updatedAt)}</b><small>updated</small></span>
            </summary>
            <div className="seoTaskExpanded">
              <div className="seoTaskTargets">
                <h3>TARGET</h3>
                {task.targetUrls.length ? task.targetUrls.map(url => <a key={url} href={url} target="_blank" rel="noreferrer">{url}</a>) : <p>URLなし</p>}
                <small>{task.articleCount} article record</small>
              </div>
              <div>
                <h3>ISSUE</h3>
                {task.issueUrl ? <p><a href={task.issueUrl} target="_blank" rel="noreferrer">GitHub Issue #{task.issueNumber}</a></p> : <p>Issue発行待ち</p>}
                <small>state: {task.issueState ?? '—'} · created by {task.createdBy}</small>
              </div>
              <div>
                <h3>EXECUTION</h3>
                <p>{task.executionSummary || task.lastHistory?.detail || 'まだ実行結果はありません。'}</p>
                {task.resultCommitSha ? <small>commit {task.resultCommitSha.slice(0, 10)}</small> : <small>result commit未記録</small>}
              </div>
              {task.lastHistory && <div className="seoTaskHistory">
                <h3>LATEST HISTORY</h3>
                <p><b>{task.lastHistory.event ?? 'update'}</b> · {when(task.lastHistory.at)}</p>
                <small>{task.lastHistory.actor ?? 'unknown'}</small>
              </div>}
            </div>
          </details>;
        })}
        {!visible.length && <div className="composedEmpty"><strong>表示するSEO Issueはありません</strong><p>今のフィルタでは対象がありません。Plannerは件数合わせでIssueを作りません。</p></div>}
      </div>
    }
    <p className="remoteFootnote">自動ポーリングなし · 最新 {when(updatedAt)}。画面を開いた時と手動更新時だけbounded readします。</p>
  </div>;
}
