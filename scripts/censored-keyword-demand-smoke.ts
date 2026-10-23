import assert from 'node:assert/strict';
import {
  buildCalibration,
  censoredKeywordDemandEstimate,
  estimateFromBing,
  normalizeKey,
  ratioStats,
  termClass
} from '../packages/commands/src/censored-keyword-demand.js';
import { bingKeywordStatsUrl } from '../packages/research/src/bing-keyword-stats.js';

// Pure helpers
assert.equal(termClass('ソープランド'), 'head');
assert.equal(termClass('吉原 ソープ'), 'modified');
assert.equal(termClass('吉原　ソープ'), 'modified'); // full-width space
assert.equal(normalizeKey('エロ 動画'), normalizeKey('エロ動画'));
assert.deepEqual(ratioStats([]), null);
const stats = ratioStats([100, 200, 300, 400, 500]);
assert.equal(stats?.median, 300);
assert.equal(stats?.q1, 200);
assert.equal(stats?.q3, 400);
assert.deepEqual(estimateFromBing(10, stats), { mid: 3000, low: 2000, high: 4000, ratio: 300, anchorsUsed: 5 });
assert.equal(estimateFromBing(null, stats), null);

// Class-specific calibration needs >=3 anchors per class, otherwise falls back to all terms.
const calibration = buildCalibration([
  { keyword: 'a', termClass: 'head', source: 'google_ads', referenceMonthly: 1000, bingMonthly: 10, ratio: 100 },
  { keyword: 'b', termClass: 'head', source: 'google_ads', referenceMonthly: 1500, bingMonthly: 10, ratio: 150 },
  { keyword: 'c', termClass: 'head', source: 'google_ads', referenceMonthly: 2000, bingMonthly: 10, ratio: 200 },
  { keyword: 'd e', termClass: 'modified', source: 'google_ads', referenceMonthly: 5000, bingMonthly: 10, ratio: 500 }
]);
assert.equal(calibration.pick('head').basis, 'head_terms');
assert.equal(calibration.pick('head').stats?.median, 150);
assert.equal(calibration.pick('modified').basis, 'all_terms');
assert.equal(calibration.leaveOneOut.length, 4);

// URL derivation from the Google Ads proxy origin.
assert.equal(bingKeywordStatsUrl({ GOOGLE_ADS_KEYWORD_VOLUME_API_URL: 'https://api.example.app/api/get-keyword-volumes' }), 'https://api.example.app/api/bing-keyword-stats');
assert.equal(bingKeywordStatsUrl({ BING_KEYWORD_STATS_API_URL: 'https://x.test/b', GOOGLE_ADS_KEYWORD_VOLUME_API_URL: 'https://api.example.app/a' }), 'https://x.test/b');
assert.equal(bingKeywordStatsUrl({}), null);

// End-to-end with injected providers (numbers from a real 2026-10-23 JP run).
const google: Record<string, number> = {
  '吉原 ソープ': 201000, '雄琴 ソープ': 110000, '中洲 ソープ': 74000, 'すすきの ソープ': 74000,
  'メンエス': 246000, 'メンズ エステ': 450000, 'ピンサロ': 301000, 'ソープ': 201000, '吉原': 110000, 'ソープ 嬢': 12100
};
const bing: Record<string, number> = {
  '吉原 ソープ': 601, '雄琴 ソープ': 205, '中洲 ソープ': 114, 'すすきの ソープ': 232, 'メンエス': 1233,
  'メンズ エステ': 434, 'ピンサロ': 804, 'ソープ': 1175, '吉原': 928,
  'ソープランド': 2542, '風俗': 6151, '川崎 ソープ': 781, 'ちょんまげ ソープ': 50, 'ソープ 流れ': 40, 'ソープ 初めて': 30
};
let demandCalls = 0;
const result = await censoredKeywordDemandEstimate({
  keywords: ['ソープランド', '風俗', '川崎 ソープ', '風俗 求人', '吉原 ソープ'],
  gscSiteId: 'chonmage-ja'
}, {
  demand: async keywords => {
    demandCalls += 1;
    // Google Ads normalizes spacing in some answers; matching must survive that.
    return { results: keywords.map(keyword => ({ keyword: keyword === 'ソープ 嬢' ? 'ソープ嬢' : keyword, avgMonthlySearches: google[keyword] ?? 0 })) };
  },
  bing: async ({ keywords, country = 'jp', language = 'ja-JP' }) => ({
    provider: 'bing_webmaster_keyword_stats', country, language, fetchedAt: new Date().toISOString(),
    results: keywords.map(keyword => bing[keyword]
      ? { keyword, status: 'ok' as const, weeks: 22, firstWeek: '2026-04-25', lastWeek: '2026-10-17', monthlyImpressions: bing[keyword], monthlyBroadImpressions: bing[keyword], recentMonthlyImpressions: bing[keyword] }
      : { keyword, status: 'no_data' as const, weeks: 0, firstWeek: null, lastWeek: null, monthlyImpressions: null, monthlyBroadImpressions: null, recentMonthlyImpressions: null })
  }),
  gsc: async () => ({
    periodDays: 28, periodStart: '2026-09-20', periodEnd: '2026-10-17',
    rows: [
      { query: 'ちょんまげ ソープ', impressions: 1400, averagePosition: 1.2 },
      { query: 'ソープ 流れ', impressions: 2800, averagePosition: 2.5 },
      { query: 'ソープ 初めて', impressions: 1960, averagePosition: 2.9 },
      { query: 'ソープ 料金 相場', impressions: 5000, averagePosition: 8 }, // too low a position
      { query: '川崎 ソープ', impressions: 3000, averagePosition: 2 }
    ]
  })
});
assert.equal(demandCalls, 1);

const byKeyword = new Map(result.results.map(row => [row.keyword, row]));
const soapland = byKeyword.get('ソープランド')!;
assert.equal(soapland.googleAds.censored, true);
assert.equal(soapland.termClass, 'head');
assert.equal(soapland.anchorEstimate?.basis, 'head_terms');
assert.ok(soapland.anchorEstimate && soapland.anchorEstimate.low <= soapland.anchorEstimate.mid && soapland.anchorEstimate.mid <= soapland.anchorEstimate.high);
assert.equal(soapland.recommended.source, 'bing_gsc_calibrated');

const yoshiwara = byKeyword.get('吉原 ソープ')!;
assert.equal(yoshiwara.googleAds.censored, false);
assert.deepEqual(yoshiwara.recommended, { value: 201000, source: 'google_ads' });

const kawasaki = byKeyword.get('川崎 ソープ')!;
assert.equal(kawasaki.recommended.source, 'gsc_observed');
assert.equal(kawasaki.gscObserved?.monthlyImpressions, Math.round(3000 * 30 / 28));

const jobs = byKeyword.get('風俗 求人')!;
assert.equal(jobs.bing.status, 'no_data');
assert.deepEqual(jobs.recommended, { value: null, source: 'none' });

// Targets are never used as anchors; zero-volume anchors (ソープ 嬢 has no Bing data) are skipped.
const anchorKeywords = result.calibration.googleAdsAnchors?.anchors.map(anchor => anchor.keyword) ?? [];
assert.ok(!anchorKeywords.includes('吉原 ソープ'));
assert.ok(!anchorKeywords.includes('ソープ 嬢'));
assert.equal(anchorKeywords.length, 8);
assert.equal(result.calibration.gscAnchors?.anchors?.length, 3);
assert.ok(!result.calibration.gscAnchors?.anchors?.some(anchor => anchor.keyword === 'ソープ 料金 相場'));

console.log('censored-keyword-demand smoke ok');
