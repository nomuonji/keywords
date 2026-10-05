import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { field, firestore, firestoreDocumentName, FirestoreError, value } from '../../db/src/firestore.js';
import { keywordDemand } from '../../keyword-treasury/src/index.js';
import { serpResearchCached } from './remote-keyword-research.js';
import {
  MARKET_SENSOR_SOURCE_IDS,
  marketSignalScan,
  type MarketSignalObservation,
  type MarketSignalScanResult
} from '../../research/src/market-sensors.js';

const REQUEST_TIMEOUT_MS = 12_000;
const snapshotId = z.string().regex(/^[a-zA-Z0-9_-]{1,120}$/);

export const marketIntelligenceResearchShape = {
  query: z.string().trim().min(1).max(200).optional(),
  geo: z.string().length(2).optional(),
  limit: z.number().int().min(1).max(20).optional(),
  tiktokPeriodDays: z.union([z.literal(7), z.literal(30), z.literal(90)]).optional(),
  hackerNewsFeed: z.enum(['top', 'new', 'best']).optional(),
  includeTopAds: z.boolean().optional(),
  includePinterest: z.boolean().optional(),
  includeAppStore: z.boolean().optional()
};

export const marketSignalSnapshotSaveShape = {
  id: snapshotId.optional(),
  label: z.string().trim().min(1).max(200).optional(),
  ...marketIntelligenceResearchShape
};

export const marketSignalSnapshotCompareShape = {
  snapshotId,
  rightSnapshotId: snapshotId.optional(),
  query: z.string().trim().min(1).max(200).optional(),
  geo: z.string().length(2).optional(),
  limit: z.number().int().min(1).max(20).optional(),
  tiktokPeriodDays: z.union([z.literal(7), z.literal(30), z.literal(90)]).optional(),
  hackerNewsFeed: z.enum(['top', 'new', 'best']).optional(),
  includeTopAds: z.boolean().optional(),
  includePinterest: z.boolean().optional(),
  includeAppStore: z.boolean().optional()
};


export interface MarketingMechanicEvidence {
  mechanic: string;
  count: number;
  evidence: Array<{
    source: string;
    label: string;
    excerpt: string;
    url: string | null;
  }>;
}

export interface TopAdObservation {
  key: string;
  label: string;
  url: string;
  description: string;
  likes: number | null;
  likesText: string | null;
  ctrTopPercent: number | null;
  budget: string | null;
  mechanics: string[];
}

export interface AppStoreObservation {
  key: string;
  label: string;
  url: string | null;
  seller: string | null;
  primaryGenre: string | null;
  price: number | null;
  currency: string | null;
  rating: number | null;
  ratingCount: number | null;
  currentVersionReleaseDate: string | null;
}

export interface PinterestObservation {
  key: string;
  label: string;
  url: string;
  metrics: Record<string, number | string | boolean | null>;
}

export interface MarketIntelligencePacket {
  fetchedAt: string;
  query: string | null;
  geo: string;
  signals: MarketSignalScanResult;
  creativeEvidence: {
    source: 'tiktok_top_ads';
    url: string;
    observations: TopAdObservation[];
    mechanics: MarketingMechanicEvidence[];
    warnings: string[];
  };
  pinterest: {
    source: 'pinterest_trends';
    url: string;
    observations: PinterestObservation[];
    warnings: string[];
  };
  commercialization: {
    source: 'app_store';
    query: string | null;
    url: string | null;
    totalCount: number | null;
    observations: AppStoreObservation[];
    metrics: {
      observedAppCount: number;
      paidAppCount: number;
      medianPrice: number | null;
      medianRatingCount: number | null;
      medianRating: number | null;
    };
    warnings: string[];
  };
  thesisFrame: {
    evidenceBySignal: Record<string, Array<{ source: string; label: string; fact: string; url: string | null }>>;
    strongestMechanics: Array<{ mechanic: string; count: number }>;
    commercializationFacts: string[];
    contradictionsAndUnknowns: string[];
    requiredAgentOutput: string[];
  };
  warnings: string[];
}

function decodeHtml(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#([0-9]+);/g, (_match, code) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&nbsp;/gi, ' ');
}

function stripTags(value: string): string {
  return decodeHtml(value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim());
}

function humanNumber(value: string | null): number | null {
  if (!value) return null;
  const cleaned = value.replaceAll(',', '').trim().toUpperCase();
  const match = cleaned.match(/^([0-9]+(?:\.[0-9]+)?)\s*([KMB])?\+?$/);
  if (!match?.[1]) return null;
  const base = Number(match[1]);
  if (!Number.isFinite(base)) return null;
  const multiplier = match[2] === 'K' ? 1_000 : match[2] === 'M' ? 1_000_000 : match[2] === 'B' ? 1_000_000_000 : 1;
  return Math.round(base * multiplier);
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function normalizeKey(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/^#/, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, '-').slice(0, 160);
}

async function fetchText(url: string, accept = 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8') {
  const response = await fetch(url, {
    headers: {
      accept,
      'accept-language': 'en-US,en;q=0.9,ja;q=0.7',
      'user-agent': 'keywords-market-intelligence/1.0 (+read-only public market research)'
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });
  if (!response.ok) throw new Error('HTTP ' + response.status + ' from ' + new URL(url).hostname);
  return { text: await response.text(), finalUrl: response.url, contentType: response.headers.get('content-type') ?? '' };
}

const MECHANIC_RULES: Array<{ mechanic: string; pattern: RegExp }> = [
  { mechanic: 'comparison', pattern: /\b(compar(?:e|es|ed|ing|ison)|versus|\bvs\b|superior|superiority|difference between|real differences?)\b/i },
  { mechanic: 'social_proof', pattern: /\b(testimonial|testimony|review|customers?|users?|people (?:say|love|share))\b/i },
  { mechanic: 'problem_solution', pattern: /\b(problem|pain|struggle|disturbing situation|annoying|frustrating|solution|solve|fix)\b/i },
  { mechanic: 'demonstration', pattern: /\b(showcase|demonstrat(?:e|ion)|how to|tutorial|step[- ]by[- ]step|in action|use case|feature)\b/i },
  { mechanic: 'transformation', pattern: /\b(before and after|before\/after|transformation|results?|changed?|improvement)\b/i },
  { mechanic: 'curiosity_gap', pattern: /\b(curiosity|secret|you won['’]t believe|what happens|guess|surprising|unknown|reveal)\b/i },
  { mechanic: 'identity_inclusion', pattern: /\b(inclusive|diversity|identity|people like you|customer groups?|community)\b/i },
  { mechanic: 'urgency', pattern: /\b(limited|today only|right now|act now|hurry|last chance|ends? soon)\b/i },
  { mechanic: 'ranking_list', pattern: /\b(top\s+\d+|ranking|ranked|best \d+|\d+ reasons?|list of)\b/i },
  { mechanic: 'immersive_spectacle', pattern: /\b(intense|battle|gameplay|scene|transition|sound effect|cinematic|visual effect)\b/i },
  { mechanic: 'personalization', pattern: /\b(personali[sz]ed|your type|for you|recommend(?:ed|ation)|matched to you|customi[sz]ed)\b/i }
];

export function extractMarketingMechanics(text: string): string[] {
  return MECHANIC_RULES.filter(rule => rule.pattern.test(text)).map(rule => rule.mechanic);
}

export function parseTikTokTopAdsHtml(html: string, sourceUrl: string, limit = 10): TopAdObservation[] {
  const text = stripTags(html);
  const segments = text.split(/\bSee analysis\b|\bSee analytics\b|\b分析を確認する\b/i);
  const observations: TopAdObservation[] = [];

  for (const segment of segments) {
    if (observations.length >= limit) break;
    const metrics = segment.match(/([0-9]+(?:\.[0-9]+)?[KMB]?)\s*(?:Likes|いいね数)\s*Top\s*([0-9]+)%\s*CTR\s*(High|Medium|Low|高|中|低)\s*(?:Budget|予算)/i);
    if (!metrics) continue;
    const metricIndex = metrics.index ?? 0;
    const after = segment.slice(metricIndex + metrics[0].length).trim();
    const before = segment.slice(0, metricIndex).trim();
    const description = (after || before.split(/Top Ads Dashboard|Top Ads Spotlight|トップ広告ダッシュボード|Spotlight広告の上位/i).pop() || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 1200);
    const mechanics = extractMarketingMechanics(description);
    observations.push({
      key: 'top-ad-' + (observations.length + 1) + '-' + normalizeKey(description.slice(0, 80)),
      label: description ? description.slice(0, 160) : 'TikTok Top Ad ' + (observations.length + 1),
      url: sourceUrl,
      description,
      likes: humanNumber(metrics[1] ?? null),
      likesText: metrics[1] ?? null,
      ctrTopPercent: metrics[2] ? Number(metrics[2]) : null,
      budget: metrics[3] ?? null,
      mechanics
    });
  }

  return observations;
}

async function tiktokTopAds(geo: string, limit: number) {
  const regionalUrl = 'https://ads.tiktok.com/business/creativecenter/inspiration/topads/pc/en?region=' + encodeURIComponent(geo);
  const spotlightUrl = 'https://ads.tiktok.com/business/creativecenter/tiktok-topads-spotlight/pc/en';
  const urls = [regionalUrl, spotlightUrl];
  const warnings: string[] = [];
  for (const url of urls) {
    try {
      const response = await fetchText(url);
      const observations = parseTikTokTopAdsHtml(response.text, response.finalUrl, limit);
      if (observations.length) {
        if (url === spotlightUrl) warnings.push('Regional Top Ads exposed no parseable server-rendered cards; using global Top Ads Spotlight creative examples as fallback.');
        return { url: response.finalUrl, observations, warnings };
      }
      warnings.push('TikTok Top Ads page loaded but exposed no parseable public ad cards at ' + url);
    } catch (error) {
      warnings.push(error instanceof Error ? error.message : String(error));
    }
  }
  return { url: regionalUrl, observations: [] as TopAdObservation[], warnings };
}

function mechanicsSummary(observations: TopAdObservation[]): MarketingMechanicEvidence[] {
  const grouped = new Map<string, MarketingMechanicEvidence>();
  for (const observation of observations) {
    for (const mechanic of observation.mechanics) {
      const current = grouped.get(mechanic) ?? { mechanic, count: 0, evidence: [] };
      current.count += 1;
      if (current.evidence.length < 5) {
        current.evidence.push({
          source: 'tiktok_top_ads',
          label: observation.label,
          excerpt: observation.description.slice(0, 500),
          url: observation.url
        });
      }
      grouped.set(mechanic, current);
    }
  }
  return [...grouped.values()].sort((left, right) => right.count - left.count || left.mechanic.localeCompare(right.mechanic));
}

async function appStoreResearch(query: string | null, geo: string, limit: number) {
  if (!query) {
    return {
      source: 'app_store' as const,
      query,
      url: null,
      totalCount: null,
      observations: [] as AppStoreObservation[],
      metrics: { observedAppCount: 0, paidAppCount: 0, medianPrice: null, medianRatingCount: null, medianRating: null },
      warnings: ['App Store commercialization check requires a query.']
    };
  }
  const url = new URL('https://itunes.apple.com/search');
  url.searchParams.set('term', query);
  url.searchParams.set('country', geo.toLowerCase());
  url.searchParams.set('entity', 'software');
  url.searchParams.set('limit', String(limit));
  try {
    const response = await fetch(url, {
      headers: { accept: 'application/json', 'user-agent': 'keywords-market-intelligence/1.0' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
    if (!response.ok) throw new Error('HTTP ' + response.status + ' from itunes.apple.com');
    const raw = await response.json() as { resultCount?: number; results?: Array<Record<string, unknown>> };
    const observations = (raw.results ?? []).slice(0, limit).flatMap((item): AppStoreObservation[] => {
      const id = typeof item.trackId === 'number' ? String(item.trackId) : '';
      const label = typeof item.trackName === 'string' ? item.trackName : '';
      if (!id || !label) return [];
      return [{
        key: 'app-' + id,
        label,
        url: typeof item.trackViewUrl === 'string' ? item.trackViewUrl : null,
        seller: typeof item.sellerName === 'string' ? item.sellerName : null,
        primaryGenre: typeof item.primaryGenreName === 'string' ? item.primaryGenreName : null,
        price: typeof item.price === 'number' ? item.price : null,
        currency: typeof item.currency === 'string' ? item.currency : null,
        rating: typeof item.averageUserRating === 'number' ? item.averageUserRating : null,
        ratingCount: typeof item.userRatingCount === 'number' ? item.userRatingCount : null,
        currentVersionReleaseDate: typeof item.currentVersionReleaseDate === 'string' ? item.currentVersionReleaseDate : null
      }];
    });
    const prices = observations.flatMap(item => item.price === null ? [] : [item.price]);
    const ratingCounts = observations.flatMap(item => item.ratingCount === null ? [] : [item.ratingCount]);
    const ratings = observations.flatMap(item => item.rating === null ? [] : [item.rating]);
    return {
      source: 'app_store' as const,
      query,
      url: url.toString(),
      totalCount: typeof raw.resultCount === 'number' ? raw.resultCount : observations.length,
      observations,
      metrics: {
        observedAppCount: observations.length,
        paidAppCount: observations.filter(item => (item.price ?? 0) > 0).length,
        medianPrice: median(prices),
        medianRatingCount: median(ratingCounts),
        medianRating: median(ratings)
      },
      warnings: [] as string[]
    };
  } catch (error) {
    return {
      source: 'app_store' as const,
      query,
      url: url.toString(),
      totalCount: null,
      observations: [] as AppStoreObservation[],
      metrics: { observedAppCount: 0, paidAppCount: 0, medianPrice: null, medianRatingCount: null, medianRating: null },
      warnings: [error instanceof Error ? error.message : String(error)]
    };
  }
}

export function parsePinterestTrendsHtml(html: string, sourceUrl: string, limit = 20): PinterestObservation[] {
  const observations: PinterestObservation[] = [];
  const seen = new Set<string>();
  const patterns = [
    /"(?:keyword|term|search_query|query)"\s*:\s*"([^"\\]{2,120})"/gi,
    /"(?:name|title)"\s*:\s*"([^"\\]{2,120})"\s*,\s*"(?:trend|growth|volume)/gi
  ];
  for (const pattern of patterns) {
    for (const match of html.matchAll(pattern)) {
      if (observations.length >= limit) return observations;
      const label = decodeHtml(match[1] ?? '').trim();
      const key = normalizeKey(label);
      if (!key || seen.has(key) || /^(pinterest|trends?|search)$/i.test(label)) continue;
      seen.add(key);
      observations.push({ key: 'pinterest-' + key, label, url: sourceUrl, metrics: {} });
    }
  }
  return observations;
}

async function pinterestTrends(query: string | null, geo: string, limit: number) {
  const url = new URL('https://trends.pinterest.com/');
  url.searchParams.set('country', geo);
  if (query) url.searchParams.set('searchTerm', query);
  try {
    const response = await fetchText(url.toString());
    const observations = parsePinterestTrendsHtml(response.text, response.finalUrl, limit);
    return {
      source: 'pinterest_trends' as const,
      url: response.finalUrl,
      observations,
      warnings: observations.length ? [] : ['Pinterest Trends public page loaded but exposed no parseable trend payload; official Trends API access is restricted, so this source remains best-effort.']
    };
  } catch (error) {
    return {
      source: 'pinterest_trends' as const,
      url: url.toString(),
      observations: [] as PinterestObservation[],
      warnings: [error instanceof Error ? error.message : String(error)]
    };
  }
}

function signalFact(observation: MarketSignalObservation): string {
  const metrics = Object.entries(observation.metrics)
    .filter(([, value]) => value !== null && value !== '')
    .slice(0, 3)
    .map(([key, value]) => key + '=' + String(value))
    .join(', ');
  return metrics ? observation.label + ' (' + metrics + ')' : observation.label;
}

function buildThesisFrame(
  signals: MarketSignalScanResult,
  mechanics: MarketingMechanicEvidence[],
  commercialization: Awaited<ReturnType<typeof appStoreResearch>>,
  supplementalWarnings: string[]
): MarketIntelligencePacket['thesisFrame'] {
  const evidenceBySignal: Record<string, Array<{ source: string; label: string; fact: string; url: string | null }>> = {};
  for (const result of signals.results) {
    for (const observation of result.observations.slice(0, 5)) {
      for (const kind of result.signalKind) {
        const list = evidenceBySignal[kind] ?? [];
        list.push({ source: result.source, label: observation.label, fact: signalFact(observation), url: observation.url });
        evidenceBySignal[kind] = list.slice(0, 12);
      }
    }
  }
  const commercializationFacts: string[] = [];
  if (commercialization.query) {
    commercializationFacts.push(
      'App Store query "' + commercialization.query + '" returned ' + String(commercialization.totalCount ?? commercialization.observations.length) + ' results.'
    );
    if (commercialization.metrics.observedAppCount) {
      commercializationFacts.push(
        String(commercialization.metrics.paidAppCount) + '/' + String(commercialization.metrics.observedAppCount) + ' observed apps are paid upfront.'
      );
      if (commercialization.metrics.medianRatingCount !== null) {
        commercializationFacts.push('Median observed rating count: ' + String(Math.round(commercialization.metrics.medianRatingCount)) + '.');
      }
    }
  }
  const contradictionsAndUnknowns = [
    'Attention/search/ad metrics do not prove willingness to pay or unit sales.',
    ...(commercialization.query && commercialization.observations.length === 0 ? ['No App Store commercialization evidence was retrieved for the supplied query.'] : []),
    ...(mechanics.length === 0 ? ['No reliable creative mechanic was extracted from the currently public Top Ads surface.'] : []),
    ...supplementalWarnings.slice(0, 5)
  ];
  return {
    evidenceBySignal,
    strongestMechanics: mechanics.slice(0, 8).map(item => ({ mechanic: item.mechanic, count: item.count })),
    commercializationFacts,
    contradictionsAndUnknowns: [...new Set(contradictionsAndUnknowns)],
    requiredAgentOutput: [
      'Write 1-3 market theses only after reading the evidence above.',
      'For each thesis, cite at least two independent observed sources when available.',
      'State the underlying behavior/desire, its current fulfillment, and the marketing mechanic that appears to trigger attention.',
      'Propose adjacency dimensions (audience, format, context, social loop, output artifact, distribution, business model) before proposing products.',
      'Classify each resulting concept as copy_like, adjacent, or speculative and explain why.',
      'State disconfirming evidence, payment unknowns, and the next cheapest validation step. Do not invent missing market pain.'
    ]
  };
}

export async function marketIntelligenceResearch(input: unknown = {}): Promise<MarketIntelligencePacket> {
  const args = z.object(marketIntelligenceResearchShape).strict().parse(input);
  const geo = (args.geo ?? 'JP').toUpperCase();
  const limit = args.limit ?? 10;
  const query = args.query?.trim() || null;
  const includeTopAds = args.includeTopAds ?? true;
  const includePinterest = args.includePinterest ?? true;
  const includeAppStore = args.includeAppStore ?? true;

  const [signals, topAdsResult, pinterestResult, appStoreResult] = await Promise.all([
    marketSignalScan({
      sources: [...MARKET_SENSOR_SOURCE_IDS],
      geo,
      limit,
      tiktokPeriodDays: args.tiktokPeriodDays,
      hackerNewsFeed: args.hackerNewsFeed
    }),
    includeTopAds ? tiktokTopAds(geo, Math.min(limit, 10)) : Promise.resolve({ url: '', observations: [] as TopAdObservation[], warnings: ['TikTok Top Ads was disabled for this research call.'] }),
    includePinterest ? pinterestTrends(query, geo, limit) : Promise.resolve({ source: 'pinterest_trends' as const, url: '', observations: [] as PinterestObservation[], warnings: ['Pinterest Trends was disabled for this research call.'] }),
    includeAppStore ? appStoreResearch(query, geo, limit) : Promise.resolve({
      source: 'app_store' as const,
      query,
      url: null,
      totalCount: null,
      observations: [] as AppStoreObservation[],
      metrics: { observedAppCount: 0, paidAppCount: 0, medianPrice: null, medianRatingCount: null, medianRating: null },
      warnings: ['App Store commercialization check was disabled for this research call.']
    })
  ]);

  const mechanics = mechanicsSummary(topAdsResult.observations);
  const warnings = [
    ...signals.warnings,
    ...topAdsResult.warnings,
    ...pinterestResult.warnings,
    ...appStoreResult.warnings
  ];

  return {
    fetchedAt: new Date().toISOString(),
    query,
    geo,
    signals,
    creativeEvidence: {
      source: 'tiktok_top_ads',
      url: topAdsResult.url,
      observations: topAdsResult.observations,
      mechanics,
      warnings: topAdsResult.warnings
    },
    pinterest: pinterestResult,
    commercialization: appStoreResult,
    thesisFrame: buildThesisFrame(signals, mechanics, appStoreResult, warnings),
    warnings
  };
}

interface SnapshotDocument {
  id: string;
  label: string;
  query: string | null;
  geo: string;
  createdAt: string;
  packet: MarketIntelligencePacket;
}

function parseDoc<T>(doc: any): T {
  return { id: String(doc.name ?? '').split('/').pop() ?? '', ...Object.fromEntries(Object.entries(doc.fields ?? {}).map(([key, item]) => [key, value(item)])) } as T;
}

async function readSnapshot(idValue: string): Promise<SnapshotDocument> {
  try {
    const doc = await firestore('/marketSignalSnapshots/' + snapshotId.parse(idValue));
    return parseDoc<SnapshotDocument>(doc);
  } catch (error) {
    if (error instanceof FirestoreError && error.status === 404) throw new Error('Market signal snapshot not found: ' + idValue);
    throw error;
  }
}

export async function marketSignalSnapshotSave(input: unknown) {
  const args = z.object(marketSignalSnapshotSaveShape).strict().parse(input);
  const packet = await marketIntelligenceResearch({
    query: args.query,
    geo: args.geo,
    limit: args.limit,
    tiktokPeriodDays: args.tiktokPeriodDays,
    hackerNewsFeed: args.hackerNewsFeed,
    includeTopAds: args.includeTopAds,
    includePinterest: args.includePinterest,
    includeAppStore: args.includeAppStore
  });
  const idValue = args.id ?? ('market-' + Date.now().toString(36) + '-' + randomUUID().slice(0, 8));
  const createdAt = new Date().toISOString();
  const doc: SnapshotDocument = {
    id: idValue,
    label: args.label ?? [packet.query, packet.geo, createdAt.slice(0, 10)].filter(Boolean).join(' / '),
    query: packet.query,
    geo: packet.geo,
    createdAt,
    packet
  };
  if (Buffer.byteLength(JSON.stringify(doc), 'utf8') > 850000) throw new Error('Market snapshot exceeds Firestore document budget; reduce limit or sources.');
  const runId = randomUUID();
  await firestore(':commit', {
    method: 'POST',
    body: JSON.stringify({
      writes: [
        {
          update: {
            name: firestoreDocumentName('marketSignalSnapshots/' + idValue),
            fields: Object.fromEntries(Object.entries(doc).map(([key, item]) => [key, field(item)]))
          },
          currentDocument: { exists: false }
        },
        {
          update: {
            name: firestoreDocumentName('runs/' + runId),
            fields: Object.fromEntries(Object.entries({
              id: runId,
              command: 'market_signal_snapshot_save',
              targetId: idValue,
              actor: 'remote_mcp',
              createdAt,
              outcome: 'succeeded'
            }).map(([key, item]) => [key, field(item)]))
          },
          currentDocument: { exists: false }
        }
      ]
    })
  });
  return { id: idValue, label: doc.label, query: doc.query, geo: doc.geo, createdAt, runId, packet };
}

interface FlatObservation {
  source: string;
  key: string;
  label: string;
  metrics: Record<string, number | string | boolean | null>;
}

function flattenPacket(packet: MarketIntelligencePacket): FlatObservation[] {
  const items: FlatObservation[] = [];
  for (const result of packet.signals.results) {
    for (const observation of result.observations) {
      items.push({
        source: result.source,
        key: normalizeKey(observation.label),
        label: observation.label,
        metrics: observation.metrics
      });
    }
  }
  for (const observation of packet.creativeEvidence.observations) {
    items.push({
      source: 'tiktok_top_ads',
      key: observation.key,
      label: observation.label,
      metrics: { likes: observation.likes, ctrTopPercent: observation.ctrTopPercent, budget: observation.budget }
    });
  }
  for (const observation of packet.pinterest.observations) {
    items.push({ source: 'pinterest_trends', key: observation.key, label: observation.label, metrics: observation.metrics });
  }
  for (const observation of packet.commercialization.observations) {
    items.push({
      source: 'app_store',
      key: observation.key,
      label: observation.label,
      metrics: { price: observation.price, rating: observation.rating, ratingCount: observation.ratingCount }
    });
  }
  return items;
}

export function compareMarketPackets(left: MarketIntelligencePacket, right: MarketIntelligencePacket) {
  const leftMap = new Map(flattenPacket(left).map(item => [item.source + ':' + item.key, item]));
  const rightMap = new Map(flattenPacket(right).map(item => [item.source + ':' + item.key, item]));
  const added: FlatObservation[] = [];
  const removed: FlatObservation[] = [];
  const matched: Array<{
    source: string;
    key: string;
    label: string;
    metricDeltas: Array<{ metric: string; before: number; after: number; delta: number; relativeDelta: number | null }>;
  }> = [];

  for (const [key, rightItem] of rightMap) {
    const leftItem = leftMap.get(key);
    if (!leftItem) {
      added.push(rightItem);
      continue;
    }
    const metricDeltas: Array<{ metric: string; before: number; after: number; delta: number; relativeDelta: number | null }> = [];
    for (const metric of new Set([...Object.keys(leftItem.metrics), ...Object.keys(rightItem.metrics)])) {
      const before = leftItem.metrics[metric];
      const after = rightItem.metrics[metric];
      if (typeof before !== 'number' || typeof after !== 'number' || !Number.isFinite(before) || !Number.isFinite(after) || before === after) continue;
      metricDeltas.push({
        metric,
        before,
        after,
        delta: after - before,
        relativeDelta: before === 0 ? null : (after - before) / Math.abs(before)
      });
    }
    matched.push({ source: rightItem.source, key: rightItem.key, label: rightItem.label, metricDeltas });
  }
  for (const [key, leftItem] of leftMap) {
    if (!rightMap.has(key)) removed.push(leftItem);
  }

  const velocityHighlights = matched
    .flatMap(item => item.metricDeltas.map(delta => ({ ...delta, source: item.source, key: item.key, label: item.label })))
    .sort((left, right) => Math.abs(right.relativeDelta ?? 0) - Math.abs(left.relativeDelta ?? 0) || Math.abs(right.delta) - Math.abs(left.delta))
    .slice(0, 30);

  const sourceSummary: Record<string, { added: number; removed: number; matched: number; changed: number }> = {};
  for (const source of new Set([...leftMap.values(), ...rightMap.values()].map(item => item.source))) {
    sourceSummary[source] = {
      added: added.filter(item => item.source === source).length,
      removed: removed.filter(item => item.source === source).length,
      matched: matched.filter(item => item.source === source).length,
      changed: matched.filter(item => item.source === source && item.metricDeltas.length > 0).length
    };
  }

  return {
    leftFetchedAt: left.fetchedAt,
    rightFetchedAt: right.fetchedAt,
    queryChanged: left.query !== right.query,
    geoChanged: left.geo !== right.geo,
    sourceSummary,
    added: added.slice(0, 50),
    removed: removed.slice(0, 50),
    velocityHighlights,
    guidance: [
      'An entry appearing or disappearing from a ranked/trending surface is a rank-set change, not proof of demand growth or collapse.',
      'Relative deltas are meaningful only for comparable numeric metrics from the same source and label.',
      'Use velocity as a trigger for deeper validation, not as an automatic product decision.'
    ]
  };
}

export async function marketSignalSnapshotCompare(input: unknown) {
  const args = z.object(marketSignalSnapshotCompareShape).strict().parse(input);
  const left = await readSnapshot(args.snapshotId);
  if (args.rightSnapshotId) {
    const right = await readSnapshot(args.rightSnapshotId);
    return {
      baseline: { id: left.id, label: left.label, createdAt: left.createdAt, query: left.query, geo: left.geo },
      comparison: { id: right.id, label: right.label, createdAt: right.createdAt, query: right.query, geo: right.geo },
      delta: compareMarketPackets(left.packet, right.packet)
    };
  }

  const current = await marketIntelligenceResearch({
    query: args.query ?? left.query ?? undefined,
    geo: args.geo ?? left.geo,
    limit: args.limit,
    tiktokPeriodDays: args.tiktokPeriodDays,
    hackerNewsFeed: args.hackerNewsFeed,
    includeTopAds: args.includeTopAds,
    includePinterest: args.includePinterest,
    includeAppStore: args.includeAppStore
  });
  return {
    baseline: { id: left.id, label: left.label, createdAt: left.createdAt, query: left.query, geo: left.geo },
    comparison: { id: null, label: 'live', createdAt: current.fetchedAt, query: current.query, geo: current.geo },
    current,
    delta: compareMarketPackets(left.packet, current)
  };
}
