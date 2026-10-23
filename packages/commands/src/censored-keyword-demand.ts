import { z } from 'zod';
import { keywordDemand } from '../../keyword-treasury/src/index.js';
import { bingKeywordStats, type BingKeywordStat } from '../../research/src/bing-keyword-stats.js';
import { seoPlanningDigestGet } from './seo-planning-digest.js';

// Google Ads Keyword Planner returns 0 for some adult head terms (e.g. 風俗, デリヘル, ソープランド)
// even with includeAdultKeywords. This command estimates their Google-scale demand from Bing
// Webmaster impressions, calibrated on anchors whose Google volume is known:
//  - anchor ratio  = Google Ads volume / Bing monthly impressions (same genre, live-fetched)
//  - GSC ratio     = own-site GSC impressions at top positions / Bing monthly impressions (optional)
// Bing in Japan is desktop-heavy, so ratios differ by term type; head terms and modified terms
// (place/qualifier + term) are calibrated separately when enough anchors exist.

export const ANCHOR_PRESETS = {
  jp_adult_nightlife: [
    '吉原 ソープ', '雄琴 ソープ', '中洲 ソープ', 'すすきの ソープ', 'メンエス',
    'メンズ エステ', 'ピンサロ', 'ソープ', '吉原', 'ソープ 嬢'
  ]
} as const;

const keywordText = z.string().trim().min(1).max(200);

export const bingKeywordStatsShape = {
  keywords: z.array(keywordText).min(1).max(50),
  country: z.string().regex(/^[a-zA-Z]{2}$/).optional(),
  language: z.string().regex(/^[a-zA-Z]{2,3}(-[a-zA-Z]{2,4})?$/).optional()
};

export const censoredKeywordDemandEstimateShape = {
  keywords: z.array(keywordText).min(1).max(30),
  anchorPreset: z.enum(['jp_adult_nightlife', 'none']).default('jp_adult_nightlife'),
  anchorKeywords: z.array(keywordText).max(30).default([]),
  gscSiteId: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/).optional(),
  gscMaxPosition: z.number().min(1).max(10).default(3),
  gscMinImpressions: z.number().int().min(1).max(100_000).default(30),
  gscMaxAnchors: z.number().int().min(0).max(30).default(20),
  country: z.string().regex(/^[a-zA-Z]{2}$/).default('jp'),
  language: z.string().regex(/^[a-zA-Z]{2,3}(-[a-zA-Z]{2,4})?$/).default('ja-JP'),
  languageConstant: z.string().optional(),
  geoTargetConstants: z.array(z.string()).optional()
};

export type TermClass = 'head' | 'modified';

export type CalibrationAnchor = {
  keyword: string;
  termClass: TermClass;
  source: 'google_ads' | 'gsc';
  referenceMonthly: number;
  bingMonthly: number;
  ratio: number;
};

export type RatioStats = { n: number; median: number; q1: number; q3: number } | null;

export function normalizeKey(keyword: string) {
  return keyword.normalize('NFKC').toLowerCase().replace(/\s+/g, '');
}

export function termClass(keyword: string): TermClass {
  return keyword.normalize('NFKC').trim().split(/\s+/).filter(Boolean).length > 1 ? 'modified' : 'head';
}

function quantile(sorted: number[], q: number) {
  if (!sorted.length) return NaN;
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

export function ratioStats(ratios: number[]): RatioStats {
  const sorted = ratios.filter(value => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
  if (!sorted.length) return null;
  return { n: sorted.length, median: quantile(sorted, 0.5), q1: quantile(sorted, 0.25), q3: quantile(sorted, 0.75) };
}

export function buildCalibration(anchors: CalibrationAnchor[], minPerClass = 3) {
  const overall = ratioStats(anchors.map(anchor => anchor.ratio));
  const byClass = {
    head: ratioStats(anchors.filter(anchor => anchor.termClass === 'head').map(anchor => anchor.ratio)),
    modified: ratioStats(anchors.filter(anchor => anchor.termClass === 'modified').map(anchor => anchor.ratio))
  };
  const pick = (cls: TermClass): { stats: RatioStats; basis: string } => {
    const classStats = byClass[cls];
    if (classStats && classStats.n >= minPerClass) return { stats: classStats, basis: `${cls}_terms` };
    return { stats: overall, basis: 'all_terms' };
  };
  // Leave-one-out: how far each anchor is predicted by the others (honest error estimate).
  const leaveOneOut = anchors.map(anchor => {
    const others = anchors.filter(other => other !== anchor);
    const classOthers = others.filter(other => other.termClass === anchor.termClass);
    const stats = ratioStats((classOthers.length >= minPerClass ? classOthers : others).map(other => other.ratio));
    const predicted = stats ? anchor.bingMonthly * stats.median : null;
    return {
      keyword: anchor.keyword,
      actual: anchor.referenceMonthly,
      predicted: predicted === null ? null : Math.round(predicted),
      errorRatio: predicted === null ? null : Number(((predicted - anchor.referenceMonthly) / anchor.referenceMonthly).toFixed(3))
    };
  });
  const absErrors = leaveOneOut.map(row => row.errorRatio).filter((value): value is number => value !== null).map(Math.abs).sort((a, b) => a - b);
  return {
    overall,
    byClass,
    pick,
    leaveOneOut,
    medianAbsoluteError: absErrors.length ? Number(quantile(absErrors, 0.5).toFixed(3)) : null
  };
}

export function estimateFromBing(bingMonthly: number | null, stats: RatioStats) {
  if (!bingMonthly || !stats) return null;
  return {
    mid: Math.round(bingMonthly * stats.median),
    low: Math.round(bingMonthly * stats.q1),
    high: Math.round(bingMonthly * stats.q3),
    ratio: Number(stats.median.toFixed(1)),
    anchorsUsed: stats.n
  };
}

type DemandRow = { keyword: string; avgMonthlySearches: number | null };
type GscRow = { query: string; impressions: number | null; averagePosition: number | null };

export type CensoredDemandDeps = {
  demand?: (keywords: string[]) => Promise<{ results: DemandRow[] }>;
  bing?: typeof bingKeywordStats;
  gsc?: (siteId: string) => Promise<{ periodDays: number; periodStart: string; periodEnd: string; rows: GscRow[] } | null>;
};

async function defaultGsc(siteId: string) {
  const digest: any = await seoPlanningDigestGet({ siteId });
  const period = digest?.periods?.current28;
  const rows = digest?.siteQueries?.current28;
  if (!period?.start || !period?.end || !Array.isArray(rows)) return null;
  const periodDays = Math.round((Date.parse(`${period.end}T00:00:00Z`) - Date.parse(`${period.start}T00:00:00Z`)) / 86_400_000) + 1;
  if (!Number.isFinite(periodDays) || periodDays <= 0) return null;
  return { periodDays, periodStart: String(period.start), periodEnd: String(period.end), rows: rows as GscRow[] };
}

async function demandInChunks(demand: NonNullable<CensoredDemandDeps['demand']>, keywords: string[]) {
  const map = new Map<string, number | null>();
  for (let offset = 0; offset < keywords.length; offset += 50) {
    const { results } = await demand(keywords.slice(offset, offset + 50));
    for (const row of results ?? []) {
      const value = row.avgMonthlySearches === null || row.avgMonthlySearches === undefined ? null : Number(row.avgMonthlySearches);
      map.set(normalizeKey(row.keyword), Number.isFinite(value) ? value : null);
    }
  }
  return map;
}

export async function bingKeywordStatsCommand(input: unknown, deps: Pick<CensoredDemandDeps, 'bing'> = {}) {
  const args = z.object(bingKeywordStatsShape).strict().parse(input);
  const result = await (deps.bing ?? bingKeywordStats)(args);
  return {
    ...result,
    monthlyConversion: 'mean weekly impressions × 52/12',
    caveat: 'Bing-only impressions (desktop-heavy in Japan). Use censored_keyword_demand_estimate to convert to Google scale.'
  };
}

export async function censoredKeywordDemandEstimate(input: unknown, deps: CensoredDemandDeps = {}) {
  const args = z.object(censoredKeywordDemandEstimateShape).strict().parse(input);
  const demand = deps.demand ?? ((keywords: string[]) => keywordDemand({ keywords, includeAdultKeywords: true, languageConstant: args.languageConstant, geoTargetConstants: args.geoTargetConstants }));
  const bing = deps.bing ?? bingKeywordStats;
  const gscFetch = deps.gsc ?? defaultGsc;
  const warnings: string[] = [];

  const targets = [...new Map(args.keywords.map(keyword => [normalizeKey(keyword), keyword.trim()])).values()];
  const targetKeys = new Set(targets.map(normalizeKey));
  const presetAnchors = args.anchorPreset === 'none' ? [] : [...ANCHOR_PRESETS[args.anchorPreset]];
  const anchorCandidates = [...new Map([...presetAnchors, ...args.anchorKeywords].map(keyword => [normalizeKey(keyword), keyword.trim()])).values()]
    .filter(keyword => !targetKeys.has(normalizeKey(keyword)));

  // 1. Google Ads for targets and anchors in one pass.
  const googleMap = await demandInChunks(demand, [...targets, ...anchorCandidates]);
  const googleValue = (keyword: string) => googleMap.has(normalizeKey(keyword)) ? googleMap.get(normalizeKey(keyword)) ?? null : null;

  // 2. Optional GSC anchors: queries where the site ranks near the top, so impressions ≈ searches (lower bound).
  let gscInfo: { siteId: string; periodStart: string; periodEnd: string; periodDays: number; candidates: Array<{ query: string; monthly: number; averagePosition: number }> } | null = null;
  if (args.gscSiteId) {
    try {
      const gsc = await gscFetch(args.gscSiteId);
      if (!gsc) warnings.push(`No complete 28-day GSC digest for site ${args.gscSiteId}; GSC calibration skipped.`);
      else {
        const candidates = gsc.rows
          .filter(row => (row.averagePosition ?? Infinity) <= args.gscMaxPosition && (row.impressions ?? 0) >= args.gscMinImpressions)
          .map(row => ({ query: row.query.trim(), monthly: Math.round((row.impressions ?? 0) * 30 / gsc.periodDays), averagePosition: Number(row.averagePosition) }))
          .sort((a, b) => b.monthly - a.monthly);
        gscInfo = { siteId: args.gscSiteId, periodStart: gsc.periodStart, periodEnd: gsc.periodEnd, periodDays: gsc.periodDays, candidates };
      }
    } catch (error: any) {
      warnings.push(`GSC digest unavailable for ${args.gscSiteId}: ${String(error?.message ?? error).slice(0, 200)}`);
    }
  }
  const gscByKey = new Map((gscInfo?.candidates ?? []).map(row => [normalizeKey(row.query), row]));
  const gscAnchorQueries = (gscInfo?.candidates ?? []).filter(row => !targetKeys.has(normalizeKey(row.query))).slice(0, args.gscMaxAnchors).map(row => row.query);

  // 3. Bing impressions for targets, Google anchors with a non-zero volume, and GSC anchors.
  const googleAnchors = anchorCandidates.filter(keyword => (googleValue(keyword) ?? 0) > 0);
  const bingKeywords = [...new Map([...targets, ...googleAnchors, ...gscAnchorQueries].map(keyword => [normalizeKey(keyword), keyword])).values()];
  const bingResult = await bing({ keywords: bingKeywords, country: args.country, language: args.language });
  const bingByKey = new Map<string, BingKeywordStat>(bingResult.results.map(row => [normalizeKey(row.keyword), row]));
  const bingMonthly = (keyword: string) => {
    const row = bingByKey.get(normalizeKey(keyword));
    return row?.status === 'ok' && row.monthlyImpressions && row.monthlyImpressions > 0 ? row.monthlyImpressions : null;
  };

  // 4. Calibrations.
  const googleAnchorRows: CalibrationAnchor[] = googleAnchors.flatMap(keyword => {
    const b = bingMonthly(keyword); const g = googleValue(keyword);
    return b && g ? [{ keyword, termClass: termClass(keyword), source: 'google_ads' as const, referenceMonthly: g, bingMonthly: b, ratio: g / b }] : [];
  });
  const gscAnchorRows: CalibrationAnchor[] = gscAnchorQueries.flatMap(query => {
    const b = bingMonthly(query); const g = gscByKey.get(normalizeKey(query))?.monthly;
    return b && g ? [{ keyword: query, termClass: termClass(query), source: 'gsc' as const, referenceMonthly: g, bingMonthly: b, ratio: g / b }] : [];
  });
  const anchorCalibration = buildCalibration(googleAnchorRows);
  const gscCalibration = gscAnchorRows.length >= 3 ? buildCalibration(gscAnchorRows) : null;
  if (googleAnchorRows.length < 3) warnings.push(`Only ${googleAnchorRows.length} Google Ads anchors had both Google and Bing data; anchor estimates are unreliable.`);
  if (args.gscSiteId && gscInfo && gscAnchorRows.length < 3) warnings.push(`Only ${gscAnchorRows.length} GSC anchors had Bing data; GSC-based estimates omitted.`);

  // 5. Per-target output.
  const results = targets.map(keyword => {
    const google = googleValue(keyword);
    const censored = !google;
    const cls = termClass(keyword);
    const bingRow = bingByKey.get(normalizeKey(keyword));
    const b = bingMonthly(keyword);
    const anchorPick = anchorCalibration.pick(cls);
    const anchorEstimate = estimateFromBing(b, anchorPick.stats);
    const gscPick = gscCalibration?.pick(cls);
    const gscEstimate = gscPick ? estimateFromBing(b, gscPick.stats) : null;
    const gscObservedRow = gscByKey.get(normalizeKey(keyword));
    const gscObserved = gscObservedRow ? { monthlyImpressions: gscObservedRow.monthly, averagePosition: gscObservedRow.averagePosition, note: 'Own-site impressions at a top position; a lower bound on searches.' } : null;

    let recommended: { value: number | null; source: 'google_ads' | 'gsc_observed' | 'bing_gsc_calibrated' | 'bing_anchor_calibrated' | 'none' };
    if (!censored) recommended = { value: google, source: 'google_ads' };
    else if (gscObserved) recommended = { value: Math.max(gscObserved.monthlyImpressions, gscEstimate?.mid ?? 0), source: 'gsc_observed' };
    else if (gscEstimate) recommended = { value: gscEstimate.mid, source: 'bing_gsc_calibrated' };
    else if (anchorEstimate) recommended = { value: anchorEstimate.mid, source: 'bing_anchor_calibrated' };
    else recommended = { value: null, source: 'none' };

    return {
      keyword,
      termClass: cls,
      googleAds: { avgMonthlySearches: google, censored },
      bing: { status: bingRow?.status ?? 'error', monthlyImpressions: bingRow?.monthlyImpressions ?? null, weeks: bingRow?.weeks ?? 0, firstWeek: bingRow?.firstWeek ?? null, lastWeek: bingRow?.lastWeek ?? null },
      anchorEstimate: anchorEstimate ? { ...anchorEstimate, basis: anchorPick.basis } : null,
      gscEstimate: gscEstimate && gscPick ? { ...gscEstimate, basis: gscPick.basis } : null,
      gscObserved,
      recommended
    };
  });

  const strip = (calibration: ReturnType<typeof buildCalibration> | null, rows: CalibrationAnchor[]) => calibration ? {
    overall: calibration.overall,
    byClass: calibration.byClass,
    medianAbsoluteError: calibration.medianAbsoluteError,
    leaveOneOut: calibration.leaveOneOut,
    anchors: rows.map(row => ({ keyword: row.keyword, termClass: row.termClass, referenceMonthly: row.referenceMonthly, bingMonthly: row.bingMonthly, ratio: Number(row.ratio.toFixed(1)) }))
  } : null;

  return {
    method: 'bing_impressions_calibrated_to_google',
    fetchedAt: new Date().toISOString(),
    country: args.country,
    language: args.language,
    results,
    calibration: {
      googleAdsAnchors: strip(anchorCalibration, googleAnchorRows),
      gscAnchors: gscInfo ? { siteId: gscInfo.siteId, period: { start: gscInfo.periodStart, end: gscInfo.periodEnd, days: gscInfo.periodDays }, maxPosition: args.gscMaxPosition, ...strip(gscCalibration, gscAnchorRows) } : null
    },
    warnings,
    caveats: [
      'Google Ads 0 means withheld, not zero demand; censored terms are estimated, not measured.',
      'Bing in Japan is desktop-heavy, so ratios vary by term type. Trust order of magnitude and ranking more than the exact value; use low–high as the range.',
      'GSC impressions at top positions are a lower bound on searches. Prefer GSC calibration when available.',
      'Google Ads may merge spelling variants into one volume, which distorts some anchor ratios.'
    ]
  };
}
