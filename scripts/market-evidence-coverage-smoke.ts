import assert from 'node:assert/strict';
import {
  assessMarketEvidenceCoverage,
  extractSocialFormatSignals,
  parseIndexedSocialSnippetMetrics,
  parseTikTokPublicMetrics,
  parseYouTubePublicMetrics,
  type SocialContentResearchResult
} from '../packages/commands/src/market-social-research.js';
import { clusterObservedSocialMarkets, extractContextualObservedMarketClusterLabels, extractObservedMarketClusterLabels, mergeBroadDiscoveryObservations, selectBroadValidationClusters } from '../packages/commands/src/market-intelligence.js';

function social(overrides: Partial<SocialContentResearchResult> = {}): SocialContentResearchResult {
  return {
    source: 'serp_indexed_social_content',
    evidenceScope: 'public_index_plus_best_effort_public_page_metrics',
    query: '海外旅行 eSIM おすすめ',
    platformsRequested: ['tiktok', 'youtube_shorts'],
    platformsObserved: [],
    observations: [],
    formatSummary: [],
    platformStatus: [],
    warnings: [],
    guidance: [],
    ...overrides
  };
}

const discoveredLabels = extractObservedMarketClusterLabels({
  title: 'メンズ洗顔料🫧20商品を比較！本当におすすめTOP3 #メンズ洗顔料 #メンズスキンケア #買ってよかった',
  snippet: 'ドラッグストアで買える洗顔料を比較'
});
assert.ok(discoveredLabels.includes('メンズ洗顔料'));
assert.ok(discoveredLabels.includes('メンズスキンケア'));
assert.ok(!discoveredLabels.includes('買ってよかった'));

const contextualLabels = extractContextualObservedMarketClusterLabels({
  title: '絵伝言ゲームやってみた！ #shorts',
  snippet: null
});
assert.deepEqual(contextualLabels, ['絵伝言ゲーム']);

const hashtagOnlyNoise = clusterObservedSocialMarkets([
  {
    platform: 'tiktok',
    searchQuery: 'site:tiktok.com やめてよかった',
    position: 1,
    title: '人生で一番やめてよかったこと #孫GONG',
    url: 'https://www.tiktok.com/@example/video/noise1',
    snippet: null,
    formatSignals: [],
    metrics: { views: 10000, likes: 500, comments: 10, shares: 2 },
    metricProvenance: 'tiktok_public_page'
  },
  {
    platform: 'tiktok',
    searchQuery: 'site:tiktok.com やめてよかった',
    position: 2,
    title: '孫GONG 名言集 #孫GONG',
    url: 'https://www.tiktok.com/@example/video/noise2',
    snippet: null,
    formatSignals: [],
    metrics: { views: 9000, likes: 400, comments: 8, shares: 1 },
    metricProvenance: 'tiktok_public_page'
  }
]);
assert.equal(hashtagOnlyNoise.length, 0, 'Repeated hashtags without contextual phrase evidence must not become market clusters.');

const anchoredSingle = clusterObservedSocialMarkets([{
  platform: 'tiktok',
  searchQuery: 'site:tiktok.com やめてよかった',
  position: 1,
  title: '株をやめてよかった人の特徴',
  url: 'https://www.tiktok.com/@example/video/stocks1',
  snippet: null,
  formatSignals: [],
  metrics: { views: 120000, likes: 1500, comments: 30, shares: 12 },
  metricProvenance: 'tiktok_public_page'
}]);
assert.equal(anchoredSingle[0]?.label, '株');
assert.equal(anchoredSingle[0]?.contextualEvidenceCount, 1);

const discoveredClusters = clusterObservedSocialMarkets([
  {
    platform: 'tiktok',
    searchQuery: 'site:tiktok.com "買ってよかった" おすすめ',
    position: 1,
    title: '2026年買ってよかったガジェット5選 #ガジェット #デスク周り',
    url: 'https://www.tiktok.com/@example/video/10',
    snippet: null,
    formatSignals: ['listicle'],
    metrics: { views: 100000, likes: 4000, comments: 30, shares: 10 },
    metricProvenance: 'tiktok_public_page'
  },
  {
    platform: 'youtube_shorts',
    searchQuery: 'site:youtube.com/shorts "買ってよかった" おすすめ',
    position: 1,
    title: '買ってよかったガジェット3選 #ガジェット',
    url: 'https://www.youtube.com/shorts/gadget',
    snippet: null,
    formatSignals: ['listicle'],
    metrics: { views: 50000, likes: null, comments: null, shares: null },
    metricProvenance: 'youtube_public_page'
  },
  {
    platform: 'tiktok',
    searchQuery: 'site:tiktok.com "おすすめ" 比較 商品',
    position: 2,
    title: '旅行におすすめな便利グッズ3選 #旅行グッズ #海外旅行',
    url: 'https://www.tiktok.com/@example/video/11',
    snippet: null,
    formatSignals: ['listicle'],
    metrics: { views: 70000, likes: 2000, comments: 8, shares: 15 },
    metricProvenance: 'tiktok_public_page'
  }
]);
const gadgetCluster = discoveredClusters.find(item => item.label.toLowerCase() === 'ガジェット');
assert.ok(gadgetCluster);
assert.equal(gadgetCluster?.platforms.length, 2);
assert.equal(gadgetCluster?.evidenceCount, 2);
assert.ok((gadgetCluster?.contextualEvidenceCount ?? 0) >= 1);

const genericFormatLabels = extractObservedMarketClusterLabels({
  title: '2026年上半期 買ってよかったものランキング #買ってよかったもの #おすすめ商品',
  snippet: '人気商品を紹介'
});
assert.ok(!genericFormatLabels.includes('買ってよかったもの'));
assert.ok(!genericFormatLabels.includes('おすすめ商品'));

const productionLikeNoiseLabels = extractObservedMarketClusterLabels({
  title: '2025年5月に買ってよかったもの第5位〜第1位を発表します❗️ #ガジェット #神ガジェット #スマホスタンド',
  snippet: '○特徴 ・クランクを搭載しゲームをプレイ可能 ・高性能ポータブルゲーム機 ・自分でゲームを作成可能'
});
assert.ok(productionLikeNoiseLabels.includes('ガジェット'));
assert.ok(productionLikeNoiseLabels.includes('スマホスタンド'));
assert.ok(!productionLikeNoiseLabels.some(label => label.includes('クランクを搭載しゲーム')));
assert.ok(!productionLikeNoiseLabels.some(label => label.includes('高性能ポータブルゲーム')));
assert.ok(!productionLikeNoiseLabels.some(label => label.includes('自分でゲーム')));

const diversifiedClusters = clusterObservedSocialMarkets([
  {
    platform: 'tiktok',
    searchQuery: 'site:tiktok.com 初めて やってみた',
    position: 1,
    title: '初めて陶芸をやってみた #陶芸',
    url: 'https://www.tiktok.com/@example/video/pottery1',
    snippet: null,
    formatSignals: [],
    metrics: { views: 45000, likes: 900, comments: 20, shares: 10 },
    metricProvenance: 'tiktok_public_page'
  },
  {
    platform: 'youtube_shorts',
    searchQuery: 'site:youtube.com/shorts 初めて やってみた',
    position: 1,
    title: '陶芸を初体験 #陶芸',
    url: 'https://www.youtube.com/shorts/pottery2',
    snippet: null,
    formatSignals: [],
    metrics: { views: 12000, likes: null, comments: null, shares: null },
    metricProvenance: 'youtube_public_page'
  },
  {
    platform: 'tiktok',
    searchQuery: 'site:tiktok.com 一人で 行ってみた',
    position: 1,
    title: '一人で居酒屋に行ってみた #一人飲み',
    url: 'https://www.tiktok.com/@example/video/solo1',
    snippet: null,
    formatSignals: ['routine_day_in_life'],
    metrics: { views: 210000, likes: 4200, comments: 120, shares: 60 },
    metricProvenance: 'tiktok_public_page'
  },
  {
    platform: 'youtube_shorts',
    searchQuery: 'site:youtube.com/shorts 一人で 行ってみた',
    position: 1,
    title: '初めての一人飲み #一人飲み',
    url: 'https://www.youtube.com/shorts/solo2',
    snippet: null,
    formatSignals: [],
    metrics: { views: 70000, likes: null, comments: null, shares: null },
    metricProvenance: 'youtube_public_page'
  },
  {
    platform: 'tiktok',
    searchQuery: 'site:tiktok.com 最近 ハマってる',
    position: 2,
    title: '最近ハマってるガジェット #ガジェット',
    url: 'https://www.tiktok.com/@example/video/gadget1',
    snippet: null,
    formatSignals: [],
    metrics: { views: 500000, likes: 9000, comments: 80, shares: 40 },
    metricProvenance: 'tiktok_public_page'
  },
  {
    platform: 'tiktok',
    searchQuery: 'site:tiktok.com 困った 解決',
    position: 2,
    title: '肌荒れで困った #メンズ洗顔料',
    url: 'https://www.tiktok.com/@example/video/facewash1',
    snippet: null,
    formatSignals: ['problem_solution'],
    metrics: { views: 180000, likes: 2500, comments: 25, shares: 12 },
    metricProvenance: 'tiktok_public_page'
  },
  {
    platform: 'youtube_shorts',
    searchQuery: 'site:youtube.com/shorts やめてよかった',
    position: 1,
    title: '使うのをやめてよかったAIツール #AIツール',
    url: 'https://www.youtube.com/shorts/ai1',
    snippet: null,
    formatSignals: [],
    metrics: { views: 300000, likes: null, comments: null, shares: null },
    metricProvenance: 'youtube_public_page'
  }
]);
const diversifiedSelection = selectBroadValidationClusters(
  diversifiedClusters,
  ['初めて やってみた', '最近 ハマってる', '一人で 行ってみた', '困った 解決', 'やめてよかった', '買ってよかった'],
  2
);
assert.deepEqual(
  new Set(diversifiedSelection.map(item => item.label)),
  new Set(['陶芸', '一人飲み']),
  'Broad validation should prefer contextually anchored evidence, not hard-coded category names.'
);

const mergedDiscoveryObservations = mergeBroadDiscoveryObservations([
  social({
    query: '初めて やってみた',
    observations: [
      { platform: 'tiktok', searchQuery: 'seed-a', position: 1, title: 'A1', url: 'https://www.tiktok.com/@example/video/a1', snippet: null, formatSignals: [], metrics: { views: 1, likes: null, comments: null, shares: null }, metricProvenance: 'tiktok_public_page' },
      { platform: 'tiktok', searchQuery: 'seed-a', position: 2, title: 'A2', url: 'https://www.tiktok.com/@example/video/a2', snippet: null, formatSignals: [], metrics: { views: 1, likes: null, comments: null, shares: null }, metricProvenance: 'tiktok_public_page' }
    ]
  }),
  social({
    query: '最近 ハマってる',
    observations: [
      { platform: 'youtube_shorts', searchQuery: 'seed-b', position: 1, title: 'B1', url: 'https://www.youtube.com/shorts/b1', snippet: null, formatSignals: [], metrics: { views: 1, likes: null, comments: null, shares: null }, metricProvenance: 'youtube_public_page' },
      { platform: 'youtube_shorts', searchQuery: 'seed-b', position: 2, title: 'B2', url: 'https://www.youtube.com/shorts/b2', snippet: null, formatSignals: [], metrics: { views: 1, likes: null, comments: null, shares: null }, metricProvenance: 'youtube_public_page' }
    ]
  }),
  social({
    query: '一人で 行ってみた',
    observations: [
      { platform: 'tiktok', searchQuery: 'seed-c', position: 1, title: 'C1', url: 'https://www.tiktok.com/@example/video/c1', snippet: null, formatSignals: [], metrics: { views: 1, likes: null, comments: null, shares: null }, metricProvenance: 'tiktok_public_page' }
    ]
  })
], 3);
assert.deepEqual(
  mergedDiscoveryObservations.map(item => item.title),
  ['A1', 'B1', 'C1'],
  'Broad discovery observation caps should be balanced across lenses instead of truncating later lenses.'
);

const formats = extractSocialFormatSignals('韓国eSIMおすすめ5選を正直レビュー。料金を比較して使い方も解説');
assert.ok(formats.includes('listicle'));
assert.ok(formats.includes('comparison'));
assert.ok(formats.includes('review_testimonial'));
assert.ok(formats.includes('cost_breakdown'));
assert.ok(formats.includes('how_to_demo'));

const metrics = parseTikTokPublicMetrics(`
<html><body><script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">
{"scope":{"video":{"stats":{"playCount":"12345","diggCount":678,"commentCount":19,"shareCount":21}}}}
</script></body></html>`);
assert.deepEqual(metrics, { views: 12345, likes: 678, comments: 19, shares: 21 });

const youtubeMetrics = parseYouTubePublicMetrics('<script>var ytInitialPlayerResponse={"videoDetails":{"videoId":"abc","viewCount":"54321"}}</script>');
assert.deepEqual(youtubeMetrics, { views: 54321, likes: null, comments: null, shares: null });

const snippetMetrics = parseIndexedSocialSnippetMetrics('tiktok', 'いいねの数：6175コメントの数：124。再生回数：1.2万');
assert.deepEqual(snippetMetrics, { views: 12000, likes: 6175, comments: 124, shares: null });
assert.ok(extractSocialFormatSignals('宅配クリーニングの油汚れの落とし方').includes('how_to_demo'));

const missingSocial = assessMarketEvidenceCoverage({
  researchGoal: 'social_affiliate',
  query: '海外旅行 eSIM おすすめ',
  broadSignalCount: 0,
  broadSourceCount: 0,
  broadSocialSignalCount: 0,
  searchSurfaceCount: 12,
  searchDemandCount: 4,
  socialContent: social(),
  senseSelectionRequired: false
});
assert.equal(missingSocial.status, 'insufficient');
assert.equal(missingSocial.conclusionAllowed, false);
assert.ok(missingSocial.missingRequired.includes('social_content_patterns'));

const partialSocial = assessMarketEvidenceCoverage({
  researchGoal: 'social_affiliate',
  query: '海外旅行 eSIM おすすめ',
  broadSignalCount: 0,
  broadSourceCount: 0,
  broadSocialSignalCount: 0,
  searchSurfaceCount: 12,
  searchDemandCount: 0,
  socialContent: social({
    platformsObserved: ['tiktok'],
    observations: [{
      platform: 'tiktok',
      searchQuery: 'site:tiktok.com 海外旅行 eSIM おすすめ',
      position: 1,
      title: '海外eSIM使ってみた',
      url: 'https://www.tiktok.com/@example/video/1',
      snippet: null,
      formatSignals: ['review_testimonial'],
      metrics: { views: null, likes: null, comments: null, shares: null },
      metricProvenance: 'none'
    }]
  }),
  senseSelectionRequired: false
});
assert.equal(partialSocial.status, 'partial');
assert.equal(partialSocial.conclusionAllowed, true);

const sufficientSocial = assessMarketEvidenceCoverage({
  researchGoal: 'social_affiliate',
  query: '海外旅行 eSIM おすすめ',
  broadSignalCount: 0,
  broadSourceCount: 0,
  broadSocialSignalCount: 0,
  searchSurfaceCount: 12,
  searchDemandCount: 4,
  socialContent: social({
    platformsObserved: ['tiktok', 'youtube_shorts'],
    observations: [
      {
        platform: 'tiktok',
        searchQuery: 'site:tiktok.com 海外旅行 eSIM おすすめ',
        position: 1,
        title: '海外eSIM比較',
        url: 'https://www.tiktok.com/@example/video/1',
        snippet: null,
        formatSignals: ['comparison'],
        metrics: { views: 12000, likes: 700, comments: 30, shares: 20 },
        metricProvenance: 'tiktok_public_page'
      },
      {
        platform: 'youtube_shorts',
        searchQuery: 'site:youtube.com/shorts 海外旅行 eSIM おすすめ',
        position: 1,
        title: 'eSIM 3つ比較',
        url: 'https://www.youtube.com/shorts/abc',
        snippet: null,
        formatSignals: ['comparison'],
        metrics: { views: null, likes: null, comments: null, shares: null },
        metricProvenance: 'none'
      }
    ]
  }),
  senseSelectionRequired: false
});
assert.equal(sufficientSocial.status, 'sufficient');
assert.equal(sufficientSocial.conclusionAllowed, true);

const ambiguous = assessMarketEvidenceCoverage({
  researchGoal: 'social_affiliate',
  query: 'eSIM',
  broadSignalCount: 0,
  broadSourceCount: 0,
  broadSocialSignalCount: 0,
  searchSurfaceCount: 10,
  searchDemandCount: 4,
  socialContent: sufficientSocial.checks ? social({
    platformsObserved: ['tiktok'],
    observations: [{
      platform: 'tiktok',
      searchQuery: 'site:tiktok.com eSIM',
      position: 1,
      title: 'eSIM',
      url: 'https://www.tiktok.com/@example/video/2',
      snippet: null,
      formatSignals: [],
      metrics: { views: 10, likes: 1, comments: 0, shares: 0 },
      metricProvenance: 'tiktok_public_page'
    }]
  }) : social(),
  senseSelectionRequired: true
});
assert.equal(ambiguous.conclusionAllowed, false);
assert.ok(ambiguous.missingRequired.includes('semantic_sense_selection'));



const broadMissingSocial = assessMarketEvidenceCoverage({
  researchGoal: 'social_affiliate',
  query: null,
  broadSignalCount: 20,
  broadSourceCount: 2,
  broadSocialSignalCount: 0,
  searchSurfaceCount: 0,
  searchDemandCount: 0,
  socialContent: social({ query: null }),
  senseSelectionRequired: false
});
assert.equal(broadMissingSocial.status, 'insufficient');
assert.equal(broadMissingSocial.conclusionAllowed, false);
assert.ok(broadMissingSocial.missingRequired.includes('social_content_patterns'));

const broadIndexedSocial = assessMarketEvidenceCoverage({
  researchGoal: 'social_affiliate',
  query: null,
  broadSignalCount: 20,
  broadSourceCount: 2,
  broadSocialSignalCount: 6,
  broadSocialMetricCount: 4,
  broadSocialSources: ['tiktok', 'youtube_shorts'],
  broadSocialMetricSources: ['tiktok_public_page', 'youtube_public_page'],
  searchSurfaceCount: 0,
  searchDemandCount: 0,
  socialContent: social({ query: null }),
  senseSelectionRequired: false
});
assert.equal(broadIndexedSocial.status, 'sufficient');
assert.equal(broadIndexedSocial.conclusionAllowed, true);
assert.deepEqual(
  broadIndexedSocial.checks.find(check => check.evidenceClass === 'social_content_patterns')?.sources,
  ['tiktok', 'youtube_shorts']
);
assert.deepEqual(
  broadIndexedSocial.checks.find(check => check.evidenceClass === 'social_engagement_metrics')?.sources,
  ['tiktok_public_page', 'youtube_public_page']
);
assert.ok(!broadIndexedSocial.guidance.some(item => item.includes('engagement strength is not verified')));

const broadWithoutMetrics = assessMarketEvidenceCoverage({
  researchGoal: 'social_affiliate',
  query: null,
  broadSignalCount: 20,
  broadSourceCount: 2,
  broadSocialSignalCount: 6,
  broadSocialMetricCount: 0,
  broadSocialSources: ['tiktok', 'youtube_shorts'],
  broadSocialMetricSources: [],
  searchSurfaceCount: 0,
  searchDemandCount: 0,
  socialContent: social({ query: null }),
  senseSelectionRequired: false
});
assert.equal(broadWithoutMetrics.status, 'partial');
assert.ok(broadWithoutMetrics.guidance.some(item => item.includes('engagement strength is not verified')));

console.log('market evidence coverage smoke passed');
