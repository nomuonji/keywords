import { serpResearchCached } from './remote-keyword-research.js';

export const SOCIAL_MARKET_PLATFORMS = ['tiktok', 'youtube_shorts', 'instagram_reels'] as const;
export const DEFAULT_SOCIAL_MARKET_PLATFORMS = ['tiktok', 'youtube_shorts'] as const;
export const MARKET_RESEARCH_GOALS = ['general', 'affiliate', 'social_affiliate', 'product_ideation'] as const;

export type SocialMarketPlatform = (typeof SOCIAL_MARKET_PLATFORMS)[number];
export type MarketResearchGoal = (typeof MARKET_RESEARCH_GOALS)[number];

export interface SocialContentObservation {
  platform: SocialMarketPlatform;
  searchQuery: string;
  position: number | null;
  title: string;
  url: string;
  snippet: string | null;
  formatSignals: string[];
  metrics: {
    views: number | null;
    likes: number | null;
    comments: number | null;
    shares: number | null;
  };
  metricProvenance: 'tiktok_public_page' | 'youtube_public_page' | 'search_snippet' | 'public_page_plus_search_snippet' | 'none';
}

export interface SocialPlatformStatus {
  platform: SocialMarketPlatform;
  searchQuery: string;
  status: 'observed' | 'no_indexed_results' | 'failed';
  indexedResultCount: number;
  metricResultCount: number;
  cacheHit: boolean | null;
  searchProvider: 'brave' | 'api' | null;
  warning: string | null;
}

export interface SocialFormatSummary {
  format: string;
  count: number;
  platforms: SocialMarketPlatform[];
  evidence: Array<{ platform: SocialMarketPlatform; title: string; url: string }>;
}

export interface SocialContentResearchResult {
  source: 'serp_indexed_social_content';
  evidenceScope: 'public_index_plus_best_effort_public_page_metrics';
  query: string | null;
  platformsRequested: SocialMarketPlatform[];
  platformsObserved: SocialMarketPlatform[];
  observations: SocialContentObservation[];
  formatSummary: SocialFormatSummary[];
  platformStatus: SocialPlatformStatus[];
  warnings: string[];
  guidance: string[];
}

export interface MarketEvidenceCheck {
  evidenceClass: 'broad_market_signals' | 'query_search_surface' | 'query_search_demand' | 'social_content_patterns' | 'social_engagement_metrics';
  required: boolean;
  status: 'available' | 'partial' | 'unavailable' | 'not_required';
  evidenceCount: number;
  sources: string[];
  note: string;
}

export interface MarketEvidenceCoverage {
  researchGoal: MarketResearchGoal;
  status: 'sufficient' | 'partial' | 'insufficient';
  conclusionAllowed: boolean;
  checks: MarketEvidenceCheck[];
  missingRequired: string[];
  guidance: string[];
}

const SOCIAL_FORMAT_RULES: Array<{ id: string; pattern: RegExp }> = [
  { id: 'listicle', pattern: /(?:\btop\s*\d+\b|\b\d+\s*(?:tips?|ways?|reasons?)\b|\d+選|ランキング|まとめ|おすすめ\s*\d+)/i },
  { id: 'comparison', pattern: /(?:比較|違い|どっち|どちら|vs\.?|versus|compare|comparison)/i },
  { id: 'review_testimonial', pattern: /(?:レビュー|口コミ|正直|使ってみた|買ってみた|試してみた|review|tested|my experience)/i },
  { id: 'how_to_demo', pattern: /(?:使い方|やり方|落とし方|洗い方|選び方|方法|設定|手順|実演|検証|how\s*to|tutorial|setup|demo)/i },
  { id: 'routine_day_in_life', pattern: /(?:ルーティン|一日|1日|一週間|1週間|vlog|day\s*in\s*(?:my|the)\s*life|routine)/i },
  { id: 'cost_breakdown', pattern: /(?:料金|価格|費用|コスパ|いくら|\d+[,.]?\d*\s*円|price|cost|budget)/i },
  { id: 'before_after', pattern: /(?:ビフォー.?アフター|before\s*(?:\/|&|and)?\s*after|変化|改善)/i },
  { id: 'mistake_warning', pattern: /(?:失敗|注意|知らないと|やめたほう|後悔|危険|mistakes?|warning|avoid|don['’]t)/i },
  { id: 'problem_solution', pattern: /(?:悩み|困った|解決|対策|problem|struggle|solution|fix)/i }
];

const PLATFORM_QUERY: Record<SocialMarketPlatform, (query: string) => string> = {
  tiktok: query => `site:tiktok.com ${query}`,
  youtube_shorts: query => `site:youtube.com/shorts ${query}`,
  instagram_reels: query => `site:instagram.com/reel ${query}`
};

function emptyMetrics() {
  return { views: null, likes: null, comments: null, shares: null };
}

function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(String(value).replaceAll(',', ''));
  return Number.isFinite(number) ? number : null;
}

function finiteCompactNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const raw = String(value).trim().replaceAll(',', '');
  const match = raw.match(/^([0-9]+(?:\.[0-9]+)?)\s*([kKmMbB万億])?$/);
  if (!match?.[1]) return finiteNumber(raw);
  const base = Number(match[1]);
  if (!Number.isFinite(base)) return null;
  const unit = match[2]?.toLowerCase() ?? '';
  const multiplier =
    unit === 'k' ? 1_000 :
    unit === 'm' ? 1_000_000 :
    unit === 'b' ? 1_000_000_000 :
    unit === '万' ? 10_000 :
    unit === '億' ? 100_000_000 :
    1;
  return Math.round(base * multiplier);
}

export function parseIndexedSocialSnippetMetrics(platform: SocialMarketPlatform, snippet: string | null): SocialContentObservation['metrics'] | null {
  if (!snippet) return null;
  const likes = snippet.match(/(?:いいね(?:の数)?|likes?)\s*[：:]?\s*([0-9][0-9,.]*(?:\.[0-9]+)?\s*[kKmMbB万億]?)/i)?.[1] ?? null;
  const comments = snippet.match(/(?:コメント(?:の数)?|comments?)\s*[：:]?\s*([0-9][0-9,.]*(?:\.[0-9]+)?\s*[kKmMbB万億]?)/i)?.[1] ?? null;
  const views = snippet.match(/(?:再生回数|視聴回数|views?)\s*[：:]?\s*([0-9][0-9,.]*(?:\.[0-9]+)?\s*[kKmMbB万億]?)/i)?.[1] ?? null;
  const metrics = {
    views: finiteCompactNumber(views),
    likes: finiteCompactNumber(likes),
    comments: finiteCompactNumber(comments),
    shares: null
  };
  if (platform === 'instagram_reels' && metrics.views === null && metrics.likes === null && metrics.comments === null) return null;
  return Object.values(metrics).some(value => value !== null) ? metrics : null;
}

function mergeMetrics(primary: SocialContentObservation['metrics'], secondary: SocialContentObservation['metrics']) {
  return {
    views: primary.views ?? secondary.views,
    likes: primary.likes ?? secondary.likes,
    comments: primary.comments ?? secondary.comments,
    shares: primary.shares ?? secondary.shares
  };
}

function isPlatformUrl(platform: SocialMarketPlatform, raw: string) {
  try {
    const url = new URL(raw);
    const hostname = url.hostname.toLowerCase().replace(/^www\./, '');
    if (platform === 'tiktok') {
      return (hostname === 'tiktok.com' || hostname.endsWith('.tiktok.com')) && /\/video\/\d+/i.test(url.pathname);
    }
    if (platform === 'youtube_shorts') {
      return (hostname === 'youtube.com' || hostname.endsWith('.youtube.com')) && /\/shorts(?:\/|$)/i.test(url.pathname);
    }
    return (hostname === 'instagram.com' || hostname.endsWith('.instagram.com')) && /\/reel(?:s)?(?:\/|$)/i.test(url.pathname);
  } catch {
    return false;
  }
}

export function extractSocialFormatSignals(text: string): string[] {
  return SOCIAL_FORMAT_RULES.filter(rule => rule.pattern.test(text)).map(rule => rule.id);
}

export function summarizeSocialFormats(observations: SocialContentObservation[]): SocialFormatSummary[] {
  const grouped = new Map<string, SocialFormatSummary>();
  for (const observation of observations) {
    for (const format of observation.formatSignals) {
      const current = grouped.get(format) ?? { format, count: 0, platforms: [], evidence: [] };
      current.count += 1;
      if (!current.platforms.includes(observation.platform)) current.platforms.push(observation.platform);
      if (current.evidence.length < 5) {
        current.evidence.push({ platform: observation.platform, title: observation.title, url: observation.url });
      }
      grouped.set(format, current);
    }
  }
  return [...grouped.values()].sort((left, right) =>
    right.count - left.count ||
    right.platforms.length - left.platforms.length ||
    left.format.localeCompare(right.format)
  );
}

function findTikTokStats(value: unknown, depth = 0): Record<string, unknown> | null {
  if (depth > 8 || value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findTikTokStats(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  const hasStats = ['playCount', 'diggCount', 'commentCount', 'shareCount'].filter(key => keys.includes(key)).length >= 2;
  if (hasStats) return record;
  for (const child of Object.values(record)) {
    const found = findTikTokStats(child, depth + 1);
    if (found) return found;
  }
  return null;
}

export function parseTikTokPublicMetrics(html: string): SocialContentObservation['metrics'] | null {
  if (!/playCount|diggCount|commentCount|shareCount/i.test(html)) return null;
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
    .map(match => match[1]?.trim())
    .filter((value): value is string => Boolean(value && /playCount|diggCount|commentCount|shareCount/i.test(value)));

  for (const script of scripts) {
    try {
      const parsed = JSON.parse(script.replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
      const stats = findTikTokStats(parsed);
      if (!stats) continue;
      const metrics = {
        views: finiteNumber(stats.playCount),
        likes: finiteNumber(stats.diggCount),
        comments: finiteNumber(stats.commentCount),
        shares: finiteNumber(stats.shareCount)
      };
      if (Object.values(metrics).some(value => value !== null)) return metrics;
    } catch {
      // Some TikTok script blocks are JavaScript rather than JSON. Ignore them.
    }
  }
  return null;
}

export function parseYouTubePublicMetrics(html: string): SocialContentObservation['metrics'] | null {
  const match = html.match(/"videoDetails"\s*:\s*\{[\s\S]{0,80000}?"viewCount"\s*:\s*"(\d+)"/i)
    ?? html.match(/"viewCount"\s*:\s*"?(\d{1,20})"?/i);
  if (!match?.[1]) return null;
  return { views: finiteNumber(match[1]), likes: null, comments: null, shares: null };
}

async function enrichPublicMetrics(platform: SocialMarketPlatform, url: string) {
  try {
    const response = await fetch(url, {
      headers: {
        accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
        'accept-language': 'ja,en-US;q=0.8,en;q=0.6',
        'user-agent': 'Mozilla/5.0 (compatible; KeywordsMarketResearch/1.0; +https://keywords-seven.vercel.app)'
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(8_000)
    });
    if (!response.ok) return null;
    const html = await response.text();
    if (platform === 'tiktok') {
      const metrics = parseTikTokPublicMetrics(html);
      return metrics ? { metrics, provenance: 'tiktok_public_page' as const } : null;
    }
    if (platform === 'youtube_shorts') {
      const metrics = parseYouTubePublicMetrics(html);
      return metrics ? { metrics, provenance: 'youtube_public_page' as const } : null;
    }
    return null;
  } catch {
    return null;
  }
}

export async function socialContentResearch(input: {
  query: string | null;
  geo: string;
  limit: number;
  platforms?: SocialMarketPlatform[];
}): Promise<SocialContentResearchResult> {
  const query = input.query?.trim() || null;
  const platforms = [...new Set(input.platforms?.length ? input.platforms : DEFAULT_SOCIAL_MARKET_PLATFORMS)];
  if (!query) {
    return {
      source: 'serp_indexed_social_content',
      evidenceScope: 'public_index_plus_best_effort_public_page_metrics',
      query: null,
      platformsRequested: platforms,
      platformsObserved: [],
      observations: [],
      formatSummary: [],
      platformStatus: platforms.map(platform => ({
        platform,
        searchQuery: '',
        status: 'no_indexed_results',
        indexedResultCount: 0,
        metricResultCount: 0,
        cacheHit: null,
        searchProvider: null,
        warning: 'Query-specific social-content research requires a query.'
      })),
      warnings: ['Query-specific social-content research requires a query.'],
      guidance: ['No social-content absence inference is allowed when a query was not supplied.']
    };
  }

  const perPlatformLimit = Math.max(1, Math.min(input.limit, 5));
  // Search deeper than the requested output count before filtering to canonical
  // video/reel URLs. TikTok often ranks discover/profile pages above videos.
  const discoveryFetchSize = Math.min(20, Math.max(10, perPlatformLimit * 3));
  const observations: SocialContentObservation[] = [];
  const platformStatus: SocialPlatformStatus[] = [];
  const warnings: string[] = [];

  async function indexedSearch(searchQuery: string) {
    let braveError: string | null = null;
    try {
      const serp = await serpResearchCached({
        query: searchQuery,
        country: input.geo,
        language: input.geo === 'JP' ? 'ja' : 'en',
        num: discoveryFetchSize,
        provider: 'brave',
        forceRefresh: false,
        maxCacheAgeHours: 24
      }) as any;
      return { serp, provider: 'brave' as const };
    } catch (error) {
      braveError = error instanceof Error ? error.message : String(error);
    }
    try {
      const serp = await serpResearchCached({
        query: searchQuery,
        country: input.geo,
        language: input.geo === 'JP' ? 'ja' : 'en',
        num: discoveryFetchSize,
        provider: 'api',
        forceRefresh: false,
        maxCacheAgeHours: 24
      }) as any;
      warnings.push('Brave social search failed for "' + searchQuery + '"; API fallback succeeded: ' + braveError);
      return { serp, provider: 'api' as const };
    } catch (error) {
      const apiError = error instanceof Error ? error.message : String(error);
      throw new Error('Brave failed: ' + braveError + '; API fallback failed: ' + apiError);
    }
  }

  for (const platform of platforms) {
    const searchQuery = PLATFORM_QUERY[platform](query);
    try {
      const indexed = await indexedSearch(searchQuery);
      const serp = indexed.serp;
      const candidates = (Array.isArray(serp?.results) ? serp.results : [])
        .filter((item: any) => item?.link && isPlatformUrl(platform, String(item.link)))
        .slice(0, perPlatformLimit);

      const mapped: SocialContentObservation[] = candidates.map((item: any) => {
        const title = String(item?.title ?? '').trim();
        const snippet = item?.snippet == null ? null : String(item.snippet).trim();
        const snippetMetrics = parseIndexedSocialSnippetMetrics(platform, snippet);
        return {
          platform,
          searchQuery,
          position: typeof item?.position === 'number' ? item.position : null,
          title,
          url: String(item.link),
          snippet,
          formatSignals: extractSocialFormatSignals([title, snippet].filter(Boolean).join(' ')),
          metrics: snippetMetrics ?? emptyMetrics(),
          metricProvenance: snippetMetrics ? 'search_snippet' : 'none'
        };
      }).filter((item: SocialContentObservation) => item.title && item.url);

      if ((platform === 'tiktok' || platform === 'youtube_shorts') && mapped.length) {
        const enrichments = await Promise.all(mapped.slice(0, 3).map(item => enrichPublicMetrics(platform, item.url)));
        for (let index = 0; index < enrichments.length; index++) {
          const enrichment = enrichments[index];
          if (!enrichment || !mapped[index]) continue;
          const previous = mapped[index];
          mapped[index] = {
            ...previous,
            metrics: mergeMetrics(enrichment.metrics, previous.metrics),
            metricProvenance: previous.metricProvenance === 'search_snippet'
              ? 'public_page_plus_search_snippet'
              : enrichment.provenance
          };
        }
      }

      observations.push(...mapped);
      const metricResultCount = mapped.filter(item => Object.values(item.metrics).some(value => value !== null)).length;
      const cacheHit = typeof serp?.cache?.hit === 'boolean' ? serp.cache.hit : null;
      const warning = mapped.length
        ? null
        : 'No indexed public ' + platform + ' results were observed for this query. Treat this as retrieval absence, not evidence that the platform has no relevant content.';
      platformStatus.push({
        platform,
        searchQuery,
        status: mapped.length ? 'observed' : 'no_indexed_results',
        indexedResultCount: mapped.length,
        metricResultCount,
        cacheHit,
        searchProvider: indexed.provider,
        warning
      });
      if (warning) warnings.push(warning);
    } catch (error) {
      const warning = platform + ' indexed-content research failed: ' + (error instanceof Error ? error.message : String(error));
      warnings.push(warning);
      platformStatus.push({
        platform,
        searchQuery,
        status: 'failed',
        indexedResultCount: 0,
        metricResultCount: 0,
        cacheHit: null,
        searchProvider: null,
        warning
      });
    }
  }

  const deduped = observations.filter((item, index, all) => all.findIndex(other => other.url === item.url) === index);
  return {
    source: 'serp_indexed_social_content',
    evidenceScope: 'public_index_plus_best_effort_public_page_metrics',
    query,
    platformsRequested: platforms,
    platformsObserved: platforms.filter(platform => deduped.some(item => item.platform === platform)),
    observations: deduped,
    formatSummary: summarizeSocialFormats(deduped),
    platformStatus,
    warnings,
    guidance: [
      'Indexed social results are real public content observations, but search-engine ranking is not a native TikTok/YouTube/Instagram popularity ranking.',
      'Social engagement metrics are best-effort values from indexed search snippets and public content pages when exposed; missing metrics mean unavailable evidence, not zero engagement.',
      'Brave is preferred for site-restricted social discovery because it returned materially better TikTok/Shorts coverage in production checks; the general SERP API remains a fallback.',
      'Use titles/snippets and formatSignals to study output patterns. Use engagement metrics only when metricProvenance is present.'
    ]
  };
}

export function assessMarketEvidenceCoverage(input: {
  researchGoal: MarketResearchGoal;
  query: string | null;
  broadSignalCount: number;
  broadSourceCount: number;
  broadSocialSignalCount: number;
  broadSocialMetricCount?: number;
  broadSocialSources?: string[];
  searchSurfaceCount: number;
  searchDemandCount: number;
  socialContent: SocialContentResearchResult;
  senseSelectionRequired: boolean;
}): MarketEvidenceCoverage {
  const queryMode = Boolean(input.query);
  const socialCount = input.socialContent.observations.length;
  const socialPlatformCount = input.socialContent.platformsObserved.length;
  const socialMetricCount = input.socialContent.observations.filter(item =>
    Object.values(item.metrics).some(value => value !== null)
  ).length;

  const requiresQueryMarket = queryMode && ['affiliate', 'social_affiliate', 'product_ideation'].includes(input.researchGoal);
  const requiresSocial = input.researchGoal === 'social_affiliate';
  const broadSocialMetricCount = input.broadSocialMetricCount ?? input.broadSocialSignalCount;
  const broadSocialSources = input.broadSocialSources?.length
    ? [...new Set(input.broadSocialSources)]
    : input.broadSocialSignalCount > 0
      ? ['tiktok_creative_center']
      : [];
  const checks: MarketEvidenceCheck[] = [
    {
      evidenceClass: 'broad_market_signals',
      required: !queryMode,
      status: queryMode ? 'not_required' : input.broadSourceCount >= 2 ? 'available' : input.broadSignalCount > 0 ? 'partial' : 'unavailable',
      evidenceCount: input.broadSignalCount,
      sources: [],
      note: queryMode ? 'Broad signals are contextual only in query-focused mode.' : 'Broad market scanning should observe more than one independent source before strong conclusions.'
    },
    {
      evidenceClass: 'query_search_surface',
      required: requiresQueryMarket,
      status: !queryMode ? 'not_required' : input.searchSurfaceCount > 0 ? 'available' : 'unavailable',
      evidenceCount: input.searchSurfaceCount,
      sources: input.searchSurfaceCount > 0 ? ['serp'] : [],
      note: 'Related searches, PAA, and ranked pages establish the current query surface.'
    },
    {
      evidenceClass: 'query_search_demand',
      required: false,
      status: !queryMode ? 'not_required' : input.searchDemandCount > 0 ? 'available' : 'unavailable',
      evidenceCount: input.searchDemandCount,
      sources: input.searchDemandCount > 0 ? ['google_ads'] : [],
      note: 'Historical keyword demand strengthens the case but is not allowed to substitute for missing social evidence.'
    },
    {
      evidenceClass: 'social_content_patterns',
      required: requiresSocial,
      status: queryMode
        ? socialPlatformCount >= 2 ? 'available' : socialCount > 0 ? 'partial' : 'unavailable'
        : requiresSocial
          ? input.broadSocialSignalCount > 0 ? 'available' : 'unavailable'
          : 'not_required',
      evidenceCount: queryMode ? socialCount : input.broadSocialSignalCount,
      sources: queryMode
        ? input.socialContent.platformsObserved
        : broadSocialSources,
      note: queryMode
        ? 'Query-relevant indexed TikTok/Shorts/Reels content is used to observe actual output formats rather than inventing them from the model.'
        : 'Broad social-affiliate research may use generic indexed TikTok/Shorts discovery in addition to TikTok Creative Center. Google Trends/HN alone cannot stand in for social evidence.'
    },
    {
      evidenceClass: 'social_engagement_metrics',
      required: false,
      status: queryMode
        ? socialMetricCount > 0 ? 'available' : socialCount > 0 ? 'partial' : 'unavailable'
        : broadSocialMetricCount > 0 ? 'available' : input.broadSocialSignalCount > 0 ? 'partial' : 'unavailable',
      evidenceCount: queryMode ? socialMetricCount : broadSocialMetricCount,
      sources: queryMode
        ? [...new Set(input.socialContent.observations.filter(item =>
            Object.values(item.metrics).some(value => value !== null)
          ).map(item => item.metricProvenance).filter(source => source !== 'none'))]
        : broadSocialMetricCount > 0 ? broadSocialSources : [],
      note: 'Engagement evidence is best-effort and never inferred from search ranking.'
    }
  ];

  const missingRequired: string[] = checks
    .filter(check => check.required && check.status === 'unavailable')
    .map(check => check.evidenceClass);
  if (input.senseSelectionRequired) missingRequired.push('semantic_sense_selection');

  const conclusionAllowed = missingRequired.length === 0 && (
    queryMode
      ? (input.searchSurfaceCount > 0 || input.searchDemandCount > 0)
      : input.broadSignalCount > 0
  );
  const strongSocial = !requiresSocial || (queryMode
    ? socialPlatformCount >= 2 && socialMetricCount > 0
    : input.broadSocialSignalCount > 0 && broadSocialMetricCount > 0);
  const strongSearch = !queryMode || (input.searchSurfaceCount > 0 && input.searchDemandCount > 0);
  const strongBroad = queryMode || input.broadSourceCount >= 2;
  const status: MarketEvidenceCoverage['status'] = !conclusionAllowed
    ? 'insufficient'
    : strongSocial && strongSearch && strongBroad
      ? 'sufficient'
      : 'partial';

  return {
    researchGoal: input.researchGoal,
    status,
    conclusionAllowed,
    checks,
    missingRequired: [...new Set(missingRequired)],
    guidance: [
      ...(conclusionAllowed
        ? ['A market thesis may be formed, but preserve every partial/unavailable evidence class as an explicit limitation.']
        : ['Do not rank or recommend markets from this packet. Retrieve the missing required evidence first.']),
      ...(requiresSocial && socialMetricCount === 0
        ? ['Social output patterns may be observed from indexed content, but virality/engagement strength is not verified until native/public-page metrics are present.']
        : []),
      ...(input.researchGoal === 'affiliate' || input.researchGoal === 'social_affiliate'
        ? ['Affiliate-program availability, payout, approval conditions, and conversion terms still require separate program-level verification before calling a market easy to monetize.']
        : [])
    ]
  };
}
