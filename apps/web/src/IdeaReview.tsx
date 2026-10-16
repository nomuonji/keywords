import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { api } from './api';
import './idea-review.css';

type IdeaStatus = 'unreviewed' | 'liked' | 'rejected' | 'deferred' | 'exploring';
type AssetRef = {id:string; destination:string; kind:string; title:string;
  owner:string; stage:'proposed'|'draft'|'handed_off'; targetRef?:string; contentRef?:string};
const outlets = [
  {id:'new_site_db',label:'新規サイト・DB'},
  {id:'existing_site_growth',label:'既存サイト改善'},
  {id:'product_affiliate',label:'商品・アフィリエイト'},
  {id:'traffic_distribution',label:'集客・販路'},
  {id:'product_business',label:'新規プロダクト・事業'},
  {id:'social_content',label:'SNSコンテンツ'},
  {id:'youtube_video',label:'YouTube・動画'}
];
const outletName = (id:string) => outlets.find(v=>v.id===id)?.label ?? id;
type Idea = {
  id: string; title: string; status: IdeaStatus; audience: string; userTask: string;
  entities?: string; informationMechanism: string; interaction?: string;
  marketCategory?: string; dataSources?: string[]; marketEvidenceRefs?: string[];
  unknowns?: string[]; maintenance?: string; reconsiderWhen?: string;
  sessionId?: string; createdAt?: string; updatedAt?: string;
  tags?: string[]; destinations?: string[]; assetRefs?: AssetRef[]; assetCount?:number; revision?:number;
  destinationVerdicts?: Record<string,IdeaStatus>;
  presentationHistory?: Array<{ runId: string; presentedAt: string }>;
};
type ReviewEvent = {
  id: string; ideaId?: string; scope: string; source: string; destination?:string;
  feedback: string; reason: string; statusAfter?: IdeaStatus; createdAt: string;
};
type IdeaPage = { items: Idea[]; nextCursor: string | null };
type EventPage = { events: ReviewEvent[]; nextCursor: string | null };
type Rating = 'good' | 'reject' | 'hold' | 'reset';
type Axis = 'appeal' | 'dbValue' | 'seo' | 'revenue' | 'upkeep';
const PAGE_SIZE = 9;
const axes: Array<{ id: Axis; label: string }> = [
  { id: 'appeal', label: '面白さ・興味' },
  { id: 'dbValue', label: '形式・用途との相性' },
  { id: 'seo', label: '見つけられやすさ・集客' },
  { id: 'revenue', label: '収益性' },
  { id: 'upkeep', label: '制作・維持のしやすさ' }
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
  const [outletFilter, setOutletFilter] = useState('all');
  const [reviewTarget,setReviewTarget]=useState('overall');
  const isOutlet=(value:string)=>outlets.some(outlet=>outlet.id===value);
  const targetFor=(item:Idea,detailView=false)=>{
    const choice=detailView ? reviewTarget : outletFilter;
    return isOutlet(choice) && (item.destinations??[]).includes(choice) ? choice : 'overall';
  };
  const verdictFor=(item:Idea,detailView=false)=>{
    const target=targetFor(item,detailView);
    return target==='overall' ? item.status : item.destinationVerdicts?.[target] ?? 'unreviewed';
  };
  const [tagInput, setTagInput] = useState('');
  const [destInput, setDestInput] = useState<string[]>([]);
  const [assetTitle, setAssetTitle] = useState('');
  const [assetKind, setAssetKind] = useState('social_post');
  const [assetDestination, setAssetDestination] = useState('social_content');
  const [assetTarget, setAssetTarget] = useState('');
  const [organizing, setOrganizing] = useState(false);
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
      .then(result => { if (alive) {
        setDetail(result);
        setTagInput((result.tags ?? []).join('、'));
        setDestInput(result.destinations ?? []);
        setAssetTitle(''); setAssetTarget('');
      } })
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
    .filter(item => filter === 'all' || verdictFor(item) === filter)
    .filter(item => outletFilter === 'all' || (outletFilter === 'unassigned'
      ? !(item.destinations?.length) : (item.destinations ?? []).includes(outletFilter)))
    .filter(item => !query.trim() || [
      item.title, item.audience, item.userTask, item.entities, item.informationMechanism,
      item.marketCategory, ...(item.tags ?? []), ...(item.destinations ?? [])
    ].join(' ').toLocaleLowerCase().includes(query.toLocaleLowerCase().trim()))
    .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '')), [ideas, filter, outletFilter, query]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const visible = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  const reviews = events.filter(e => e.ideaId === selectedId && e.scope === 'specific_idea' && e.source === 'direct_user');
  const stats = useMemo(() => {
    const withinOutlet = ideas.filter(item => outletFilter==='all' ||
      (outletFilter==='unassigned' ? !(item.destinations?.length) :
        (item.destinations??[]).includes(outletFilter)));
    return Object.fromEntries(
      (['unreviewed','liked','rejected','deferred','exploring'] as IdeaStatus[])
        .map(state => [state, withinOutlet.filter(item=>verdictFor(item)===state).length])
    ) as Record<IdeaStatus,number>;
  }, [ideas,outletFilter]);

  function openDetail(id: string) {
    setSelectedId(id);
    setComment('');
    setScores({});
    const idea=ideas.find(item=>item.id===id);
    setReviewTarget(idea && isOutlet(outletFilter) && (idea.destinations??[]).includes(outletFilter) ? outletFilter : 'overall');
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
    const selectedTarget=targetFor(target,fromDetail);
    const destination=selectedTarget==='overall' ? undefined : selectedTarget;
    setBusyId(ideaId); setError(''); setMessage(''); setSavedId('');
    try {
      const response = await api<{ status: IdeaStatus; event: ReviewEvent }>('/api/theme-research', {
        method: 'POST',
        body: JSON.stringify({
          action: 'review', ideaId, rating,
          ...(destination ? {destination} : {}),
          comment: fromDetail ? comment : '',
          axes: fromDetail ? scores : {},
          idempotencyKey: 'ui_' + crypto.randomUUID().replaceAll('-', '')
        })
      });
      setIdeas(items => items.map(item => item.id === ideaId
        ? { ...item,
            ...(destination ? {destinationVerdicts:{...(item.destinationVerdicts??{}),[destination]:response.status}} :
              {status:response.status}),
            updatedAt: response.event.createdAt,
            revision: item.revision ? item.revision + 1 : undefined } : item));
      setDetail(current => current?.id === ideaId ? { ...current,
            ...(destination ? {destinationVerdicts:{...(current.destinationVerdicts??{}),[destination]:response.status}} :
              {status:response.status}),
            updatedAt: response.event.createdAt,
            revision: current.revision ? current.revision + 1 : undefined } : current);
      setEvents(old => [response.event, ...old]);
      if (fromDetail) { setComment(''); setScores({}); }
      setSavedId(ideaId);
      setMessage('「' + target.title + '」の' + (destination ? outletName(destination) : 'アイデア全体') +
        'を' + names[response.status] + 'として保存しました。');
    } catch (e) { setError(e instanceof Error ? e.message : '評価を保存できませんでした'); }
    finally { setBusyId(null); }
  }

  async function organize(asset?: AssetRef) {
    if (!detail || organizing || busyId) return;
    const tags = [...new Set(tagInput.split(/[,、，\r\n]+/).map(v => v.trim()).filter(Boolean))];
    if (tags.length > 20 || tags.some(v => v.length > 60)) {
      setError('タグは20個まで、各60文字以内にしてください。'); return;
    }
    const nextDestinations = [...new Set([...destInput, ...(asset ? [asset.destination] : [])])];
    const nextAssets = asset ? [...(detail.assetRefs ?? []),asset] : (detail.assetRefs ?? []);
    setOrganizing(true); setError(''); setMessage('');
    try {
      const response = await api<{idea:Idea;outcome:string}>('/api/theme-research', {
        method:'POST',body:JSON.stringify({
          action:'organize', ideaId:detail.id, expectedRevision:detail.revision,
          tags, destinations:nextDestinations, assetRefs:nextAssets
        })
      });
      setDetail(response.idea); setDestInput(response.idea.destinations ?? []);
      setIdeas(rows => rows.map(row => row.id === detail.id ? {
        ...row, tags:response.idea.tags, destinations:response.idea.destinations,
        assetCount:response.idea.assetCount, revision:response.idea.revision,
        updatedAt:response.idea.updatedAt
      } : row));
      if (asset) {setAssetTitle('');setAssetTarget('');}
      setMessage(response.outcome === 'unchanged' ? '変更はありません。' : 'タグ・展開先・制作物を保存しました。');
    } catch (e) {setError(e instanceof Error ? e.message : '保存に失敗しました。再読込してください。');}
    finally {setOrganizing(false);}
  }

  function attachAsset() {
    const title = assetTitle.trim();
    if (!title || title.length > 200 || !detail) return;
    const targetRef=assetTarget.trim();
    if (targetRef && (!/^https:\/\//.test(targetRef) || targetRef.length>1000)) {
      setError('制作物の参照先はHTTPSのURLにしてください。'); return;
    }
    if ((detail.assetRefs?.length ?? 0) >= 40) {setError('派生成果物の参照は40件までです。');return;}
    void organize({id:'asset-'+crypto.randomUUID().replaceAll('-',''),
      destination:assetDestination,kind:assetKind,title,owner:'Idea Memory',
      stage:'proposed',...(targetRef ? {targetRef} : {})});
  }

  const ratingButtons = (item: Idea, insideDetail = false) => <div className={'ideaQuickActions ' + (insideDetail ? 'ideaQuickActionsLarge' : '')}
    role="group" aria-label={item.title + 'の' + (targetFor(item,insideDetail)==='overall'
      ? 'アイデア全体' : outletName(targetFor(item,insideDetail))) + 'の評価'}>
    <button type="button" className="good" aria-pressed={verdictFor(item,insideDetail) === 'liked'} title="GOODとして保存"
      disabled={!!busyId} onClick={() => void rate(item.id, 'good', insideDetail)}>GOOD</button>
    <button type="button" className="reject" aria-pressed={verdictFor(item,insideDetail) === 'rejected'} title="ボツとして保存"
      disabled={!!busyId} onClick={() => void rate(item.id, 'reject', insideDetail)}>ボツ</button>
    <button type="button" className="hold" aria-pressed={verdictFor(item,insideDetail) === 'deferred'} title="保留として保存"
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
        <p>1つのIdea DBから7つの用途に展開。全体・出口別にGOOD・ボツ・保留を独立して保存できます。</p>
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
    <nav className="ideaOutletTabs" aria-label="アイデアの展開先">
      {[{id:'all',label:'すべて'},{id:'unassigned',label:'未振り分け'},...outlets].map(outlet =>
        <button key={outlet.id} type="button" aria-pressed={outletFilter === outlet.id}
          onClick={() => {setOutletFilter(outlet.id);setFilter('all');setPage(0);}}>
          {outlet.label}
          <small>{outlet.id === 'all' ? ideas.length : ideas.filter(item =>
            outlet.id === 'unassigned' ? !(item.destinations?.length) :
            (item.destinations ?? []).includes(outlet.id)).length}</small>
        </button>)}
    </nav>
    <div className="ideaReviewScope" role="status">
      <div><strong>現在の評価対象：{isOutlet(outletFilter) ? outletName(outletFilter) : 'アイデア全体'}</strong>
      <small>{isOutlet(outletFilter)
        ? 'この用途に対する評価だけを保存。ほかの用途・全体の評価は変わりません。'
        : outletFilter==='unassigned' ? '未振り分けの案にはまず出口を割り当てられます。'
        : '用途ごとの評価をするには上の出口を選択してください。'}</small></div>
    </div>
    <div className="ideaReviewFilters">
      <label className="ideaSearchLabel" htmlFor="ideaSearch">検索
        <input id="ideaSearch" type="search" placeholder="タイトル・対象・テーマタグ・出口" value={query}
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
      {mode === 'rows' && <div className="ideaInboxHead" aria-hidden="true"><span>アイデアと判定</span><span>用途（複数可）・タグ</span><span>提案の切り口</span><span>表示中の対象を評価</span></div>}
      <div className="ideaInboxItems">
        {visible.map(item => <article key={item.id} className={'ideaInboxItem ' + (savedId === item.id ? 'justSaved' : '')}>
          <div className="ideaInboxIdentity">
            <span className={'ideaStatus ' + verdictFor(item)}>{names[verdictFor(item)]}</span>
            <button type="button" className="ideaOpenDetail" onClick={() => openDetail(item.id)} aria-label={item.title + 'の詳細・理由を開く'}>
              <strong>{item.title}</strong><span aria-hidden="true">↗</span>
            </button>
            <small>{dateLabel(item.updatedAt)}{item.assetCount ? ` · 制作物${item.assetCount}件` : ''}</small>
          </div>
          <div className="ideaInboxRoutes">
            <span className="ideaCellHint">利用先・制作媒体</span>
            <div className="ideaRouteBadges">
              {item.destinations?.length ? item.destinations.map(dest =>
                <button type="button" key={dest} className={outletFilter===dest?'selected':''}
                  title={outletName(dest)+'について評価する'}
                  onClick={()=>{setOutletFilter(dest);setFilter('all');setPage(0);}}>
                  {outletName(dest)}
                  {item.destinationVerdicts?.[dest] && item.destinationVerdicts[dest]!=='unreviewed' &&
                    <em>{names[item.destinationVerdicts[dest]]}</em>}
                </button>) : <span className="ideaUnassigned">展開先なし</span>}
            </div>
            {item.tags?.length ? <div className="ideaSubjectTags">{item.tags.map(tag =>
              <span key={tag}>#{tag}</span>)}</div> : null}
          </div>
          <div className="ideaInboxMechanism"><span className="ideaCellHint">提案の仕組み・切り口</span>
            <p>{short(item.informationMechanism,mode==='cards'?100:72)}</p>
            <small>{short(item.userTask,66)}</small>
          </div>
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
            <div><dt>企画の仕組み・切り口</dt><dd>{detail.informationMechanism}</dd></div>
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
          <section className="ideaOrganizeSection" aria-label="タグ・展開先・派生成果物">
            <h3>タグと展開先</h3>
            <p>1つのアイデアから複数の制作企画へ展開できます。公開や投稿はここでは行いません。</p>
            <label className="ideaOrganizeLabel" htmlFor="ideaTags">タグ（読点・カンマ区切り）
              <input id="ideaTags" maxLength={1300} value={tagInput} onChange={e=>setTagInput(e.target.value)}
                placeholder="消費行動、ネット文化、男性心理"/>
            </label>
            <div className="ideaDestinationChecks">{outlets.map(item=><label key={item.id}>
              <input type="checkbox" checked={destInput.includes(item.id)}
                onChange={e=>setDestInput(old=>e.target.checked?[...old,item.id]:old.filter(v=>v!==item.id))}/>
              {item.label}
            </label>)}</div>
            <button type="button" className="ideaOrganizeSave" disabled={organizing||!!busyId||!detail.revision}
              onClick={()=>void organize()}>{organizing?'保存中…':'タグ・展開先を保存'}</button>
            <h3>派生成果物</h3>
            <p>制作物の参照を保存します。原稿や投稿の正本はそれぞれの制作システムに残します。</p>
            {(detail.assetRefs ?? []).length>0 ? <ul className="ideaAssetList">{detail.assetRefs?.map(a=><li key={a.id}>
              <strong>{a.title}</strong><span>{outletName(a.destination)} · {a.kind} · {a.stage}</span>
              {a.targetRef&&/^https:\/\//.test(a.targetRef)&&
                <a href={a.targetRef} target="_blank" rel="noopener noreferrer">制作物を開く ↗</a>}
            </li>)}</ul> : <p className="ideaEmptyAssets">まだ派生成果物はありません。</p>}
            <div className="ideaAssetForm">
              <input aria-label="制作物タイトル" placeholder="制作物のタイトル・企画名" maxLength={200}
                value={assetTitle} onChange={e=>setAssetTitle(e.target.value)}/>
              <select aria-label="展開先" value={assetDestination} onChange={e=>setAssetDestination(e.target.value)}>
                {outlets.map(item=><option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
              <select aria-label="制作物の種類" value={assetKind} onChange={e=>setAssetKind(e.target.value)}>
                {[['social_post','SNS投稿'],['social_series','SNS連載'],['youtube_script','YouTube台本'],
                  ['youtube_shorts','Shorts構成'],['site_plan','サイト企画'],['article','記事案'],
                  ['product_pitch','商品訴求'],['distribution_plan','集客施策'],
                  ['app_spec','プロダクト企画'],['other','その他']].map(([key,label])=>
                    <option key={key} value={key}>{label}</option>)}
              </select>
              <input aria-label="制作物URL" placeholder="制作物のURL（任意・https://）" maxLength={1000}
                value={assetTarget} onChange={e=>setAssetTarget(e.target.value)}/>
              <button type="button" disabled={!assetTitle.trim()||organizing||!!busyId||!detail.revision}
                onClick={attachAsset}>派生成果物を追加</button>
            </div>
          </section>
          <section className="ideaRateSection" aria-label="アイデアの詳細評価">
            <h3>評価する対象を選択</h3>
            <p>「全体」と各出口の評価は独立しています。例えばDBサイトはボツ、YouTube動画はGOODと記録できます。</p>
            <div className="ideaReviewTargetChoices" role="group" aria-label="評価する対象">
              {[{id:'overall',label:'アイデア全体'},...(detail.destinations??[]).map(dest=>({id:dest,label:outletName(dest)}))].map(target=>
                <button type="button" key={target.id} aria-pressed={reviewTarget===target.id}
                  onClick={()=>setReviewTarget(target.id)}>
                  <span>{target.label}</span>
                  <small>{names[target.id==='overall' ? detail.status :
                    detail.destinationVerdicts?.[target.id]??'unreviewed']}</small>
                </button>)}
            </div>
            <div className="ideaReviewActiveTarget">
              評価対象：<strong>{reviewTarget==='overall'?'アイデア全体':outletName(reviewTarget)}</strong>
            </div>
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
            {reviews.slice(0, 8).map(review => <p key={review.id}>
              <small>{dateLabel(review.createdAt)} — {review.destination ? outletName(review.destination) : 'アイデア全体'} ／ {names[review.statusAfter ?? 'unreviewed']}</small>
              {review.feedback}
            </p>)}
          </div>}
        </article>}
      </div>
    </dialog>
    <p className="ideaReviewDisclaimer">評価はIdea Memory正本へ保存。画面上の未評価は、探索側でGOODやボツと推定しません。</p>
  </section>;
}
