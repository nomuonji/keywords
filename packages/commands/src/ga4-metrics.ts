import { randomUUID } from 'node:crypto';
import { getDatabase, schema } from '@keywords/db';
import type { CommandContext } from '@keywords/domain';
import { ga4Configured, ga4RunLandingPageReport, ga4RunReport, normalizeGa4PropertyId } from '@keywords/research/ga4';
import { assertOperationAllowed, fingerprint, reserveOperationBudget, settleOperationBudget } from './guard.js';
import { recordMeasurementImport } from './measurement.js';
import { remoteSitesStatus, siteRegistryResolve } from './remote-site-operations.js';
import type { SiteRecord } from '../../db/src/site-operations-schema.js';

const { db } = getDatabase();
const now = () => new Date().toISOString();

function origin(value: string | null | undefined) {
  if (!value) return null;
  try { return new URL(value).origin; } catch { return null; }
}

function landingPageLimit() {
  const configured = Number(process.env.KEYWORDS_GA4_LANDING_PAGE_LIMIT ?? 25_000);
  return Number.isFinite(configured) ? Math.max(1, Math.min(Math.floor(configured), 250_000)) : 25_000;
}

export function normalizeGa4Metrics(input: Awaited<ReturnType<typeof ga4RunReport>>['metrics']) {
  return {
    sessions: input.sessions,
    activeUsers: input.activeUsers,
    engagement: input.engagementRate,
    views: input.screenPageViews
  };
}

/** Capture one explicit GA4 property/period into the shared measurement-import contract. */
export async function captureGa4Period(ctx: CommandContext, input: { projectId: string; propertyId: string; targetOrigin?: string | null; startDate: string; endDate: string }) {
  assertOperationAllowed(ctx, { projectId: input.projectId, command: 'metrics.capture_ga4', capability: 'measurement.capture' });
  const propertyId = normalizeGa4PropertyId(input.propertyId);
  const property = `properties/${propertyId}`;
  const capturedAt = now();
  const siteReservation = reserveOperationBudget(ctx, input.projectId, 'external_request', `ga4:site:${property}:${input.startDate}:${input.endDate}`);
  try {
    const report = await ga4RunReport({ propertyId, startDate: input.startDate, endDate: input.endDate });
    settleOperationBudget(siteReservation?.id, 'succeeded');
    const metrics = normalizeGa4Metrics(report.metrics);

    let landingPages: {
      status: 'complete' | 'partial' | 'failed';
      rowCount: number;
      rows: Array<{ landingPage: string; metrics: ReturnType<typeof normalizeGa4Metrics> }>;
      error?: string;
    };
    const landingReservation = reserveOperationBudget(ctx, input.projectId, 'external_request', `ga4:landing:${property}:${input.startDate}:${input.endDate}`);
    try {
      const landingReport = await ga4RunLandingPageReport({ propertyId, startDate: input.startDate, endDate: input.endDate, maxRows: landingPageLimit() });
      settleOperationBudget(landingReservation?.id, 'succeeded');
      landingPages = {
        status: landingReport.complete ? 'complete' : 'partial',
        rowCount: landingReport.rowCount,
        rows: landingReport.rows.map(row => ({ landingPage: row.landingPage, metrics: normalizeGa4Metrics(row.metrics) }))
      };
    } catch (error) {
      settleOperationBudget(landingReservation?.id, 'failed', error);
      landingPages = { status: 'failed', rowCount: 0, rows: [], error: 'ga4_landing_page_collection_failed' };
    }

    const sourceVersion = fingerprint({ provider: 'ga4', property, startDate: input.startDate, endDate: input.endDate, metrics, landingPages });
    const observation = recordMeasurementImport({
      projectId: input.projectId,
      provider: 'ga4',
      property,
      targetOrigin: input.targetOrigin ?? null,
      filters: [],
      startDate: input.startDate,
      endDate: input.endDate,
      timezone: 'UTC',
      searchType: null,
      dimensions: landingPages.status === 'complete' ? ['landingPage'] : [],
      status: 'succeeded',
      completeness: 'complete',
      sourceLabel: `GA4 snapshot: ${input.startDate} → ${input.endDate}`,
      sourceVersion,
      capturedAt,
      payload: { metrics, landingPages, api: 'analyticsdata.googleapis.com/v1beta', rowCount: report.rowCount }
    });
    const source = {
      id: randomUUID(), projectId: input.projectId, type: 'ga4_snapshot',
      label: `GA4 snapshot: ${input.startDate} → ${input.endDate}`,
      url: input.targetOrigin ?? null,
      metadataJson: JSON.stringify({
        measurementImportId: observation.id, sourceVersion, property, metrics,
        landingPages: { status: landingPages.status, rowCount: landingPages.rowCount, storedRows: landingPages.rows.length },
        api: 'analyticsdata.googleapis.com/v1beta'
      }),
      createdAt: capturedAt
    };
    if (!observation.reused) await db.insert(schema.sources).values(source);
    return {
      status: 'captured' as const,
      measurementImportId: observation.id,
      reused: observation.reused,
      sourceId: observation.reused ? null : source.id,
      property,
      targetOrigin: input.targetOrigin ?? null,
      period: { startDate: input.startDate, endDate: input.endDate },
      metrics,
      landingPages: { status: landingPages.status, rowCount: landingPages.rowCount, storedRows: landingPages.rows.length },
      capturedAt
    };
  } catch (error) {
    settleOperationBudget(siteReservation?.id, 'failed', error);
    const message = error instanceof Error ? error.message : String(error);
    const failedVersion = fingerprint({ provider: 'ga4', property, startDate: input.startDate, endDate: input.endDate, capturedAt, error: message });
    recordMeasurementImport({
      projectId: input.projectId, provider: 'ga4', property, targetOrigin: input.targetOrigin ?? null, filters: [],
      startDate: input.startDate, endDate: input.endDate, timezone: 'UTC', searchType: null, dimensions: [],
      status: 'failed', completeness: 'failed', sourceLabel: `GA4 failed: ${input.startDate} → ${input.endDate}`,
      sourceVersion: failedVersion, capturedAt, payload: { error: 'ga4_collection_failed' }
    });
    throw new Error(`GA4 collection failed for ${input.startDate} → ${input.endDate}: ${message}`);
  }
}

/** Resolve the registered real site and capture bounded periods. Failure is additive to GSC. */
export async function captureProjectGa4Metrics(ctx: CommandContext, input: { projectId: string; periods: Array<{ key: string; startDate: string; endDate: string }> }) {
  if (!ga4Configured()) return { status: 'skipped' as const, reason: 'ga4_credentials_not_configured', captures: [] };
  const runtime = remoteSitesStatus();
  if (!runtime.firestoreConfigured || !runtime.projectConfigured) return { status: 'skipped' as const, reason: 'firestore_not_configured', captures: [] };
  let site: SiteRecord | null = null;
  try { site = (await siteRegistryResolve({ localProjectId: input.projectId })).site as SiteRecord | null; }
  catch { return { status: 'skipped' as const, reason: 'site_registry_unavailable', captures: [] }; }
  if (!site) return { status: 'skipped' as const, reason: 'site_not_linked', captures: [] };
  if (!site.ga4PropertyId) return { status: 'skipped' as const, reason: 'ga4_property_not_registered', siteId: site.id, captures: [] };
  const targetOrigin = origin(site.productionUrl);
  if (!targetOrigin) return { status: 'skipped' as const, reason: 'site_production_url_invalid', siteId: site.id, captures: [] };
  const captures: Array<Record<string, unknown>> = [];
  for (const period of input.periods.slice(0, 4)) {
    try {
      captures.push({ key: period.key, ...(await captureGa4Period(ctx, { projectId: input.projectId, propertyId: site.ga4PropertyId, targetOrigin, startDate: period.startDate, endDate: period.endDate })) });
    } catch (error) {
      captures.push({ key: period.key, status: 'failed', error: error instanceof Error ? error.message : String(error), period: { startDate: period.startDate, endDate: period.endDate } });
    }
  }
  const failed = captures.filter(item => item.status === 'failed').length;
  return { status: failed === 0 ? 'captured' as const : failed === captures.length ? 'failed' as const : 'partial' as const, siteId: site.id, property: `properties/${normalizeGa4PropertyId(site.ga4PropertyId)}`, captures };
}
