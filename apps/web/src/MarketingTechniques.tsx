import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { api, isRemoteBackend } from './api';
import './marketing-techniques.css';

type Status = 'candidate' | 'usable' | 'avoid' | 'archived';
type Evidence = 'observed' | 'reported' | 'literature' | 'hypothesis';
type Usage = { at: string; surface: string; target: string; note: string };
type Technique = {
  id: string;
  name: string;
  lever: string;
  category: string;
  summary: string;
  mechanism: string;
  example: string;
  evidenceLevel: Evidence;
  sourceUrl: string | null;
  sourceLabel: string | null;
  observedAt: string | null;
  surfaces: string[];
  fitWhen: string;
  avoidWhen: string;
  tags: string[];
  status: Status;
  usages: Usage[];
  revision: number;
  createdAt: string;
  updatedAt: string;
  origin: 'builtin' | 'firestore';
};
type Context = {
  generatedAt: string;
  mission: string;
  rules: string[];
  items: Technique[];
  total: number;
  levers: Array<{ name: string; count: number }>;
};

const local = ['localhost', '127.0.0.1'].includes(window.location.hostname);
// The deployed viewer is read-only; edits run against the local API.
const readOnly = isRemoteBackend();
const endpoint = local ? '/marketing-techniques' : '/api/theme-research?resource=marketing-techniques';
const statusLabel: Record<Status, string> = { candidate: '候補', usable: '使える', avoid: '使わない', archived: '保管' };
const statusClass: Record<Status, string> = { candidate: 'workPill', usable: 'goodPill', avoid: 'dangerPill', archived: 'neutralPill' };
const evidenceLabel: Record<Evidence, string> = {
  observed: '自分で観測',
  reported: '他者の報告',
  literature: '文献',
  hypothesis: '仮説'
};

type Draft = {
  id?: string;
  expectedRevision?: number;
  name: string;
  lever: string;
  category: string;
  summary: string;
  mechanism: string;
  example: string;
  evidenceLevel: Evidence;
  sourceUrl: string;
  sourceLabel: string;
  observedAt: string;
  surfaces: string;
  fitWhen: string;
  avoidWhen: string;
  tags: string;
  status: Status;
};

const emptyDraft: Draft = {
  name: '', lever: '', category: 'クリエイティブ', summary: '', mechanism: '', example: '',
  evidenceLevel: 'observed', sourceUrl: '', sourceLabel: '', observedAt: '',
  surfaces: '', fitWhen: '', avoidWhen: '', tags: '', status: 'candidate'
};

function draftFrom(item: Technique): Draft {
  return {
    id: item.id, expectedRevision: item.revision,
    name: item.name, lever: item.lever, category: item.category,
    summary: item.summary, mechanism: item.mechanism, example: item.example,
    evidenceLevel: item.evidenceLevel, sourceUrl: item.sourceUrl ?? '',
    sourceLabel: item.sourceLabel ?? '', observedAt: item.observedAt ?? '',
    surfaces: item.surfaces.join(', '), fitWhen: item.fitWhen, avoidWhen: item.avoidWhen,
    tags: item.tags.join(', '), status: item.status === 'archived' ? 'candidate' : item.status
  };
}

function splitList(value: string) {
  return value.split(/[,、\n]/).map(item => item.trim()).filter(Boolean);
}

export function MarketingTechniques() {
  const [context, setContext] = useState<Context | null>(null);
  const [selected, setSelected] = useState('');
  const [query, setQuery] = useState('');
  const [lever, setLever] = useState('');
  const [status, setStatus] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  async function refresh(nextLever = lever) {
    const params = new URLSearchParams();
    if (nextLever) params.set('lever', nextLever);
    if (status) params.set('status', status);
    const separator = endpoint.includes('?') ? '&' : '?';
    const data = await api<Context>(params.size ? `${endpoint}${separator}${params}` : endpoint);
    setContext(data);
    setSelected(current => data.items.some(item => item.id === current) ? current : data.items[0]?.id ?? '');
    return data;
  }

  useEffect(() => {
    refresh().catch(err => setError(err instanceof Error ? err.message : String(err)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!context) return;
    refresh(lever).catch(err => setError(err instanceof Error ? err.message : String(err)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lever, status]);

  useEffect(() => {
    if (!draft) return;
    document.getElementById('technique-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [draft]);

  const visible = useMemo(() => {
    if (!context) return [];
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return context.items;
    return context.items.filter(item => {
      const haystack = [item.name, item.lever, item.category, item.summary, item.mechanism, item.example, item.fitWhen, ...item.tags].join(' ').toLowerCase();
      return words.every(word => haystack.includes(word));
    });
  }, [context, query]);
  const current = visible.find(item => item.id === selected) ?? visible[0] ?? null;

  async function submitDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const payload: Record<string, unknown> = {
        name: draft.name, lever: draft.lever || '未分類', category: draft.category || 'クリエイティブ',
        summary: draft.summary, mechanism: draft.mechanism, example: draft.example,
        evidenceLevel: draft.evidenceLevel,
        sourceUrl: draft.sourceUrl || null, sourceLabel: draft.sourceLabel || null,
        observedAt: draft.observedAt || null,
        surfaces: splitList(draft.surfaces), fitWhen: draft.fitWhen, avoidWhen: draft.avoidWhen,
        tags: splitList(draft.tags), status: draft.status
      };
      if (draft.id) { payload.id = draft.id; payload.expectedRevision = draft.expectedRevision ?? 0; }
      const result = await api<{ technique: Technique }>(endpoint, { method: 'POST', body: JSON.stringify(payload) });
      setNotice(draft.id ? '更新しました。' : '保存しました。');
      setDraft(null);
      await refresh();
      setSelected(result.technique.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function recordUse(item: Technique) {
    const surface = window.prompt('どの面で使いましたか（例: 記事タイトル / サムネ / 商品名）', '記事タイトル');
    if (!surface) return;
    const target = window.prompt('どの対象ですか（記事・商品・サイト名など）', '');
    if (!target) return;
    const note = window.prompt('結果や気づき（任意）', '') ?? '';
    setBusy(true); setError(''); setNotice('');
    try {
      await api(endpoint + '/use', { method: 'POST', body: JSON.stringify({ id: item.id, expectedRevision: item.revision, surface, target, note }) });
      setNotice('使用記録を追加しました。');
      await refresh();
      setSelected(item.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function changeStatus(item: Technique, next: Status) {
    setBusy(true); setError(''); setNotice('');
    try {
      await api(endpoint, { method: 'POST', body: JSON.stringify({ id: item.id, expectedRevision: item.revision, status: next }) });
      setNotice(`状態を「${statusLabel[next]}」にしました。`);
      await refresh();
      setSelected(item.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  if (error && !context) return <div className="corePage"><div className="coreError">{error}</div></div>;
  if (!context) return <div className="corePage"><div className="dashboardSkeleton">{Array.from({ length: 4 }, (_, i) => <span key={i} />)}</div></div>;

  return <div className="corePage">
    <div className="coreTitleRow">
      <div>
        <p className="coreEyebrow">MARKETING PLAYBOOK</p>
        <h1>マーケ術</h1>
        <p>観測した「売れ方の型」を、効く理由・実例・使わない条件ごと貯めておく。記事タイトル、サムネ、商品名、CTAを考える前にここを引く。</p>
      </div>
      <div className="coreLive"><span />{context.total} techniques</div>
    </div>

    <div className="coreToolbar">
      <input value={query} onChange={e => setQuery(e.target.value)} placeholder="手法・レバー・実例で検索" />
      <select value={lever} onChange={e => setLever(e.target.value)} aria-label="レバーで絞り込み">
        <option value="">すべてのレバー</option>
        {context.levers.map(item => <option key={item.name} value={item.name}>{item.name}（{item.count}）</option>)}
      </select>
      <select value={status} onChange={e => setStatus(e.target.value)} aria-label="状態で絞り込み">
        <option value="">すべての状態</option>
        <option value="candidate">候補</option>
        <option value="usable">使える</option>
        <option value="avoid">使わない</option>
      </select>
      <button type="button" className="mtAddButton" onClick={() => setDraft({ ...emptyDraft, lever })} disabled={readOnly}>+ 技を登録</button>
    </div>

    {readOnly && <p className="mtNotice">この画面は閲覧専用です。登録・編集・使用記録はローカル版のKeywordsで行ってください。</p>}

    {error && <div className="coreError" role="alert">{error}</div>}
    {notice && <p className="mtNotice" role="status">{notice}</p>}

    <div className="sourcePoolLayout">
      <section className="sourcePoolList">
        {visible.map(item => <button key={item.id} className={current?.id === item.id ? 'selected' : ''} onClick={() => setSelected(item.id)}>
          <div><b>{item.name}</b><em className={statusClass[item.status]}>{statusLabel[item.status]}</em></div>
          <small>{item.lever} · {item.category}</small>
          <p>{item.summary}</p>
        </button>)}
        {!visible.length && <p className="coreEmpty">条件に合う技がありません。</p>}
      </section>

      <section className="coreSection sourcePoolDetail">
        {current ? <>
          <div className="coreSectionHead">
            <div>
              <p className="coreEyebrow">{current.lever} / {current.category}</p>
              <h2>{current.name}</h2>
            </div>
            <div className="mtDetailActions">
              {!readOnly && <>
                <button type="button" disabled={busy} onClick={() => void recordUse(current)}>使った</button>
                <button type="button" disabled={busy} onClick={() => setDraft(draftFrom(current))}>編集</button>
              </>}
            </div>
          </div>

          <p className="mtLead">{current.summary}</p>

          <dl className="mtMeta">
            <div><dt>証拠</dt><dd>{evidenceLabel[current.evidenceLevel]}{current.observedAt ? ` · ${current.observedAt}` : ''}</dd></div>
            <div><dt>出典</dt><dd>{current.sourceUrl ? <a href={current.sourceUrl} target="_blank" rel="noreferrer">{current.sourceLabel || current.sourceUrl} ↗</a> : current.sourceLabel || '未記録'}</dd></div>
            <div><dt>使う面</dt><dd>{current.surfaces.length ? current.surfaces.join(' / ') : '未指定'}</dd></div>
          </dl>

          <h3>なぜ効くか</h3>
          <p className="mtBody">{current.mechanism}</p>

          {current.example && <><h3>実例</h3><p className="mtBody">{current.example}</p></>}

          <div className="mtConditions">
            <div><h3>効く条件</h3><p className="mtBody">{current.fitWhen || '未記入'}</p></div>
            <div className="mtAvoid"><h3>使わない条件</h3><p className="mtBody">{current.avoidWhen || '未記入'}</p></div>
          </div>

          {!!current.tags.length && <div className="mtTags">{current.tags.map(tag => <span key={tag}>{tag}</span>)}</div>}

          <div className="mtStatusRow">
            <small>状態</small>
            {(['candidate', 'usable', 'avoid'] as const).map(next => <button key={next} type="button" disabled={busy || readOnly || current.status === next}
              className={current.status === next ? 'active' : ''} onClick={() => void changeStatus(current, next)}>{statusLabel[next]}</button>)}
          </div>

          <h3>使用記録</h3>
          {current.usages.length ? <ol className="mtUsages">
            {[...current.usages].reverse().map((usage, i) => <li key={i}>
              <b>{usage.at} · {usage.surface}</b>
              <span>{usage.target}</span>
              {usage.note && <p>{usage.note}</p>}
            </li>)}
          </ol> : <p className="coreEmpty">まだ使っていません。</p>}
        </> : <p className="coreEmpty">技がありません。</p>}
      </section>
    </div>

    {draft && !readOnly && <form id="technique-form" className="coreSection mtForm" onSubmit={event => void submitDraft(event)}>
      <div className="coreSectionHead">
        <div><p className="coreEyebrow">{draft.id ? 'EDIT TECHNIQUE' : 'NEW TECHNIQUE'}</p><h2>{draft.id ? '技を編集' : '技を登録'}</h2></div>
        <button type="button" className="mtClose" onClick={() => setDraft(null)}>閉じる</button>
      </div>
      <div className="mtGrid">
        <label>名前<input required value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} placeholder="例: 振るモデルチェンジ" /></label>
        <label>レバー<input required value={draft.lever} onChange={e => setDraft({ ...draft, lever: e.target.value })} placeholder="例: 意外性" /></label>
        <label>分類<input value={draft.category} onChange={e => setDraft({ ...draft, category: e.target.value })} placeholder="商品 / クリエイティブ / コピー" /></label>
        <label>証拠レベル<select value={draft.evidenceLevel} onChange={e => setDraft({ ...draft, evidenceLevel: e.target.value as Evidence })}>
          {Object.entries(evidenceLabel).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select></label>
      </div>
      <label>一言でいうと<input required value={draft.summary} onChange={e => setDraft({ ...draft, summary: e.target.value })} /></label>
      <label>なぜ効くか<textarea required rows={3} value={draft.mechanism} onChange={e => setDraft({ ...draft, mechanism: e.target.value })} /></label>
      <label>実例<textarea rows={2} value={draft.example} onChange={e => setDraft({ ...draft, example: e.target.value })} /></label>
      <div className="mtGrid">
        <label>効く条件<textarea rows={2} value={draft.fitWhen} onChange={e => setDraft({ ...draft, fitWhen: e.target.value })} /></label>
        <label>使わない条件<textarea rows={2} value={draft.avoidWhen} onChange={e => setDraft({ ...draft, avoidWhen: e.target.value })} /></label>
      </div>
      <div className="mtGrid">
        <label>出典URL<input value={draft.sourceUrl} onChange={e => setDraft({ ...draft, sourceUrl: e.target.value })} placeholder="https://…" /></label>
        <label>出典メモ<input value={draft.sourceLabel} onChange={e => setDraft({ ...draft, sourceLabel: e.target.value })} placeholder="誰の・いつの話か" /></label>
        <label>観測日<input value={draft.observedAt} onChange={e => setDraft({ ...draft, observedAt: e.target.value })} placeholder="YYYY-MM-DD" /></label>
        <label>使う面<input value={draft.surfaces} onChange={e => setDraft({ ...draft, surfaces: e.target.value })} placeholder="記事タイトル, サムネ, CTA" /></label>
      </div>
      <label>タグ<input value={draft.tags} onChange={e => setDraft({ ...draft, tags: e.target.value })} placeholder="注意, 記憶, 口コミ" /></label>
      <label>状態<select value={draft.status} onChange={e => setDraft({ ...draft, status: e.target.value as Status })}>
        <option value="candidate">候補</option>
        <option value="usable">使える</option>
        <option value="avoid">使わない</option>
      </select></label>
      <div className="mtFormActions">
        <button type="submit" disabled={busy}>{busy ? '保存中…' : '保存'}</button>
        <small>出典のない噂は「仮説」にしてください。使ってはいけない条件が書けない手法は登録しない方針です。</small>
      </div>
    </form>}
  </div>;
}
