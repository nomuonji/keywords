import { z } from 'zod';
import { keywordDemandWithFallback } from './keyword-research-pipeline.js';
import {
  screenDemandResults,
  serpResearchCached,
  serpUsageStatus
} from './remote-keyword-research.js';
import { siteStructureGet } from './site-structure.js';

const keywordList = z.array(z.string().trim().min(1).max(500)).min(1).max(50);
const siteConceptId = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);

export const trendArticleResearchShape = {
  topic: z.string().trim().min(1).max(500),
  keywords: keywordList,
  sourceUrls: z.array(z.string().url().max(2000)).max(30).optional(),
  detectedAt: z.string().datetime({ offset: true }).optional(),
  siteConceptId: siteConceptId.optional(),
  maxSerpChecks: z.number().int().min(0).max(5).default(3),
  languageConstant: z.string().optional(),
  geoTargetConstants: z.array(z.string()).max(10).optional(),
  includeAdultKeywords: z.boolean().optional(),
  country: z.string().min(2).max(2).optional(),
  language: z.string().min(2).max(10).optional(),
  location: z.string().max(200).optional(),
  num: z.number().int().min(1).max(20).default(10),
  provider: z.enum(['api', 'brave', 'serper']).optional()
};

function normalized(value: string) {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}
function finite(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}
function uniqueKeywords(items: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items) {
    const key = normalized(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(item.trim());
  }
  return result;
}

export function selectTrendSerpKeywords(
  inputOrder: string[],
  screened: Array<{ keyword: string; avgMonthlySearches?: number | null; screenScore?: number | null }>,
  limit: number
) {
  if (limit <= 0) return [];
  const positiveDemand = screened
    .filter(item => finite(item.avgMonthlySearches) > 0)
    .sort((a, b) => finite(b.screenScore) - finite(a.screenScore))
    .map(item => item.keyword);

  // Historical demand is lagging evidence. Fresh X trends with zero recorded
  // volume remain eligible and fill the remaining SERP budget in caller order.
  return uniqueKeywords([...positiveDemand, ...inputOrder]).slice(0, limit);
}

function existingPageMatches(siteContext: any, keywords: string[]) {
  if (!siteContext || !Array.isArray(siteContext.nodes)) return [];
  const keywordById = new Map(
    (Array.isArray(siteContext.keywords) ? siteContext.keywords : [])
      .filter((item: any) => item && typeof item.id === 'string' && typeof item.keyword === 'string')
      .map((item: any) => [item.id, item.keyword])
  );
  const matches: Array<Record<string, unknown>> = [];
  for (const node of siteContext.nodes) {
    const linkedKeywords = (Array.isArray(node.keywordIds) ? node.keywordIds : [])
      .map((id: string) => keywordById.get(id))
      .filter(Boolean) as string[];
    const fields = [node.title, node.path, node.purpose, node.notes, ...linkedKeywords]
      .filter((value): value is string => typeof value === 'string' && Boolean(value.trim()));
    const haystack = normalized(fields.join(' '));
    const matchedKeywords = keywords.filter(keyword => {
      const needle = normalized(keyword);
      if (needle.length < 2) return false;
      return haystack.includes(needle) || linkedKeywords.some(linked => normalized(linked) === needle);
    });
    if (matchedKeywords.length) {
      matches.push({
        nodeId: node.id,
        title: node.title,
        path: node.path,
        kind: node.kind,
        matchedKeywords
      });
    }
  }
  return matches;
}

export async function trendArticleResearch(input: unknown) {
  const args = z.object(trendArticleResearchShape).strict().parse(input);
  const keywords = uniqueKeywords(args.keywords);
  const demand = await keywordDemandWithFallback({
    keywords,
    languageConstant: args.languageConstant,
    geoTargetConstants: args.geoTargetConstants,
    includeAdultKeywords: args.includeAdultKeywords
  });
  const screening = screenDemandResults(demand.results, {});
  const selectedForSerp = selectTrendSerpKeywords(keywords, screening.results, args.maxSerpChecks);

  const serpChecks: Array<Record<string, unknown>> = [];
  let stoppedReason: string | null = null;
  for (const keyword of selectedForSerp) {
    try {
      const result = await serpResearchCached({
        query: keyword,
        country: args.country,
        language: args.language,
        location: args.location,
        num: args.num,
        provider: args.provider,
        forceRefresh: false
      });
      serpChecks.push({ keyword, ...result });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      stoppedReason = message;
      if (/SERP .*limit|quota|reserve|Firestore request failed \(429\)/i.test(message)) break;
      serpChecks.push({ keyword, error: message.slice(0, 700) });
    }
  }

  let siteContext: any = null;
  let siteContextError: string | null = null;
  if (args.siteConceptId) {
    try {
      siteContext = await siteStructureGet({ id: args.siteConceptId });
    } catch (error) {
      siteContextError = (error instanceof Error ? error.message : String(error)).slice(0, 700);
    }
  }

  let usage: Awaited<ReturnType<typeof serpUsageStatus>> | null = null;
  let usageError: string | null = null;
  try {
    usage = await serpUsageStatus();
  } catch (error) {
    usageError = (error instanceof Error ? error.message : String(error)).slice(0, 700);
  }

  const demandByKeyword = new Map(
    demand.results.map((item: any) => [normalized(String(item.keyword ?? '')), item])
  );
  const keywordSignals = keywords.map(keyword => {
    const metric: any = demandByKeyword.get(normalized(keyword)) ?? {};
    return {
      keyword,
      avgMonthlySearches: metric.avgMonthlySearches ?? null,
      averageCpcMicros: metric.averageCpcMicros ?? null,
      competitionIndex: metric.competitionIndex ?? null,
      historicalDemandObserved: finite(metric.avgMonthlySearches) > 0,
      selectedForSerp: selectedForSerp.some(item => normalized(item) === normalized(keyword))
    };
  });

  return {
    topic: args.topic,
    detectedAt: args.detectedAt ?? null,
    sourceUrls: args.sourceUrls ?? [],
    keywordSignals,
    demand,
    screening,
    selectedForSerp,
    serpChecks,
    stoppedReason,
    siteConceptId: args.siteConceptId ?? null,
    siteContext,
    siteContextError,
    existingPageMatches: existingPageMatches(siteContext, keywords),
    usage,
    usageError,
    interpretation: {
      historicalDemand: 'Google Ads demand is historical and can lag a fresh trend. Zero-volume trend terms are not automatically rejected.',
      serpBudget: 'SERP checks are quota-aware, cached, and capped per call. Positive historical demand is checked first; remaining capacity follows caller keyword priority.',
      siteOverlap: 'existingPageMatches is a literal overlap hint only. The caller must still compare search intent before choosing new article vs existing-page update.'
    }
  };
}
