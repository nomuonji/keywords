import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { analyzeSerp } from '../packages/research/src/index.js';
import { buildGoogleAdsHistoricalMetricsPayload, googleAdsMonthNumber, normalizeGoogleAdsHistoricalResults } from '../api/google-ads-direct.js';
import { KEYWORDS_MCP_SERVER_VERSION, KEYWORDS_MCP_TOOL_NAMES } from '../api/mcp-contract.js';

assert.equal(KEYWORDS_MCP_SERVER_VERSION, '1.2.0');
assert.deepEqual([...KEYWORDS_MCP_TOOL_NAMES], [
  'remote_keyword_status',
  'keyword_demand_research',
  'serp_research',
  'serp_analyze',
  'keyword_treasury_save',
  'keyword_treasury_list'
]);
assert.equal(KEYWORDS_MCP_TOOL_NAMES.length, 6);

assert.equal(googleAdsMonthNumber('JANUARY'), 1);
assert.equal(googleAdsMonthNumber('SEPTEMBER'), 9);
assert.equal(googleAdsMonthNumber('12'), 12);

const metrics = normalizeGoogleAdsHistoricalResults([{
  text: 'ai 英会話 比較',
  keywordMetrics: {
    avgMonthlySearches: '880',
    competition: 'LOW',
    competitionIndex: '22',
    averageCpcMicros: '123456',
    lowTopOfPageBidMicros: '90000',
    highTopOfPageBidMicros: '180000',
    monthlySearchVolumes: [
      { year: '2026', month: 'AUGUST', monthlySearches: '1000' },
      { year: 2026, month: 'JULY', monthlySearches: 900 }
    ]
  }
}]);
assert.equal(metrics.length, 1);
assert.equal(metrics[0]?.averageCpcMicros, 123456);
assert.deepEqual(metrics[0]?.monthlySearchVolumes, [
  { year: 2026, month: 8, searches: 1000 },
  { year: 2026, month: 7, searches: 900 }
]);

const payload = buildGoogleAdsHistoricalMetricsPayload({ keywords: ['ai 英会話 比較'], languageId: '1005', geoTargetIds: ['2392'] });
assert.deepEqual(payload.historicalMetricsOptions, { includeAverageCpc: true });
assert.equal(payload.language, 'languageConstants/1005');
assert.deepEqual(payload.geoTargetConstants, ['geoTargetConstants/2392']);

const analysis = analyzeSerp({
  query: 'ai 英会話 比較',
  country: 'JP',
  language: 'ja',
  provider: 'brave',
  fetchedAt: new Date(0).toISOString(),
  peopleAlsoAsk: [],
  relatedSearches: [],
  results: [
    { position: 1, title: 'AI 英会話 比較 2026', link: 'https://example.com/a', domain: 'example.com', snippet: '2026年版' },
    { position: 2, title: 'AI英会話を使ってみた', link: 'https://note.com/a', domain: 'note.com', snippet: '2019年の記事' },
    { position: 3, title: 'おすすめ英会話', link: 'https://www.reddit.com/r/test', domain: 'reddit.com', snippet: null }
  ]
});
for (const key of ['exactTitleCount', 'weakDomainCount', 'forumCount', 'stalePageCount', 'opportunityScore'] as const) {
  assert.equal(typeof analysis[key], 'number');
}

const mcpSource = readFileSync(new URL('../api/mcp.ts', import.meta.url), 'utf8');
assert.match(mcpSource, /keyword:\s*z\.string\(\)/);
assert.match(mcpSource, /count:\s*z\.number\(\)/);
assert.match(mcpSource, /analysis:\s*analyzeSerp\(result\)/);
assert.match(mcpSource, /fallbackUsed:\s*true/);
assert.match(mcpSource, /directProviderError/);

console.log('remote MCP contract smoke passed');
