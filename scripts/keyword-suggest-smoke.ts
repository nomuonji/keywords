import assert from 'node:assert/strict';
import { keywordSuggestUrl, keywordSuggest } from '../packages/research/src/keyword-suggest.js';
import { keywordSuggestCommand } from '../packages/commands/src/keyword-suggest.js';
import { analyzeSerp } from '../packages/research/src/index.js';

assert.equal(keywordSuggestUrl({ GOOGLE_ADS_KEYWORD_VOLUME_API_URL: 'https://api.example.app/api/get-keyword-volumes' }), 'https://api.example.app/api/keyword-suggest');
assert.equal(keywordSuggestUrl({ KEYWORD_SUGGEST_API_URL: 'https://x.test/s', GOOGLE_ADS_KEYWORD_VOLUME_API_URL: 'https://api.example.app/a' }), 'https://x.test/s');
assert.equal(keywordSuggestUrl({}), null);

// Adapter normalizes proxy rows and drops malformed ones.
process.env.KEYWORD_SUGGEST_API_URL = 'https://proxy.test/api/keyword-suggest';
let sentBody: any = null;
const fakeFetch = (async (_url: unknown, init: any) => {
  sentBody = JSON.parse(init.body);
  return new Response(JSON.stringify({
    provider: 'keyword_suggest', fetchedAt: '2026-10-26T00:00:00.000Z', seeds: ['知育玩具'], sources: ['google', 'ads'], expand: 'kana', warnings: [],
    suggestions: [
      { keyword: '知育玩具 2歳', sources: ['google', 'youtube', 'bogus'], hits: 8, bestRank: 1, via: ['知育玩具', '知育玩具 に', 'x', 'y'], avgMonthlySearches: '4400' },
      { keyword: '知育玩具 いらない', sources: ['google'], hits: 1, bestRank: 6, via: ['知育玩具 い'] },
      { keyword: 'モンテッソーリ おもちゃ', sources: ['ads'], hits: 1, bestRank: 3, via: [], avgMonthlySearches: 9900, competitionIndex: 100, competitionLevel: 'HIGH' },
      { keyword: '知育玩具 中古', sources: ['bing'], hits: 1, bestRank: 2, via: ['bing_related:知育玩具'], bingMonthlyImpressions: 180, volumeSource: 'bing', matchesSeed: true },
      { sources: ['google'] }
    ]
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}) as typeof fetch;
const raw = await keywordSuggest({ seeds: ['知育玩具'], sources: ['google', 'ads'], modifierPreset: 'intent_ja' }, fakeFetch);
assert.equal(sentBody.modifierPreset, 'intent_ja');
assert.equal(raw.count, 4);
assert.equal(raw.suggestions[3].bingMonthlyImpressions, 180);
assert.equal(raw.suggestions[3].volumeSource, 'bing');
assert.equal(raw.suggestions[3].matchesSeed, true);
assert.equal('volumeSource' in raw.suggestions[0], false);
assert.deepEqual(raw.suggestions[0].sources, ['google', 'youtube']);
assert.equal(raw.suggestions[0].via.length, 3);
assert.equal(raw.suggestions[0].avgMonthlySearches, 4400);

// Command filters by hits but always keeps Ads ideas, then limits.
const command = await keywordSuggestCommand({ seeds: ['知育玩具'], sources: ['google', 'ads'], minHits: 2, limit: 5 }, { suggest: async () => raw });
assert.deepEqual(command.suggestions.map(row => row.keyword), ['知育玩具 2歳', 'モンテッソーリ おもちゃ', '知育玩具 中古']);
assert.equal(command.totalBeforeFilter, 4);
assert.equal(command.truncated, false);
await assert.rejects(() => keywordSuggestCommand({ seeds: [] }, { suggest: async () => raw }));
await assert.rejects(() => keywordSuggestCommand({ seeds: ['a'], sources: ['yahoo'] }, { suggest: async () => raw }));

// Proxy errors surface status and warnings.
const failing = (async () => new Response(JSON.stringify({ error: 'No suggestions could be fetched', warnings: ['Every autocomplete request failed.'] }), { status: 502 })) as typeof fetch;
await assert.rejects(() => keywordSuggest({ seeds: ['x'] }, failing), /502.*No suggestions.*Every autocomplete/);

// New request options pass schema validation.
await keywordSuggestCommand({ seeds: ['x'], expand: 'pre', position: 'both', adsMatch: 'any', includeVolumes: 'auto' }, { suggest: async () => raw });

// Degraded SERPs carry an explicit limitation.
const degraded = analyzeSerp({ query: 'メンズエステ 摘発', country: 'jp', language: 'ja', results: [], peopleAlsoAsk: [], relatedSearches: [], provider: 'api', degraded: true, fetchedAt: new Date().toISOString() });
assert.ok(degraded.limitations.some(item => item.startsWith('DEGRADED SERP')));

console.log('keyword suggest smoke ok');
