/** Split one Search Console property's remaining URL Inspection budget fairly. */
export function inspectionSlice(remaining: number, unvisitedSites: number, maxPerSiteCall: number) {
  if (!Number.isInteger(remaining) || remaining < 0) throw new Error('Invalid remaining budget');
  if (!Number.isInteger(unvisitedSites) || unvisitedSites < 1) throw new Error('Invalid unvisited site count');
  if (!Number.isInteger(maxPerSiteCall) || maxPerSiteCall < 1 || maxPerSiteCall > 50) {
    throw new Error('Invalid per-call cap');
  }
  return Math.min(maxPerSiteCall, Math.ceil(remaining / unvisitedSites));
}

export type ProactiveInspectionRecord = {
  inventoryState: string;
  indexable: boolean;
  lastInspectedAt: string | null;
  observedIndexState: string;
  coverageState: string | null;
  indexingState: string | null;
  robotsTxtState: string | null;
  pageFetchState: string | null;
  googleCanonical: string | null;
  userCanonical: string | null;
};

const PROACTIVE_COVERAGE_STATES = new Set([
  'Crawled - currently not indexed',
  'Discovered - currently not indexed',
  'URL is unknown to Google'
]);

function canonicalIdentity(value: string) {
  try {
    const url = new URL(value);
    url.hash = '';
    url.hostname = url.hostname.toLowerCase();
    if ((url.protocol === 'https:' && url.port === '443') || (url.protocol === 'http:' && url.port === '80')) url.port = '';
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\\/+$/, '');
    return url.toString();
  } catch {
    return value.trim();
  }
}

/**
 * Spare-quota refill is deliberately limited to unresolved, indexable URLs.
 * It must not repeatedly inspect pages with an explicit technical exclusion,
 * canonical conflict, or a recent observation.
 */
export function isProactiveInspectionCandidate(
  record: ProactiveInspectionRecord,
  nowMs: number,
  minimumAgeHours: number
) {
  if (record.inventoryState !== 'current' || !record.indexable) return false;
  if (!Number.isFinite(nowMs) || !Number.isFinite(minimumAgeHours) || minimumAgeHours < 1) return false;
  if (!PROACTIVE_COVERAGE_STATES.has(record.coverageState ?? '')) return false;
  if (record.observedIndexState === 'indexed') return false;
  if (!record.lastInspectedAt) return false;

  const lastInspectedMs = Date.parse(record.lastInspectedAt);
  if (!Number.isFinite(lastInspectedMs) || nowMs - lastInspectedMs < minimumAgeHours * 60 * 60 * 1000) return false;

  if (record.indexingState && !['INDEXING_ALLOWED', 'INDEXING_STATE_UNSPECIFIED'].includes(record.indexingState)) return false;
  if (record.robotsTxtState && !['ALLOWED', 'ROBOTS_TXT_STATE_UNSPECIFIED'].includes(record.robotsTxtState)) return false;
  if (record.coverageState === 'Crawled - currently not indexed' && record.pageFetchState !== 'SUCCESSFUL') return false;
  if (record.googleCanonical && record.userCanonical &&
      canonicalIdentity(record.googleCanonical) !== canonicalIdentity(record.userCanonical)) return false;

  return true;
}

export function proactiveInspectionPriority(coverageState: string | null) {
  if (coverageState === 'Crawled - currently not indexed') return 0;
  if (coverageState === 'Discovered - currently not indexed') return 1;
  if (coverageState === 'URL is unknown to Google') return 2;
  return 3;
}
