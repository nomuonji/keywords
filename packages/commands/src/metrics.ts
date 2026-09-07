import { and, count, desc, eq } from 'drizzle-orm';
import { getDatabase, schema } from '@keywords/db';
import type { CommandContext } from '@keywords/domain';
import { searchConsoleQuery, type SearchConsoleResult } from '@keywords/research';

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

async function fetchAll(input: { siteUrl?: string; startDate: string; endDate: string; dimensions: string[]; searchType: string; maxRows: number }) {
  const pageSize = Math.min(25_000, input.maxRows); const rows: SearchConsoleResult['rows'] = []; let startRow = 0; let requests = 0; let first: SearchConsoleResult | null = null; let complete = false;
  while (rows.length < input.maxRows) {
    const take = Math.min(pageSize, input.maxRows - rows.length);
    const result = await searchConsoleQuery({ siteUrl: input.siteUrl, startDate: input.startDate, endDate: input.endDate, dimensions: input.dimensions, rowLimit: take, startRow, searchType: input.searchType });
    first ??= result; requests++; rows.push(...result.rows); startRow += result.rows.length;
    if (result.rows.length < take) { complete = true; break; }
    if (!result.rows.length) { complete = true; break; }
  }
  if (!first) throw new Error('Search Console returned no response');
  return { ...first, rows, requests, complete };
}

const periodDays = (startDate: string, endDate: string) => Math.round((new Date(`${endDate}T00:00:00Z`).getTime() - new Date(`${startDate}T00:00:00Z`).getTime()) / 86_400_000) + 1;
function compatiblePairs<T extends { startDate: string; endDate: string; siteUrl: string; searchType: string | null }>(rows: T[], identity: (row: T) => string) {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const key = `${identity(row)}\u0000${row.siteUrl}\u0000${row.searchType ?? 'web'}\u0000${periodDays(row.startDate, row.endDate)}`;
    const values = groups.get(key) ?? []; if (!values.some(item => item.startDate === row.startDate && item.endDate === row.endDate)) values.push(row); groups.set(key, values);
  }
  return [...groups.entries()].flatMap(([key, values]) => {
    const sorted = values.sort((a, b) => b.endDate.localeCompare(a.endDate)); if (sorted.length < 2) return [];
    const [latest, previous] = sorted; const latestStart = new Date(`${latest.startDate}T00:00:00Z`).getTime(); const previousEnd = new Date(`${previous.endDate}T00:00:00Z`).getTime();
    if (latestStart <= previousEnd) return [];
    return [{ key, id: identity(latest), latest, previous, siteUrl: latest.siteUrl, searchType: latest.searchType ?? 'web', periodDays: periodDays(latest.startDate, latest.endDate) }];
  });
}

export const metricsCommands = {
  capture: async (ctx: CommandContext, input: { projectId: string; siteUrl?: string; startDate: string; endDate: string; searchType?: string; rowLimit?: number }) => withRun(projectCtx(ctx, input.projectId), 'metrics.capture', input, async () => {
    const searchType = input.searchType ?? 'web'; const observedAt = now(); const maxRows = Math.max(1, Math.min(Math.floor(input.rowLimit ?? 25_000), 100_000));
    const [queries, pages] = await Promise.all([
      fetchAll({ siteUrl: input.siteUrl, startDate: input.startDate, endDate: input.endDate, dimensions: ['query'], searchType, maxRows }),
      fetchAll({ siteUrl: input.siteUrl, startDate: input.startDate, endDate: input.endDate, dimensions: ['page'], searchType, maxRows })
    ]);
    if (queries.siteUrl !== pages.siteUrl) throw new Error('Query/page Search Console responses used different properties');
    await db.delete(schema.keywordMetricSnapshots).where(and(eq(schema.keywordMetricSnapshots.projectId, input.projectId), eq(schema.keywordMetricSnapshots.siteUrl, queries.siteUrl), eq(schema.keywordMetricSnapshots.startDate, input.startDate), eq(schema.keywordMetricSnapshots.endDate, input.endDate), eq(schema.keywordMetricSnapshots.searchType, searchType)));
    await db.delete(schema.pageMetricSnapshots).where(and(eq(schema.pageMetricSnapshots.projectId, input.projectId), eq(schema.pageMetricSnapshots.siteUrl, pages.siteUrl), eq(schema.pageMetricSnapshots.startDate, input.startDate), eq(schema.pageMetricSnapshots.endDate, input.endDate), eq(schema.pageMetricSnapshots.searchType, searchType)));
    for (const row of queries.rows) { const query = row.keys[0]; if (!query) continue; const keywordId = await upsertKeyword(input.projectId, query, row, observedAt); await db.insert(schema.keywordMetricSnapshots).values({ id: id(), projectId: input.projectId, keywordId, query, siteUrl: queries.siteUrl, startDate: input.startDate, endDate: input.endDate, searchType, clicks: row.clicks, impressions: row.impressions, ctr: row.ctr, position: row.position, observedAt }); }
    for (const row of pages.rows) { const url = row.keys[0]; if (!url) continue; const pageId = await upsertLivePage(input.projectId, url, observedAt); await db.insert(schema.pageMetricSnapshots).values({ id: id(), projectId: input.projectId, pageId, url, siteUrl: pages.siteUrl, startDate: input.startDate, endDate: input.endDate, searchType, clicks: row.clicks, impressions: row.impressions, ctr: row.ctr, position: row.position, observedAt }); }
    const source = { id: id(), projectId: input.projectId, type: 'gsc_snapshot', label: `GSC snapshot: ${input.startDate} → ${input.endDate}`, url: queries.siteUrl.startsWith('http') ? queries.siteUrl : null, metadataJson: JSON.stringify({ siteUrl: queries.siteUrl, startDate: input.startDate, endDate: input.endDate, searchType, maxRows, queryRows: queries.rows.length, pageRows: pages.rows.length, queryComplete: queries.complete, pageComplete: pages.complete, requests: queries.requests + pages.requests }), createdAt: observedAt };
    await db.insert(schema.sources).values(source);
    return { sourceId: source.id, siteUrl: queries.siteUrl, searchType, period: { startDate: input.startDate, endDate: input.endDate, days: periodDays(input.startDate, input.endDate) }, queries: { rows: queries.rows.length, complete: queries.complete }, pages: { rows: pages.rows.length, complete: pages.complete }, requests: queries.requests + pages.requests, capturedAt: observedAt };
  }),

  context: async (ctx: CommandContext, projectId: string, limit = 25) => withRun(projectCtx(ctx, projectId), 'metrics.context', { projectId, limit }, async () => {
    const [queryTotalRow, pageTotalRow, queryRows, pageRows] = await Promise.all([
      db.select({ value: count() }).from(schema.keywordMetricSnapshots).where(eq(schema.keywordMetricSnapshots.projectId, projectId)).get(),
      db.select({ value: count() }).from(schema.pageMetricSnapshots).where(eq(schema.pageMetricSnapshots.projectId, projectId)).get(),
      db.select().from(schema.keywordMetricSnapshots).where(eq(schema.keywordMetricSnapshots.projectId, projectId)).orderBy(desc(schema.keywordMetricSnapshots.endDate), desc(schema.keywordMetricSnapshots.impressions)).limit(10_000),
      db.select().from(schema.pageMetricSnapshots).where(eq(schema.pageMetricSnapshots.projectId, projectId)).orderBy(desc(schema.pageMetricSnapshots.endDate), desc(schema.pageMetricSnapshots.impressions)).limit(10_000)
    ]);
    const queryPairs = compatiblePairs(queryRows, row => row.query); const pagePairs = compatiblePairs(pageRows, row => row.url);
    const positionDrops = queryPairs.filter(({ latest, previous }) => latest.position - previous.position >= 3 && previous.impressions > 0).sort((a, b) => b.previous.impressions - a.previous.impressions).slice(0, limit).map(({ id: query, latest, previous, siteUrl, searchType, periodDays }) => ({ query, latest, previous, siteUrl, searchType, periodDays, positionDelta: latest.position - previous.position, impressionDelta: latest.impressions - previous.impressions }));
    const clickDrops = queryPairs.filter(({ latest, previous }) => previous.clicks >= 5 && latest.clicks <= previous.clicks * 0.7).sort((a, b) => b.previous.clicks - a.previous.clicks).slice(0, limit).map(({ id: query, latest, previous, siteUrl, searchType, periodDays }) => ({ query, latest, previous, siteUrl, searchType, periodDays, clickDelta: latest.clicks - previous.clicks }));
    const pageClickDrops = pagePairs.filter(({ latest, previous }) => previous.clicks >= 5 && latest.clicks <= previous.clicks * 0.7).sort((a, b) => b.previous.clicks - a.previous.clicks).slice(0, limit).map(({ id: url, latest, previous, siteUrl, searchType, periodDays }) => ({ url, latest, previous, siteUrl, searchType, periodDays, clickDelta: latest.clicks - previous.clicks }));
    const queryTotal = Number(queryTotalRow?.value ?? 0); const pageTotal = Number(pageTotalRow?.value ?? 0);
    return { generatedAt: now(), definitions: { positionDrops: 'Same Search Console property/search type/period length; non-overlapping periods; average position worsened by at least 3.', clickDrops: 'Compatible periods only; clicks fell by at least 30% from a previous period with at least 5 clicks.', pageClickDrops: 'Compatible periods only; page clicks fell by at least 30% from a previous period with at least 5 clicks.' }, positionDrops, clickDrops, pageClickDrops, querySnapshots: queryTotal, pageSnapshots: pageTotal, loadedForComparison: { queries: queryRows.length, pages: pageRows.length }, comparisonTruncated: queryTotal > queryRows.length || pageTotal > pageRows.length };
  })
};
