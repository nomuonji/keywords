import { and, desc, eq, isNotNull } from 'drizzle-orm';
import { getDatabase, schema } from '@keywords/db';
import type { CommandContext } from '@keywords/domain';
import { fetchSitemapUrls } from '@keywords/research/sitemap';
import { recordProviderCapability } from './workspace.js';
import { assertOperationAllowed, reserveOperationBudget, settleOperationBudget } from './guard.js';

const { db, sqlite } = getDatabase();
const now = () => new Date().toISOString();
const id = () => crypto.randomUUID();
const projectCtx = (ctx: CommandContext, projectId: string): CommandContext => ({ ...ctx, projectId });

async function withRun<T>(ctx: CommandContext, command: string, input: unknown, fn: () => Promise<T>): Promise<T> {
  const runId = id(); const started = Date.now(); const createdAt = now();
  try { const output = await fn(); await db.insert(schema.runs).values({ id: runId, projectId: ctx.projectId ?? null, workSessionId: ctx.workSessionId ?? null, actor: ctx.actor, actorId: ctx.actorId ?? null, command, status: 'succeeded', inputJson: JSON.stringify(input ?? null), outputJson: JSON.stringify(output ?? null), durationMs: Date.now() - started, createdAt }); return output; }
  catch (error) { await db.insert(schema.runs).values({ id: runId, projectId: ctx.projectId ?? null, workSessionId: ctx.workSessionId ?? null, actor: ctx.actor, actorId: ctx.actorId ?? null, command, status: 'failed', inputJson: JSON.stringify(input ?? null), error: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started, createdAt }); throw error; }
}
function defaultSitemap(domain: string) { const raw = /^https?:\/\//i.test(domain) ? domain : `https://${domain}`; return new URL('/sitemap.xml', raw).toString(); }
function pageIdentity(input: string) { const url = new URL(input); const pathname = url.pathname.replace(/\/+$/, '') || '/'; const decoded = decodeURIComponent(pathname); const title = decoded === '/' ? url.hostname : (decoded.split('/').filter(Boolean).at(-1) ?? url.hostname).replace(/[-_]+/g, ' '); const slug = pathname === '/' ? '__root__' : pathname.replace(/^\/+|\/+$/g, '').replace(/\//g, '--').slice(0, 220); return { url: url.toString(), title, slug }; }
const slugSuffix = (value: string) => Buffer.from(value).toString('base64url').slice(0, 10).toLowerCase();

async function upsertLivePage(projectId: string, inputUrl: string, seenAt: string) {
  const identity = pageIdentity(inputUrl);
  const existingUrl = await db.select().from(schema.pages).where(and(eq(schema.pages.projectId, projectId), eq(schema.pages.url, identity.url))).get();
  if (existingUrl) {
    await db.update(schema.pages).set({ status: existingUrl.status === 'archived' || existingUrl.status === 'stale' ? 'published' : existingUrl.status, source: existingUrl.source === 'search_console' ? 'search_console' : 'sitemap', lastSeenAt: seenAt, updatedAt: seenAt }).where(eq(schema.pages.id, existingUrl.id));
    return { id: existingUrl.id, created: false };
  }
  const sameSlug = await db.select().from(schema.pages).where(and(eq(schema.pages.projectId, projectId), eq(schema.pages.slug, identity.slug))).get();
  const safeSlug = sameSlug ? `${identity.slug.slice(0, 210)}--live-${slugSuffix(identity.url)}` : identity.slug;
  const row = { id: id(), projectId, clusterId: null, title: identity.title, slug: safeSlug, kind: 'existing', status: 'published', rationale: null, evidenceJson: null, audience: null, question: null, searchIntent: null, uniqueAngle: null, unresolvedAssumptionsJson: null, planMode: 'new_page', targetPageId: null, url: identity.url, source: 'sitemap', lastSeenAt: seenAt, createdAt: seenAt, updatedAt: seenAt };
  await db.insert(schema.pages).values(row); return { id: row.id, created: true };
}

export const siteCommands = {
  list: async (ctx: CommandContext, projectId: string) => withRun(projectCtx(ctx, projectId), 'site.list', { projectId }, async () => db.select().from(schema.pages).where(and(eq(schema.pages.projectId, projectId), isNotNull(schema.pages.url))).orderBy(desc(schema.pages.lastSeenAt)).limit(2000)),

  syncSitemap: async (ctx: CommandContext, input: { projectId: string; sitemapUrl?: string }) => withRun(projectCtx(ctx, input.projectId), 'site.sync_sitemap', input, async () => {
    assertOperationAllowed(ctx, { projectId: input.projectId, command: 'site.sync_sitemap', capability: 'site.sync' });
    const project = await db.select().from(schema.projects).where(eq(schema.projects.id, input.projectId)).get(); if (!project) throw new Error('Project not found');
    const previous = sqlite.prepare("SELECT url FROM sources WHERE project_id=? AND type='sitemap' ORDER BY created_at DESC LIMIT 1").get(input.projectId) as any;
    const sitemapUrl = input.sitemapUrl?.trim() || previous?.url || (project.domain ? defaultSitemap(project.domain) : ''); if (!sitemapUrl) throw new Error('sitemapUrl is required when the project has no domain');
    const targetOrigin = project.domain ? new URL(defaultSitemap(project.domain)).origin : new URL(sitemapUrl).origin;
    const reservations: string[] = [], requestId = id();
    try {
      const discovery = await fetchSitemapUrls({ sitemapUrl, targetOrigin, discover: !input.sitemapUrl, onRequest: async () => {
        assertOperationAllowed(ctx, { projectId: input.projectId, command: 'site.request', capability: 'site.sync' });
        const reservation = reserveOperationBudget(ctx, input.projectId, 'external_request', `sitemap:${requestId}:${reservations.length}`);
        if (reservation) reservations.push(reservation.id);
      } });
      for (const reservation of reservations) settleOperationBudget(reservation, 'succeeded');
      const seenAt = now(); let created = 0, updated = 0;
      const before = await db.select().from(schema.pages).where(and(eq(schema.pages.projectId, input.projectId), eq(schema.pages.source, 'sitemap')));
      for (const url of discovery.urls) { const result = await upsertLivePage(input.projectId, url, seenAt); if (result.created) created++; else updated++; }
      const stale = discovery.complete ? before.filter(page => page.lastSeenAt && page.lastSeenAt !== seenAt && page.url && !discovery.urls.includes(page.url)).map(page => ({ id: page.id, url: page.url, lastSeenAt: page.lastSeenAt })) : [];
      for (const page of stale) await db.update(schema.pages).set({ status: 'stale', updatedAt: seenAt }).where(eq(schema.pages.id, page.id));
      const source = { id: id(), projectId: input.projectId, type: 'sitemap', label: `Sitemap sync: ${discovery.urls.length} URLs`, url: discovery.sitemapUrl, metadataJson: JSON.stringify({ sitemaps: discovery.sitemaps, urlCount: discovery.urls.length, complete: discovery.complete, rejectedUrls: discovery.rejectedUrls, created, updated, staleCount: stale.length, staleMeans: 'not observed in this complete sitemap sync; not proven deleted' }), createdAt: seenAt };
      await db.insert(schema.sources).values(source); await recordProviderCapability(input.projectId, 'sitemap', 'available');
      return { sitemapUrl: discovery.sitemapUrl, complete: discovery.complete, discovered: discovery.urls.length, created, updated, stale, sourceId: source.id, syncedAt: seenAt };
    } catch (error) { for (const reservation of reservations) settleOperationBudget(reservation, 'failed', 'Sitemap request failed'); await recordProviderCapability(input.projectId, 'sitemap', 'failed', error); throw error; }
  })
};
