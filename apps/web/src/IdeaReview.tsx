import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { api } from './api';
import './idea-review.css';

type IdeaStatus = 'unreviewed' | 'liked' | 'rejected' | 'deferred' | 'exploring';
type Idea = {
  id: string; title: string; status: IdeaStatus; audience: string; userTask: string;
  entities: string; informationMechanism: string; interaction: string;
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
const dateLabel = (text?: string) => text
  ? new Intl.DateTimeFormat('ja-JP', { dateStyle: 'medium' }).format(new Date(text))
  : '—';

export function IdeaReview() {
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
  const [configured, setConfigured] = useState(true);
  const [password, setPassword] = useState('');
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [events, setEvents] = useState<ReviewEvent[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [filter, setFilter] = useState<IdeaStatus | 'all'>('all');
  const [query, setQuery] = useState('');
  const [comment, setComment] = useState('');
  const [scores, setScores] = useState<Partial<Record<Axis, number>>>({});
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  async function load(firstPage: boolean, next?: string | null) {
    setLoading(true);
    setError('');
    try {
      const path = '/api/theme-research?resource=idea-inbox&limit=100' + (next ? '&cursor=' + encodeURIComponent(next) : '');
      const data = await api<IdeaPage>(path);
      setIdeas(previous => firstPage ? data.items : [
        ...previous, ...data.items.filter(item => !previous.some(old => old.id === item.id))
      ]);
      setCursor(data.nextCursor);
      if (firstPage) setSelectedId(data.items[0]?.id ?? '');
      if (firstPage) {
        const feedback = await api<EventPage>('/api/theme-research?resource=idea-feedback&limit=100');
        setEvents(feedback.events);
      }
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

  const filtered = useMemo(() => ideas
    .filter(item => filter === 'all' || item.status === filter)
    .filter(item => !query.trim() || [
      item.title, item.audience, item.userTask, item.entities, item.informationMechanism,
      item.interaction, item.marketCategory, ...(item.marketEvidenceRefs ?? [])
    ].join(' ').toLowerCase().includes(query.toLowerCase().trim()))
    .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '')), [ideas, filter, query]);
  const selected = ideas.find(item => item.id === selectedId);
  const reviews = events.filter(e => e.ideaId === selectedId && e.scope === 'specific_idea' && e.source === 'direct_user');
  const stats = useMemo(() => Object.fromEntries(['unreviewed', 'liked', 'rejected', 'deferred', 'exploring']
    .map(status => [status, ideas.filter(item => item.status === status).length])) as Record<IdeaStatus, number>, [ideas]);

  function select(id: string) {
    setSelectedId(id);
    setComment('');
    setScores({});
    setError('');
    setMessage('');
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
    setLoggedIn(false); setIdeas([]); setEvents([]); setSelectedId('');
  }
  async function rate(rating: Rating) {
    if (!selected || submitting) return;
    setSubmitting(true); setError(''); setMessage('');
    try {
      const response = await api<{ status: IdeaStatus; event: ReviewEvent }>('/api/theme-research', {
        method: 'POST',
        body: JSON.stringify({
          action: 'review', ideaId: selected.id, rating,
          comment, axes: scores,
          idempotencyKey: 'ui_' + crypto.randomUUID().replaceAll('-', '')
        })
      });
      setIdeas(items => items.map(item => item.id === selected.id
        ? { ...item, status: response.status, updatedAt: response.event.createdAt } : item));
      setEvents(old => [response.event, ...old]);
      setComment(''); setScores({});
      setMessage('評価を保存しました。次回の探索ではこの評価履歴も参照します。');
    } catch (e) { setError(e instanceof Error ? e.message : '評価を保存できませんでした'); }
    finally { setSubmitting(false); }
  }

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
    <div className="coreTitleRow"><div><p className="coreEyebrow">IDEA MEMORY / FEEDBACK LOOP</p><h1>アイデアを評価</h1>
      <p>GOOD・ボツ・保留を付けるとFirestoreに記録されます。定期探索は評価と理由を次回の候補選別に利用します。</p>
    </div><div className="ideaReviewTools"><button type="button" onClick={() => void load(true)} disabled={loading}>更新</button><button type="button" onClick={() => void logOut()}>ログアウト</button></div></div>
    <div className="ideaStats">
      <div><strong>{ideas.length}</strong><span>読込済み</span></div>
      <div><strong>{stats.unreviewed}</strong><span>未評価</span></div>
      <div><strong>{stats.liked}</strong><span>GOOD</span></div>
      <div><strong>{stats.rejected}</strong><span>ボツ</span></div>
      <div><strong>{stats.deferred}</strong><span>保留</span></div>
    </div>
    <div className="ideaReviewFilters">
      <label htmlFor="ideaSearch">キーワードで探す</label>
      <input id="ideaSearch" placeholder="テーマ、対象、市場から検索" value={query} onChange={e => setQuery(e.target.value)} />
      <div className="ideaFilterButtons" aria-label="評価状態で絞り込み">
        {(['all', 'unreviewed', 'liked', 'rejected', 'deferred', 'exploring'] as const).map(s =>
          <button type="button" key={s} aria-pressed={filter === s} className={filter === s ? 'selected' : ''}
            onClick={() => setFilter(s)}>{s === 'all' ? 'すべて' : names[s]}</button>
        )}
      </div>
    </div>
    {error && <p className="ideaReviewError" role="alert">{error}</p>}
    {message && <p className="ideaReviewSuccess" role="status">{message}</p>}
    <div className="ideaReviewLayout">
      <div className="ideaList" aria-label="蓄積済みのアイデア">
        {filtered.map(item => <button type="button" key={item.id} className={'ideaListItem ' + (selectedId === item.id ? 'active' : '')}
          onClick={() => select(item.id)} aria-pressed={selectedId === item.id}>
          <span className={'ideaStatus ' + item.status}>{names[item.status]}</span>
          <strong>{item.title}</strong>
          <small>{short(item.userTask, 95)}</small>
          <span className="ideaListFoot">{dateLabel(item.updatedAt)}　·　{item.id}</span>
        </button>)}
        {filtered.length === 0 && !loading && <p className="ideaReviewEmpty">一致するアイデアはありません。</p>}
        {cursor && <button type="button" className="ideaLoadMore" disabled={loading}
          onClick={() => void load(false, cursor)}>{loading ? '読み込み中…' : 'さらに過去のアイデアを読み込む'}</button>}
        {loading && <p>読み込み中…</p>}
      </div>
      {selected ? <article className="ideaDetail">
        <div className="ideaDetailHeader">
          <span className={'ideaStatus ' + selected.status}>{names[selected.status]}</span>
          <span>{dateLabel(selected.createdAt)}</span>
        </div>
        <h2>{selected.title}</h2>
        <p className="ideaLead">{selected.userTask}</p>
        <dl className="ideaFacts">
          <div><dt>対象となる人</dt><dd>{selected.audience}</dd></div>
          <div><dt>蓄積するデータ</dt><dd>{selected.entities}</dd></div>
          <div><dt>なぜDBにするか</dt><dd>{selected.informationMechanism}</dd></div>
          <div><dt>使い方</dt><dd>{selected.interaction}</dd></div>
          {selected.maintenance && <div><dt>更新・運用</dt><dd>{selected.maintenance}</dd></div>}
        </dl>
        {Boolean(selected.marketEvidenceRefs?.length) && <details className="ideaEvidence"><summary>市場の証拠・調査メモ</summary>
          <ul>{selected.marketEvidenceRefs?.map((fact, i) => <li key={i}>{fact}</li>)}</ul></details>}
        {Boolean(selected.unknowns?.length) && <details className="ideaEvidence"><summary>未解決の疑問・弱点</summary>
          <ul>{selected.unknowns?.map((fact, i) => <li key={i}>{fact}</li>)}</ul></details>}
        {Boolean(selected.dataSources?.length) && <details className="ideaEvidence"><summary>データの出典</summary>
          <ul>{selected.dataSources?.filter(source => /^https:\/\//.test(source)).map((link, i) =>
            <li key={i}><a href={link} target="_blank" rel="noopener noreferrer">{link}</a></li>)}</ul></details>}
        <section className="ideaRateSection" aria-label="アイデアの評価">
          <h3>この案を評価</h3><p>評価と理由を保存すると、次の定期探索で実際の発想・重複防止に利用します。</p>
          <div className="ideaScores">
            {axes.map(axis => <label key={axis.id}>{axis.label}
              <select value={scores[axis.id] || ''} onChange={event => setScores(old => ({
                ...old, [axis.id]: Number(event.target.value) || undefined
              }))}><option value="">採点しない</option>{[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n} / 5</option>)}</select>
            </label>)}
          </div>
          <label className="ideaComment" htmlFor="ideaReviewComment">評価した理由・改善条件（任意）</label>
          <textarea id="ideaReviewComment" maxLength={1000} rows={3} placeholder="刺さらない理由、気に入った点、次回からの条件など"
            value={comment} onChange={e => setComment(e.target.value)} />
          <div className="ideaRatingButtons">
            <button type="button" className="good" onClick={() => void rate('good')} disabled={submitting}>GOOD</button>
            <button type="button" className="reject" onClick={() => void rate('reject')} disabled={submitting}>ボツ</button>
            <button type="button" className="hold" onClick={() => void rate('hold')} disabled={submitting}>保留</button>
            <button type="button" className="reset" onClick={() => void rate('reset')} disabled={submitting}>未評価に戻す</button>
          </div>
        </section>
        {reviews.length > 0 && <div className="ideaHistory"><h3>過去の評価</h3>
          {reviews.slice(0, 8).map(review => <p key={review.id}><small>{dateLabel(review.createdAt)} — {names[review.statusAfter ?? 'unreviewed']}</small>{review.feedback}</p>)}
        </div>}
      </article> : <div className="ideaDetail ideaReviewEmpty">左側から評価したい案を選んでください。</div>}
    </div>
    <p className="ideaReviewDisclaimer">評価は Idea Memory 正本へ直接反映。管理画面の評価理由も次の探索前に取得されます。未評価案は勝手にGOOD・ボツへ変更しません。</p>
  </section>;
}
