// 指定したキーワードの検索ボリュームを直接測る（Google Ads generateKeywordHistoricalMetrics）
//
// 使い方:
//   cd D:\youph\keywords
//   node --env-file=.env --import tsx/esm scripts/kw-volumes.ts "KW1" "KW2" "KW3"
//
// 出力: provider / customerId / count / rows[{keyword, volume, competition, competitionIndex, cpcYen, bidLowYen, bidHighYen}]
//   - 成人向け・センシティブ語は Google 側で censored になり volume=null で返る（0 ではない）
//   - 一度に最大50語
import { googleAdsKeywordHistoricalMetrics } from '@keywords/research';

const keywords = process.argv.slice(2);
if (!keywords.length) {
  console.error('usage: kw-volumes.ts <keyword> [keyword...]');
  process.exit(1);
}

const result: any = await googleAdsKeywordHistoricalMetrics({
  keywords,
  languageId: '1005',
  geoTargetIds: ['2392'],
});

const rows = (result.results ?? []).map((r: any) => ({
  keyword: r.text,
  volume: r.avgMonthly,
  competition: r.competition,
  competitionIndex: r.competitionIndex,
  cpcYen: r.averageCpcMicros ? Math.round(r.averageCpcMicros / 1_000_000) : null,
  // historical metrics は averageCpc を返さないことが多い。広告主が上位表示に払う入札レンジで代替する
  bidLowYen: r.lowTopOfPageBidMicros ? Math.round(r.lowTopOfPageBidMicros / 1_000_000) : null,
  bidHighYen: r.highTopOfPageBidMicros ? Math.round(r.highTopOfPageBidMicros / 1_000_000) : null,
}));

console.log(JSON.stringify({ provider: result.provider, customerId: result.customerId, count: rows.length, rows }, null, 1));
