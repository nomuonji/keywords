import { z } from 'zod';
import { publicEvidenceUrl } from './search-gap-research.js';
import { keywordDemand, treasurySave } from '../../keyword-treasury/src/index.js';
import {
  googleAdsDirectConfiguration,
  googleAdsKeywordHistoricalMetricsDirect,
  sanitizeGoogleAdsError
} from '../../research/src/google-ads-direct.js';
import {
  keywordScreenCriteriaShape,
  screenDemandResults,
  serpResearchCached,
  serpUsageStatus
} from './remote-keyword-research.js';

const keywordList = z.array(z.string().trim().min(1).max(500)).min(1).max(50);
const demandShape = {
  keywords: keywordList,
  languageConstant: z.string().optional(),
  geoTargetConstants: z.array(z.string()).optional(),
  includeAdultKeywords: z.boolean().optional()
};

export const keywordScreenBatchShape = {
  ...demandShape,
  criteria: z.object(keywordScreenCriteriaShape).strict().optional()
};

export const keywordResearchPipelineShape = {
  ...keywordScreenBatchShape,
  maxSerpChecks: z.number().int().min(0).max(10).default(5),
  maxObservationChecks: z.number().int().min(0).max(10).default(2),
  observedCandidates: z.array(z.object({
    keyword: z.string().trim().min(1).max(500),
    sourceUrl: publicEvidenceUrl,
    observedAt: z.string().datetime({ offset: true }),
    excerpt: z.string().trim().min(1).max(2000),
    researchReason: z.string().trim().min(1).max(2000)
  }).strict()).max(20).default([]),
  country: z.string().min(2).max(2).optional(),
  language: z.string().min(2).max(10).optional(),
  location: z.string().max(200).optional(),
  num: z.number().int().min(1).max(20).optional(),
  provider: z.enum(['api', 'brave', 'serper']).optional()
};

const treasuryCandidate = z.object({
  keyword: z.string().trim().min(1).max(500),
  seed: z.string().max(500).optional(),
  status: z.enum(['inbox', 'shortlisted', 'rejected', 'published']).optional(),
  notes: z.string().max(4000).optional(),
  volume: z.number().nullable().optional(),
  competition: z.union([z.string(), z.number()]).nullable().optional(),
  allintitle: z.number().nullable().optional(),
  serpWeakness: z.number().nullable().optional(),
  source: z.string().max(200).optional(),
  evidence: z.record(z.string(), z.unknown()).optional(),
  avgMonthlySearches: z.number().nullable().optional(),
  averageCpcMicros: z.number().nullable().optional(),
  competitionIndex: z.number().nullable().optional(),
  opportunityScore: z.number().nullable().optional(),
  weakDomainCount: z.number().nullable().optional(),
  forumCount: z.number().nullable().optional(),
  stalePageCount: z.number().nullable().optional(),
  exactTitleCount: z.number().nullable().optional(),
  demandResearchedAt: z.string().nullable().optional(),
  serpResearchedAt: z.string().nullable().optional(),
  country: z.string().nullable().optional(),
  language: z.string().nullable().optional()
}).strict();

export const keywordTreasurySaveShape = {
  candidates: z.array(treasuryCandidate).min(1).max(100)
};

type DemandInput = {
  keywords: string[];
  languageConstant?: string;
  geoTargetConstants?: string[];
  includeAdultKeywords?: boolean;
};
let googleAdsDirectLastError: string | null = null;

function demandInput(args: DemandInput) {
  return {
    keywords: args.keywords,
    languageConstant: args.languageConstant,
    geoTargetConstants: args.geoTargetConstants,
    includeAdultKeywords: args.includeAdultKeywords
  };
}

export function keywordResearchProviderStatus() {
  const direct = googleAdsDirectConfiguration();
  return {
    googleAdsDemandProviderOrder: ['proxy', 'direct'] as const,
    googleAdsDirectConfigured: direct.configured,
    googleAdsDirectConfiguration: direct,
    googleAdsDirectLastError
  };
}

export async function keywordDemandWithFallback(input: unknown) {
  const args = z.object(demandShape).strict().parse(input) as DemandInput;
  let proxyProviderError: string | null = null;
  try {
    const result = await keywordDemand(args);
    googleAdsDirectLastError = null;
    return { ...result, fallbackUsed: false, providerRoute: 'proxy' as const };
  } catch (error) {
    proxyProviderError = sanitizeGoogleAdsError(error);
  }
  try {
    const result = await googleAdsKeywordHistoricalMetricsDirect({
      keywords: args.keywords,
      languageId: args.languageConstant,
      geoTargetIds: args.geoTargetConstants,
      includeAdultKeywords: args.includeAdultKeywords
    });
    googleAdsDirectLastError = null;
    return { ...result, fallbackUsed: true, providerRoute: 'direct_fallback' as const, proxyProviderError };
  } catch (error) {
    const directProviderError = sanitizeGoogleAdsError(error);
    googleAdsDirectLastError = directProviderError;
    throw new Error(`Google Ads proxy failed: ${proxyProviderError}; direct fallback failed: ${directProviderError}`);
  }
}

export async function keywordScreenBatch(input: unknown) {
  const args = z.object(keywordScreenBatchShape).strict().parse(input);
  const demand = await keywordDemandWithFallback(demandInput(args));
  const screening = screenDemandResults(demand.results, args.criteria ?? {});
  return { demand, screening };
}

export async function keywordResearchPipeline(input: unknown, demandProvider: (input: DemandInput) => ReturnType<typeof keywordDemandWithFallback> = keywordDemandWithFallback) {
  const args = z.object(keywordResearchPipelineShape).strict().parse(input);
  const normalize = (keyword: string) => keyword.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
  const supplied = new Set(args.keywords.map(normalize));
  for (const candidate of args.observedCandidates) {
    if (!supplied.has(normalize(candidate.keyword))) throw new Error('Every observedCandidate keyword must be included in keywords');
  }
  let demand;
  let demandError: string | null = null;
  try {
    demand = await demandProvider(demandInput(args));
  } catch (error) {
    // A missing demand provider must not block bounded investigation of actual observations.
    if (!args.observedCandidates.length || args.maxObservationChecks === 0) throw error;
    demandError = sanitizeGoogleAdsError(error);
    demand = { provider: 'unavailable', results: [], providerError: demandError };
  }
  const screening = screenDemandResults(demand.results, args.criteria ?? {});
  const selected: Array<{ keyword: string; selectionBasis: 'observation' | 'demand'; observation?: typeof args.observedCandidates[number]; screenScore: number | null }> = [];
  const seen = new Set<string>();
  const add = (candidate: typeof selected[number]) => {
    const key = normalize(candidate.keyword);
    if (seen.has(key) || selected.length >= args.maxSerpChecks) return;
    seen.add(key);
    selected.push(candidate);
  };
  const observed = [...new Map(args.observedCandidates.map(candidate => [normalize(candidate.keyword), candidate])).values()];
  // Reserve investigation capacity before selecting the old numeric shortlist.
  for (const observation of observed.slice(0, Math.min(args.maxObservationChecks, args.maxSerpChecks))) {
    add({ keyword: observation.keyword, selectionBasis: 'observation', observation, screenScore: null });
  }
  for (const candidate of screening.results.filter(item => item.passed)) {
    add({ keyword: candidate.keyword, selectionBasis: 'demand', screenScore: candidate.screenScore });
  }
  const serpChecks: Array<Record<string, unknown>> = [];
  let stoppedReason: string | null = null;
  for (const candidate of selected) {
    try {
      const result = await serpResearchCached({
        query: candidate.keyword,
        country: args.country,
        language: args.language,
        location: args.location,
        num: args.num,
        provider: args.provider,
        forceRefresh: false
      });
      serpChecks.push({ ...candidate, ...result });
    } catch (error) {
      stoppedReason = error instanceof Error ? error.message : String(error);
      if (/SERP .*limit|quota|reserve|Firestore request failed \(429\)/i.test(stoppedReason)) break;
      serpChecks.push({ ...candidate, error: stoppedReason });
    }
  }
  let usage: Awaited<ReturnType<typeof serpUsageStatus>> | null = null;
  let usageError: string | null = null;
  try {
    usage = await serpUsageStatus();
  } catch (error) {
    usageError = (error instanceof Error ? error.message : String(error)).slice(0, 700);
    if (!stoppedReason) stoppedReason = usageError;
  }
  return {
    demand,
    demandError,
    screening,
    maxSerpChecks: args.maxSerpChecks,
    maxObservationChecks: args.maxObservationChecks,
    selection: selected,
    selectedForSerp: selected.map(item => item.keyword),
    serpChecks,
    stoppedReason,
    usage,
    usageError,
    guidance: 'Observation-led checks bypass numeric screening only for investigation, never as proof of measured demand or an unmet need. Preserve unknown metrics. Use search_gap_research to read page bodies before promotion; screenScore is a legacy budget hint, not SEO difficulty or a ranking prediction.'
  };
}

function assertGscFeedbackProvenance(candidate: z.infer<typeof treasuryCandidate>) {
  if (candidate.source !== 'gsc_feedback') return;
  const evidence = candidate.evidence;
  if (!evidence
    || typeof evidence.siteId !== 'string'
    || typeof evidence.snapshotId !== 'string'
    || typeof evidence.previousSnapshotId !== 'string'
    || !evidence.gsc
    || typeof evidence.gsc !== 'object') {
    throw new Error('gsc_feedback Treasury candidates require evidence.siteId, snapshotId, previousSnapshotId and the original gsc candidate row');
  }
}

export async function keywordTreasurySave(input: unknown) {
  const args = z.object(keywordTreasurySaveShape).strict().parse(input);
  for (const candidate of args.candidates) assertGscFeedbackProvenance(candidate);
  return treasurySave(args.candidates);
}
