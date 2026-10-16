import { useEffect, useState } from 'react';
type Row={date:string;rootName:string;genreId:string;genreName:string;items:{itemCode:string;rank:number}[];comparison:{previousDate:string;sameItemCount:number;denominator:number}|null};
type Snapshot={schemaVersion:number;date:string;generatedAt:string;coverage:{rootGenreCount:number;sampledToday:number};observations:Row[];warnings:{genreId:string;reason:string}[]};
export function MarketDiscovery(){
 const [data,setData]=useState<Snapshot|null>(null);
 const [error,setError]=useState('');
 const [selected,setSelected]=useState('');
 const [products,setProducts]=useState<{rank:number;itemCode:string;itemName:string;itemUrl:string}[]>([]);
 const [loading,setLoading]=useState(false);
 useEffect(()=>{fetch('https://raw.githubusercontent.com/nomuonji/keywords/market-data/data/latest.json',{cache:'no-store'}).then(r=>{if(!r.ok)throw Error('まだ観測データがありません（HTTP '+r.status+'）');return r.json()}).then(setData).catch(e=>setError(e.message))},[]);
 async function inspect(id:string){
   setSelected(id);setLoading(true);setProducts([]);
   try{
     const url=new URL('https://api-three-gilt-37.vercel.app/api/affiliate');
     url.searchParams.set('network','rakuten-ichiba');url.searchParams.set('action','ranking');url.searchParams.set('genreId',id);
     const r=await fetch(url);if(!r.ok)throw Error('ランキング取得失敗: '+r.status);
     const body=await r.json();setProducts(body.items||[]);
   }catch(e){setError(e instanceof Error?e.message:String(e));}
   finally{setLoading(false)}
 }
 const rows=data?.observations.filter(r=>r.date===data.date)||[];
 return <section className="corePage">
  <div className="coreTitleRow"><div><p className="coreEyebrow">MARKET DISCOVERY</p><h1>楽天カテゴリ別ランキング観測</h1><p>市場探索のための外部観測資料。ここで表示するランキングはIdea Memoryの新規アイデアや人間の評価とは別のデータです。</p></div></div>
  {error&&<p role="status">{error} <a href="https://github.com/nomuonji/keywords/actions/workflows/market-discovery.yml">実行状況</a></p>}
  {data&&<><p>最終観測 {data.date} ／ 本日 {rows.length}カテゴリ ／ 大分類 {data.coverage.rootGenreCount}種類 ／ 過去90日の記録 {data.observations.length}件</p>
   <p>順位は販売個数・成約実績ではありません。商品の名前・価格・画像は保存せず、閲覧時に最新情報を取得します。</p>
   <div className="treasuryTable"><table><thead><tr><th>大分類</th><th>調査カテゴリ</th><th>前回との一致</th><th>現在の商品</th></tr></thead><tbody>{rows.map(r=><tr key={r.genreId}>
    <td>{r.rootName}</td><td>{r.genreName} <small>ID {r.genreId}</small></td>
    <td>{r.comparison?r.comparison.sameItemCount+'/'+r.comparison.denominator+'件（'+r.comparison.previousDate+'比較）':'初回観測'}</td>
    <td><button onClick={()=>void inspect(r.genreId)}>商品を確認</button></td>
   </tr>)}</tbody></table></div>
   {loading&&<p>取得中...</p>}
   {selected&&<div className="treasuryTable"><h2>最新ランキング — {rows.find(r=>r.genreId===selected)?.genreName||selected}</h2><table><thead><tr><th>順位</th><th>商品</th><th>リンク</th></tr></thead><tbody>{products.map(p=><tr key={p.itemCode}><td>{p.rank}</td><td>{p.itemName}</td><td>{p.itemUrl.startsWith('https://')?<a href={p.itemUrl} target="_blank" rel="noreferrer">楽天で確認 ↗</a>:''}</td></tr>)}</tbody></table></div>}
   <p>候補の商品が売れる理由はレビュー・購買意図・競合の別証拠で検証します。広告配信は自動的に開始しません。</p>
  </>}
 </section>;
}
