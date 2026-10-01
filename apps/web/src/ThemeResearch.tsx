import { useEffect, useMemo, useRef, useState } from 'react';
import type { ThemeDiscovery } from '@keywords/db/remote-keyword-schema';
import { api } from './api';

type ThemeStatus = 'surviving' | 'challenged' | 'killed' | 'parked' | 'pilot_ready';
type ObservedFact = { label: string; value: string; source?: string; observedAt?: string };
type Challenge = {
  id: string;
  createdAt: string;
  attack: string;
  evidence: string[];
  defense: string;
  conclusion: string;
  statusAfter: ThemeStatus;
  nextChallenge: string;
};
type Candidate = {
  id: string;
  title: string;
  thesis: string;
  status: ThemeStatus;
  currentVerdict: string;
  whyStillAlive: string;
  fatalRisks: string[];
  unknowns: string[];
  observedFacts: ObservedFact[];
  alternatives: string[];
  nextChallenge: string;
  discovery?: ThemeDiscovery | null;
  challengeHistory: Challenge[];
  historyDigest: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
};
type Context = {
  sessionId: string;
  title: string;
  objective: string;
  revision: number;
  principles: string[];
  legacyFindings: string[];
  nextActions: string[];
  notes: string;
  themeLedgerVersion: number;
  bootstrapRequired?: boolean;
  candidates: Candidate[];
};

const endpoint = ['localhost', '127.0.0.1'].includes(window.location.hostname)
  ? '/theme-research'
  : '/api/theme-research';

const statusMeta: Record<ThemeStatus, { label: string; tone: string; help: string }> = {
  surviving: { label: '検討継続', tone: 'good', help: '反証後も候補として残っている' },
  challenged: { label: '要反証', tone: 'work', help: '重大な疑義があり追加調査が必要' },
  pilot_ready: { label: '実地検証候補', tone: 'good', help: '小規模テストへ送れる状態' },
  parked: { label: '保留', tone: 'neutral', help: '条件変更や追加情報待ち' },
  killed: { label: '見送り', tone: 'regressed', help: '現時点では狙わない' }
};

const statusOrder: ThemeStatus[] = ['pilot_ready', 'surviving', 'challenged', 'parked', 'killed'];
const formatDate = (value?: string) => value
  ? new Intl.DateTimeFormat('ja-JP', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
  : '—';

function compact(text: string, length = 110) {
  const normalized = text.trim().replace(/\s+/g, ' ');
  return normalized.length > length ? `${normalized.slice(0, length)}…` : normalized;
}

export function ThemeResearch() {
  const [sessionId, setSessionId] = useState('seo-theme-research');
  const [sessions, setSessions] = useState<Array<{ id: string; title: string }>>([]);
  const [sessionListError, setSessionListError] = useState('');
  const [context, setContext] = useState<Context | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<ThemeStatus | ''>('');
  const [showKilled, setShowKilled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const requestId = useRef(0);

  const load = async () => {
    const request = ++requestId.current;
    setLoading(true);
    setError('');
    try {
      const result = await api<Context>(`${endpoint}?includeKilled=true&sessionId=${encodeURIComponent(sessionId)}`);
      if (request !== requestId.current) return;
      setContext(result);
      setSelectedId(previous => result.candidates.some(item => item.id === previous)
        ? previous
        : result.candidates.find(item => item.status !== 'killed')?.id ?? result.candidates[0]?.id ?? '');
    } catch (e) {
      if (request === requestId.current) setError(e instanceof Error ? e.message : 'テーマリサーチを取得できませんでした');
    } finally {
      if (request === requestId.current) setLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    void api<{ items: Array<{ id: string; title: string }> }>(`${endpoint}?resource=sessions`)
      .then(result => { if (active) setSessions(result.items); })
      .catch(() => { if (active) setSessionListError('探索セッション一覧を取得できませんでした。'); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    setContext(null);
    void load();
    return () => { requestId.current += 1; };
  }, [sessionId]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (context?.candidates ?? [])
      .filter(item => showKilled || item.status !== 'killed')
      .filter(item => !status || item.status === status)
      .filter(item => !needle || [
        item.title, item.thesis, item.currentVerdict, item.whyStillAlive,
        item.nextChallenge, ...item.fatalRisks, ...item.unknowns,
        ...item.observedFacts.flatMap(fact => [fact.label, fact.value]),
        item.discovery?.audience ?? '', item.discovery?.question ?? '', item.discovery?.unmetNeed ?? '',
        item.discovery?.deliverable ?? '', ...(item.discovery?.nextQueries.map(next => `${next.query} ${next.reason}`) ?? [])
      ].join(' ').toLowerCase().includes(needle))
      .sort((a, b) => statusOrder.indexOf(a.status) - statusOrder.indexOf(b.status)
        || new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }, [context, query, status, showKilled]);

  const selected = context?.candidates.find(item => item.id === selectedId) ?? null;
  const counts = Object.fromEntries(statusOrder.map(key => [key, context?.candidates.filter(item => item.status === key).length ?? 0])) as Record<ThemeStatus, number>;

  return <section className="themeResearchView">
    <div className="coreSectionHead">
      <div>
        <p className="coreEyebrow">ONGOING THEME RESEARCH</p>
        <h1>SEOテーマ研究</h1>
        <p>候補を点数化せず、反証・弱点・未確認点を引き継ぎながら狙うテーマを洗練します。</p>
      </div>
      <button onClick={() => void load()} disabled={loading}>{loading ? '更新中…' : '更新'}</button>
    </div>

    {error && <div className="systemNotice" role="alert"><div><strong>テーマ研究に接続できません</strong><p>{error}</p><button onClick={() => void load()}>再試行</button></div></div>}

    {context && <div className="themeResearchSummary">
      <div className="themeResearchLead">
        <span>正本 · {context.sessionId}</span>
        <strong>{context.title}</strong>
        <p>{context.objective}</p>
      </div>
      <div className="themeResearchCounts">
        <div><small>実地検証候補</small><b>{counts.pilot_ready}</b></div>
        <div><small>検討継続</small><b>{counts.surviving}</b></div>
        <div><small>要反証</small><b>{counts.challenged}</b></div>
        <div><small>見送り</small><b>{counts.killed}</b></div>
      </div>
    </div>}

    {context?.bootstrapRequired && <aside className="themeBootstrapNotice" role="status">
      <div>
        <strong>既存リサーチの構造化移行待ち</strong>
        <p>過去の検証内容は失われていません。次回の継続リサーチ実行時に候補台帳へ移されます。</p>
      </div>
      <span>{context.legacyFindings.length}件の既存所見</span>
    </aside>}

    <div className="coreToolbar">
      <select aria-label="探索対象" value={sessionId} onChange={event => setSessionId(event.target.value)}>
        <option value="seo-theme-research">新規収益テーマ</option>
        {sessions.filter(session => session.id !== 'seo-theme-research').map(session => <option key={session.id} value={session.id}>{session.title}</option>)}
      </select>
      {sessionListError && <span role="status">{sessionListError}</span>}
      <input
        aria-label="テーマ研究を検索"
        placeholder="テーマ・弱点・未確認点・証拠を検索"
        value={query}
        onChange={e => setQuery(e.target.value)}
      />
      <select aria-label="状態で絞り込み" value={status} onChange={e => setStatus(e.target.value as ThemeStatus | '')}>
        <option value="">すべての状態</option>
        {statusOrder.map(key => <option key={key} value={key}>{statusMeta[key].label}</option>)}
      </select>
      <label className="themeKilledToggle">
        <input type="checkbox" checked={showKilled} onChange={e => setShowKilled(e.target.checked)}/>
        見送りも表示
      </label>
      <span>{visible.length}件</span>
    </div>

    {loading && !context ? <div className="dashboardSkeleton" aria-label="テーマ研究を読み込み中"><span/><span/><span/></div>
      : context && context.candidates.length > 0 ? <div className="themeResearchLayout">
        <aside className="themeCandidateList" aria-label="テーマ候補一覧">
          {visible.map(item => {
            const meta = statusMeta[item.status];
            return <button key={item.id} className={selectedId === item.id ? 'selected' : ''} onClick={() => setSelectedId(item.id)}>
              <span className="themeCandidateTop"><i className={`statusPill ${meta.tone}`}>{meta.label}</i><small>{formatDate(item.updatedAt)}</small></span>
              <strong>{item.title}</strong>
              <p>{compact(item.currentVerdict || item.thesis)}</p>
              {item.nextChallenge && <span className="themeNextMini">次: {compact(item.nextChallenge, 72)}</span>}
            </button>;
          })}
          {!visible.length && <p className="coreEmpty">条件に一致する候補はありません。</p>}
        </aside>

        <article className="themeResearchDetail" aria-live="polite">
          {selected ? <>
            <header className="themeDetailHeader">
              <div>
                <span className={`statusPill ${statusMeta[selected.status].tone}`}>{statusMeta[selected.status].label}</span>
                <h2>{selected.title}</h2>
                <p>{selected.thesis}</p>
              </div>
              <small>第{selected.revision}版 · 更新 {formatDate(selected.updatedAt)}</small>
            </header>

            <div className="themeVerdictGrid">
              <section className="themeVerdictCard primary">
                <span>現在の見立て</span>
                <p>{selected.currentVerdict || 'まだ明文化されていません。'}</p>
              </section>
              <section className="themeVerdictCard">
                <span>なぜまだ残るか</span>
                <p>{selected.whyStillAlive || '未整理'}</p>
              </section>
              <section className="themeVerdictCard next">
                <span>次に何を疑うか</span>
                <p>{selected.nextChallenge || '次の反証テーマは未設定です。'}</p>
              </section>
            </div>

            {selected.discovery ? <section className="themeEvidenceSection">
              <div className="themeSubhead"><h3>発見した機会</h3></div>
              <div className="themeEvidenceGrid">
                {[
                  ['誰のどの疑問か', `${selected.discovery.audience} — ${selected.discovery.question}`],
                  ['今ある答えの不足', selected.discovery.unmetNeed],
                  ['作るもの', selected.discovery.deliverable],
                  ['作れる理由', selected.discovery.feasibility],
                  ['この案を捨てる条件', selected.discovery.falsification]
                ].map(([label, text]) => <div className="themeEvidenceCard" key={label}><small>{label}</small><p>{text || '調査中'}</p></div>)}
              </div>
              <h4>困りごとの証拠</h4>
              {selected.discovery.observations.map((observation, index) => <div className="themeEvidenceCard" key={index}>
                <p>{observation.excerpt}</p><a href={observation.url} target="_blank" rel="noreferrer">出典</a> · {formatDate(observation.observedAt)}
              </div>)}
              <h4>競合本文で確認したこと</h4>
              {selected.discovery.serpReviews.map((review, index) => <details key={index}>
                <summary>{review.query} · {review.provider === 'serper' ? 'Google検索' : 'Brave検索'} · {formatDate(review.researchedAt)}</summary>
                {review.pages.map((page, pageIndex) => <div className="themeEvidenceCard" key={pageIndex}>
                  <a href={page.url} target="_blank" rel="noreferrer">確認したページ</a><small> · {page.coverage === 'partial' ? '部分的な確認' : '取得本文を確認'}</small>
                  <p>{page.excerpt}</p><p>回答済み: {page.answers || '未整理'}</p><p>残る疑問: {page.remainingGap || '未確認'}</p>
                </div>)}
              </details>)}
              <h4>発見から次に調べること</h4>
              {selected.discovery.nextQueries.length ? <ul>{selected.discovery.nextQueries.map((next, index) => <li key={index}><strong>{next.query}</strong> — {next.reason}</li>)}</ul> : <p className="themeMuted">次の検索は未設定です。</p>}
            </section> : <p className="themeMuted">観察・競合本文・提供価値の証拠はまだ未整理です。実装へ進む前に調査します。</p>}

            <div className="themeResearchColumns">
              <section>
                <div className="themeSubhead"><h3>致命傷候補</h3><span>{selected.fatalRisks.length}</span></div>
                {selected.fatalRisks.length ? <ul className="themeRiskList">{selected.fatalRisks.map(item => <li key={item}>{item}</li>)}</ul> : <p className="themeMuted">未登録</p>}
              </section>
              <section>
                <div className="themeSubhead"><h3>未確認点</h3><span>{selected.unknowns.length}</span></div>
                {selected.unknowns.length ? <ul className="themeUnknownList">{selected.unknowns.map(item => <li key={item}>{item}</li>)}</ul> : <p className="themeMuted">未登録</p>}
              </section>
            </div>

            <section className="themeEvidenceSection">
              <div className="themeSubhead"><h3>観測事実</h3><span>{selected.observedFacts.length}</span></div>
              {selected.observedFacts.length ? <div className="themeEvidenceGrid">{selected.observedFacts.map((fact, index) => <div key={`${fact.label}-${index}`} className="themeEvidenceCard">
                <small>{fact.label}</small>
                <strong>{fact.value}</strong>
                {(fact.source || fact.observedAt) && <p>{fact.source || ''}{fact.source && fact.observedAt ? ' · ' : ''}{fact.observedAt ? formatDate(fact.observedAt) : ''}</p>}
              </div>)}</div> : <p className="themeMuted">観測事実はまだ構造化されていません。</p>}
            </section>

            <section className="themeHistorySection">
              <div className="themeSubhead"><h3>批判検証の履歴</h3><span>{selected.challengeHistory.length}</span></div>
              {selected.challengeHistory.length ? <div className="themeHistoryList">{[...selected.challengeHistory].reverse().map(item => <details key={item.id}>
                <summary>
                  <span><i className={`statusPill ${statusMeta[item.statusAfter].tone}`}>{statusMeta[item.statusAfter].label}</i><b>{item.conclusion}</b></span>
                  <small>{formatDate(item.createdAt)}</small>
                </summary>
                <div>
                  <h4>疑ったこと</h4><p>{item.attack}</p>
                  {item.evidence.length > 0 && <><h4>根拠</h4><ul>{item.evidence.map(evidence => <li key={evidence}>{evidence}</li>)}</ul></>}
                  {item.defense && <><h4>それでも残る根拠</h4><p>{item.defense}</p></>}
                  {item.nextChallenge && <><h4>次の検証</h4><p>{item.nextChallenge}</p></>}
                </div>
              </details>)}</div> : <p className="themeMuted">構造化された検証履歴はまだありません。</p>}
              {selected.historyDigest && <details className="themeHistoryDigest"><summary>古い履歴の要約</summary><pre>{selected.historyDigest}</pre></details>}
            </section>
          </> : <p className="coreEmpty">左から候補を選択してください。</p>}
        </article>
      </div> : context && context.legacyFindings.length ? <div className="themeLegacyPanel">
        <div className="coreSectionHead"><div><p className="coreEyebrow">CURRENT RESEARCH MEMORY</p><h2>これまでの検証</h2><p>候補台帳へ移行する前の所見です。内容は継続リサーチへ引き継がれます。</p></div></div>
        <div className="themeLegacyGrid">{context.legacyFindings.map((finding, index) => <article key={index}><span>{String(index + 1).padStart(2, '0')}</span><p>{finding}</p></article>)}</div>
        {context.nextActions.length > 0 && <section className="themeNextActions"><h3>次回の調査方針</h3><ul>{context.nextActions.map(item => <li key={item}>{item}</li>)}</ul></section>}
      </div> : !error && <div className="structureEmpty"><h2>テーマ研究はまだありません</h2><p>継続リサーチが候補を保存すると、ここに検証状況が表示されます。</p></div>}
  </section>;
}
