import { useEffect, useMemo, useState } from 'react';
import { api } from './api';

type Project = { id: string; name: string; domain?: string | null };
type Outcome = { status: string; publishedAt?: string | null; evaluationDueAt?: string | null; metrics?: Record<string, unknown>; nextAction?: string | null; updatedAt: string } | null;
type KeywordResearch = { required: boolean; ready: boolean; missing: string[]; estimatedMonthlyTraffic?: number | null; estimatedTrafficBasis?: string | null };
type Article = {
  id: string; recordType: 'artifact' | 'local_file'; operationId?: string | null; projectId: string; projectName: string; projectDomain?: string | null;
  pageId?: string | null; articleId: string; title: string; url?: string | null; path: string; contentSha256: string; validatorStatus: string;
  buildStatus: string; verifiedAt?: string | null; revisionCount: number; failedChecks: string[]; updatedAt: string;
  keyword: { id: string; text: string; role?: string; avgMonthly?: number | null; competition?: number | null; cpcMicros?: number | null; clicks?: number | null; impressions?: number | null; ctr?: number | null; position?: number | null; demandValue?: number | null; demandProvider?: string | null; demandStatus?: string | null; demandObservedAt?: string | null; adCompetition?: number | null; serpStatus?: string | null; evidenceCount?: number; selectionDecisionId?: string | null; selectionVerdict?: string | null; selectionReason?: string | null } | null;
  keywordResearch?: KeywordResearch; outcome: Outcome;
};
type Result = { generatedAt: string; total: number; limit: number; offset: number; items: Article[] };
type ArticleContent = { artifact?: Article | null; path: string; exists: boolean; content: string | null; actualSha256: string | null; contentMatches: boolean };
type ContentState = { status: 'loading' | 'ready' | 'error'; data?: ArticleContent; error?: string };

const pageSize = 50;
const when = (value?: string | null) => value ? new Date(value).toLocaleString('ja-JP', { year: 'numeric', month: 'numeric', day: 'numeric' }) : '—';
const outcomeLabel: Record<string, string> = { pending: '評価待ち', improved: '改善', regressed: '悪化', inconclusive: '未判定', unmeasurable: '計測不能' };
const demandLabel: Record<string, string> = { provider_estimated: 'Provider推定', gsc_observed: 'GSC実績', search_surface_observed: '検索面観測', unverified: '未検証' };
const number = (value?: number | null) => value == null ? '—' : Number(value).toLocaleString('ja-JP');
const competition = (value?: number | null) => value == null ? '—' : `${(value <= 1 ? value * 100 : value).toFixed(0)}%`;

export function ArticlesOverview() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [data, setData] = useState<Result | null>(null);
  const [query, setQuery] = useState('');
  const [projectId, setProjectId] = useState('');
  const [status, setStatus] = useState('all');
  const [page, setPage] = useState(0);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [contentById, setContentById] = useState<Record<string, ContentState>>({});

  const loadContent = async (article: Article) => {
    if (contentById[article.id]?.status === 'loading' || contentById[article.id]?.status === 'ready') return;
    setContentById(current => ({ ...current, [article.id]: { status: 'loading' } }));
    try {
      const content = await api<ArticleContent>(`/articles/${encodeURIComponent(article.id)}/content`);
      setContentById(current => ({ ...current, [article.id]: { status: 'ready', data: content } }));
    } catch (e) {
      setContentById(current => ({ ...current, [article.id]: { status: 'error', error: String(e) } }));
    }
  };

  const deleteArticle = async (article: Article) => {
    if (busyId) return;
    const stage = article.recordType === 'local_file' ? '未登録のBlogファイル' : article.verifiedAt ? '検証済みのBlogファイル' : 'Keywordsに登録済みのBlogファイル';
    const publicationNote = article.outcome?.publishedAt ? '\n公開記録は残りますが、公開中サイトの公開停止は行いません。' : '';
    if (!window.confirm(`「${article.title}」\n\n段階: ${stage}\n本文ファイルをBlogの作業フォルダから削除します。\nこの操作は元に戻せません。${publicationNote}\n\n削除しますか？`)) return;
    setBusyId(article.id);
    try {
      await api(`/articles/${encodeURIComponent(article.id)}/delete`, { method: 'POST', body: JSON.stringify({ projectId: article.projectId, reason: 'Articles UIから削除' }) });
      setData(current => current ? { ...current, total: Math.max(0, current.total - 1), items: current.items.filter(item => item.id !== article.id) } : current);
      setContentById(current => { const next = { ...current }; delete next[article.id]; return next; });
    } catch (e) {
      setError(String(e));
    } finally {
      setBusyId(null);
    }
  };

  useEffect(() => { api<Project[]>('/projects').then(setProjects).catch(e => setError(String(e))); }, []);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        setLoading(true);
        const params = new URLSearchParams({ limit: String(pageSize), offset: String(page * pageSize) });
        if (query.trim()) params.set('q', query.trim());
        if (projectId) params.set('projectId', projectId);
        if (status !== 'all') params.set('status', status);
        setData(await api<Result>(`/articles?${params}`, { signal: controller.signal }));
        setError('');
      } catch (e) {
        if (!controller.signal.aborted) setError(String(e));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 180);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, projectId, status, page]);
  useEffect(() => setPage(0), [query, projectId, status]);

  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / pageSize));
  const summary = useMemo(() => ({
    verified: data?.items.filter(a => a.recordType === 'artifact' && a.verifiedAt).length ?? 0,
    working: data?.items.filter(a => a.recordType === 'artifact' && !a.verifiedAt).length ?? 0,
    local: data?.items.filter(a => a.recordType === 'local_file').length ?? 0,
    published: data?.items.filter(a => a.outcome?.publishedAt).length ?? 0,
    regressed: data?.items.filter(a => a.outcome?.status === 'regressed').length ?? 0
  }), [data]);

  return <div className="corePage">
    <div className="coreTitleRow"><div><p className="coreEyebrow">ARTICLE INDEX</p><h1>記事</h1><p>大量の記事を検索・絞り込みし、必要な行だけ詳細を開きます。</p></div><span className="countBadge">{data?.total ?? 0} articles</span></div>
    {error && <div className="coreError">{error}</div>}
    <div className="articleSummary"><span><b>{summary.verified}</b> 検証済み</span><span><b>{summary.working}</b> 制作中</span><span><b>{summary.local}</b> 未登録ファイル</span><span><b>{summary.published}</b> 公開記録あり</span><span className={summary.regressed ? 'dangerMetric' : ''}><b>{summary.regressed}</b> 悪化</span></div>
    <section className="articleLifecycleGuide" aria-label="記事の段階と削除の説明"><div className="articleLifecycleSteps"><span><i>1</i><b>Blogにファイル</b><small>本文が存在</small></span><span><i>2</i><b>Keywordsに登録</b><small>成果物として管理</small></span><span><i>3</i><b>検証済み</b><small>品質チェック完了</small></span><span><i>4</i><b>公開記録</b><small>公開後の評価対象</small></span></div><p><strong>削除について</strong> どの段階でも、確認後にBlog作業フォルダの本文ファイルを削除できます。削除した記事はこの一覧から消え、監査記録だけ残ります。公開中サイトの公開停止やURL削除は、この操作では行いません。</p></section>
    <div className="coreToolbar articleToolbar"><input value={query} onChange={e => setQuery(e.target.value)} placeholder="記事名・キーワード・サイトを検索" /><select value={projectId} onChange={e => setProjectId(e.target.value)}><option value="">すべてのサイト</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select><div className="segmented"><button className={status === 'all' ? 'active' : ''} onClick={() => setStatus('all')}>すべて</button><button className={status === 'in_progress' ? 'active' : ''} onClick={() => setStatus('in_progress')}>制作中</button><button className={status === 'complete' ? 'active' : ''} onClick={() => setStatus('complete')}>検証済み</button></div></div>
    <div className="articleTableWrap"><table className="articleTable"><thead><tr><th>記事</th><th>サイト</th><th>キーワード</th><th>状態</th><th>公開後</th><th>更新</th></tr></thead><tbody>
      {!loading && data?.items.map(article => {
        const contentState = contentById[article.id];
        const research = article.keywordResearch;
        const volume = article.keyword?.avgMonthly ?? article.keyword?.demandValue;
        return <tr key={article.id}><td colSpan={6}><details className="articleDetail" onToggle={event => { if ((event.currentTarget as HTMLDetailsElement).open) void loadContent(article); }}>
          <summary><span className="articleCellTitle"><b>{article.title}</b><small>{article.path}</small></span><span>{article.projectName}</span><span><b>{article.keyword?.text || '—'}</b><small>{volume != null ? `月間 ${number(volume)} · 競合 ${competition(article.keyword?.competition ?? article.keyword?.adCompetition)}` : '事前調査未登録'}</small></span><span><i className={`statusPill ${article.recordType === 'artifact' && article.verifiedAt ? 'good' : article.recordType === 'local_file' ? 'neutral' : 'work'}`}>{article.recordType === 'local_file' ? '未登録' : article.verifiedAt ? '検証済み' : '登録済み'}</i></span><span><i className={`statusPill ${article.outcome?.status || 'neutral'}`}>{article.outcome?.publishedAt ? (outcomeLabel[article.outcome.status] || '公開記録あり') : article.recordType === 'local_file' ? '公開記録なし' : '公開記録なし'}</i></span><span>{when(article.updatedAt)}</span></summary>
          <div className="articleExpanded"><div><h3>キーワード選定・事前調査</h3><p><b>{article.keyword?.text || '紐づくメインキーワードなし'}</b></p><div className="keywordEvidenceGrid"><span><small>月間検索数</small><b>{number(volume)}</b></span><span><small>競合</small><b>{competition(article.keyword?.competition ?? article.keyword?.adCompetition)}</b></span><span><small>推定月間流入</small><b>{number(research?.estimatedMonthlyTraffic)}</b></span><span><small>需要状態</small><b>{demandLabel[article.keyword?.demandStatus || ''] || article.keyword?.demandStatus || '—'}</b></span></div>{research?.ready ? <small>作成前チェック: 根拠あり · evidence {article.keyword?.evidenceCount ?? 0}件</small> : <small className="badText">作成前チェック未完了: {(research?.missing ?? ['primary_keyword']).join(' / ')}</small>}<small>Provider {article.keyword?.demandProvider || '—'} · SERP {article.keyword?.serpStatus || '—'}</small><small>{article.keyword?.selectionReason || '選定理由の記録なし'}</small></div>
            <div><h3>制作・検証</h3>{article.recordType === 'local_file' ? <><p>Blogファイルから検出 · DBアーティファクト未登録</p><small>本文は確認できますが、検証・公開後評価の記録はありません。</small></> : <><p>validator {article.validatorStatus} / build {article.buildStatus} / revision {article.revisionCount}</p>{article.failedChecks.length ? <small className="badText">未通過: {article.failedChecks.join(' / ')}</small> : <small>SHA {article.contentSha256.slice(0, 16)}…</small>}</>}</div>
            <div><h3>公開後評価</h3>{article.outcome ? <><p>{outcomeLabel[article.outcome.status] || article.outcome.status}{article.outcome.publishedAt ? ` · 公開記録 ${when(article.outcome.publishedAt)}` : ''}</p><small>{article.outcome.nextAction || `評価予定 ${when(article.outcome.evaluationDueAt)}`}</small>{article.outcome.metrics && Object.keys(article.outcome.metrics).length ? <code>{Object.entries(article.outcome.metrics).slice(0, 6).map(([key, value]) => `${key}: ${String(value)}`).join(' · ')}</code> : null}</> : <p>{article.recordType === 'local_file' ? 'ローカルファイルのみ（公開記録なし）' : 'まだ公開後評価はありません。'}</p>}<div className="articleDeleteAction"><div><strong>{article.verifiedAt ? '検証済みでも削除できます' : article.recordType === 'local_file' ? '未登録ファイルを削除' : '登録済みファイルを削除'}</strong><small>Blog作業フォルダの本文を削除し、監査記録を残します。</small>{article.outcome?.publishedAt && <small className="badText">公開記録あり。公開停止は別操作です。</small>}</div><button className="dangerButton" disabled={busyId === article.id} onClick={event => { event.preventDefault(); event.stopPropagation(); void deleteArticle(article); }}>{busyId === article.id ? '削除中…' : '本文ファイルを削除'}</button></div></div>
            <div className="articleContentPanel"><div className="articleContentHead"><h3>本文</h3>{contentState?.status === 'ready' && <small>{contentState.data?.contentMatches ? '保存済みSHAと一致' : '保存済みSHAと不一致'}</small>}</div>{contentState?.status === 'loading' && <p className="articleContentMuted">本文を読み込み中…</p>}{contentState?.status === 'error' && <p className="badText">本文を読み込めません: {contentState.error}</p>}{contentState?.status === 'ready' && !contentState.data?.exists && <p className="badText">保存先にファイルがありません。</p>}{contentState?.status === 'ready' && contentState.data?.exists && <pre className="articleContent">{contentState.data.content}</pre>}</div>
          </div>
        </details></td></tr>;
      })}
      {loading && <tr><td colSpan={6}><div className="tableLoading">読み込み中…</div></td></tr>}
      {!loading && data?.items.length === 0 && <tr><td colSpan={6}><div className="coreEmpty">条件に一致する記事はありません。</div></td></tr>}
    </tbody></table></div>
    <div className="pagination"><button disabled={page === 0} onClick={() => setPage(current => Math.max(0, current - 1))}>← 前へ</button><span>{page + 1} / {pages}</span><button disabled={page + 1 >= pages} onClick={() => setPage(current => current + 1)}>次へ →</button></div>
  </div>;
}
