import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { field, value, firestore, firestoreDocumentName, FirestoreError } from '../../db/src/firestore.js';
import type { MetricSnapshot, OptimizationEvent, SiteArticleRecord, SiteRecord } from '../../db/src/site-operations-schema.js';

const entityId = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
const note = z.string().max(4000);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const isoTime = z.string().datetime({ offset: true });
const repository = z.string().trim().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/).max(200);
const webUrl = z.string().url().refine(value => /^https?:\/\//i.test(value), 'URL must use http or https');
const commitSha = z.string().regex(/^[a-f0-9]{7,64}$/i);
const keywordId = z.string().regex(/^[a-f0-9]{32}$/);
const metrics = z.record(z.string().min(1).max(100), z.number().finite().nullable()).default({});
const period = z.object({ start: isoDate, end: isoDate }).strict();
const deploymentProvider = z.enum(['vercel', 'cloudflare_pages', 'github_pages', 'other']);
const siteStatus = z.enum(['planned', 'building', 'active', 'paused', 'archived']);
const articleStatus = z.enum(['draft', 'published', 'paused', 'archived']);
const actionType = z.enum(['content_expand', 'title_snippet', 'internal_links', 'cta_ui', 'freshness', 'indexing', 'new_article', 'other']);
const optimizationPhase = z.enum(['proposed', 'implemented', 'evaluated', 'cancelled']);
const optimizationResult = z.enum(['pending', 'improved', 'neutral', 'worsened', 'inconclusive']);

export const siteRegistryListShape = { status: siteStatus.optional(), limit: z.number().int().min(1).max(100).default(50), pageToken: z.string().max(4000).optional() };
export const siteRegistryGetShape = { id: entityId };
export const siteRegistryResolveShape = {
  localProjectId: entityId.optional(),
  productionUrl: webUrl.optional()
};
const siteResolveSchema = z.object(siteRegistryResolveShape).strict().refine(input => Boolean(input.localProjectId || input.productionUrl), 'localProjectId or productionUrl is required');
export const siteRegistrySaveShape = {
  id: entityId, expectedRevision: z.number().int().min(0),
  siteConceptId: entityId.nullable().optional(), localProjectId: entityId.nullable().optional(), name: z.string().trim().min(1).max(200).optional(),
  repository: repository.optional(), productionUrl: webUrl.optional(), deploymentProvider: deploymentProvider.optional(),
  ga4PropertyId: z.string().trim().min(1).max(200).nullable().optional(),
  searchConsoleProperty: z.string().trim().min(1).max(500).nullable().optional(), status: siteStatus.optional()
};
const siteSaveSchema = z.object(siteRegistrySaveShape).strict();

export const siteArticleListShape = { siteId: entityId, status: articleStatus.optional(), limit: z.number().int().min(1).max(500).default(50) };
export const siteArticleGetShape = { id: entityId };
export const siteArticleSaveShape = {
  id: entityId, expectedRevision: z.number().int().min(0), siteId: entityId,
  localPageId: entityId.nullable().optional(), canonicalUrl: webUrl.nullable().optional(), repo: repository.optional(),
  repoPath: z.string().trim().min(1).max(1000).refine(path => !path.startsWith('/') && !path.includes('\\') && !path.split('/').includes('..'), 'repoPath must be a safe repository-relative path').optional(),
  currentCommitSha: commitSha.nullable().optional(), slug: z.string().trim().min(1).max(300).regex(/^[^\s?#]+$/).optional(),
  title: z.string().trim().min(1).max(300).optional(), primaryKeywordId: keywordId.nullable().optional(),
  secondaryKeywordIds: z.array(keywordId).max(100).optional(), status: articleStatus.optional(),
  publishedAt: isoTime.nullable().optional(), lastUpdatedAt: isoTime.nullable().optional()
};
const articleSaveSchema = z.object(siteArticleSaveShape).strict();

const queryRow = z.object({
  query: z.string().trim().min(1).max(500), clicks: z.number().finite().min(0).nullable().default(null),
  impressions: z.number().finite().min(0).nullable().default(null), ctr: z.number().finite().min(0).max(1).nullable().default(null),
  averagePosition: z.number().finite().min(0).nullable().default(null)
}).strict();
export const metricSnapshotSaveShape = {
  id: entityId.optional(), siteId: entityId, articleId: entityId.nullable().optional(), provider: z.enum(['gsc', 'ga4']),
  periodStart: isoDate, periodEnd: isoDate, metrics, queries: z.array(queryRow).max(200).default([]),
  completeness: z.enum(['complete', 'partial', 'failed']).default('complete'), sourceVersion: z.string().trim().min(1).max(500),
  capturedAt: isoTime.optional()
};
const metricSaveSchema = z.object(metricSnapshotSaveShape).strict();
export const metricSnapshotListShape = {
  siteId: entityId, articleId: entityId.optional(), provider: z.enum(['gsc', 'ga4']).optional(),
  limit: z.number().int().min(1).max(100).default(50)
};

export const optimizationEventCreateShape = {
  id: entityId.optional(), siteId: entityId, articleId: entityId,
  observation: note.refine(value => value.trim().length > 0), diagnosis: note.refine(value => value.trim().length > 0),
  hypothesis: note.refine(value => value.trim().length > 0), actionType,
  beforeCommit: commitSha.nullable().optional(), afterCommit: commitSha.nullable().optional(), baselinePeriod: period,
  changedAt: isoTime.nullable().optional(), evaluateAfter: isoTime.nullable().optional(), phase: optimizationPhase.default('proposed'),
  notes: note.default('')
};
const optimizationCreateSchema = z.object(optimizationEventCreateShape).strict();
export const optimizationEventListShape = {
  siteId: entityId, articleId: entityId.optional(), phase: optimizationPhase.optional(), result: optimizationResult.optional(),
  limit: z.number().int().min(1).max(100).default(50)
};
export const optimizationEventUpdateShape = {
  id: entityId, expectedRevision: z.number().int().min(1), beforeCommit: commitSha.nullable().optional(), afterCommit: commitSha.nullable().optional(),
  changedAt: isoTime.nullable().optional(), evaluateAfter: isoTime.nullable().optional(), phase: optimizationPhase.optional(),
  result: optimizationResult.optional(), evaluationMetrics: metrics.optional(), notes: note.optional()
};
const optimizationUpdateSchema = z.object(optimizationEventUpdateShape).strict();
export const optimizationContextShape = { siteId: entityId, articleId: entityId.optional(), metricLimit: z.number().int().min(1).max(100).default(30), eventLimit: z.number().int().min(1).max(100).default(30) };

const encodeFields = (data: object) => Object.fromEntries(Object.entries(data).map(([key, item]) => [key, field(item)]));
const decoded = (doc: any) => ({ id: doc.name.split('/').pop(), ...Object.fromEntries(Object.entries(doc.fields ?? {}).map(([key, item]) => [key, value(item)])) });
const siteRecord = (doc: any) => ({ localProjectId: null, ...decoded(doc) }) as SiteRecord;
const articleRecord = (doc: any) => ({ localPageId: null, canonicalUrl: null, ...decoded(doc) }) as SiteArticleRecord;
const now = () => new Date().toISOString();
const sha = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

function normalizeWebIdentity(value: string) {
  const url = new URL(value);
  url.hash = '';
  url.search = '';
  if ((url.protocol === 'https:' && url.port === '443') || (url.protocol === 'http:' && url.port === '80')) url.port = '';
  if (url.pathname !== '/') url.pathname = url.pathname.replace(/\/+$/, '') || '/';
  return url.toString();
}

async function readDocument(collection: string, idValue: string) {
  try { return await firestore(`/${collection}/${entityId.parse(idValue)}`); }
  catch (error) { if (error instanceof FirestoreError && error.status === 404) return null; throw error; }
}

async function listDocuments(collection: string, input: { limit: number; pageToken?: string; orderBy?: string }) {
  const params = new URLSearchParams({ pageSize: String(input.limit) });
  if (input.pageToken) params.set('pageToken', input.pageToken);
  if (input.orderBy) params.set('orderBy', input.orderBy);
  return firestore(`/${collection}?${params}`);
}

async function queryByField(collection: string, fieldPath: string, expected: unknown, limit = 500) {
  const result = await firestore(':runQuery', { method: 'POST', body: JSON.stringify({ structuredQuery: {
    from: [{ collectionId: collection }],
    where: { fieldFilter: { field: { fieldPath }, op: 'EQUAL', value: field(expected) } },
    limit: Math.max(1, Math.min(limit, 1000))
  } }) });
  return (Array.isArray(result) ? result : []).flatMap((row: any) => row.document ? [row.document] : []);
}

async function sitesByProductionUrl(productionUrl: string): Promise<SiteRecord[]> {
  const result = await listDocuments('sites', { limit: 500 });
  if (result.nextPageToken) throw new Error('Site registry is too large for a complete productionUrl identity check; resolve by localProjectId or migrate to an indexed identity key');
  return (result.documents ?? []).map(siteRecord).filter((site: SiteRecord) => site.productionUrl && normalizeWebIdentity(site.productionUrl) === productionUrl);
}

async function queryBySite(collection: string, siteId: string, limit = 500) {
  return (await queryByField(collection, 'siteId', siteId, limit)).map(decoded);
}

async function ensureSite(siteId: string) {
  const doc = await readDocument('sites', siteId);
  if (!doc) throw new Error('Site not found: create it with site_registry_save first');
  return siteRecord(doc);
}

async function ensureArticle(articleId: string, siteId?: string) {
  const doc = await readDocument('articles', articleId);
  if (!doc) throw new Error('Article not found: create it with site_article_save first');
  const article = articleRecord(doc);
  if (siteId && article.siteId !== siteId) throw new Error('Article does not belong to the requested site');
  return article;
}

async function auditWrite(command: string, targetId: string, data: object, previous?: any | null) {
  const runId = randomUUID();
  const createdAt = now();
  const writes: any[] = [
    { update: { name: firestoreDocumentName(`runs/${runId}`), fields: encodeFields({ id: runId, command, targetId, actor: 'sites_remote_mcp', createdAt, outcome: 'succeeded' }) }, currentDocument: { exists: false } }
  ];
  const update = (data as any).__write as { collection: string; id: string; fields: object };
  writes.unshift({ update: { name: firestoreDocumentName(`${update.collection}/${update.id}`), fields: encodeFields(update.fields) }, currentDocument: previous ? { updateTime: previous.updateTime } : { exists: false } });
  try { await firestore(':commit', { method: 'POST', body: JSON.stringify({ writes }) }); }
  catch (error) {
    if (error instanceof FirestoreError && [400, 409, 412].includes(error.status)) throw new Error('Save failed or revision changed: read the current record and retry with its revision');
    throw error;
  }
  return runId;
}

function assertPeriod(start: string, end: string) {
  if (Date.parse(`${start}T00:00:00Z`) > Date.parse(`${end}T00:00:00Z`)) throw new Error('Period start must be on or before period end');
}

function normalizeImplementedEvent<T extends OptimizationEvent>(event: T, forcePending = true): T {
  if (event.phase !== 'implemented') return event;
  const changedAt = event.changedAt ?? now();
  const evaluateAfter = event.evaluateAfter ?? new Date(Date.parse(changedAt) + 14 * 86_400_000).toISOString();
  if (Date.parse(evaluateAfter) <= Date.parse(changedAt)) throw new Error('evaluateAfter must be later than changedAt');
  return { ...event, changedAt, evaluateAfter, result: forcePending ? 'pending' : event.result };
}

async function assertNoPendingImplementedChange(siteId: string, articleId: string, excludeId?: string) {
  const events = await queryBySite('optimizationEvents', siteId, 500);
  const pending = events.find((event: any) => event.id !== excludeId && event.articleId === articleId && event.phase === 'implemented' && event.result === 'pending');
  if (pending) throw new Error(`Article has an unevaluated optimization (${pending.id}); evaluate or cancel it before another implemented change`);
}

export function remoteSitesStatus() {
  return {
    firestoreConfigured: Boolean(process.env.FIREBASE_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || process.env.GCP_PROJECT_ID),
    projectConfigured: Boolean(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || process.env.FIREBASE_SERVICE_ACCOUNT || process.env.FIREBASE_SERVICE_ACCOUNT_BASE64),
    sourceOfTruth: { articleBody: 'git_repository', operations: 'firestore', localExecution: 'sqlite' },
    collections: ['sites', 'articles', 'metricSnapshots', 'optimizationEvents'],
    optimizationPolicy: { oneImplementedChangePerArticle: true, defaultEvaluationWaitDays: 14 }
  };
}

export async function siteRegistryList(input: unknown = {}) {
  const args = z.object(siteRegistryListShape).strict().parse(input);
  const result = await listDocuments('sites', { limit: args.limit, pageToken: args.pageToken, orderBy: 'updatedAt desc' });
  const items = (result.documents ?? []).map(siteRecord).filter((item: SiteRecord) => !args.status || item.status === args.status);
  return { items, nextPageToken: result.nextPageToken ?? null };
}

export async function siteRegistryGet(input: unknown) {
  const args = z.object(siteRegistryGetShape).strict().parse(input);
  const doc = await readDocument('sites', args.id); if (!doc) throw new Error('Site not found');
  return siteRecord(doc);
}

export async function siteRegistryResolve(input: unknown) {
  const args = siteResolveSchema.parse(input);
  const matches = args.localProjectId
    ? (await queryByField('sites', 'localProjectId', args.localProjectId, 3)).map(siteRecord)
    : await sitesByProductionUrl(normalizeWebIdentity(args.productionUrl!));
  if (matches.length > 1) throw new Error('Site registry mapping is ambiguous; each local project/production URL must map to one site');
  return { site: matches[0] ?? null };
}

export async function siteRegistrySave(input: unknown) {
  const args = siteSaveSchema.parse(input);
  const previous = await readDocument('sites', args.id); const current = previous ? siteRecord(previous) : null;
  if ((current?.revision ?? 0) !== args.expectedRevision) throw new Error('Revision conflict: call site_registry_get and reapply the edit');
  if (!current && (!args.name || !args.repository || !args.productionUrl)) throw new Error('name, repository and productionUrl are required for a new site');
  if (args.siteConceptId) {
    const concept = await readDocument('siteStructures', args.siteConceptId);
    if (!concept) throw new Error('Unknown siteConceptId: create the Site Concept before registering a real site');
  }
  if (args.localProjectId) {
    const linked = (await queryByField('sites', 'localProjectId', args.localProjectId, 3)).map(siteRecord).find(site => site.id !== args.id);
    if (linked) throw new Error(`localProjectId is already linked to site ${linked.id}`);
  }
  const productionUrl = typeof args.productionUrl === 'string' ? normalizeWebIdentity(args.productionUrl) : args.productionUrl;
  if (productionUrl) {
    const linked = (await sitesByProductionUrl(productionUrl)).find(site => site.id !== args.id);
    if (linked) throw new Error(`productionUrl is already linked to site ${linked.id}`);
  }
  const t = now(); const { expectedRevision, ...rawPatch } = args;
  const patch = args.productionUrl === undefined ? rawPatch : { ...rawPatch, productionUrl };
  const base: SiteRecord = current ?? {
    id: args.id, siteConceptId: null, localProjectId: null, name: '', repository: '', productionUrl: '', deploymentProvider: 'other',
    ga4PropertyId: null, searchConsoleProperty: null, status: 'planned', revision: 0, createdAt: t, updatedAt: t
  };
  const record: SiteRecord = {
    ...base, ...Object.fromEntries(Object.entries(patch).filter(([, item]) => item !== undefined)),
    id: args.id, revision: expectedRevision + 1, createdAt: current?.createdAt ?? t, updatedAt: t
  } as SiteRecord;
  const runId = await auditWrite('site_registry_save', record.id, { __write: { collection: 'sites', id: record.id, fields: record } }, previous);
  return { ...record, runId };
}

export async function siteArticleList(input: unknown) {
  const args = z.object(siteArticleListShape).strict().parse(input); await ensureSite(args.siteId);
  const all = (await queryBySite('articles', args.siteId, 501)).map(item => ({ localPageId: null, canonicalUrl: null, ...item }) as SiteArticleRecord);
  const filtered = all
    .filter(item => !args.status || item.status === args.status)
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  return { items: filtered.slice(0, args.limit), truncated: all.length > 500 };
}

export async function siteArticleGet(input: unknown) {
  const args = z.object(siteArticleGetShape).strict().parse(input); return ensureArticle(args.id);
}

export async function siteArticleSave(input: unknown) {
  const args = articleSaveSchema.parse(input); await ensureSite(args.siteId);
  const previous = await readDocument('articles', args.id); const current = previous ? articleRecord(previous) : null;
  if ((current?.revision ?? 0) !== args.expectedRevision) throw new Error('Revision conflict: call site_article_get and reapply the edit');
  if (current && current.siteId !== args.siteId) throw new Error('An existing article cannot be moved to another site');
  if (!current && (!args.repo || !args.repoPath || !args.slug || !args.title)) throw new Error('repo, repoPath, slug and title are required for a new article');
  const canonicalUrl = typeof args.canonicalUrl === 'string' ? normalizeWebIdentity(args.canonicalUrl) : args.canonicalUrl;
  const siblingResponse = (args.localPageId || canonicalUrl) ? await siteArticleList({ siteId: args.siteId, limit: 500 }) : { items: [] as SiteArticleRecord[], truncated: false };
  if (siblingResponse.truncated) throw new Error('Article registry is too large for a complete identity check; migrate to indexed article identity keys before adding or remapping articles');
  const siblings = siblingResponse.items as SiteArticleRecord[];
  if (args.localPageId) {
    const linked = siblings.find(article => article.id !== args.id && article.localPageId === args.localPageId);
    if (linked) throw new Error(`localPageId is already linked to article ${linked.id}`);
  }
  if (canonicalUrl) {
    const linked = siblings.find(article => article.id !== args.id && article.canonicalUrl && normalizeWebIdentity(article.canonicalUrl) === canonicalUrl);
    if (linked) throw new Error(`canonicalUrl is already linked to article ${linked.id}`);
  }
  const t = now(); const { expectedRevision, ...rawPatch } = args;
  const patch = args.canonicalUrl === undefined ? rawPatch : { ...rawPatch, canonicalUrl };
  const base: SiteArticleRecord = current ?? {
    id: args.id, siteId: args.siteId, localPageId: null, canonicalUrl: null, repo: '', repoPath: '', currentCommitSha: null, slug: '', title: '', primaryKeywordId: null,
    secondaryKeywordIds: [], status: 'draft', publishedAt: null, lastUpdatedAt: null, revision: 0, createdAt: t, updatedAt: t
  };
  const record: SiteArticleRecord = {
    ...base, ...Object.fromEntries(Object.entries(patch).filter(([, item]) => item !== undefined)),
    id: args.id, siteId: args.siteId, revision: expectedRevision + 1, createdAt: current?.createdAt ?? t, updatedAt: t
  } as SiteArticleRecord;
  const runId = await auditWrite('site_article_save', record.id, { __write: { collection: 'articles', id: record.id, fields: record } }, previous);
  return { ...record, runId };
}

export async function metricSnapshotSave(input: unknown) {
  const args = metricSaveSchema.parse(input); assertPeriod(args.periodStart, args.periodEnd); await ensureSite(args.siteId);
  if (args.articleId) await ensureArticle(args.articleId, args.siteId);
  const capturedAt = args.capturedAt ?? now();
  const idValue = args.id ?? sha({ siteId: args.siteId, articleId: args.articleId ?? null, provider: args.provider, periodStart: args.periodStart, periodEnd: args.periodEnd, sourceVersion: args.sourceVersion }).slice(0, 40);
  const existing = await readDocument('metricSnapshots', idValue);
  if (existing) {
    const saved = decoded(existing) as MetricSnapshot;
    if (saved.sourceVersion !== args.sourceVersion) throw new Error('Metric snapshot ID already exists with a different sourceVersion');
    return { ...saved, reused: true };
  }
  const record: MetricSnapshot = { id: idValue, siteId: args.siteId, articleId: args.articleId ?? null, provider: args.provider, periodStart: args.periodStart, periodEnd: args.periodEnd,
    metrics: args.metrics, queries: args.queries, completeness: args.completeness, sourceVersion: args.sourceVersion, capturedAt, createdAt: now() };
  const runId = await auditWrite('site_metric_snapshot_save', record.id, { __write: { collection: 'metricSnapshots', id: record.id, fields: record } }, null);
  return { ...record, reused: false, runId };
}

export async function metricSnapshotList(input: unknown) {
  const args = z.object(metricSnapshotListShape).strict().parse(input); await ensureSite(args.siteId);
  const items = (await queryBySite('metricSnapshots', args.siteId, 1000)).filter((item: any) => (!args.articleId || item.articleId === args.articleId) && (!args.provider || item.provider === args.provider))
    .sort((a: any, b: any) => String(b.capturedAt).localeCompare(String(a.capturedAt))).slice(0, args.limit) as MetricSnapshot[];
  return { items };
}

export async function optimizationEventCreate(input: unknown) {
  const args = optimizationCreateSchema.parse(input); assertPeriod(args.baselinePeriod.start, args.baselinePeriod.end); await ensureSite(args.siteId); await ensureArticle(args.articleId, args.siteId);
  const idValue = args.id ?? randomUUID();
  if (await readDocument('optimizationEvents', idValue)) throw new Error('Optimization event already exists');
  if (args.phase === 'implemented' || args.changedAt) await assertNoPendingImplementedChange(args.siteId, args.articleId);
  const t = now();
  let event: OptimizationEvent = { id: idValue, siteId: args.siteId, articleId: args.articleId, observation: args.observation, diagnosis: args.diagnosis, hypothesis: args.hypothesis,
    actionType: args.actionType, beforeCommit: args.beforeCommit ?? null, afterCommit: args.afterCommit ?? null, baselinePeriod: args.baselinePeriod,
    changedAt: args.changedAt ?? null, evaluateAfter: args.evaluateAfter ?? null, phase: args.phase, result: 'pending', evaluationMetrics: {}, notes: args.notes, revision: 1, createdAt: t, updatedAt: t };
  if (event.changedAt && event.phase === 'proposed') event.phase = 'implemented';
  event = normalizeImplementedEvent(event, true);
  const runId = await auditWrite('optimization_event_create', event.id, { __write: { collection: 'optimizationEvents', id: event.id, fields: event } }, null);
  return { ...event, runId };
}

export async function optimizationEventList(input: unknown) {
  const args = z.object(optimizationEventListShape).strict().parse(input); await ensureSite(args.siteId);
  const items = (await queryBySite('optimizationEvents', args.siteId, 1000)).filter((item: any) => (!args.articleId || item.articleId === args.articleId) && (!args.phase || item.phase === args.phase) && (!args.result || item.result === args.result))
    .sort((a: any, b: any) => String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, args.limit) as OptimizationEvent[];
  return { items };
}

export async function optimizationEventUpdate(input: unknown) {
  const args = optimizationUpdateSchema.parse(input); const previous = await readDocument('optimizationEvents', args.id); if (!previous) throw new Error('Optimization event not found');
  const current = decoded(previous) as OptimizationEvent; if (current.revision !== args.expectedRevision) throw new Error('Revision conflict: list optimization events and reapply the edit');
  const t = now(); const { expectedRevision, id: _id, ...patch } = args;
  let event: OptimizationEvent = { ...current, ...Object.fromEntries(Object.entries(patch).filter(([, item]) => item !== undefined)), revision: expectedRevision + 1, updatedAt: t } as OptimizationEvent;
  const becomingImplemented = event.phase === 'implemented' && current.phase !== 'implemented';
  if (becomingImplemented || (event.phase === 'implemented' && current.result !== 'pending')) await assertNoPendingImplementedChange(event.siteId, event.articleId, event.id);
  event = normalizeImplementedEvent(event, becomingImplemented);
  if (event.result !== 'pending') {
    if (!event.changedAt || !event.evaluateAfter) throw new Error('Implemented/evaluation timestamps are required before recording a result');
    if (Date.now() < Date.parse(event.evaluateAfter)) throw new Error('Evaluation window has not matured yet; keep the event pending');
    event.phase = 'evaluated';
  }
  if (event.phase === 'cancelled') event.result = event.result === 'pending' ? 'inconclusive' : event.result;
  const runId = await auditWrite('optimization_event_update', event.id, { __write: { collection: 'optimizationEvents', id: event.id, fields: event } }, previous);
  return { ...event, runId };
}

export async function optimizationContext(input: unknown) {
  const args = z.object(optimizationContextShape).strict().parse(input); const site = await ensureSite(args.siteId);
  if (args.articleId) await ensureArticle(args.articleId, args.siteId);
  const [metricRows, eventRows] = await Promise.all([queryBySite('metricSnapshots', args.siteId, 1000), queryBySite('optimizationEvents', args.siteId, 1000)]);
  const metricsForTarget = metricRows.filter((item: any) => !args.articleId || item.articleId === args.articleId).sort((a: any, b: any) => String(b.capturedAt).localeCompare(String(a.capturedAt))).slice(0, args.metricLimit);
  const eventsForTarget = eventRows.filter((item: any) => !args.articleId || item.articleId === args.articleId).sort((a: any, b: any) => String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, args.eventLimit);
  const active = eventsForTarget.find((event: any) => event.phase === 'implemented' && event.result === 'pending') as OptimizationEvent | undefined;
  return {
    site, articleId: args.articleId ?? null, changeAllowed: !active, activeOptimization: active ?? null,
    cooldownUntil: active?.evaluateAfter ?? null,
    latestMetrics: {
      gsc: metricsForTarget.find((snapshot: any) => snapshot.provider === 'gsc') ?? null,
      ga4: metricsForTarget.find((snapshot: any) => snapshot.provider === 'ga4') ?? null
    },
    metricSnapshots: metricsForTarget, optimizationEvents: eventsForTarget,
    policy: { oneImplementedChangePerArticle: true, defaultEvaluationWaitDays: 14, note: 'Daily collection is allowed; content changes remain blocked until the active hypothesis is evaluated or cancelled.' }
  };
}