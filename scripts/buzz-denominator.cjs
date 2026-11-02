// 分母台帳の単発収集：同じ型の「選ばれていない」普通の投稿を、成熟した1日分だけ Latest で取る
//
// 使い方:
//   RAPIDAPI_KEY=... node scripts/buzz-denominator.cjs data/experiments/<日付>/buzz
//
// 出力: denominator.json — 型の目印（妻が・夫が・娘が・息子が 等）ごとの likes 分布
//   - バズ台帳だけでは型の当たる確率が分からない（生存者バイアス）。これがその分母
//   - markers と since/until はスクリプト内で変える。本文を含むのでコミットしない
const fs=require('fs');const H={'x-rapidapi-key':process.env.RAPIDAPI_KEY,'x-rapidapi-host':'twitter-api45.p.rapidapi.com'};const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const markers=['妻が','夫が','娘が','息子が','あるある'];const out={};let calls=0;
(async()=>{for(const m of markers){const q=`${m} lang:ja since:2026-10-28 until:2026-10-29 -filter:replies -filter:retweets`;let cur=null;out[m]=[];
 for(let p=0;p<4;p++){calls++;const r=await fetch(`https://twitter-api45.p.rapidapi.com/search.php?query=${encodeURIComponent(q)}&search_type=Latest${cur?`&cursor=${encodeURIComponent(cur)}`:''}`,{headers:H});const d=r.ok?await r.json():null;
  if(!d?.timeline?.length)break;for(const x of d.timeline)if(x.tweet_id)out[m].push({id:x.tweet_id,likes:+x.favorites||0,followers:x.user_info?.followers_count??null,text:(x.text||'').slice(0,120)});cur=d.next_cursor;if(!cur)break;await sleep(2000)}}
 fs.mkdirSync(process.argv[2]||'data/experiments/buzz',{recursive:true});fs.writeFileSync((process.argv[2]||'data/experiments/buzz')+'/denominator.json',JSON.stringify({fetchedAt:new Date().toISOString(),window:'2026-10-28 JST day, Latest, matured ~5 days',calls,samples:out},null,1));
 for(const[m,a]of Object.entries(out)){const l=a.map(x=>x.likes).sort((x,y)=>x-y);const f=t=>a.filter(x=>x.likes>=t).length;console.log(m,'n',a.length,'median',l[Math.floor(l.length/2)],'p90',l[Math.floor(l.length*.9)],'max',l[l.length-1],'>=100',f(100),'>=1000',f(1000))}
})();
