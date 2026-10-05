import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { analyzeSerp } from '../packages/research/src/index.js';
import { parseBoothSearchHtml } from '../packages/research/src/marketplace.js';
import { parseGoogleTrendsRss, parseHackerNewsAlgolia, parseTikTokCreativeCenterHtml } from '../packages/research/src/market-sensors.js';
import { screenDemandResults, serpQuotaConfiguration } from '../packages/commands/src/remote-keyword-research.js';
import { buildGoogleAdsHistoricalMetricsPayload, buildGoogleAdsKeywordIdeasPayload, googleAdsMonthNumber, normalizeGoogleAdsHistoricalResults } from '../api/google-ads-direct.js';
import { KEYWORDS_MCP_SERVER_VERSION, KEYWORDS_MCP_TOOL_NAMES } from '../api/mcp-contract.js';
import { selectTrendSerpKeywords } from '../packages/commands/src/trend-article-research.js';
import { attachQuerySignalsToIntentTree, buildQueryIntentTree, classifyMarketIntent, compareMarketPackets, extractMarketingMechanics, parseTikTokTopAdsHtml } from '../packages/commands/src/market-intelligence.js';

assert.equal(KEYWORDS_MCP_SERVER_VERSION, '1.14.0');
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
  'market_intelligence_research',
  'market_signal_snapshot_save',
  'market_signal_snapshot_compare',
  'marketplace_research',
  'search_gap_research'
]);
assert.equal(KEYWORDS_MCP_TOOL_NAMES.length, 32);

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


const hnQuery = parseHackerNewsAlgolia({
  hits: [
    {
      title: 'Local AI security proxy',
      objectID: '123',
      points: 87,
      num_comments: 31,
      created_at: '2026-10-05T12:00:00.000Z'
    }
  ]
}, 'https://hn.algolia.com/api/v1/search?query=AI%20security&tags=story', 10);
assert.equal(hnQuery.length, 1);
assert.equal(hnQuery[0]?.label, 'Local AI security proxy');
assert.equal(hnQuery[0]?.metrics.score, 87);
assert.equal(hnQuery[0]?.metrics.comments, 31);
assert.equal(hnQuery[0]?.metrics.queryMatch, true);
assert.match(hnQuery[0]?.url ?? '', /news\.ycombinator\.com\/item\?id=123/);


assert.equal(classifyMarketIntent('AI Security 株式会社', 'AI security').primaryIntent, 'entity');
assert.equal(classifyMarketIntent('AI Security 株式 会社', 'AI security').primaryIntent, 'entity');
assert.equal(classifyMarketIntent('AI Security 合同 会社', 'AI security').primaryIntent, 'entity');
assert.ok(!classifyMarketIntent('AI Security株式会社', 'AI security').secondaryIntents.includes('investment'));
assert.ok(!classifyMarketIntent('AI Security 株式 会社', 'AI security').secondaryIntents.includes('investment'));
assert.notEqual(classifyMarketIntent('Security Incident INC-2026-07-28-01 – UK AI Security Institute', 'AI security').primaryIntent, 'entity');
assert.equal(classifyMarketIntent('AIセキュリティ銘柄', 'AI security').primaryIntent, 'investment');
assert.equal(classifyMarketIntent('AIセキュリティ資格', 'AI security').primaryIntent, 'career_qualification');
assert.equal(classifyMarketIntent('生成AIセキュリティ対策', 'AI security').primaryIntent, 'solution_product');
assert.equal(classifyMarketIntent('AIセキュリティ問題', 'AI security').primaryIntent, 'problem_need');
assert.equal(classifyMarketIntent('AIセキュリティガイドライン', 'AI security').primaryIntent, 'research_information');
assert.equal(classifyMarketIntent('AI security', 'AI security').primaryIntent, 'ambiguous');

const intentTree = buildQueryIntentTree({
  query: 'AI security',
  relatedSearches: [
    'AI Security 株式会社',
    'AIセキュリティ問題',
    'AIセキュリティ銘柄',
    'AIセキュリティ資格',
    'AIセキュリティ対策',
    'AIセキュリティガイドライン'
  ],
  peopleAlsoAsk: [
    'AI Securityはどのような会社ですか？',
    'AIセーフティとAIセキュリティの違いは何ですか？'
  ],
  topResults: [
    { position: 1, title: 'AI Security株式会社 会社概要', link: 'https://entity.example/', snippet: '企業情報' },
    { position: 2, title: '生成AIのセキュリティ対策', link: 'https://market.example/', snippet: '情報漏洩を防止する方法' }
  ],
  demand: [
    { keyword: 'AI security', avgMonthlySearches: 390, averageCpcMicros: 1000, competition: 0.3, competitionIndex: 30, monthlySearchVolumes: [] },
    { keyword: 'AIセキュリティ問題', avgMonthlySearches: 140, averageCpcMicros: 900, competition: 0.4, competitionIndex: 40, monthlySearchVolumes: [] },
    { keyword: 'AIセキュリティ銘柄', avgMonthlySearches: 170, averageCpcMicros: null, competition: 0.1, competitionIndex: 10, monthlySearchVolumes: [] },
    { keyword: 'AIセキュリティ資格', avgMonthlySearches: 140, averageCpcMicros: 800, competition: 0.1, competitionIndex: 10, monthlySearchVolumes: [] },
    { keyword: 'AIセキュリティ対策', avgMonthlySearches: 480, averageCpcMicros: 1200, competition: 0.5, competitionIndex: 50, monthlySearchVolumes: [] }
  ]
});
assert.deepEqual(intentTree.targetIntents, ['problem_need', 'solution_product', 'how_to', 'commercial']);
assert.equal(intentTree.mixedIntent, true);
assert.equal(intentTree.senseSelectionRequired, true);
assert.ok(intentTree.senseGuidance.some(item => item.includes('semantic sense')));
assert.equal(intentTree.branches.find(branch => branch.intent === 'entity')?.role, 'out_of_scope');
assert.equal(intentTree.branches.find(branch => branch.intent === 'investment')?.role, 'adjacent_market');
assert.equal(intentTree.branches.find(branch => branch.intent === 'career_qualification')?.role, 'adjacent_market');
assert.equal(intentTree.branches.find(branch => branch.intent === 'solution_product')?.role, 'primary');
assert.equal(intentTree.branches.find(branch => branch.intent === 'problem_need')?.role, 'primary');
assert.equal(intentTree.branches.find(branch => branch.intent === 'research_information')?.role, 'contextual');
assert.ok(intentTree.primaryEvidenceKeywords.includes('AIセキュリティ対策'));
assert.ok(!intentTree.primaryEvidenceKeywords.includes('AIセキュリティ銘柄'));
assert.ok(intentTree.excludedFromPrimaryThesis.some(item => item.label === 'AI Security 株式会社' && item.intent === 'entity'));


const qualificationTree = buildQueryIntentTree({
  query: 'AIセキュリティ資格',
  relatedSearches: ['AIセキュリティ資格 難易度', 'AIセキュリティ対策'],
  peopleAlsoAsk: [],
  topResults: [],
  demand: []
});
assert.deepEqual(qualificationTree.targetIntents, ['career_qualification']);
assert.equal(qualificationTree.senseSelectionRequired, false);
assert.equal(qualificationTree.branches.find(branch => branch.intent === 'career_qualification')?.role, 'primary');
assert.equal(qualificationTree.branches.find(branch => branch.intent === 'solution_product')?.role, 'contextual');

const investmentTree = buildQueryIntentTree({
  query: 'AIセキュリティ銘柄',
  relatedSearches: ['AIセキュリティ銘柄 日本', 'AIセキュリティ対策'],
  peopleAlsoAsk: [],
  topResults: [],
  demand: []
});
assert.deepEqual(investmentTree.targetIntents, ['investment']);
assert.equal(investmentTree.branches.find(branch => branch.intent === 'investment')?.role, 'primary');
assert.equal(investmentTree.branches.find(branch => branch.intent === 'solution_product')?.role, 'contextual');

const entityTree = buildQueryIntentTree({
  query: 'AI Security株式会社',
  relatedSearches: ['AI Security株式会社 評判', 'AIセキュリティ対策'],
  peopleAlsoAsk: [],
  topResults: [],
  demand: []
});
assert.deepEqual(entityTree.targetIntents, ['entity']);
assert.equal(entityTree.branches.find(branch => branch.intent === 'entity')?.role, 'primary');

const intentQueryFocus: any = {
  mode: 'hypothesis_led',
  query: 'AI security',
  searchSurface: { source: 'serp', query: 'AI security', relatedSearches: [], peopleAlsoAsk: [], topResults: [], cacheHit: true, warnings: [] },
  searchDemand: { source: 'google_ads', query: 'AI security', researchedKeywords: [], results: [], warnings: [] },
  intentTree
};
const enrichedIntent = attachQuerySignalsToIntentTree(intentQueryFocus, {
  fetchedAt: '2026-10-06T00:00:00.000Z',
  geo: 'JP',
  sourcesRequested: ['hacker_news'],
  sourcesSucceeded: ['hacker_news'],
  warnings: [],
  interpretationGuardrails: [],
  results: [{
    source: 'hacker_news',
    url: 'https://hn.algolia.com/',
    signalKind: ['query_relevant_early_adopter_attention'],
    warnings: [],
    observations: [
      { source: 'hacker_news', rank: 1, label: 'AI security tool for local agents', url: 'https://example.com/tool', category: 'story', observedAt: null, metrics: { score: 20 }, related: [] },
      { source: 'hacker_news', rank: 2, label: 'AI security stocks rally', url: 'https://example.com/stocks', category: 'story', observedAt: null, metrics: { score: 10 }, related: [] }
    ]
  }]
});
assert.equal(enrichedIntent.intentTree.branches.find((branch: any) => branch.intent === 'solution_product')?.externalSignals.length, 1);
assert.equal(enrichedIntent.intentTree.branches.find((branch: any) => branch.intent === 'investment')?.externalSignals.length, 1);
assert.ok(enrichedIntent.intentTree.excludedFromPrimaryThesis.some((item: any) => item.label === 'AI security stocks rally' && item.intent === 'investment'));


const topAds = parseTikTokTopAdsHtml(`
<html><body>
  <div>34K Likes Top 21%CTR High Budget Showcase a real-time comparison between products, while communicating superiority. See analysis</div>
  <div>37K Likes Top 15%CTR High Budget The video starts with a disturbing situation and introduces the product as a solution. See analysis</div>
</body></html>`, 'https://ads.tiktok.com/business/creativecenter/tiktok-topads-spotlight/pc/en', 10);
assert.equal(topAds.length, 2);
assert.equal(topAds[0]?.likes, 34000);
assert.equal(topAds[0]?.ctrTopPercent, 21);
assert.deepEqual(topAds[0]?.mechanics, ['comparison', 'demonstration']);
assert.ok(topAds[1]?.mechanics.includes('problem_solution'));
assert.deepEqual(extractMarketingMechanics('A testimonial compares two products and shows the solution in action.'), ['comparison', 'social_proof', 'problem_solution', 'demonstration']);

const leftPacket: any = {
  fetchedAt: '2026-10-01T00:00:00.000Z', query: 'habit tracker', geo: 'JP',
  signals: { results: [{ source: 'google_trends', observations: [{ label: 'habit tracker', metrics: { approxTraffic: 1000 } }] }] },
  creativeEvidence: { observations: [] }, pinterest: { observations: [] }, commercialization: { observations: [] }
};
const rightPacket: any = {
  fetchedAt: '2026-10-02T00:00:00.000Z', query: 'habit tracker', geo: 'JP',
  signals: { results: [{ source: 'google_trends', observations: [{ label: 'habit tracker', metrics: { approxTraffic: 1800 } }, { label: 'new entrant', metrics: { approxTraffic: 500 } }] }] },
  creativeEvidence: { observations: [] }, pinterest: { observations: [] }, commercialization: { observations: [] }
};
const packetDelta = compareMarketPackets(leftPacket, rightPacket);
assert.equal(packetDelta.sourceSummary.google_trends?.added, 1);
assert.equal(packetDelta.sourceSummary.google_trends?.changed, 1);
assert.equal(packetDelta.velocityHighlights[0]?.delta, 800);

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
assert.match(mcpSource, /market_intelligence_research/);
assert.match(mcpSource, /hypothesis-led mode/);
assert.match(mcpSource, /google_ads_query_demand/);
assert.match(mcpSource, /intentDecomposition/);
assert.match(mcpSource, /thesisUsesPrimaryBranchOnly/);
assert.match(mcpSource, /semanticSenseSelectionForAmbiguousQueries/);
assert.match(mcpSource, /appStoreEvidenceScope/);
assert.match(mcpSource, /market_signal_snapshot_save/);
assert.match(mcpSource, /market_signal_snapshot_compare/);
assert.match(mcpSource, /marketSensorCapabilities/);
assert.match(mcpSource, /marketplace_research/);
assert.match(mcpSource, /supportedMarketplaceAdapters/);
assert.match(mcpSource, /KEYWORDS_GROQ_MCP_TOKEN/);
assert.match(mcpSource, /x-api-key/);
assert.match(mcpSource, /groqStaticTokenConfigured/);

const trendArticleSource = readFileSync(new URL('../packages/commands/src/trend-article-research.ts', import.meta.url), 'utf8');
assert.match(trendArticleSource, /Zero-volume trend terms are not automatically rejected/);
assert.match(trendArticleSource, /existingPageMatches/);

const marketIntelligenceSource = readFileSync(new URL('../packages/commands/src/market-intelligence.ts', import.meta.url), 'utf8');
assert.match(marketIntelligenceSource, /queryFocusedResearch/);
assert.match(marketIntelligenceSource, /sources: query \? \['hacker_news'\]/);
assert.match(marketIntelligenceSource, /relatedSearches/);
assert.match(marketIntelligenceSource, /keywordDemand/);
assert.match(marketIntelligenceSource, /query_search_demand/);
assert.match(marketIntelligenceSource, /query_search_surface/);
assert.match(marketIntelligenceSource, /descriptionExcerpt/);
assert.match(marketIntelligenceSource, /lexical_search_only/);
assert.match(marketIntelligenceSource, /senseSelectionRequired/);

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
