import { z } from 'zod';
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
  country: z.string().min(2).max(2).optional(),
  language: z.string().min(2).max(10).optional(),
  location: z.string().max(200).optional(),
  num: z.number().int().min(1).max(20).optional(),
  provider: z.enum(['brave', 'serper']).optional()
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

export async function keywordResearchPipeline(input: unknown) {
  const args = z.object(keywordResearchPipelineShape).strict().parse(input);
  const demand = await keywordDemandWithFallback(demandInput(args));
  const screening = screenDemandResults(demand.results, args.criteria ?? {});
  const selected = screening.results.filter(item => item.passed).slice(0, args.maxSerpChecks);
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
      serpChecks.push({ keyword: candidate.keyword, screenScore: candidate.screenScore, ...result });
    } catch (error) {
      stoppedReason = error instanceof Error ? error.message : String(error);
      if (/SERP .*limit|quota|reserve|Firestore request failed \(429\)/i.test(stoppedReason)) break;
      serpChecks.push({ keyword: candidate.keyword, screenScore: candidate.screenScore, error: stoppedReason });
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
    screening,
    maxSerpChecks: args.maxSerpChecks,
    selectedForSerp: selected.map(item => item.keyword),
    serpChecks,
    stoppedReason,
    usage,
    usageError
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
