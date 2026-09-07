import { and, desc, eq } from 'drizzle-orm';
import { getDatabase, schema } from '@keywords/db';
import type { CommandContext } from '@keywords/domain';
import { searchConsoleQuery } from '@keywords/research';

const { db } = getDatabase();
const now = () => new Date().toISOString();
const id = () => crypto.randomUUID();
const normalize = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ');
const projectCtx = (ctx: CommandContext, projectId: string): CommandContext => ({ ...ctx, projectId });

async function withRun<T>(ctx: CommandContext, command: string, input: unknown, fn: () => Promise<T>): Promise<T> {
  const runId = id(); const started = Date.now(); const createdAt = now();
  try {
    const output = await fn();
    await db.insert(schema.runs).values({ id: runId, projectId: ctx.projectId ?? null, workSessionId: ctx.workSessionId ?? null, actor: ctx.actor, actorId: ctx.actorId ?? null, command, status: 'succeeded', inputJson: JSON.stringify(input ?? null), outputJson: JSON.stringify(output ?? null), durationMs: Date.now() - started, createdAt });
    return output;
  } catch (error) {
    await db.insert(schema.runs).values({ id: runId, projectId: ctx.projectId ?? null, workSessionId: ctx.workSessionId ?? null, actor: ctx.actor, actorId: ctx.actorId ?? null, command, status: 'failed', inputJson: JSON.stringify(input ?? null), error: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started, createdAt });
    throw error;
  }
}

function pageIdentity(input: string) {
  const url = new URL(input);
  const pathname = url.pathname.replace(/\/+$/, '') || '/';
  const title = pathname === '/' ? url.hostname : (decodeURIComponent(pathname).split('/').filter(Boolean).at(-1) ?? url.hostname).replace(/[-_]+/g, ' ');
  const slug = pathname === '/' ? '__root__' : pathname.replace(/^\/+|\/+$/g, '').replace(/\//g, '--').slice(0, 240);
  return { url: url.toString(), title, slug };
}

async function upsertKeyword(projectId: string, query: string, row: { clicks: number; impressions: number; ctr: number; position: number }, observedAt: string) {
  const normalized = normalize(query);
  let keyword = await db.select().from(schema.keywords).where(and(eq(schema.keywords.projectId, projectId), eq(schema.keywords.normalized, normalized))).get();
  if (!keyword) {
    const created = { id: id(), projectId, topicId: null, text: query.trim(), normalized, source: 'search_console', status: 'active', avgMonthly: null, competition: null, cpcMicros: null, gscClicks: row.clicks, gscImpressions: row.impressions, gscCtr: row.ctr, gscPosition: row.position, gscUpdatedAt: observedAt, createdAt: observedAt, updatedAt: observedAt };
    await db.insert(schema.keywords).values(created);
    return created.id;
  }
  await db.update(schema.keywords).set({ gscClicks: row.clicks, gscImpressions: row.impressions, gscCtr: row.ctr, gscPosition: row.position, gscUpdatedAt: observedAt, updatedAt: observedAt }).where(eq(schema.keywords.id, keyword.id));
  return keyword.id;
}

async function upsertLivePage(projectId: string, inputUrl: string, observedAt: string) {
  const identity = pageIdentity(inputUrl);
  const existingUrl = await db.select().from(schema.pages).where(and(eq(schema.pages.projectId, projectId), eq(schema.pages.url, identity.url))).get();
  if (existingUrl) {
    await db.update(schema.pages).set({ status: existingUrl.status === 'archived' ? 'published' : existingUrl.status, lastSeenAt: observedAt, updatedAt: observedAt }).where(eq(schema.pages.id, existingUrl.id));
    return existingUrl.id;
  }
  const sameSlug = await db.select().from(schema.pages).where(and(eq(schema.pages.projectId, projectId), eq(schema.pages.slug, identity.slug))).get();
  if (sameSlug) {
    await db.update(schema.pages).set({ url: identity.url, source: sameSlug.source === 'workspace' ? 'search_console' : sameSlug.source, status: 'published', lastSeenAt: observedAt, updatedAt: observedAt }).where(eq(schema.pages.id, sameSlug.id));
    return sameSlug.id;
  }
  const page = { id: id(), projectId, clusterId: null, title: identity.title, slug: identity.slug, kind: 'existing', status: 'published', rationale: null, evidenceJson: null, url: identity.url, source: 'search_console', lastSeenAt: observedAt, createdAt: observedAt, updatedAt: observedAt };
  await db.insert(schema.pages).values(page);
  return page.id;
}

function pairBy<T extends { endDate: string }>(rows: T[], key: (row: T) => string) {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const values = groups.get(key(row)) ?? [];
    if (!values.some(item => item.endDate === row.endDate) && values.length < 2) values.push(row);
    groups.set(key(row), values);
  }
  return [...groups.entries()].filter(([, values]) => values.length >= 2).map(([id, values]) => ({ id, latest: values[0], previous: values[1] }));
}

export const metricsCommands = {
  capture: async (ctx: CommandContext, input: { projectId: string; siteUrl?: string; startDate: string; endDate: string; searchType?: string; rowLimit?: number }) => withRun(projectCtx(ctx, input.projectId), 'metrics.capture', input, async () => {
    const searchType = input.searchType ?? 'web';
    const observedAt = now();
    const [queries, pages] = await Promise.all([
      searchConsoleQuery({ siteUrl: input.siteUrl, startDate: input.startDate, endDate: input.endDate, dimensions: ['query'], rowLimit: input.rowLimit, searchType }),
      searchConsoleQuery({ siteUrl: input.siteUrl, startDate: input.startDate, endDate: input.endDate, dimensions: ['page'], rowLimit: input.rowLimit, searchType })
    ]);
    await db.delete(schema.keywordMetricSnapshots).where(and(eq(schema.keywordMetricSnapshots.projectId, input.projectId), eq(schema.keywordMetricSnapshots.siteUrl, queries.siteUrl), eq(schema.keywordMetricSnapshots.startDate, input.startDate), eq(schema.keywordMetricSnapshots.endDate, input.endDate), eq(schema.keywordMetricSnapshots.searchType, searchType)));
    await db.delete(schema.pageMetricSnapshots).where(and(eq(schema.pageMetricSnapshots.projectId, input.projectId), eq(schema.pageMetricSnapshots.siteUrl, pages.siteUrl), eq(schema.pageMetricSnapshots.startDate, input.startDate), eq(schema.pageMetricSnapshots.endDate, input.endDate), eq(schema.pageMetricSnapshots.searchType, searchType)));
    for (const row of queries.rows) {
      const query = row.keys[0]; if (!query) continue;
      const keywordId = await upsertKeyword(input.projectId, query, row, observedAt);
      await db.insert(schema.keywordMetricSnapshots).values({ id: id(), projectId: input.projectId, keywordId, query, siteUrl: queries.siteUrl, startDate: input.startDate, endDate: input.endDate, searchType, clicks: row.clicks, impressions: row.impressions, ctr: row.ctr, position: row.position, observedAt });
    }
    for (const row of pages.rows) {
      const url = row.keys[0]; if (!url) continue;
      const pageId = await upsertLivePage(input.projectId, url, observedAt);
      await db.insert(schema.pageMetricSnapshots).values({ id: id(), projectId: input.projectId, pageId, url, siteUrl: pages.siteUrl, startDate: input.startDate, endDate: input.endDate, searchType, clicks: row.clicks, impressions: row.impressions, ctr: row.ctr, position: row.position, observedAt });
    }
    const source = { id: id(), projectId: input.projectId, type: 'gsc_snapshot', label: `GSC snapshot: ${input.startDate} → ${input.endDate}`, url: queries.siteUrl.startsWith('http') ? queries.siteUrl : null, metadataJson: JSON.stringify({ siteUrl: queries.siteUrl, startDate: input.startDate, endDate: input.endDate, searchType, queryRows: queries.rows.length, pageRows: pages.rows.length }), createdAt: observedAt };
    await db.insert(schema.sources).values(source);
    return { sourceId: source.id, siteUrl: queries.siteUrl, period: { startDate: input.startDate, endDate: input.endDate }, queries: queries.rows.length, pages: pages.rows.length, capturedAt: observedAt };
  }),

  context: async (ctx: CommandContext, projectId: string, limit = 25) => withRun(projectCtx(ctx, projectId), 'metrics.context', { projectId, limit }, async () => {
    const [queryRows, pageRows] = await Promise.all([
      db.select().from(schema.keywordMetricSnapshots).where(eq(schema.keywordMetricSnapshots.projectId, projectId)).orderBy(desc(schema.keywordMetricSnapshots.endDate), desc(schema.keywordMetricSnapshots.impressions)).limit(5000),
      db.select().from(schema.pageMetricSnapshots).where(eq(schema.pageMetricSnapshots.projectId, projectId)).orderBy(desc(schema.pageMetricSnapshots.endDate), desc(schema.pageMetricSnapshots.impressions)).limit(5000)
    ]);
    const queryPairs = pairBy(queryRows, row => row.query);
    const pagePairs = pairBy(pageRows, row => row.url);
    const positionDrops = queryPairs.filter(({ latest, previous }) => latest.position - previous.position >= 3 && previous.impressions > 0).sort((a, b) => (b.previous.impressions - b.latest.impressions) - (a.previous.impressions - a.latest.impressions)).slice(0, limit).map(({ id: query, latest, previous }) => ({ query, latest, previous, positionDelta: latest.position - previous.position, impressionDelta: latest.impressions - previous.impressions }));
    const clickDrops = queryPairs.filter(({ latest, previous }) => previous.clicks >= 5 && latest.clicks <= previous.clicks * 0.7).sort((a, b) => (b.previous.clicks - b.latest.clicks) - (a.previous.clicks - a.latest.clicks)).slice(0, limit).map(({ id: query, latest, previous }) => ({ query, latest, previous, clickDelta: latest.clicks - previous.clicks }));
    const pageClickDrops = pagePairs.filter(({ latest, previous }) => previous.clicks >= 5 && latest.clicks <= previous.clicks * 0.7).sort((a, b) => (b.previous.clicks - b.latest.clicks) - (a.previous.clicks - a.latest.clicks)).slice(0, limit).map(({ id: url, latest, previous }) => ({ url, latest, previous, clickDelta: latest.clicks - previous.clicks }));
    return { generatedAt: now(), definitions: { positionDrops: 'Query average position worsened by at least 3 positions between the two latest captured periods.', clickDrops: 'Query clicks fell by at least 30% from a previous period with at least 5 clicks.', pageClickDrops: 'Page clicks fell by at least 30% from a previous period with at least 5 clicks.' }, positionDrops, clickDrops, pageClickDrops, querySnapshots: queryRows.length, pageSnapshots: pageRows.length };
  })
};
