import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { api } from './api';
import './idea-review.css';

type IdeaStatus = 'unreviewed' | 'liked' | 'rejected' | 'deferred' | 'exploring';
type Idea = {
  id: string; title: string; status: IdeaStatus; audience: string; userTask: string;
  entities?: string; informationMechanism: string; interaction?: string;
  marketCategory?: string; dataSources?: string[]; marketEvidenceRefs?: string[];
  unknowns?: string[]; maintenance?: string; reconsiderWhen?: string;
  sessionId?: string; createdAt?: string; updatedAt?: string;
  presentationHistory?: Array<{ runId: string; presentedAt: string }>;
};
type ReviewEvent = {
  id: string; ideaId?: string; scope: string; source: string;
  feedback: string; reason: string; statusAfter?: IdeaStatus; createdAt: string;
};
type IdeaPage = { items: Idea[]; nextCursor: string | null };
type EventPage = { events: ReviewEvent[]; nextCursor: string | null };
type Rating = 'good' | 'reject' | 'hold' | 'reset';
type Axis = 'appeal' | 'dbValue' | 'seo' | 'revenue' | 'upkeep';
const PAGE_SIZE = 15;
const axes: Array<{ id: Axis; label: string }> = [
  { id: 'appeal', label: '面白さ・興味' },
  { id: 'dbValue', label: 'DBの必然性' },
  { id: 'seo', label: 'SEOでの強さ' },
  { id: 'revenue', label: '収益性' },
  { id: 'upkeep', label: '維持のしやすさ' }
];
const names: Record<IdeaStatus, string> = {
  unreviewed: '未評価', liked: 'GOOD', rejected: 'ボツ', deferred: '保留', exploring: '探索中'
};
const short = (text?: string, max = 160) => {
  const s = (text ?? '').replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max) + '…' : s;
};
const dateLabel = (text?: string) => {
  if (!text || Number.isNaN(Date.parse(text))) return '—';
  return new Intl.DateTimeFormat('ja-JP', { dateStyle: 'medium' }).format(new Date(text));
};

export function IdeaReview() {
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
  const [configured, setConfigured] = useState(true);
  const [password, setPassword] = useState('');
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [events, setEvents] = useState<ReviewEvent[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [detailOpen, setDetailOpen] = useState(false);
  const [detail, setDetail] = useState<Idea | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [filter, setFilter] = useState<IdeaStatus | 'all'>('all');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [mode, setMode] = useState<'rows' | 'cards'>('rows');
  const [comment, setComment] = useState('');
  const [scores, setScores] = useState<Partial<Record<Axis, number>>>({});
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [savedId, setSavedId] = useState('');
  const dialogRef = useRef<HTMLDialogElement>(null);

  async function load(firstPage: boolean, next?: string | null) {
    setLoading(true);
    setError('');
    try {
      const path = '/api/theme-research?resource=idea-inbox&summary=1&limit=60' +
        (next ? '&cursor=' + encodeURIComponent(next) : '');
      const data = await api<IdeaPage>(path);
      setIdeas(previous => firstPage ? data.items : [
        ...previous, ...data.items.filter(item => !previous.some(old => old.id === item.id))
      ]);
      setCursor(data.nextCursor);
      if (firstPage) setPage(0);
    } catch (e) {
      setError(e instanceof Error ? e.message : '読み込みに失敗しました。');
    } finally { setLoading(false); }
  }

  useEffect(() => {
    let alive = true;
    void api<{ authenticated: boolean; configured: boolean }>('/api/theme-research?resource=idea-session')
      .then(session => {
        if (!alive) return;
        setLoggedIn(session.authenticated);
        setConfigured(session.configured);
        if (session.authenticated) void load(true);
      })
      .catch(e => {
        if (alive) { setLoggedIn(false); setError(e instanceof Error ? e.message : 'サーバーに接続できません'); }
      });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (detailOpen && !dialog.open) dialog.showModal();
    if (!detailOpen && dialog.open) dialog.close();
  }, [detailOpen]);

  useEffect(() => {
    if (!detailOpen || !selectedId) return;
    let alive = true;
    setDetail(null);
    setDetailError('');
    setDetailLoading(true);
    void api<Idea>('/api/theme-research?resource=idea-detail&id=' + encodeURIComponent(selectedId))
      .then(result => { if (alive) setDetail(result); })
      .catch(e => { if (alive) setDetailError(e instanceof Error ? e.message : '詳細の取得に失敗しました'); })
      .finally(() => { if (alive) setDetailLoading(false); });
    return () => { alive = false; };
  }, [selectedId, detailOpen]);

  useEffect(() => {
    if (!detailOpen || historyLoaded || !selectedId) return;
    let alive = true;
    void api<EventPage>('/api/theme-research?resource=idea-feedback&limit=100')
      .then(result => { if (alive) { setEvents(result.events); setHistoryLoaded(true); } })
      .catch(() => undefined); // 履歴取得の失敗で詳細や評価を使えなくしない
    return () => { alive = false; };
  }, [detailOpen, historyLoaded, selectedId]);

  const filtered = useMemo(() => ideas
    .filter(item => filter === 'all' || item.status === filter)
    .filter(item => !query.trim() || [
      item.title, item.audience, item.userTask, item.entities, item.informationMechanism,
      item.marketCategory
    ].join(' ').toLocaleLowerCase().includes(query.toLocaleLowerCase().trim()))
    .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '')), [ideas, filter, query]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const visible = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  const reviews = events.filter(e => e.ideaId === selectedId && e.scope === 'specific_idea' && e.source === 'direct_user');
  const stats = useMemo(() => Object.fromEntries(['unreviewed', 'liked', 'rejected', 'deferred', 'exploring']
    .map(status => [status, ideas.filter(item => item.status === status).length])) as Record<IdeaStatus, number>, [ideas]);

  function openDetail(id: string) {
    setSelectedId(id);
    setComment('');
    setScores({});
    setDetailOpen(true);
  }
  async function logIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true); setError('');
    try {
      await api('/api/theme-research', {
        method: 'POST', body: JSON.stringify({ action: 'login', password })
      });
      setPassword('');
      setLoggedIn(true);
      await load(true);
    } catch (e) { setError(e instanceof Error ? e.message : '認証できませんでした'); }
    finally { setSubmitting(false); }
  }
  async function logOut() {
    await api('/api/theme-research', { method: 'POST', body: JSON.stringify({ action: 'logout' }) })
      .catch(() => undefined);
    setDetailOpen(false); setLoggedIn(false); setIdeas([]); setEvents([]); setSelectedId('');
    setHistoryLoaded(false);
  }
  async function rate(ideaId: string, rating: Rating, fromDetail = false) {
    if (busyId || submitting) return;
    const target = ideas.find(item => item.id === ideaId);
    if (!target) return;
    setBusyId(ideaId); setError(''); setMessage(''); setSavedId('');
    try {
      const response = await api<{ status: IdeaStatus; event: ReviewEvent }>('/api/theme-research', {
        method: 'POST',
        body: JSON.stringify({
          action: 'review', ideaId, rating,
          comment: fromDetail ? comment : '',
          axes: fromDetail ? scores : {},
          idempotencyKey: 'ui_' + crypto.randomUUID().replaceAll('-', '')
        })
      });
      setIdeas(items => items.map(item => item.id === ideaId
        ? { ...item, status: response.status, updatedAt: response.event.createdAt } : item));
      setDetail(current => current?.id === ideaId ? { ...current, status: response.status, updatedAt: response.event.createdAt } : current);
      setEvents(old => [response.event, ...old]);
      if (fromDetail) { setComment(''); setScores({}); }
      setSavedId(ideaId);
      setMessage('「' + target.title + '」を' + names[response.status] + 'として保存しました。');
    } catch (e) { setError(e instanceof Error ? e.message : '評価を保存できませんでした'); }
    finally { setBusyId(null); }
  }

  const ratingButtons = (item: Idea, insideDetail = false) => <div className={'ideaQuickActions ' + (insideDetail ? 'ideaQuickActionsLarge' : '')}
    role="group" aria-label={item.title + 'の評価'}>
    <button type="button" className="good" aria-pressed={item.status === 'liked'} title="GOODとして保存"
      disabled={!!busyId} onClick={() => void rate(item.id, 'good', insideDetail)}>GOOD</button>
    <button type="button" className="reject" aria-pressed={item.status === 'rejected'} title="ボツとして保存"
      disabled={!!busyId} onClick={() => void rate(item.id, 'reject', insideDetail)}>ボツ</button>
    <button type="button" className="hold" aria-pressed={item.status === 'deferred'} title="保留として保存"
      disabled={!!busyId} onClick={() => void rate(item.id, 'hold', insideDetail)}>保留</button>
    {busyId === item.id && <span className="ideaSaving" role="status">保存中…</span>}
  </div>;

  if (loggedIn === null) return <section className="corePage"><h1>アイデアを評価</h1><p>認証状態を確認しています。</p></section>;
  if (!loggedIn) return <section className="corePage ideaReviewPage">
    <div className="coreTitleRow"><div><p className="coreEyebrow">IDEA MEMORY</p><h1>アイデアを評価</h1><p>定期探索で蓄積した案に評価を付け、その結果を次の探索に使います。</p></div></div>
    <form className="ideaLogin" onSubmit={event => void logIn(event)}>
      <h2>管理者としてログイン</h2>
      <p>評価履歴は非公開データです。ブラウザには認証キーを保存せず、HttpOnly Cookieでセッションを維持します。</p>
      <label htmlFor="ideaReviewKey">管理者用アクセスキー</label>
      <input id="ideaReviewKey" type="password" autoComplete="current-password" required
        value={password} onChange={event => setPassword(event.target.value)} />
      <button type="submit" disabled={!configured || submitting}>{submitting ? '認証中…' : 'ログイン'}</button>
      {!configured && <p role="alert">サーバーに IDEA_REVIEW_ADMIN_TOKEN または既存の KEYWORDS_REMOTE_MCP_TOKEN が設定されていません。</p>}
      {error && <p role="alert">{error}</p>}
    </form>
  </section>;

  return <section className="corePage ideaReviewPage">
    <div className="coreTitleRow ideaReviewHeader">
      <div><p className="coreEyebrow">IDEA MEMORY / REVIEW DESK</p><h1>アイデアを仕分ける</h1>
        <p>一覧から直接GOOD・ボツ・保留。詳細では理由と5項目の評価も残せます。</p>
      </div>
      <div className="ideaReviewTools"><button type="button" onClick={() => void load(true)} disabled={loading}>再読込</button>
        <button type="button" onClick={() => void logOut()}>ログアウト</button></div>
    </div>
    <div className="ideaStats" aria-label="読み込み済みアイデアの評価状況">
      <button type="button" aria-pressed={filter === 'all'} onClick={() => {setFilter('all');setPage(0);}}>
        <strong>{ideas.length}</strong><span>読込済みの全件</span></button>
      {(['unreviewed', 'liked', 'rejected', 'deferred', 'exploring'] as const).map(status =>
        <button type="button" key={status} aria-pressed={filter === status}
          onClick={() => {setFilter(status);setPage(0);}}>
          <strong>{stats[status]}</strong><span>{names[status]}</span>
        </button>)}
    </div>
    <div className="ideaReviewFilters">
      <label className="ideaSearchLabel" htmlFor="ideaSearch">検索
        <input id="ideaSearch" type="search" placeholder="テーマ・対象・DBの仕組み" value={query}
          onChange={e => {setQuery(e.target.value);setPage(0);}} />
      </label>
      <div className="ideaViewToggle" role="group" aria-label="一覧の表示形式">
        <button type="button" aria-pressed={mode === 'rows'} onClick={() => setMode('rows')}>一覧</button>
        <button type="button" aria-pressed={mode === 'cards'} onClick={() => setMode('cards')}>カード</button>
      </div>
      <span className="ideaResultCount">{filtered.length}件 / 読込済み{ideas.length}件</span>
    </div>
    {error && <p className="ideaReviewError" role="alert">{error}</p>}
    {message && <p className="ideaReviewSuccess" role="status">{message}</p>}
    <div className={'ideaInbox ideaInbox-' + mode} aria-label="アイデア一覧">
      {mode === 'rows' && <div className="ideaInboxHead" aria-hidden="true"><span>評価 / テーマ</span><span>誰の・何のため</span><span>DBにする理由</span><span>その場で評価</span></div>}
      <div className="ideaInboxItems">
        {visible.map(item => <article key={item.id} className={'ideaInboxItem ' + (savedId === item.id ? 'justSaved' : '')}>
          <div className="ideaInboxIdentity">
            <span className={'ideaStatus ' + item.status}>{names[item.status]}</span>
            <button type="button" className="ideaOpenDetail" onClick={() => openDetail(item.id)} aria-label={item.title + 'の詳細・理由を開く'}>
              <strong>{item.title}</strong><span aria-hidden="true">↗</span>
            </button>
            <small>{dateLabel(item.updatedAt)}</small>
          </div>
          <div className="ideaInboxContext"><span className="ideaCellHint">誰の・何のため</span>
            <p>{short(item.userTask, mode === 'cards' ? 110 : 90)}</p>
            {item.audience && <small>{short(item.audience, 65)}</small>}
          </div>
          <div className="ideaInboxMechanism"><span className="ideaCellHint">DBにする理由</span><p>{short(item.informationMechanism, mode === 'cards' ? 125 : 105)}</p></div>
          {ratingButtons(item)}
        </article>)}
        {visible.length === 0 && !loading && <p className="ideaReviewEmpty">条件に一致するアイデアはありません。検索・評価状態を変えてください。</p>}
        {loading && ideas.length === 0 && <p className="ideaReviewEmpty" role="status">アイデアを読み込み中…</p>}
      </div>
    </div>
    <div className="ideaPager">
      <div className="ideaPagerControls">
        <button type="button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>← 前へ</button>
        <span aria-live="polite">{currentPage + 1} / {pageCount} ページ</span>
        <button type="button" disabled={currentPage + 1 >= pageCount} onClick={() => setPage(currentPage + 1)}>次へ →</button>
      </div>
      {cursor && <button type="button" className="ideaLoadMore" disabled={loading}
        onClick={() => void load(false, cursor)}>{loading ? '読み込み中…' : 'さらに60件を読み込む'}</button>}
      <small>1ページ{PAGE_SIZE}件。件数は現在読み込んだ範囲です。</small>
    </div>
    <dialog className="ideaDetailDialog" ref={dialogRef} onClose={() => setDetailOpen(false)}
      onClick={event => {if (event.target === dialogRef.current) setDetailOpen(false);}}>
      <div className="ideaDetailDialogInner">
        <div className="ideaDetailTop"><span>IDEA / DETAIL & FEEDBACK</span>
          <button type="button" className="ideaDetailClose" onClick={() => setDetailOpen(false)} aria-label="詳細を閉じる">閉じる ×</button>
        </div>
        {detailLoading && <p role="status">詳細を読み込んでいます…</p>}
        {detailError && <p className="ideaReviewError" role="alert">{detailError}</p>}
        {detail && <article className="ideaDetail">
          <div className="ideaDetailHeader">
            <span className={'ideaStatus ' + detail.status}>{names[detail.status]}</span><span>{dateLabel(detail.createdAt)}</span>
          </div>
          <h2 id="ideaDetailTitle">{detail.title}</h2>
          <p className="ideaLead">{detail.userTask}</p>
          <dl className="ideaFacts">
            <div><dt>対象となる人</dt><dd>{detail.audience}</dd></div>
            <div><dt>蓄積するデータ</dt><dd>{detail.entities}</dd></div>
            <div><dt>なぜDBにするか</dt><dd>{detail.informationMechanism}</dd></div>
            <div><dt>使い方</dt><dd>{detail.interaction}</dd></div>
            {detail.maintenance && <div><dt>更新・運用</dt><dd>{detail.maintenance}</dd></div>}
          </dl>
          {Boolean(detail.marketEvidenceRefs?.length) && <details className="ideaEvidence"><summary>市場の証拠・調査メモ</summary>
            <ul>{detail.marketEvidenceRefs?.map((fact, i) => <li key={i}>{fact}</li>)}</ul></details>}
          {Boolean(detail.unknowns?.length) && <details className="ideaEvidence"><summary>未解決の疑問・弱点</summary>
            <ul>{detail.unknowns?.map((fact, i) => <li key={i}>{fact}</li>)}</ul></details>}
          {Boolean(detail.dataSources?.length) && <details className="ideaEvidence"><summary>データの出典</summary>
            <ul>{detail.dataSources?.filter(source => /^https:\/\//.test(source)).map((link, i) =>
              <li key={i}><a href={link} target="_blank" rel="noopener noreferrer">{link}</a></li>)}</ul></details>}
          <section className="ideaRateSection" aria-label="アイデアの詳細評価">
            <h3>理由も残して評価</h3>
            <p>一覧でのワンクリック評価に加え、強み・弱点を次回の探索へ伝えられます。</p>
            <div className="ideaScores">
              {axes.map(axis => <label key={axis.id}>{axis.label}
                <select value={scores[axis.id] || ''} onChange={event => setScores(old => ({
                  ...old, [axis.id]: Number(event.target.value) || undefined
                }))}><option value="">採点しない</option>{[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n} / 5</option>)}</select>
              </label>)}
            </div>
            <label className="ideaComment" htmlFor="ideaReviewComment">評価した理由・改善条件（任意）</label>
            <textarea id="ideaReviewComment" maxLength={1000} rows={3} placeholder="気に入った点、ボツにした理由、改善条件など"
              value={comment} onChange={e => setComment(e.target.value)} />
            {ratingButtons(detail, true)}
            <button type="button" className="ideaReset" disabled={!!busyId} onClick={() => void rate(detail.id, 'reset', true)}>未評価に戻す</button>
          </section>
          {reviews.length > 0 && <div className="ideaHistory"><h3>最近の評価履歴</h3>
            {reviews.slice(0, 8).map(review => <p key={review.id}><small>{dateLabel(review.createdAt)} — {names[review.statusAfter ?? 'unreviewed']}</small>{review.feedback}</p>)}
          </div>}
        </article>}
      </div>
    </dialog>
    <p className="ideaReviewDisclaimer">評価はIdea Memory正本へ保存。画面上の未評価は、探索側でGOODやボツと推定しません。</p>
  </section>;
}
