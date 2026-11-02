// 下書き候補を本人が採用／不採用／直す で仕分けるローカル画面
//
// 使い方:
//   cd D:\youph\keywords
//   node scripts/draft-review-server.cjs <candidates.json> [port]   → http://127.0.0.1:8799
//
// 入力: { setId, format?, items: [{ n, text, source?, rank? }] }。rank_result.json が同じフォルダにあれば審査役の p も出す
// 出力: 同じフォルダの ratings-<setId>.json（{ [n]: good|bad|hold, comment, _updatedAt }）。押した瞬間に保存する
//   - 採用された候補だけを Tweets の create_drafts に渡す。この画面は投稿しない
const http = require('http');
const fs = require('fs');
const path = require('path');

const setFile = process.argv[2];
const port = Number(process.argv[3] || 8799);
if (!setFile) {
  console.error('usage: draft-review-server.cjs <candidates.json> [port]');
  process.exit(1);
}
const set = JSON.parse(fs.readFileSync(setFile, 'utf8'));
const dir = path.dirname(setFile);
const ratingsFile = path.join(dir, `ratings-${set.setId}.json`);
const rankFile = path.join(dir, 'rank_result.json');
const rank = fs.existsSync(rankFile) ? JSON.parse(fs.readFileSync(rankFile, 'utf8')) : null;
const rankOf = new Map((rank?.ranked ?? []).map(row => [row.n, row]));
const items = [...set.items].sort((a, b) => (rankOf.get(b.n)?.p ?? -1) - (rankOf.get(a.n)?.p ?? -1));

const esc = value => String(value ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
const readRatings = () => (fs.existsSync(ratingsFile) ? JSON.parse(fs.readFileSync(ratingsFile, 'utf8')) : {});

const page = () => {
  const ratings = readRatings();
  const header = rank
    ? `審査役の精度（伏せて混ぜた既知の投稿での AUC）: ${rank.auc?.toFixed(3)}${rank.trusted ? '' : '（低いので順位は参考にしない）'}。並びは審査役の p の高い順`
    : '審査役の順位はまだ無い';
  return `<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8"><title>${esc(set.setId)}</title><style>
body{font-family:system-ui,"Yu Gothic UI",sans-serif;max-width:860px;margin:32px auto;padding:0 16px;color:#1d1d1f;background:#fafaf7}h1{font-size:19px}
p.note{color:#555;font-size:13px;line-height:1.6}.card{background:#fff;border:1px solid #e3e3df;border-radius:10px;padding:14px 16px;margin:10px 0;display:grid;grid-template-columns:1fr auto;gap:10px}
.text{font-size:15px;white-space:pre-wrap;line-height:1.7}.meta{font-size:12px;color:#777;margin-top:6px}.btns{display:flex;flex-direction:column;gap:6px}
button{border:1px solid #ccc;background:#fff;border-radius:6px;padding:6px 12px;cursor:pointer}button.on.good{background:#1f8a4c;color:#fff}button.on.bad{background:#b3261e;color:#fff}button.on.hold{background:#666;color:#fff}
#sum{position:sticky;top:0;background:#fafaf7;padding:8px 0;font-size:13px;border-bottom:1px solid #e3e3df}textarea{width:100%;height:70px;margin-top:8px}</style></head><body>
<h1>${esc(set.setId)}</h1><p class="note">${esc(set.format || '')}<br>${esc(header)}</p><div id="sum"></div>
${items.map(item => {
  const scored = rankOf.get(item.n);
  return `<div class="card"><div><div class="text">${esc(item.text)}</div><div class="meta">#${item.n} ・ ${String(item.text).length}字${scored ? ` ・ 審査役 p=${scored.p}（${esc(scored.why)}）` : ''}${item.source ? ` ・ <a href="${esc(item.source)}" target="_blank">元の投稿</a>` : ''}</div></div>
<div class="btns">${[['good', '採用'], ['bad', '不採用'], ['hold', '直す']].map(([key, label]) => `<button class="${key}${ratings[item.n] === key ? ' on' : ''}" onclick="rate(${item.n},'${key}',this)">${label}</button>`).join('')}</div></div>`;
}).join('')}
<p class="note">全体へのひとこと・直したい点（自動保存）</p><textarea onchange="rate('comment',this.value)">${esc(ratings.comment)}</textarea>
<script>function sum(){const on=[...document.querySelectorAll('button.on')];const c=k=>on.filter(b=>b.classList.contains(k)).length;document.getElementById('sum').textContent='仕分け済み '+on.length+' / ${items.length} ・ 採用 '+c('good')+' ・ 不採用 '+c('bad')+' ・ 直す '+c('hold')}
async function rate(n,k,b){if(b){b.parentNode.querySelectorAll('button').forEach(x=>x.classList.remove('on'));b.classList.add('on');sum()}
await fetch('/rate',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({n,k})})}sum();</script></body></html>`;
};

http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/rate') {
    let body = '';
    req.on('data', chunk => (body += chunk));
    req.on('end', () => {
      const { n, k } = JSON.parse(body);
      const ratings = readRatings();
      ratings[n] = k;
      ratings._updatedAt = new Date().toISOString();
      fs.writeFileSync(ratingsFile, JSON.stringify(ratings, null, 1));
      res.end('ok');
    });
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(page());
}).listen(port, '127.0.0.1', () => console.log(`http://127.0.0.1:${port}`));
