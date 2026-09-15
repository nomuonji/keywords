import { useEffect, useRef, useState } from 'react';
import type { SiteStructure, SiteStructureNode } from '@keywords/db/site-structure-schema';
import { api } from './api';

type Keyword = { id: string; keyword: string; volume?: number | null; notes?: string };
type Detail = SiteStructure & { keywords: Keyword[] };
type Listing = { items: SiteStructure[]; nextPageToken: string | null };
const stateLabels = { draft: '下書き', active: '検討中', archived: 'アーカイブ' };
const kindLabels = { home: 'トップ', category: 'カテゴリ', article: '記事', landing: '入口ページ' };
const endpoint = ['localhost', '127.0.0.1'].includes(window.location.hostname) ? '/site-structures' : '/api/site-structures';

function orderedNodes(nodes: SiteStructureNode[]) {
  const rows: { node: SiteStructureNode; depth: number }[] = [];
  const visited = new Set<string>();
  function visit(parentId: string | null, depth: number) {
    for (const node of nodes.filter(item => item.parentId === parentId)) {
      if (visited.has(node.id)) continue;
      visited.add(node.id); rows.push({ node, depth }); visit(node.id, depth + 1);
    }
  }
  visit(null, 0);
  for (const node of nodes) if (!visited.has(node.id)) rows.push({ node, depth: 0 });
  return rows;
}

export function SiteStructures() {
  const [items, setItems] = useState<SiteStructure[]>([]);
  const [nextPageToken, setNextPageToken] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState('');
  const [detailError, setDetailError] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [refresh, setRefresh] = useState(0);
  const listRequest = useRef(0);
  const detailRequest = useRef(0);

  const load = async (pageToken?: string) => {
    const request = ++listRequest.current;
    setLoading(true); setError('');
    try {
      const result = await api<Listing>(`${endpoint}${pageToken ? `?pageToken=${encodeURIComponent(pageToken)}` : ''}`);
      if (request !== listRequest.current) return;
      setItems(previous => pageToken ? [...new Map([...previous, ...result.items].map(item => [item.id, item])).values()] : result.items);
      setNextPageToken(result.nextPageToken);
      if (!pageToken) { setSelectedId(previous => result.items.some(item => item.id === previous) ? previous : result.items[0]?.id ?? ''); setRefresh(value => value + 1); }
    } catch (e) { if (request === listRequest.current) setError(e instanceof Error ? e.message : '取得できませんでした'); }
    finally { if (request === listRequest.current) setLoading(false); }
  };
  useEffect(() => { void load(); return () => { listRequest.current++; }; }, []);
  useEffect(() => {
    const request = ++detailRequest.current;
    setDetail(null); setDetailError('');
    if (!selectedId) { setDetailLoading(false); return; }
    setDetailLoading(true);
    void api<Detail>(`${endpoint}?id=${encodeURIComponent(selectedId)}`).then(result => {
      if (request === detailRequest.current) setDetail(result);
    }).catch(e => { if (request === detailRequest.current) setDetailError(e instanceof Error ? e.message : '取得できませんでした'); })
      .finally(() => { if (request === detailRequest.current) setDetailLoading(false); });
    return () => { detailRequest.current++; };
  }, [selectedId, refresh]);

  const visible = items.filter(item => (!status || item.status === status) && `${item.title} ${item.concept} ${item.audience}`.toLowerCase().includes(query.trim().toLowerCase()));
  const keywords = new Map(detail?.keywords.map(item => [item.id, item]));
  const nodes = new Map(detail?.nodes.map(item => [item.id, item]));
  return <section className="treasuryView">
    <div className="coreSectionHead"><div><p className="coreEyebrow">SITE PLANNING</p><h1>サイト構想</h1><p>お宝キーワードから、読者・ページ構造・内部リンクを組み立てる。</p></div><button onClick={() => void load()} disabled={loading}>更新</button></div>
    <div className="coreToolbar"><input aria-label="サイト構想を検索" placeholder="構想名・コンセプト・読者で検索" value={query} onChange={e => setQuery(e.target.value)}/><select aria-label="構想の状態" value={status} onChange={e => setStatus(e.target.value)}><option value="">すべての状態</option>{Object.entries(stateLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select><span>{visible.length}件{nextPageToken ? '（読込済み）' : ''}</span></div>
    {error && <div className="systemNotice" role="alert"><div><strong>サイト構想に接続できません</strong><p>{error}</p><button onClick={() => void load()}>再試行</button></div></div>}
    {loading && !items.length ? <p role="status">サイト構想を読み込み中…</p> : !items.length && !error ? <div className="structureEmpty"><h2>最初のサイト構想をつくる</h2><p>接続したエージェントに、たとえば次のように依頼してください。</p><blockquote>保存したお宝キーワードを使って、サイトの読者像とカテゴリ・記事の構成を考え、サイト構想に保存して。</blockquote><p>保存後、この画面を更新すると構想とページ階層を確認できます。</p></div> : <div className="structureLayout">
      <aside className="structureList" aria-label="サイト構想一覧">{visible.map(item => <button key={item.id} className={selectedId === item.id ? 'selected' : ''} aria-pressed={selectedId === item.id} onClick={() => setSelectedId(item.id)}><strong>{item.title}</strong><span>{stateLabels[item.status]} · {item.nodes.length}ページ</span><small>{item.concept || 'コンセプト未設定'}</small></button>)}{!visible.length && !error && <p className="coreEmpty">条件に一致する構想はありません。</p>}{nextPageToken && <button disabled={loading} onClick={() => void load(nextPageToken)}>さらに読み込む</button>}</aside>
      <div className="structureDetail" aria-live="polite">
        {detailLoading && <p role="status">ページ構造を読み込み中…</p>}
        {detailError && <div role="alert"><p>{detailError}</p><button onClick={() => setRefresh(value => value + 1)}>再試行</button></div>}
        {detail && <>
          <header><span className="statusPill">{stateLabels[detail.status]}</span><h2>{detail.title}</h2><small>更新 {new Intl.DateTimeFormat('ja-JP', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(detail.updatedAt))} · 第{detail.revision}版</small></header>
          <dl className="structureBrief">{[['コンセプト', detail.concept], ['想定読者', detail.audience], ['収益化の方針', detail.monetization], ['構想メモ', detail.notes]].map(([label, text]) => <div key={label}><dt>{label}</dt><dd>{text || '未設定'}</dd></div>)}</dl>
          <h3>ページ構造 <small>{detail.nodes.length}ページ</small></h3>
          {detail.nodes.length ? <div className="treasuryTable" role="region" aria-label="ページ階層とキーワード"><table><thead><tr><th>階層・ページ</th><th>役割・メモ</th><th>お宝キーワード</th></tr></thead><tbody>{orderedNodes(detail.nodes).map(({ node, depth }) => <tr key={node.id}><td><div style={{ paddingLeft: `${Math.min(depth, 8) * 16}px` }}><small>{depth ? `階層 ${depth + 1} · ` : ''}{kindLabels[node.kind]}</small><b>{node.title}</b><code>{node.path}</code>{node.parentId && <small>親: {nodes.get(node.parentId)?.title}</small>}</div></td><td><p>{node.purpose || '—'}</p>{node.notes && <small>{node.notes}</small>}</td><td>{node.keywordIds.length ? node.keywordIds.map(id => { const keyword = keywords.get(id); return <div className="structureKeyword" key={id}><b>{keyword?.keyword ?? `参照先なし (${id})`}</b><small>月間検索数 {keyword?.volume ?? '未取得'}</small>{keyword?.notes && <small>{keyword.notes}</small>}</div>; }) : '未紐付け'}</td></tr>)}</tbody></table></div> : <p className="coreEmpty">ページはまだありません。エージェントとの相談で追加できます。</p>}
          <h3>内部リンク <small>{detail.links.length}件</small></h3>
          {detail.links.length ? <ul className="structureLinks">{detail.links.map(link => <li key={`${link.from}:${link.to}`}><strong>{nodes.get(link.from)?.title}</strong><span aria-label="リンク先"> → </span><strong>{nodes.get(link.to)?.title}</strong>{link.label && <small>{link.label}</small>}</li>)}</ul> : <p className="coreEmpty">内部リンクは未設定です。</p>}
          <p className="structureHelp">編集はエージェントに「{detail.title}の構想を編集して」と依頼してください。検討中の構想として保存されます。</p>
        </>}
      </div>
    </div>}
  </section>;
}
