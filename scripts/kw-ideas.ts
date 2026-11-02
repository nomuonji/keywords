// キーワード候補の展開（Google Ads generateKeywordIdeas 直叩き）
//
// 使い方（必ず keywords リポジトリ直下で、.env を読ませて実行する）:
//   cd D:\youph\keywords
//   node --env-file=.env --import tsx/esm scripts/kw-ideas.ts "シード1" "シード2"
//
// 出力: volume / competition / idx（competitionIndex）付きの候補30件（JSON）
//   - 語間の空白は詰めて出力する（Googleが勝手に入れるトークン区切りを除去）
//   - volume >= 30 のみ。成人向けは Google 側で censored になり null が返る
//
// 前提: .env の ADS_* （DEVTOKEN / CLIENT_ID / CLIENT_SECRET / REFRESH_TOKEN / CUSTOMER_ID）
//       顧客IDが CUSTOMER_NOT_ENABLED の場合は .env の ADS_CUSTOMER_ID を有効なCIDに変える
import { googleAdsKeywordIdeas } from '@keywords/research';

const seeds = process.argv.slice(2);
if (!seeds.length) {
  console.error('usage: kw-ideas.ts <seed> [seed...]');
  process.exit(1);
}

const norm = (s: string) => s.replace(/\s+/g, '').trim();

const result: any = await googleAdsKeywordIdeas({
  seedKeywords: seeds,
  languageId: '1005',
  geoTargetIds: ['2392'],
  network: 'GOOGLE_SEARCH',
});

const rows = (result.ideas ?? [])
  .map((r: any) => ({
    keyword: norm(String(r.text ?? '')),
    volume: r.avgMonthly,
    competition: r.competition,
    idx: r.competitionIndex,
  }))
  .filter((r: any) => r.keyword.length >= 4 && typeof r.volume === 'number' && r.volume >= 30)
  .sort((a: any, b: any) => {
    const scoreA = (b.volume ?? 0) / (1 + (a.idx ?? 50) / 10);
    const scoreB = (a.volume ?? 0) / (1 + (b.idx ?? 50) / 10);
    return scoreB - scoreA;
  })
  .slice(0, 30);

console.log(JSON.stringify({ seeds, total: (result.ideas ?? []).length, rows }, null, 1));
