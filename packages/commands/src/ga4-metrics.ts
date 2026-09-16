import { randomUUID } from 'node:crypto';
import { getDatabase, schema } from '@keywords/db';
import type { CommandContext } from '@keywords/domain';
import { ga4Configured, ga4RunReport, normalizeGa4PropertyId } from '@keywords/research/ga4';
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
  const reservation = reserveOperationBudget(ctx, input.projectId, 'external_request', `ga4:${property}:${input.startDate}:${input.endDate}`);
  try {
    const report = await ga4RunReport({ propertyId, startDate: input.startDate, endDate: input.endDate });
    settleOperationBudget(reservation?.id, 'succeeded');
    const metrics = normalizeGa4Metrics(report.metrics);
    const sourceVersion = fingerprint({ provider: 'ga4', property, startDate: input.startDate, endDate: input.endDate, metrics });
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
      dimensions: [],
      status: 'succeeded',
      completeness: 'complete',
      sourceLabel: `GA4 snapshot: ${input.startDate} → ${input.endDate}`,
      sourceVersion,
      capturedAt,
      payload: { metrics, api: 'analyticsdata.googleapis.com/v1beta', rowCount: report.rowCount }
    });
    const source = {
      id: randomUUID(), projectId: input.projectId, type: 'ga4_snapshot',
      label: `GA4 snapshot: ${input.startDate} → ${input.endDate}`,
      url: input.targetOrigin ?? null,
      metadataJson: JSON.stringify({ measurementImportId: observation.id, sourceVersion, property, metrics, api: 'analyticsdata.googleapis.com/v1beta' }),
      createdAt: capturedAt
    };
    if (!observation.reused) await db.insert(schema.sources).values(source);
    return { status: 'captured' as const, measurementImportId: observation.id, reused: observation.reused, sourceId: observation.reused ? null : source.id, property, targetOrigin: input.targetOrigin ?? null, period: { startDate: input.startDate, endDate: input.endDate }, metrics, capturedAt };
  } catch (error) {
    settleOperationBudget(reservation?.id, 'failed', error);
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
