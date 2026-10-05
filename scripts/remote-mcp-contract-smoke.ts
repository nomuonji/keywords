import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { analyzeSerp } from '../packages/research/src/index.js';
import { parseBoothSearchHtml } from '../packages/research/src/marketplace.js';
import { parseGoogleTrendsRss, parseTikTokCreativeCenterHtml } from '../packages/research/src/market-sensors.js';
import { screenDemandResults, serpQuotaConfiguration } from '../packages/commands/src/remote-keyword-research.js';
import { buildGoogleAdsHistoricalMetricsPayload, buildGoogleAdsKeywordIdeasPayload, googleAdsMonthNumber, normalizeGoogleAdsHistoricalResults } from '../api/google-ads-direct.js';
import { KEYWORDS_MCP_SERVER_VERSION, KEYWORDS_MCP_TOOL_NAMES } from '../api/mcp-contract.js';
import { selectTrendSerpKeywords } from '../packages/commands/src/trend-article-research.js';

assert.equal(KEYWORDS_MCP_SERVER_VERSION, '1.10.0');
assert.deepEqual([...KEYWORDS_MCP_TOOL_NAMES], [
  'remote_keyword_status',
  'keyword_demand_research',
  'serp_research',
  'serp_analyze',
  'keyword_treasury_save',
  'keyword_treasury_list',
  'site_structure_list',
  'site_structure_get',
  'site_structure_save',
  'research_session_create',
  'research_session_get',
  'research_session_list',
  'research_session_update',
  'serp_usage_status',
  'keyword_treasury_search',
  'site_structure_patch',
  'keyword_screen_batch',
  'keyword_research_pipeline',
  'theme_research_context',
  'theme_candidate_upsert',
  'theme_candidate_challenge',
  'seo_source_pool_context',
  'seo_source_get',
  'seo_source_save',
  'seo_source_scan_record',
  'trend_article_research',
  'market_signal_scan',
  'marketplace_research',
  'search_gap_research'
]);
assert.equal(KEYWORDS_MCP_TOOL_NAMES.length, 29);

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

const ideasPayload = buildGoogleAdsKeywordIdeasPayload({ keywords: ['ai 英会話 比較'], languageId: '1005', geoTargetIds: ['2392'], includeAdultKeywords: false });
assert.deepEqual(ideasPayload.historicalMetricsOptions, { includeAverageCpc: true });
assert.deepEqual(ideasPayload.keywordSeed, { keywords: ['ai 英会話 比較'] });
assert.equal(ideasPayload.includeAdultKeywords, false);
assert.equal(ideasPayload.language, 'languageConstants/1005');
assert.deepEqual(ideasPayload.geoTargetConstants, ['geoTargetConstants/2392']);

const ideaMetrics = normalizeGoogleAdsHistoricalResults([{
  text: 'ai 英会話 比較',
  keywordIdeaMetrics: {
    avgMonthlySearches: 480,
    averageCpcMicros: 321000,
    monthlySearchVolumes: [{ year: 2026, month: 'AUGUST', monthlySearches: 520 }]
  }
}]);
assert.equal(ideaMetrics[0]?.averageCpcMicros, 321000);
assert.deepEqual(ideaMetrics[0]?.monthlySearchVolumes, [{ year: 2026, month: 8, searches: 520 }]);

const screening = screenDemandResults([
  { keyword: 'high value', avgMonthlySearches: 1000, averageCpcMicros: 2_000_000, competitionIndex: 20 },
  { keyword: 'low value', avgMonthlySearches: 10, averageCpcMicros: 50_000, competitionIndex: 80 }
], { minVolume: 100, minCpcMicros: 100_000, maxCompetitionIndex: 60 });
assert.deepEqual(screening.passedKeywords, ['high value']);
assert.deepEqual(screening.serpRecommended, ['high value']);
assert.ok(screening.results[0].screenScore > screening.results[1].screenScore);

const trendSerpSelection = selectTrendSerpKeywords(
  ['brand new launch', 'established query', 'another fresh query'],
  [
    { keyword: 'established query', avgMonthlySearches: 500, screenScore: 70 },
    { keyword: 'brand new launch', avgMonthlySearches: 0, screenScore: 5 },
    { keyword: 'another fresh query', avgMonthlySearches: 0, screenScore: 4 }
  ],
  2
);
assert.deepEqual(trendSerpSelection, ['established query', 'brand new launch']);

process.env.KEYWORDS_SERP_MONTHLY_LIMIT = '2000';
process.env.KEYWORDS_SERP_SOFT_LIMIT = '1500';
process.env.KEYWORDS_SERP_RESERVE = '500';
process.env.KEYWORDS_SERP_CACHE_TTL_DAYS = '30';
assert.deepEqual(serpQuotaConfiguration(), { monthlyLimit: 2000, softLimit: 1500, reserve: 500, cacheTtlDays: 30, normalCutoff: 1500 });

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

const boothListing = parseBoothSearchHtml(`
<html>
  <head>
    <meta name="description" content="VRChatの通販・ダウンロード商品は1,234件あります。VRChatに関連する商品のタグには、3D、衣装などがあります。">
  </head>
  <body>
    <b>対象商品 1,234 件</b><div id="js-market-result-pulldown"></div>
    <ul class="l-cards-5cols">
      <li data-product-id="101" data-product-brand="alpha" data-product-category="7" data-product-price="500">
        <a class="item-card__title-anchor--multiline">Sample Tool</a>
        <img class="js-thumbnail-image" data-original="https://booth.pximg.net/sample.jpg">
        <div class="item-card__shop-info">
          <a class="item-card__shop-name-anchor" href="https://sample.booth.pm/"><span class="item-card__shop-name">Sample Shop</span></a>
        </div>
      </li>
      <li data-product-id="102" data-product-brand="beta" data-product-category="8" data-product-price="1200">
        <a class="item-card__title-anchor--multiline">Second Tool</a>
        <div class="item-card__shop-info">
          <a class="item-card__shop-name-anchor" href="/"><span class="item-card__shop-name">Other Shop</span></a>
        </div>
      </li>
    </ul>
  </body>
</html>
`, { query: 'VRChat', sort: 'popularity', url: 'https://booth.pm/ja/search/VRChat?sort=popularity', maxProducts: 10 });
assert.equal(boothListing.resultCount, 1234);
assert.equal(boothListing.totalPages, 21);
assert.deepEqual(boothListing.relatedTags, ['3D', '衣装']);
assert.equal(boothListing.products.length, 2);
assert.equal(boothListing.products[0]?.title, 'Sample Tool');
assert.equal(boothListing.products[0]?.price, 500);
assert.equal(boothListing.products[0]?.shopName, 'Sample Shop');

const googleTrends = parseGoogleTrendsRss(`
<rss><channel>
  <item>
    <title><![CDATA[焼肉きんぐ]]></title>
    <ht:approx_traffic>50K+</ht:approx_traffic>
    <pubDate>Mon, 05 Oct 2026 08:00:00 GMT</pubDate>
    <link>https://trends.google.com/trending?geo=JP</link>
    <ht:news_item><ht:news_item_title><![CDATA[Sample related headline]]></ht:news_item_title></ht:news_item>
  </item>
</channel></rss>`, 'https://trends.google.com/trending/rss?geo=JP', 10);
assert.equal(googleTrends.length, 1);
assert.equal(googleTrends[0]?.label, '焼肉きんぐ');
assert.equal(googleTrends[0]?.metrics.approxTraffic, 50000);
assert.deepEqual(googleTrends[0]?.related, ['Sample related headline']);

const tiktokTrends = parseTikTokCreativeCenterHtml(`
<html><body>
  <div>Rank Hashtag Posts & Views Trends Creator Action</div>
  <div>1 #physics News & Entertainment 6.2K Posts 4.8M Views</div>
  <div>2 #animal Pets 3K Posts 8.1M Views</div>
</body></html>`, 'https://ads.tiktok.com/creative/creativeCenter/trends?region=JP', 10);
assert.equal(tiktokTrends.length, 2);
assert.equal(tiktokTrends[0]?.label, '#physics');
assert.equal(tiktokTrends[0]?.metrics.posts, 6200);
assert.equal(tiktokTrends[0]?.metrics.views, 4800000);

const mcpSource = readFileSync(new URL('../api/mcp.ts', import.meta.url), 'utf8');
assert.match(mcpSource, /forceRefresh:\s*z\.boolean\(\)/);
assert.match(mcpSource, /serpResearchCached/);
assert.match(mcpSource, /structuredContent/);
assert.match(mcpSource, /googleAdsDemandProviderOrder:\s*\['proxy', 'direct'\]/);
assert.match(mcpSource, /providerRoute:\s*'proxy'/);
assert.match(mcpSource, /providerRoute:\s*'direct_fallback'/);
assert.match(mcpSource, /keyword_screen_batch/);
assert.match(mcpSource, /maxSerpChecks/);
assert.match(mcpSource, /research_session_create/);
assert.match(mcpSource, /keyword_treasury_search/);
assert.match(mcpSource, /site_structure_patch/);
assert.match(mcpSource, /theme_research_context/);
assert.match(mcpSource, /theme_candidate_upsert/);
assert.match(mcpSource, /theme_candidate_challenge/);
assert.match(mcpSource, /seo_source_pool_context/);
assert.match(mcpSource, /seo_source_scan_record/);
assert.match(mcpSource, /trend_article_research/);
assert.match(mcpSource, /market_signal_scan/);
assert.match(mcpSource, /marketSensorCapabilities/);
assert.match(mcpSource, /marketplace_research/);
assert.match(mcpSource, /supportedMarketplaceAdapters/);
assert.match(mcpSource, /KEYWORDS_GROQ_MCP_TOKEN/);
assert.match(mcpSource, /x-api-key/);
assert.match(mcpSource, /groqStaticTokenConfigured/);

const trendArticleSource = readFileSync(new URL('../packages/commands/src/trend-article-research.ts', import.meta.url), 'utf8');
assert.match(trendArticleSource, /Zero-volume trend terms are not automatically rejected/);
assert.match(trendArticleSource, /existingPageMatches/);

const researchLedgerSource = readFileSync(new URL('../packages/commands/src/theme-research.ts', import.meta.url), 'utf8');
assert.match(researchLedgerSource, /whyStillAlive/);
assert.match(researchLedgerSource, /fatalRisks/);
assert.match(researchLedgerSource, /challengeHistory/);
assert.doesNotMatch(researchLedgerSource, /compositeScore|totalScore|rankingScore/);

const sourcePoolSource = readFileSync(new URL('../packages/commands/src/seo-source-pool.ts', import.meta.url), 'utf8');
assert.match(sourcePoolSource, /x_ezayan/);
assert.match(sourcePoolSource, /Source reputation is not evidence/);
assert.match(mcpSource, /does not fetch X or the web itself/i);

const treasurySource = readFileSync(new URL('../packages/keyword-treasury/src/index.ts', import.meta.url), 'utf8');
assert.match(treasurySource, /avgMonthlySearches/);
assert.match(treasurySource, /linkedSiteConceptIds/);
assert.match(treasurySource, /TREASURY_SEARCH_SCAN_LIMIT/);

console.log('remote MCP contract smoke passed');
