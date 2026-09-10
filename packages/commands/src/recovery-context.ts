import { createHash } from 'node:crypto';
import { getDatabase } from '@keywords/db';
import type { UrlIndexObservation } from '@keywords/research';

const { sqlite } = getDatabase();
const parse = <T>(value: string | null | undefined, fallback: T): T => { try { return value ? JSON.parse(value) : fallback; } catch { return fallback; } };
export const RECOVERY_VERSION = 2;
export const RECOVERY_SAMPLE_SIZE = 20;
export const RECOVERY_INTERVAL_DAYS = 7;
export type RecoveryDaily = { date: string; impressions: number; clicks: number };
export interface RecoverySnapshot {
  version: number;
  projectId: string;
  targetOrigin: string;
  property: string;
  cohort: string[];
  cohortKey: string;
  startDate: string;
  endDate: string;
  observedAt: string;
  inspections: Array<UrlIndexObservation & { sourceId: string }>;
  daily: RecoveryDaily[] | null;
  errors: Array<{ url: string | null; code: string }>;
  complete: boolean;
}

export function recoveryDate(offsetDays = -3, clock = new Date()) {
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(clock);
  return new Date(Date.parse(`${date}T00:00:00Z`) + offsetDays * 86400000).toISOString().slice(0, 10);
}
export function dateOffset(date: string, offset: number) { return new Date(Date.parse(`${date}T00:00:00Z`) + offset * 86400000).toISOString().slice(0, 10); }
export function cohortKey(urls: string[]) { return createHash('sha256').update(JSON.stringify([...urls].sort())).digest('hex'); }

export function recoverySnapshots(projectId: string) {
  // Only command-produced observations count. A free-form source_record cannot certify recovery.
  return (sqlite.prepare(`SELECT s.id,s.created_at,s.metadata_json FROM sources s
    WHERE s.project_id=? AND s.type='seo_recovery_snapshot' AND EXISTS (
      SELECT 1 FROM runs r WHERE r.project_id=s.project_id AND r.command='recovery.capture'
      AND r.status='succeeded' AND json_extract(r.output_json,'$.sourceId')=s.id)
    ORDER BY s.created_at DESC,s.rowid DESC LIMIT 30`).all(projectId) as any[])
    .map(row => ({ id: String(row.id), ...parse<RecoverySnapshot>(row.metadata_json, {} as RecoverySnapshot) }))
    .filter(row => row.version === RECOVERY_VERSION && Array.isArray(row.cohort) && Array.isArray(row.inspections));
}

export function recoveryCohort(projectId: string, targetOrigin: string): string[] {
  const previous = recoverySnapshots(projectId).find(row => row.targetOrigin === targetOrigin && row.cohort.length);
  if (previous) return previous.cohort;
  const candidates = sqlite.prepare("SELECT url FROM pages WHERE project_id=? AND url IS NOT NULL AND status NOT IN ('archived','stale') AND (source IN ('sitemap','search_console') OR EXISTS(SELECT 1 FROM page_metric_snapshots m WHERE m.page_id=pages.id)) ORDER BY url").all(projectId) as Array<{ url: string }>;
  const groups = new Map<string, string[]>();
  for (const item of candidates) {
    try {
      const url = new URL(item.url);
      if (url.origin !== targetOrigin || url.search || url.hash || url.username || url.password) continue;
      const parts = url.pathname.split('/').filter(Boolean);
      if (parts.some(part => ['tags','tag','authors','author','search','page'].includes(part.toLowerCase()))) continue;
      if (parts.length <= 1 && /^(about|privacy|contact|terms|search|404|500)(\.html)?$/i.test(parts[0] ?? '')) continue;
      const group = parts.length > 1 ? parts[0] : parts.length ? 'pages' : 'home';
      const values = groups.get(group) ?? [];
      if (!values.includes(url.toString())) values.push(url.toString());
      groups.set(group, values);
    } catch { /* malformed historical URL is not a sample */ }
  }
  // Stable, dispersed across route groups; never take only the top sitemap rows.
  for (const values of groups.values()) values.sort((a, b) => cohortKey([a]).localeCompare(cohortKey([b])));
  const buckets = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, values]) => values);
  const selected: string[] = [];
  while (selected.length < RECOVERY_SAMPLE_SIZE && buckets.some(values => values.length)) {
    for (const values of buckets) { const url = values.shift(); if (url) selected.push(url); if (selected.length === RECOVERY_SAMPLE_SIZE) break; }
  }
  return selected;
}

export function summarizeRecovery(snapshot: RecoverySnapshot) {
  const indexed = snapshot.inspections.filter(row => row.verdict === 'PASS').length;
  const canonicalConflicts = snapshot.inspections.filter(row => row.googleCanonical && row.googleCanonical !== (row.userCanonical || row.url));
  const crawledNotIndexed = snapshot.inspections.filter(row => /crawled\s*[-–:]?\s*currently not indexed/i.test(row.coverageState ?? ''));
  const technical = snapshot.inspections.filter(row => row.robotsTxtState === 'DISALLOWED' || ['BLOCKED_BY_META_TAG','BLOCKED_BY_HTTP_HEADER'].includes(row.indexingState ?? '') ||
    (row.pageFetchState && !['SUCCESSFUL','PAGE_FETCH_STATE_UNSPECIFIED'].includes(row.pageFetchState)) || canonicalConflicts.includes(row));
  const weeks = snapshot.daily ? [0, 1, 2].map(index => {
    const start = dateOffset(snapshot.startDate, index * 7), end = dateOffset(start, 6);
    const days = snapshot.daily!.filter(row => row.date >= start && row.date <= end);
    return { startDate: start, endDate: end, impressions: days.reduce((sum, row) => sum + row.impressions, 0), clicks: days.reduce((sum, row) => sum + row.clicks, 0) };
  }) : [];
  const consecutiveGrowth = weeks.length === 3 && weeks[1].impressions > weeks[0].impressions && weeks[2].impressions > weeks[1].impressions;
  const severeDrop = weeks.length === 3 && Math.max(weeks[0].impressions, weeks[1].impressions) >= 50 && weeks[2].impressions <= Math.max(weeks[0].impressions, weeks[1].impressions) * 0.3;
  const enoughSample = snapshot.cohort.length >= RECOVERY_SAMPLE_SIZE && snapshot.inspections.length === snapshot.cohort.length;
  const indexRate = snapshot.inspections.length ? indexed / snapshot.inspections.length : null;
  return { sampleSize: snapshot.cohort.length, inspected: snapshot.inspections.length, indexed, indexRate, enoughSample,
    canonicalConflicts: canonicalConflicts.map(row => row.url), crawledNotIndexed: crawledNotIndexed.map(row => row.url), technicalIssues: technical.map(row => row.url),
    weeks, consecutiveGrowth, severeDrop,
    recovered: snapshot.complete && enoughSample && indexRate !== null && indexRate >= 0.7 && canonicalConflicts.length === 0 && technical.length === 0 && consecutiveGrowth };
}

export function recoveryContext(projectId: string) {
  const binding = sqlite.prepare('SELECT origin,observed_at,snapshot_json FROM blog_bindings WHERE project_id=?').get(projectId) as any;
  if (!binding) return { applicable: false, state: 'not_connected', newContentAllowed: false, reasons: ['Blog site is not connected.'], latest: null, summary: null, nextObservationAt: null, targets: [] as Array<{ pageId: string; url: string; title: string; reason: string }> };
  const snapshot = parse<any>(binding.snapshot_json, {});
  const latest = recoverySnapshots(projectId).find(row => row.targetOrigin === binding.origin) ?? null;
  const summary = latest ? summarizeRecovery(latest) : null;
  const nextObservationAt = latest ? new Date(Date.parse(latest.observedAt) + (latest.complete ? RECOVERY_INTERVAL_DAYS * 86400000 : 6 * 3600000)).toISOString() : null;
  const stale = !latest || !Number.isFinite(Date.parse(latest.observedAt)) || Date.now() - Date.parse(latest.observedAt) > RECOVERY_INTERVAL_DAYS * 86400000 || latest.endDate < dateOffset(recoveryDate(), -7);
  const bindingFresh = Number.isFinite(Date.parse(binding.observed_at)) && Date.now() - Date.parse(binding.observed_at) <= 7 * 86400000;
  const cleared = snapshot.eligibility?.new_content_allowed === true && snapshot.eligibility?.clearance_gate === 'listed_for_scoped_clearance';
  const qualityHealthy = snapshot.eligibility?.quality_status === 'healthy';
  const reasons: string[] = [];
  if (!cleared) reasons.push('This site is not in the scoped new-content clearance.');
  if (!bindingFresh) reasons.push('Blog context needs refreshing.');
  if (!qualityHealthy) reasons.push('Site-wide content quality is not healthy.');
  if (stale) reasons.push('A fresh fixed-cohort URL inspection and 21-day search observation is required.');
  if (latest && !latest.complete) reasons.push('Latest observation is incomplete; missing/API failures are not zero traffic or deindexation.');
  if (summary && !summary.enoughSample) reasons.push('At least 20 successfully inspected URLs are required for expansion.');
  if (summary && summary.indexRate !== null && summary.indexRate < 0.7) reasons.push('Fewer than 70% of the inspected sample are indexed.');
  if (summary?.technicalIssues.length) reasons.push('Stored URL inspections contain technical/indexing or canonical issues.');
  if (summary && !summary.consecutiveGrowth) reasons.push('Search impressions have not increased for two consecutive complete weeks.');
  const targetReasons = new Map<string, string>();
  for (const url of summary?.technicalIssues ?? []) targetReasons.set(url, 'Verify the live page against the recorded crawl/indexing/canonical issue; do not remove an intentional noindex blindly.');
  for (const url of summary?.crawledNotIndexed ?? []) if (!targetReasons.has(url)) targetReasons.set(url, 'Crawled but not indexed: inspect actual content, duplication and reader value; Google does not disclose a quality verdict.');
  for (const row of latest?.inspections ?? []) if (row.verdict !== 'PASS' && !targetReasons.has(row.url)) targetReasons.set(row.url, 'Verify the observed exclusion and the page’s intended role before deciding on a revision.');
  const targets = [...targetReasons].flatMap(([url, reason]) => {
    const page = sqlite.prepare("SELECT id,title FROM pages WHERE project_id=? AND url=? AND status!='archived' LIMIT 1").get(projectId, url) as any;
    return page ? [{ pageId: String(page.id), url, title: String(page.title), reason }] : [];
  }).slice(0, 3);
  const state = !latest || stale ? 'measurement_due' : !latest.complete ? 'measurement_incomplete' : summary?.technicalIssues.length ? 'technical_repair' : !summary?.enoughSample ? 'insufficient_sample' : summary && summary.indexRate !== null && summary.indexRate < 0.7 ? 'content_recovery' : summary?.severeDrop ? 'visibility_decline' : reasons.length ? 'observing' : 'recovered';
  return { applicable: true, state, newContentAllowed: reasons.length === 0, reasons, latest, summary, nextObservationAt, targets };
}

export function assertRecoveryAllowsExpansion(projectId: string) {
  const context = recoveryContext(projectId);
  if (context.applicable && !context.newContentAllowed) throw new Error(`New content is paused for SEO recovery: ${context.reasons.join(' ')}`);
}
