import { distributionCaseDiscovery } from '@keywords/commands/distribution-case-discovery';
import { marketDiscoveryRun } from '@keywords/commands/market-discovery-runner';
import { marketIntelligenceResearch } from '@keywords/commands/market-intelligence';
import { trafficRouteDiscovery } from '@keywords/commands/traffic-route-discovery';
import { marketSignalScan } from '@keywords/research/market-sensors';

const object = (description: string, properties: Record<string, unknown>, required: string[] = []) => ({
  type: 'object' as const,
  description,
  properties,
  required
});

export const marketTools = [
  {
    name: 'market_signal_scan',
    description: 'Read public market signals from Google Trends RSS, TikTok Creative Center public rows, and Hacker News. No credentials, SERP quota, or persistence. Observations are attention signals, not sales or willingness-to-pay evidence.',
    inputSchema: object('Current public market signals', {
      sources: { type: 'array', items: { type: 'string', enum: ['google_trends', 'tiktok_creative_center', 'hacker_news'] }, minItems: 1, maxItems: 3 },
      query: { type: 'string', minLength: 1, maxLength: 200 },
      geo: { type: 'string', minLength: 2, maxLength: 2 },
      limit: { type: 'integer', minimum: 1, maximum: 20 },
      tiktokPeriodDays: { type: 'integer', enum: [7, 30, 90] },
      hackerNewsFeed: { type: 'string', enum: ['top', 'new', 'best'] }
    })
  },
  {
    name: 'distribution_case_discovery',
    description: 'Observe dated outbound links and provider tags from nine Japanese Hatena hotentry categories plus Hacker News Show. Zero SERP/Firestore use. Bookmarks/upvotes are not referral visits, sales, or permission to promote.',
    inputSchema: object('Observed source-to-destination placements', {
      topic: { type: 'string', minLength: 2, maxLength: 120 },
      maxCases: { type: 'integer', minimum: 1, maximum: 24 },
      includeGlobalTech: { type: 'boolean' },
      maxAgeDays: { type: 'integer', minimum: 1, maximum: 30 },
      rotation: { type: 'integer', minimum: 0, maximum: 100 },
      focus: { type: 'string', enum: ['balanced', 'entertainment', 'fandom', 'everyday', 'technology'] },
      niche: { type: 'string', minLength: 2, maxLength: 80 }
    })
  },
  {
    name: 'market_discovery_run',
    description: 'Read-only adaptive discovery. Observe combines public curation links and public market signals by default; optional commerce rankings may call the affiliate API. Validate reads candidate SERPs and may consume SERP/Ads quota, so validate is operation-budgeted. No candidate is automatically approved or saved.',
    inputSchema: object('Adaptive observe or validate run', {
      phase: { type: 'string', enum: ['observe', 'validate'] },
      objective: { type: 'string', minLength: 3, maxLength: 500 },
      mode: { type: 'string', enum: ['db_site', 'general', 'commerce'] },
      sources: { type: 'array', items: { type: 'string', enum: ['curated_links', 'open_signals', 'commerce_rankings'] }, minItems: 1, maxItems: 3 },
      rotation: { type: 'integer', minimum: 0, maximum: 50 },
      maxObservations: { type: 'integer', minimum: 1, maximum: 60 },
      withDemand: { type: 'boolean' },
      country: { type: 'string', pattern: '^[A-Z]{2}$' },
      language: { type: 'string', pattern: '^[a-z]{2}(?:-[A-Z]{2})?$' },
      candidates: {
        type: 'array',
        maxItems: 3,
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', minLength: 3, maxLength: 140 },
            audience: { type: 'string', minLength: 5, maxLength: 300 },
            userNeed: { type: 'string', minLength: 8, maxLength: 450 },
            databaseUnit: { type: 'string', minLength: 3, maxLength: 160 },
            interaction: { type: 'string', minLength: 5, maxLength: 300 },
            question: { type: 'string', minLength: 8, maxLength: 450 },
            query: { type: 'string', minLength: 2, maxLength: 200 },
            evidenceUrls: { type: 'array', maxItems: 2, items: { type: 'string', format: 'uri' } }
          },
          required: ['name', 'query']
        }
      }
    })
  },
  {
    name: 'traffic_route_discovery',
    description: 'Find indexed, non-X/non-Threads/non-SEO venues around a concrete product, problem, or audience. Uses cached/quota-accounted SERP queries. A result page does not prove traffic, posting permission, referrals, or conversions.',
    inputSchema: object('Acquisition venue discovery', {
      topic: { type: 'string', minLength: 3, maxLength: 120 },
      geo: { type: 'string', minLength: 2, maxLength: 2 },
      rotation: { type: 'integer', minimum: 0, maximum: 12 },
      maxProbes: { type: 'integer', minimum: 1, maximum: 4 },
      resultsPerProbe: { type: 'integer', minimum: 3, maximum: 10 },
      audience: { type: 'string', enum: ['general', 'fandom', 'creator_community'] },
      observedVenueUrls: { type: 'array', maxItems: 3, items: { type: 'string', format: 'uri' } }
    }, ['topic'])
  },
  {
    name: 'market_intelligence_research',
    description: 'Evidence bundle for product and marketing opportunity research: public market signals, SERP/PAA, Google Ads demand, indexed public social content, creative references, and App Store results. Read-only but may consume SERP/Ads quota; operation-budgeted. Missing coverage blocks market ranking.',
    inputSchema: object('Market/product/marketing evidence', {
      query: { type: 'string', minLength: 1, maxLength: 200 },
      geo: { type: 'string', minLength: 2, maxLength: 2 },
      limit: { type: 'integer', minimum: 1, maximum: 20 },
      tiktokPeriodDays: { type: 'integer', enum: [7, 30, 90] },
      hackerNewsFeed: { type: 'string', enum: ['top', 'new', 'best'] },
      includeTopAds: { type: 'boolean' },
      includePinterest: { type: 'boolean' },
      includeAppStore: { type: 'boolean' },
      includeSocialContent: { type: 'boolean' },
      socialPlatforms: { type: 'array', minItems: 1, maxItems: 3, items: { type: 'string', enum: ['tiktok', 'youtube_shorts', 'instagram_reels'] } },
      researchGoal: { type: 'string', enum: ['general', 'affiliate', 'social_affiliate', 'product_ideation'] }
    })
  }
];

const MARKET_TOOL_NAMES = new Set(marketTools.map(tool => tool.name));

export function isMarketTool(name: string): boolean {
  return MARKET_TOOL_NAMES.has(name);
}

export async function callMarketTool(name: string, input: unknown): Promise<unknown> {
  switch (name) {
    case 'market_signal_scan':
      return marketSignalScan(input as Parameters<typeof marketSignalScan>[0]);
    case 'distribution_case_discovery':
      return distributionCaseDiscovery(input);
    case 'market_discovery_run':
      return marketDiscoveryRun(input);
    case 'traffic_route_discovery':
      return trafficRouteDiscovery(input as Parameters<typeof trafficRouteDiscovery>[0]);
    case 'market_intelligence_research':
      return marketIntelligenceResearch(input as Parameters<typeof marketIntelligenceResearch>[0]);
    default:
      throw new Error('Unknown market tool: ' + name);
  }
}
