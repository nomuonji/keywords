import { seoPlanningDigestGet } from './seo-planning-digest.js';
import { siteIndexationSummary } from './site-indexation.js';
import {
  seoRecoveryPortfolioUpdate,
  seoRecoverySiteUpdate,
  seoRecoveryStatus,
  siteRegistryList
} from './remote-site-operations.js';
import type { SiteRecord } from '../../db/src/site-operations-schema.js';

const MAX_DIGEST_AGE_MS = 48 * 60 * 60 * 1000;
const MIN_INSPECTED = 20;
const MIN_INSPECTION_COVERAGE = 0.5;
const MAX_OBSERVED_INDEXATION_RATE = 0.2;
const VISIBILITY_DROP_RATIO = 0.2;
const MIN_PREVIOUS_7D_IMPRESSIONS = 50;
const MIN_PREVIOUS_28D_IMPRESSIONS = 100;

const RELEASE_CRITERIA = [
  'Fresh representative URL Inspection evidence shows materially recovered indexation; the existing >=70% PASS convention is an internal operating threshold, not a Google ranking threshold.',
  'No unresolved robots, fetch, canonical, redirect, noindex, or other technical indexing blocker remains on the representative cohort.',
  'Complete Search Console observations show sustained recovery across two consecutive weekly comparisons rather than one good day.',
  'Any broad delete/noindex/pause/positioning/consolidation change has a decided Site Direction when required.',
  'Clearance explicitly references the currently active recovery incident; prior incident clearance does not carry forward.'
];

type SiteSignal = {
  siteId: string;
  digestFresh: boolean;
  complete7d: boolean;
  complete28d: boolean;
  previous7Impressions: number | null;
  current7Impressions: number | null;
  previous28Impressions: number | null;
  current28Impressions: number | null;
  inspectedCount: number;
  inspectionCoverage: number | null;
  observedIndexationRate: number | null;
  severeVisibilityDrop: boolean;
  severeIndexation: boolean;
  establishedBaseline: boolean;
  severeCombined: boolean;
  evidence: string[];
};

function finite(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function completeGsc(digest: any, key: string) {
  return digest?.statuses?.[key]?.gsc?.completeness === 'complete';
}

export function evaluateRecoverySignal(siteId: string, digest: any, indexation: any, nowMs = Date.now()): SiteSignal {
  const generatedAt = Date.parse(String(digest?.generatedAt ?? ''));
  const digestFresh = Number.isFinite(generatedAt) && nowMs - generatedAt <= MAX_DIGEST_AGE_MS;
  const complete7d = digestFresh && completeGsc(digest, 'current7') && completeGsc(digest, 'previous7');
  const complete28d = digestFresh && completeGsc(digest, 'current28') && completeGsc(digest, 'previous28');

  const previous7Impressions = complete7d ? finite(digest?.siteMetrics?.previous7?.gsc?.impressions) : null;
  const current7Impressions = complete7d ? finite(digest?.siteMetrics?.current7?.gsc?.impressions) : null;
  const previous28Impressions = complete28d ? finite(digest?.siteMetrics?.previous28?.gsc?.impressions) : null;
  const current28Impressions = complete28d ? finite(digest?.siteMetrics?.current28?.gsc?.impressions) : null;

  const severe7 = previous7Impressions !== null && current7Impressions !== null &&
    previous7Impressions >= MIN_PREVIOUS_7D_IMPRESSIONS &&
    current7Impressions <= previous7Impressions * VISIBILITY_DROP_RATIO;
  const severe28 = previous28Impressions !== null && current28Impressions !== null &&
    previous28Impressions >= MIN_PREVIOUS_28D_IMPRESSIONS &&
    current28Impressions <= previous28Impressions * VISIBILITY_DROP_RATIO;
  const severeVisibilityDrop = severe7 || severe28;

  const inspectedCount = Math.max(0, Number(indexation?.inspectedCount ?? 0));
  const inspectionCoverage = finite(indexation?.inspectionCoverage);
  const observedIndexationRate = finite(indexation?.observedIndexationRate);
  const severeIndexation = inspectedCount >= MIN_INSPECTED &&
    inspectionCoverage !== null && inspectionCoverage >= MIN_INSPECTION_COVERAGE &&
    observedIndexationRate !== null && observedIndexationRate <= MAX_OBSERVED_INDEXATION_RATE;

  const establishedBaseline =
    (previous7Impressions !== null && previous7Impressions >= MIN_PREVIOUS_7D_IMPRESSIONS) ||
    (previous28Impressions !== null && previous28Impressions >= MIN_PREVIOUS_28D_IMPRESSIONS);

  const evidence: string[] = [];
  if (severeIndexation) {
    evidence.push(`Indexation circuit signal: inspected=${inspectedCount}, coverage=${inspectionCoverage!.toFixed(3)}, observedIndexationRate=${observedIndexationRate!.toFixed(3)}.`);
  }
  if (severe7) evidence.push(`Complete GSC 7d collapse: previous=${previous7Impressions} impressions, current=${current7Impressions}.`);
  if (severe28) evidence.push(`Complete GSC 28d collapse: previous=${previous28Impressions} impressions, current=${current28Impressions}.`);

  return {
    siteId,
    digestFresh,
    complete7d,
    complete28d,
    previous7Impressions,
    current7Impressions,
    previous28Impressions,
    current28Impressions,
    inspectedCount,
    inspectionCoverage,
    observedIndexationRate,
    severeVisibilityDrop,
    severeIndexation,
    establishedBaseline,
    severeCombined: severeVisibilityDrop && severeIndexation,
    evidence
  };
}

export function shouldTripPortfolioCircuit(signals: SiteSignal[]) {
  const severeCombined = signals.filter(item => item.severeCombined);
  const severeIndexation = signals.filter(item => item.severeIndexation);
  const baselineAmongIndexation = severeIndexation.some(item => item.establishedBaseline);
  const trip =
    severeCombined.length >= 2 ||
    (severeIndexation.length >= 3 && baselineAmongIndexation);
  return {
    trip,
    severeCombinedCount: severeCombined.length,
    severeIndexationCount: severeIndexation.length,
    baselineAmongIndexation,
    siteIds: severeIndexation.map(item => item.siteId)
  };
}

function jstDate(at = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(at);
}

async function activeSites() {
  const items: SiteRecord[] = [];
  let pageToken: string | undefined;
  do {
    const result = await siteRegistryList({ status: 'active', limit: 100, ...(pageToken ? { pageToken } : {}) }) as { items: SiteRecord[]; nextPageToken: string | null };
    items.push(...result.items);
    pageToken = result.nextPageToken ?? undefined;
  } while (pageToken);
  return items.filter(site => Boolean(site.searchConsoleProperty));
}

export async function runSeoRecoveryCircuitBreaker() {
  const before: any = await seoRecoveryStatus({});
  const sites = await activeSites();
  const signals: SiteSignal[] = [];
  const failures: Array<{ siteId: string; error: string }> = [];

  for (const site of sites) {
    try {
      const [digest, indexation] = await Promise.all([
        seoPlanningDigestGet({ siteId: site.id }),
        siteIndexationSummary({ siteId: site.id })
      ]);
      if ((digest as any)?.digest === null) continue;
      signals.push(evaluateRecoverySignal(site.id, digest, indexation));
    } catch (error) {
      failures.push({ siteId: site.id, error: error instanceof Error ? error.message : String(error) });
    }
  }

  const circuit = shouldTripPortfolioCircuit(signals);
  let portfolio = before.portfolio;
  let trippedNow = false;

  if (portfolio.mode !== 'recovery' && circuit.trip) {
    const incidentId = `auto-recovery-${jstDate()}`;
    portfolio = await seoRecoveryPortfolioUpdate({
      expectedRevision: Number(portfolio.revision ?? 0),
      mode: 'recovery',
      incidentId,
      title: 'Automatic cross-site SEO recovery circuit breaker',
      reason: 'Conservative multi-site indexation/visibility thresholds were exceeded. Growth is frozen as a risk-control action; this does not identify a Google update or private enforcement system as the cause.',
      evidence: [
        `Circuit rule matched: severeCombined=${circuit.severeCombinedCount}, severeIndexation=${circuit.severeIndexationCount}, baselineAmongIndexation=${circuit.baselineAmongIndexation}.`,
        `Affected signal sites: ${circuit.siteIds.join(', ')}.`,
        'Automatic action is freeze-only: it does not delete/noindex content, choose a recovery strategy, or clear any site.'
      ]
    });
    trippedNow = true;
  }

  const afterTrip: any = portfolio.mode === 'recovery' ? await seoRecoveryStatus({}) : before;
  const currentIncidentId = afterTrip.portfolio?.mode === 'recovery' ? afterTrip.portfolio.incidentId : null;
  const recoveryBySite = new Map((afterTrip.sites ?? []).map((row: any) => [row.siteId, row]));
  const suspectedWrites: Array<{ siteId: string; revision: number; reused: boolean }> = [];

  if (currentIncidentId) {
    for (const signal of signals.filter(item => item.severeIndexation || item.severeVisibilityDrop)) {
      const existing: any = recoveryBySite.get(signal.siteId);
      if (existing?.incidentId === currentIncidentId) {
        suspectedWrites.push({ siteId: signal.siteId, revision: Number(existing.revision ?? 0), reused: true });
        continue;
      }
      const result: any = await seoRecoverySiteUpdate({
        siteId: signal.siteId,
        expectedRevision: Number(existing?.revision ?? 0),
        state: 'suspected',
        strategy: 'unassessed',
        reason: 'Automatic recovery watcher observed a conservative indexation and/or complete-GSC anomaly. Human/Planner diagnosis is required before choosing protect/consolidate/shrink/special_review.',
        evidence: signal.evidence.length ? signal.evidence : ['Automatic watcher threshold matched for this site.'],
        releaseCriteria: RELEASE_CRITERIA
      });
      suspectedWrites.push({ siteId: signal.siteId, revision: result.revision, reused: false });
    }
  }

  return {
    ok: failures.length === 0,
    generatedAt: new Date().toISOString(),
    modeBefore: before.portfolio?.mode ?? 'normal',
    modeAfter: portfolio.mode,
    incidentId: portfolio.incidentId ?? null,
    trippedNow,
    policy: {
      autoExit: false,
      autoClearSites: false,
      destructiveActions: false,
      minInspected: MIN_INSPECTED,
      minInspectionCoverage: MIN_INSPECTION_COVERAGE,
      maxObservedIndexationRate: MAX_OBSERVED_INDEXATION_RATE,
      visibilityDropRatio: VISIBILITY_DROP_RATIO,
      circuit: '2+ sites with severe complete-GSC drop + severe indexation OR 3+ sites with severe indexation and at least one established Search baseline'
    },
    circuit,
    signals,
    suspectedWrites,
    failures
  };
}
