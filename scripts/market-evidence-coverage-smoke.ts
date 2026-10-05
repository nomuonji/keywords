import assert from 'node:assert/strict';
import {
  assessMarketEvidenceCoverage,
  extractSocialFormatSignals,
  parseTikTokPublicMetrics,
  type SocialContentResearchResult
} from '../packages/commands/src/market-social-research.js';

function social(overrides: Partial<SocialContentResearchResult> = {}): SocialContentResearchResult {
  return {
    source: 'serp_indexed_social_content',
    evidenceScope: 'public_index_plus_best_effort_public_page_metrics',
    query: '海外旅行 eSIM おすすめ',
    platformsRequested: ['tiktok', 'youtube_shorts'],
    platformsObserved: [],
    observations: [],
    platformStatus: [],
    warnings: [],
    guidance: [],
    ...overrides
  };
}

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

const missingSocial = assessMarketEvidenceCoverage({
  researchGoal: 'social_affiliate',
  query: '海外旅行 eSIM おすすめ',
  broadSignalCount: 0,
  broadSourceCount: 0,
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

console.log('market evidence coverage smoke passed');
