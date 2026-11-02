// SERPの「弱さ」を採点する（Brave Search API 直叩き）
//
// 使い方:
//   cd D:\youph\keywords
//   node --env-file=.env --import tsx/esm scripts/serp-score.ts "KW1" ["KW2" ...]
//
// 出力: 1〜10位の position / domain / weak / big / title一致 と weakScore（0-10）
//   weak  = 知恵袋・note・個人ブログ・X/YouTube などの弱い枠、またはタイトル不一致
//   big   = go.jp / 主要メディア・EC など、勝ち目が薄い枠
//
// 判定の目安（niche-keyword-finder 準拠）:
//   8-10 かつ big が2枠以下 → 突撃 / 5-7 → 条件付き / 〜4 or bigが上位占有 → 見送り
//   ※ スコアが高くても「そのクエリ専用ページ」を量産している領域は飽和。1ページ目に
//      クエリそのもののタイトルが2件以上あれば見送る
//
// レート制限: Brave 無料枠は 1req/秒・月2000回。連続実行時は 3〜4 秒あける
import { searchSerp } from '@keywords/research';

const queries = process.argv.slice(2);
if (!queries.length) {
  console.error('usage: serp-score.ts <query> [query...]');
  process.exit(1);
}

const WEAK_DOMAIN = /(chiebukuro\.yahoo\.co\.jp|oshiete\.goo\.jp|reddit\.com|5ch\.net|x\.com|twitter\.com|instagram\.com|youtube\.com|note\.com|hatenablog\.com|hatena\.ne\.jp|ameblo\.jp|wordpress\.com|blog\.|livedoor\.blog|seesaa\.net|fc2\.com)/i;
const BIG = /(\.go\.jp|\.or\.jp|amazon\.co\.jp|rakuten\.co\.jp|kakaku\.com|nikkei\.com|toyokeizai\.net|diamond\.jp|president\.jp)/i;

const norm = (s: string) => s.replace(/[\s\u3000]+/g, '').toLowerCase();

for (const query of queries) {
  try {
    const snap: any = await searchSerp({ query, provider: 'brave', num: 10, country: 'JP', language: 'ja' });
    const results = snap?.results ?? [];
    const q = norm(query);
    let score = 0;
    const rows = results.map((r: any) => {
      const weakDomain = WEAK_DOMAIN.test(r.domain || r.link || '');
      const bigDomain = BIG.test(r.domain || r.link || '');
      const titleHit = norm(String(r.title || '')).includes(q);
      const weak = weakDomain || !titleHit;
      if (weak && !bigDomain) score += 1;
      return {
        pos: r.position,
        domain: r.domain,
        weak: weak ? 1 : 0,
        big: bigDomain ? 1 : 0,
        titleHit: titleHit ? 1 : 0,
        title: String(r.title || '').slice(0, 46),
      };
    });
    console.log('\n=== ' + query + ' | provider=' + (snap?.provider ?? '?') + ' | results=' + rows.length + ' | weakScore=' + score + '/10 ===');
    rows.forEach((r: any) => console.log(`${String(r.pos).padStart(2)} | ${r.domain} | weak=${r.weak} big=${r.big} title=${r.titleHit} | ${r.title}`));
  } catch (e: any) {
    console.log('\n=== ' + query + ' | ERROR: ' + (e?.message ?? e) + ' ===');
  }
}
