import { and, eq } from 'drizzle-orm';
import { getDatabase, schema } from '@keywords/db';
import type { CommandContext } from '@keywords/domain';
import { searchConsoleQuery, type SearchConsoleResult } from '@keywords/research';
import { assertOperationAllowed, fingerprint, reserveOperationBudget, settleOperationBudget } from './guard.js';
import { measurementComparisonContext, periodDays, recordMeasurementImport, resolveMeasurementScope } from './measurement.js';

const { db } = getDatabase();
const now = () => new Date().toISOString();
const id = () => crypto.randomUUID();
const normalize = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ');
const projectCtx = (ctx: CommandContext, projectId: string): CommandContext => ({ ...ctx, projectId });

async function withRun<T>(ctx: CommandContext, command: string, input: unknown, fn: () => Promise<T>): Promise<T> {
  const runId = id(); const started = Date.now(); const createdAt = now();
  try { const output = await fn(); await db.insert(schema.runs).values({ id: runId, projectId: ctx.projectId ?? null, workSessionId: ctx.workSessionId ?? null, actor: ctx.actor, actorId: ctx.actorId ?? null, command, status: 'succeeded', inputJson: JSON.stringify(input ?? null), outputJson: JSON.stringify(output ?? null), durationMs: Date.now() - started, createdAt }); return output; }
  catch (error) { await db.insert(schema.runs).values({ id: runId, projectId: ctx.projectId ?? null, workSessionId: ctx.workSessionId ?? null, actor: ctx.actor, actorId: ctx.actorId ?? null, command, status: 'failed', inputJson: JSON.stringify(input ?? null), error: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started, createdAt }); throw error; }
}

function pageIdentity(input: string) {
  const url = new URL(input); const pathname = url.pathname.replace(/\/+$/, '') || '/';
  const title = pathname === '/' ? url.hostname : (decodeURIComponent(pathname).split('/').filter(Boolean).at(-1) ?? url.hostname).replace(/[-_]+/g, ' ');
  const slug = pathname === '/' ? '__root__' : pathname.replace(/^\/+|\/+$/g, '').replace(/\//g, '--').slice(0, 220);
  return { url: url.toString(), title, slug };
}
const slugSuffix = (value: string) => Buffer.from(value).toString('base64url').slice(0, 10).toLowerCase();

async function upsertKeyword(projectId: string, query: string, row: { clicks: number; impressions: number; ctr: number; position: number }, observedAt: string) {
  const normalized = normalize(query); let keyword = await db.select().from(schema.keywords).where(and(eq(schema.keywords.projectId, projectId), eq(schema.keywords.normalized, normalized))).get();
  if (!keyword) { const created = { id: id(), projectId, topicId: null, text: query.trim(), normalized, source: 'search_console', status: 'active', avgMonthly: null, competition: null, cpcMicros: null, gscClicks: row.clicks, gscImpressions: row.impressions, gscCtr: row.ctr, gscPosition: row.position, gscUpdatedAt: observedAt, createdAt: observedAt, updatedAt: observedAt }; await db.insert(schema.keywords).values(created); return created.id; }
  await db.update(schema.keywords).set({ gscClicks: row.clicks, gscImpressions: row.impressions, gscCtr: row.ctr, gscPosition: row.position, gscUpdatedAt: observedAt, updatedAt: observedAt }).where(eq(schema.keywords.id, keyword.id)); return keyword.id;
}

async function upsertLivePage(projectId: string, inputUrl: string, observedAt: string) {
  const identity = pageIdentity(inputUrl);
  const existingUrl = await db.select().from(schema.pages).where(and(eq(schema.pages.projectId, projectId), eq(schema.pages.url, identity.url))).get();
  if (existingUrl) { await db.update(schema.pages).set({ status: existingUrl.status === 'archived' || existingUrl.status === 'stale' ? 'published' : existingUrl.status, lastSeenAt: observedAt, updatedAt: observedAt }).where(eq(schema.pages.id, existingUrl.id)); return existingUrl.id; }
  const sameSlug = await db.select().from(schema.pages).where(and(eq(schema.pages.projectId, projectId), eq(schema.pages.slug, identity.slug))).get();
  const safeSlug = sameSlug ? `${identity.slug.slice(0, 210)}--live-${slugSuffix(identity.url)}` : identity.slug;
  const page = { id: id(), projectId, clusterId: null, title: identity.title, slug: safeSlug, kind: 'existing', status: 'published', rationale: null, evidenceJson: null, audience: null, question: null, searchIntent: null, uniqueAngle: null, unresolvedAssumptionsJson: null, planMode: 'new_page', targetPageId: null, url: identity.url, source: 'search_console', lastSeenAt: observedAt, createdAt: observedAt, updatedAt: observedAt };
  await db.insert(schema.pages).values(page); return page.id;
}

async function fetchAll(ctx: CommandContext, input: { projectId: string; property: string; filters: Array<{groupType:string;filters:Array<{dimension:string;operator:string;expression:string}>}>; startDate: string; endDate: string; dimensions: string[]; searchType: string; maxRows: number }) {
  const pageSize = Math.min(25_000, input.maxRows); const rows: SearchConsoleResult['rows'] = []; let startRow = 0; let requests = 0; let first: SearchConsoleResult | null = null; let complete = false;
  while (rows.length < input.maxRows) {
    const take = Math.min(pageSize, input.maxRows - rows.length);
    const key = `gsc:${input.dimensions.join(',')}:${input.property}:${input.startDate}:${input.endDate}:${input.searchType}:${startRow}:${take}:${fingerprint(input.filters)}`;
    const reservation = reserveOperationBudget(ctx, input.projectId, 'external_request', key, 1);
    try {
      const result = await searchConsoleQuery({ dimensionFilterGroups: input.filters, siteUrl: input.property, startDate: input.startDate, endDate: input.endDate, dimensions: input.dimensions, rowLimit: take, startRow, searchType: input.searchType });
      settleOperationBudget(reservation?.id, 'succeeded');
      first ??= result; requests++; rows.push(...result.rows); startRow += result.rows.length;
      if (result.rows.length < take || !result.rows.length) { complete = true; break; }
    } catch (error) {
      settleOperationBudget(reservation?.id, 'failed', error);
      throw error;
    }
  }
  if (!first) throw new Error('Search Console returned no response');
  return { ...first, rows, requests, complete };
}

async function materializeCompleteCapture(input: { projectId: string; observedAt: string; property: string; startDate: string; endDate: string; searchType: string; queries: Awaited<ReturnType<typeof fetchAll>>; pages: Awaited<ReturnType<typeof fetchAll>> }) {
  await db.delete(schema.keywordMetricSnapshots).where(and(eq(schema.keywordMetricSnapshots.projectId, input.projectId), eq(schema.keywordMetricSnapshots.siteUrl, input.property), eq(schema.keywordMetricSnapshots.startDate, input.startDate), eq(schema.keywordMetricSnapshots.endDate, input.endDate), eq(schema.keywordMetricSnapshots.searchType, input.searchType)));
  await db.delete(schema.pageMetricSnapshots).where(and(eq(schema.pageMetricSnapshots.projectId, input.projectId), eq(schema.pageMetricSnapshots.siteUrl, input.property), eq(schema.pageMetricSnapshots.startDate, input.startDate), eq(schema.pageMetricSnapshots.endDate, input.endDate), eq(schema.pageMetricSnapshots.searchType, input.searchType)));
  for (const row of input.queries.rows) { const query = row.keys[0]; if (!query) continue; const keywordId = await upsertKeyword(input.projectId, query, row, input.observedAt); await db.insert(schema.keywordMetricSnapshots).values({ id: id(), projectId: input.projectId, keywordId, query, siteUrl: input.property, startDate: input.startDate, endDate: input.endDate, searchType: input.searchType, clicks: row.clicks, impressions: row.impressions, ctr: row.ctr, position: row.position, observedAt: input.observedAt }); }
  for (const row of input.pages.rows) { const url = row.keys[0]; if (!url) continue; const pageId = await upsertLivePage(input.projectId, url, input.observedAt); await db.insert(schema.pageMetricSnapshots).values({ id: id(), projectId: input.projectId, pageId, url, siteUrl: input.property, startDate: input.startDate, endDate: input.endDate, searchType: input.searchType, clicks: row.clicks, impressions: row.impressions, ctr: row.ctr, position: row.position, observedAt: input.observedAt }); }
}

export const metricsCommands = {
  capture: async (ctx: CommandContext, input: { projectId: string; siteUrl?: string; targetOrigin?: string; startDate: string; endDate: string; searchType?: string; timezone?: string; rowLimit?: number }) => withRun(projectCtx(ctx, input.projectId), 'metrics.capture', input, async () => {
    assertOperationAllowed(ctx, { projectId: input.projectId, command: 'metrics.capture', capability: 'measurement.capture' });
    const scope = resolveMeasurementScope({ projectId: input.projectId, property: input.siteUrl, targetOrigin: input.targetOrigin, searchType: input.searchType, timezone: input.timezone });
    const observedAt = now(); const maxRows = Math.max(1, Math.min(Math.floor(input.rowLimit ?? 25_000), 100_000));
    let queries: Awaited<ReturnType<typeof fetchAll>> | null = null; let pages: Awaited<ReturnType<typeof fetchAll>> | null = null;
    try {
      queries = await fetchAll(ctx, { projectId: input.projectId, property: scope.property, filters: scope.filters, startDate: input.startDate, endDate: input.endDate, dimensions: ['query'], searchType: scope.searchType, maxRows });
      pages = await fetchAll(ctx, { projectId: input.projectId, property: scope.property, filters: scope.filters, startDate: input.startDate, endDate: input.endDate, dimensions: ['page'], searchType: scope.searchType, maxRows });
    } catch (error) {
      const failedVersion = fingerprint({ scope, startDate: input.startDate, endDate: input.endDate, observedAt, error: error instanceof Error ? error.message : String(error) });
      recordMeasurementImport({ projectId: input.projectId, provider: 'gsc', property: scope.property, targetOrigin: scope.targetOrigin, filters: scope.filters, startDate: input.startDate, endDate: input.endDate, timezone: scope.timezone, searchType: scope.searchType, dimensions: ['query','page'], status: 'failed', completeness: 'failed', sourceLabel: `GSC failed: ${input.startDate} → ${input.endDate}`, sourceVersion: failedVersion, capturedAt: observedAt, payload: { queryRows: queries?.rows.length ?? 0, queryComplete: queries?.complete ?? false, error: error instanceof Error ? error.message : String(error) } });
      throw error;
    }
    if (queries.siteUrl !== pages.siteUrl || queries.siteUrl !== scope.property) throw new Error('Query/page Search Console responses used different properties');
    const complete = queries.complete && pages.complete;
    const sourceVersion = fingerprint({ scope, startDate: input.startDate, endDate: input.endDate, queryFetchedAt: queries.fetchedAt, pageFetchedAt: pages.fetchedAt, queryRows: queries.rows.length, pageRows: pages.rows.length, observedAt });
    const observation = recordMeasurementImport({ projectId: input.projectId, provider: 'gsc', property: scope.property, targetOrigin: scope.targetOrigin, filters: scope.filters, startDate: input.startDate, endDate: input.endDate, timezone: scope.timezone, searchType: scope.searchType, dimensions: ['query','page'], status: complete ? 'succeeded' : 'partial', completeness: complete ? 'complete' : 'partial', sourceLabel: `GSC snapshot: ${input.startDate} → ${input.endDate}`, sourceVersion, capturedAt: observedAt, payload: { requests: queries.requests + pages.requests, queryRows: queries.rows.length, pageRows: pages.rows.length, queryComplete: queries.complete, pageComplete: pages.complete } });
    const source = { id: id(), projectId: input.projectId, type: 'gsc_snapshot', label: `GSC snapshot: ${input.startDate} → ${input.endDate}`, url: scope.targetOrigin, metadataJson: JSON.stringify({ measurementImportId: observation.id, sourceVersion, property: scope.property, targetOrigin: scope.targetOrigin, filters: scope.filters, timezone: scope.timezone, searchType: scope.searchType, maxRows, queryRows: queries.rows.length, pageRows: pages.rows.length, queryComplete: queries.complete, pageComplete: pages.complete, requests: queries.requests + pages.requests }), createdAt: observedAt };
    await db.insert(schema.sources).values(source);
    if (complete) await materializeCompleteCapture({ projectId: input.projectId, observedAt, property: scope.property, startDate: input.startDate, endDate: input.endDate, searchType: scope.searchType, queries, pages });
    return { sourceId: source.id, measurementImportId: observation.id, sourceVersion, property: scope.property, targetOrigin: scope.targetOrigin, filters: scope.filters, searchType: scope.searchType, timezone: scope.timezone, period: { startDate: input.startDate, endDate: input.endDate, days: periodDays(input.startDate, input.endDate) }, queries: { rows: queries.rows.length, complete: queries.complete }, pages: { rows: pages.rows.length, complete: pages.complete }, requests: queries.requests + pages.requests, capturedAt: observedAt, materialized: complete, note: complete ? null : 'Partial capture retained as an observation; previous successful materialized metrics were not overwritten.' };
  }),

  context: async (ctx: CommandContext, projectId: string, limit = 25) => withRun(projectCtx(ctx, projectId), 'metrics.context', { projectId, limit }, async () => measurementComparisonContext(projectId, limit))
};
