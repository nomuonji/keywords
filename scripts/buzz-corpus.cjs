// バズ台帳の単発収集（X検索 Top、min_faves で絞る）＋投稿者ごとの基準値（最近の投稿のいいね中央値）
//
// 使い方（キーは環境変数だけで渡す。ファイルに書かない）:
//   cd D:\youph\keywords
//   RAPIDAPI_KEY=... node scripts/buzz-corpus.cjs data/experiments/<日付>/buzz
//
// 出力: corpus.json — posts[{likes, rts, views, followers, media, baselineMedianLikes, outlierRatio, likesPerFollower, url}] と baselines
//   - outlierRatio = いいね ÷ その投稿者の普段の中央値。フォロワー数の影響を外した「中身の過剰反応」
//   - 他人の投稿本文を含むので、公開リポジトリにはコミットしない（data/ は .gitignore 済み）
// 前提: RapidAPI twitter-api45。約90リクエスト。設計は docs/buzz-reproducibility.md
const fs=require('fs'),path=require('path');const OUT=process.argv[2]||'data/experiments/buzz';fs.mkdirSync(OUT,{recursive:true});
const H={'x-rapidapi-key':process.env.RAPIDAPI_KEY,'x-rapidapi-host':'twitter-api45.p.rapidapi.com'};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let calls=0;
async function get(url){calls++;for(let i=0;i<3;i++){try{const r=await fetch(url,{headers:H});if(r.ok)return await r.json();console.error('http',r.status);}catch(e){console.error(e.message)}await sleep(3000)}return null}
const pick=x=>({id:x.tweet_id,text:x.text,created_at:x.created_at,likes:+x.favorites||0,rts:+x.retweets||0,replies:+x.replies||0,quotes:+x.quotes||0,bookmarks:+x.bookmarks||0,views:+x.views||0,
  author:x.screen_name||x.user_info?.screen_name,followers:x.user_info?.followers_count??null,media:x.media?Object.keys(x.media).filter(k=>(x.media[k]||[]).length):[],isReply:/^@/.test(x.text||''),url:`https://x.com/${x.screen_name}/status/${x.tweet_id}`});
(async()=>{
  const posts=new Map();
  for(const q of ['min_faves:10000 lang:ja since:2026-10-20 -filter:replies','min_faves:3000 lang:ja since:2026-10-27 -filter:replies']){
    let cursor=null;for(let p=0;p<8;p++){const d=await get(`https://twitter-api45.p.rapidapi.com/search.php?query=${encodeURIComponent(q)}&search_type=Top${cursor?`&cursor=${encodeURIComponent(cursor)}`:''}`);
      if(!d?.timeline?.length)break;for(const x of d.timeline){if(x.type&&x.type!=='tweet')continue;const o=pick(x);o.query=q;if(!posts.has(o.id))posts.set(o.id,o)}cursor=d.next_cursor;if(!cursor)break;await sleep(2000)}}
  console.error('posts',posts.size,'calls',calls);
  // baseline: author's recent timeline median likes (controls for audience size)
  const authors=[...new Set([...posts.values()].map(p=>p.author))].slice(0,70);const base={};
  for(const a of authors){const d=await get(`https://twitter-api45.p.rapidapi.com/timeline.php?screenname=${a}`);await sleep(2000);
    const tl=(d?.timeline||[]).filter(x=>!/^RT @/.test(x.text||'')).map(pick);if(!tl.length)continue;
    const likes=tl.map(t=>t.likes).sort((a,b)=>a-b);base[a]={n:tl.length,median:likes[Math.floor(likes.length/2)],followers:d?.user?.sub_count??d?.user?.followers_count??tl[0].followers,others:tl.filter(t=>!posts.has(t.id)).slice(0,20)}}
  for(const p of posts.values()){const b=base[p.author];p.baselineMedianLikes=b?.median??null;p.baselineN=b?.n??null;p.outlierRatio=b?.median?+(p.likes/Math.max(b.median,1)).toFixed(1):null;p.likesPerFollower=p.followers?+(p.likes/p.followers).toFixed(2):null}
  fs.writeFileSync(path.join(OUT,'corpus.json'),JSON.stringify({fetchedAt:new Date().toISOString(),source:'X search (twitter-api45 RapidAPI) Top, min_faves filters; author timelines for baseline',calls,posts:[...posts.values()],baselines:base},null,1));
  console.error('done calls',calls,'authors with baseline',Object.keys(base).length);
})();
