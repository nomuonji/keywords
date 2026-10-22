import { useEffect, useMemo, useState } from 'react';
import { api } from './api';
import { AdminDelete } from './AdminDelete';

type Item = { id:string; keyword:string; seed?:string; status?:string; volume?:number|null; competition?:string|number|null; allintitle?:number|null; serpWeakness?:number|null; notes?:string; updatedAt:string };
const label:Record<string,string>={inbox:'受信箱',shortlisted:'有望',rejected:'見送り',published:'公開済み'};

export function KeywordTreasury(){
  const [items,setItems]=useState<Item[]>([]);
  const [selectedTargets,setSelectedTargets]=useState<Array<{id:string;keyword:string}>>([]);
  const [status,setStatus]=useState('');
  const [query,setQuery]=useState('');
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');

  const load=async()=>{
    setLoading(true);setError('');
    try {
      const params=new URLSearchParams(Object.fromEntries(Object.entries({status,query}).filter(([,value])=>value)));
      const local=['localhost','127.0.0.1'].includes(window.location.hostname);
      const path=local?`/keyword-treasury?${params}`:`/api/treasury?${params}`;
      const next=await api<Item[]>(path);
      setItems(next);
    }catch(e){setError(e instanceof Error?e.message:'共有ストックを取得できませんでした');}
    finally{setLoading(false);}
  };
  useEffect(()=>{void load();},[status]);
  const visible=useMemo(()=>items.filter(item=>!query||`${item.keyword} ${item.seed??''} ${item.notes??''}`.toLowerCase().includes(query.toLowerCase())),[items,query]);
  const selected=new Set(selectedTargets.map(item=>item.id));
  const allVisibleSelected=visible.length>0&&visible.every(item=>selected.has(item.id));
  const toggleSelected=(item:Item,checked:boolean)=>setSelectedTargets(old=>checked?(old.some(target=>target.id===item.id)?old:[...old,{id:item.id,keyword:item.keyword}]):old.filter(target=>target.id!==item.id));
  const selectVisible=()=>setSelectedTargets(old=>[...old,...visible.filter(item=>!old.some(target=>target.id===item.id)).map(item=>({id:item.id,keyword:item.keyword}))]);
  const clearSelected=()=>setSelectedTargets([]);
  const toggleAllVisible=(checked:boolean)=>checked?selectVisible():
    setSelectedTargets(old=>old.filter(item=>!visible.some(shown=>shown.id===item.id)));
  const afterDelete=()=>{clearSelected();void load();};
  const selectedKey=selectedTargets.map(x=>x.id).sort().join('|');

  return <section className="treasuryView">
    <div className="coreSectionHead">
      <div><p className="coreEyebrow">SHARED FIRESTORE TREASURY</p><h1>お宝キーワード</h1><p>リモートMCPで保存した候補を表示します。</p></div>
      <div className="coreToolbar">
        <button type="button" onClick={()=>void load()} disabled={loading}>更新</button>
        <AdminDelete key={selectedKey} kind="selected-keywords" targets={selectedTargets} onDeleted={afterDelete}/>
      </div>
    </div>
    <div className="treasurySelection">
      <strong>削除するキーワードを選択</strong>
      <p>チェックしたキーワードだけを削除します。検索中の「全選択」は表示中の行だけが対象です。選択した行は別の状態に絞り込んでも保持します。</p>
      <div className="coreToolbar">
        <span aria-live="polite">選択中：{selectedTargets.length}件</span>
        <button type="button" onClick={selectVisible} disabled={!visible.length||allVisibleSelected}>全選択（表示中）</button>
        <button type="button" onClick={clearSelected} disabled={!selectedIds.length}>選択解除（全件）</button>
      </div>
    </div>
    <div className="coreToolbar">
      <input value={query} onChange={e=>setQuery(e.target.value)} placeholder="キーワード・シード・メモを検索" aria-label="お宝キーワードを検索"/>
      <select value={status} onChange={e=>setStatus(e.target.value)} aria-label="状態で絞り込み">
        <option value="">すべての状態</option>
        {Object.entries(label).map(([value,text])=><option key={value} value={value}>{text}</option>)}
      </select>
      <span>{visible.length}件表示</span>
    </div>
    {error?<div className="systemNotice"><div><strong>共有ストックに接続できません</strong><p>{error}</p><small>ローカルでは .env、公開先ではVercelのFirestore設定を確認してください。</small></div></div>
      :loading?<div className="dashboardSkeleton" aria-label="お宝キーワードを読み込み中"><span/><span/><span/></div>
      :<div className="treasuryTable" role="region" aria-label="お宝キーワード一覧">
        <table>
          <thead><tr>
            <th><input type="checkbox" checked={allVisibleSelected}
              aria-label="表示中のキーワードを全選択"
              onChange={e=>toggleAllVisible(e.target.checked)}/></th>
            <th>キーワード</th><th>状態</th><th>需要</th><th>競合シグナル</th><th>根拠・メモ</th><th>更新</th><th>管理</th>
          </tr></thead>
          <tbody>{visible.map(item=><tr key={item.id}>
            <td><input type="checkbox" aria-label={`「${item.keyword}」を削除対象に選択`}
              checked={selected.has(item.id)} onChange={e=>toggleSelected(item,e.target.checked)}/></td>
            <td><b>{item.keyword}</b>{item.seed&&<small>seed: {item.seed}</small>}</td>
            <td><span className={`statusPill ${item.status??'inbox'}`}>{label[item.status??'inbox']??item.status}</span></td>
            <td>{item.volume??'—'}{item.competition!=null&&<small>{String(item.competition)}</small>}</td>
            <td><span>allintitle {item.allintitle??'—'}</span><small>SERP弱さ {item.serpWeakness??'—'}</small></td>
            <td>{item.notes||'—'}</td>
            <td>{item.updatedAt?new Intl.DateTimeFormat('ja-JP',{dateStyle:'short',timeStyle:'short'}).format(new Date(item.updatedAt)) :'—'}</td>
            <td><AdminDelete kind="keyword" id={item.id} label={item.keyword} onDeleted={()=>{setSelectedTargets(old=>old.filter(target=>target.id!==item.id));setItems(old=>old.filter(v=>v.id!==item.id));}}/></td>
          </tr>)}</tbody>
        </table>
        {!visible.length&&<p className="coreEmpty">保存済みの候補はありません。</p>}
      </div>}
  </section>;
}
