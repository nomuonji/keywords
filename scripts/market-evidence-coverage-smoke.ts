import assert from 'node:assert/strict';
import {
  assessMarketEvidenceCoverage,
  extractSocialFormatSignals,
  parseIndexedSocialSnippetMetrics,
  parseTikTokPublicMetrics,
  parseYouTubePublicMetrics,
  type SocialContentResearchResult
} from '../packages/commands/src/market-social-research.js';
import { clusterObservedSocialMarkets, extractObservedMarketClusterLabels, selectBroadValidationClusters } from '../packages/commands/src/market-intelligence.js';

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

const genericFormatLabels = extractObservedMarketClusterLabels({
  title: '2026年上半期 買ってよかったものランキング #買ってよかったもの #おすすめ商品',
  snippet: '人気商品を紹介'
});
assert.ok(!genericFormatLabels.includes('買ってよかったもの'));
assert.ok(!genericFormatLabels.includes('おすすめ商品'));

const diversifiedClusters = clusterObservedSocialMarkets([
  {
    platform: 'tiktok',
    searchQuery: 'site:tiktok.com "買ってよかった" おすすめ',
    position: 1,
    title: '買ってよかったガジェット5選 #ガジェット',
    url: 'https://www.tiktok.com/@example/video/20',
    snippet: null,
    formatSignals: ['listicle'],
    metrics: { views: 200000, likes: 3000, comments: 20, shares: 10 },
    metricProvenance: 'tiktok_public_page'
  },
  {
    platform: 'youtube_shorts',
    searchQuery: 'site:youtube.com/shorts "買ってよかった" おすすめ',
    position: 1,
    title: '買ってよかったガジェット3選 #ガジェット',
    url: 'https://www.youtube.com/shorts/gadget2',
    snippet: null,
    formatSignals: ['listicle'],
    metrics: { views: 120000, likes: null, comments: null, shares: null },
    metricProvenance: 'youtube_public_page'
  },
  {
    platform: 'tiktok',
    searchQuery: 'site:tiktok.com "おすすめ" 比較 商品',
    position: 2,
    title: 'メンズ洗顔料20商品を比較 #メンズ洗顔料 #メンズスキンケア',
    url: 'https://www.tiktok.com/@example/video/21',
    snippet: null,
    formatSignals: ['comparison'],
    metrics: { views: 80000, likes: 1200, comments: 5, shares: 4 },
    metricProvenance: 'tiktok_public_page'
  },
  {
    platform: 'youtube_shorts',
    searchQuery: 'site:youtube.com/shorts "無料" おすすめ ツール',
    position: 1,
    title: '無料AIツールベスト5 #AIツール',
    url: 'https://www.youtube.com/shorts/ai-tools',
    snippet: null,
    formatSignals: ['listicle'],
    metrics: { views: 60000, likes: null, comments: null, shares: null },
    metricProvenance: 'youtube_public_page'
  }
]);
const diversifiedSelection = selectBroadValidationClusters(
  diversifiedClusters,
  ['"買ってよかった" おすすめ', '"おすすめ" 比較 商品', '"無料" おすすめ ツール'],
  3
);
assert.deepEqual(diversifiedSelection.map(item => item.label), ['ガジェット', 'メンズ洗顔料', 'AIツール']);

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

console.log('market evidence coverage smoke passed');
