import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { field, value, firestore, firestoreDocumentName, FirestoreError } from '../../db/src/firestore.js';
import type { MetricSnapshot, OptimizationEvent, SeoRecoveryPortfolioRecord, SeoRecoverySiteRecord, SeoTaskRecord, SiteArticleRecord, SiteDirectionRecord, SiteRecord } from '../../db/src/site-operations-schema.js';
import { themeCandidateForTask } from './theme-research.js';
import { assertSeoTaskEvaluation, seoTaskEvaluationShape } from './seo-evaluation-registry.js';
import { seoPlanningDigestGet } from './seo-planning-digest.js';

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
const siteShape = z.enum(['article', 'database', 'product', 'hybrid', 'other']);
const articleStatus = z.enum(['draft', 'published', 'paused', 'archived']);
const actionType = z.enum(['content_expand', 'title_snippet', 'internal_links', 'cta_ui', 'freshness', 'indexing', 'new_article', 'other']);
const optimizationPhase = z.enum(['proposed', 'implemented', 'evaluated', 'cancelled']);
const optimizationResult = z.enum(['pending', 'improved', 'neutral', 'worsened', 'inconclusive']);
const siteDirectionStatus = z.enum(['open', 'monitor', 'decided', 'rejected', 'superseded']);
const siteDirectionTopic = z.enum(['positioning', 'audience', 'consolidation', 'content_scope', 'monetization_model', 'page_family', 'other']);
const seoRecoveryPortfolioMode = z.enum(['normal', 'recovery']);
const seoIncidentCategory = z.enum(['search_visibility', 'content_quality', 'technical_integrity', 'measurement_integrity', 'other']);
const seoRecoverySiteState = z.enum(['suspected', 'confirmed', 'recovering', 'cleared']);
const seoRecoveryStrategy = z.enum(['unassessed', 'protect', 'consolidate', 'shrink', 'special_review']);
const seoTaskType = z.enum(['revise', 'merge', 'delete', 'internal_links', 'technical', 'new_article', 'site_expansion', 'data_expansion', 'schema_expansion']);
const seoTaskStatus = z.enum(['proposed', 'ready', 'issued', 'in_progress', 'completed', 'cancelled', 'superseded']);
const seoTaskDeploymentVerificationStatus = z.enum(['pending', 'verified', 'failed', 'not_required']);
const seoTaskDeliveryState = z.enum(['none', 'push_pending', 'branch_ready', 'pr_open', 'ci_failed', 'merged']);
const seoTaskDeliveryHandoffShape = z.object({
  state: seoTaskDeliveryState,
  branch: z.string().trim().regex(/^seo\/[A-Za-z0-9._\/-]+$/).max(240).nullable(),
  headSha: commitSha.nullable(),
  baseSha: commitSha.nullable(),
  validationSummary: note,
  handedOffAt: isoTime.nullable(),
  prNumber: z.number().int().positive().nullable(),
  prUrl: webUrl.nullable(),
  lastError: note,
  updatedAt: isoTime.nullable()
}).strict();
const seoTaskRunId = z.string().trim().min(8).max(120);
const seoTaskLeaseMinutes = z.number().int().min(15).max(180).default(75);
const seoTaskDeploymentVerificationPatch = z.object({
  status: seoTaskDeploymentVerificationStatus,
  checkedAt: isoTime.nullable().optional(),
  productionUrl: webUrl.nullable().optional(),
  deployedCommitSha: commitSha.nullable().optional(),
  detail: note.optional()
}).strict();
const seoTaskPriority = z.enum(['high', 'medium', 'low']);
const issueState = z.enum(['open', 'closed']);
const historyEntry = z.object({
  at: isoTime.optional(),
  actor: z.string().trim().min(1).max(120),
  event: z.string().trim().min(1).max(120),
  detail: z.string().trim().min(1).max(2000)
}).strict();

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
  repository: repository.optional(), productionUrl: webUrl.optional(), deploymentProvider: deploymentProvider.optional(), siteShape: siteShape.optional(),
  ga4PropertyId: z.string().trim().min(1).max(200).nullable().optional(),
  searchConsoleProperty: z.string().trim().min(1).max(500).nullable().optional(), status: siteStatus.optional()
};
const siteSaveSchema = z.object(siteRegistrySaveShape).strict();

export const siteArticleListShape = { siteId: entityId, status: articleStatus.optional(), limit: z.number().int().min(1).max(100).default(50) };
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

export const siteDirectionGetShape = { id: entityId };
export const siteDirectionCreateShape = {
  id: entityId.optional(),
  siteId: entityId,
  status: z.enum(['open', 'monitor']).default('open'),
  topic: siteDirectionTopic,
  title: z.string().trim().min(1).max(300),
  observation: note.refine(value => value.trim().length > 0),
  evidence: z.array(z.string().trim().min(1).max(1200)).min(1).max(30),
  uncertainty: note.default(''),
  proposedOptions: z.array(z.string().trim().min(1).max(1200)).max(10).default([]),
  decisionQuestion: z.string().trim().min(1).max(2000),
  constraints: z.array(z.string().trim().min(1).max(1200)).max(20).default([]),
  dedupeKey: z.string().trim().min(1).max(300),
  openedBy: z.string().trim().min(1).max(120).default('chatgpt_planner')
};
const siteDirectionCreateSchema = z.object(siteDirectionCreateShape).strict();
export const siteDirectionListShape = {
  siteId: entityId.optional(),
  status: siteDirectionStatus.optional(),
  topic: siteDirectionTopic.optional(),
  limit: z.number().int().min(1).max(100).default(50)
};
export const siteDirectionUpdateShape = {
  id: entityId,
  expectedRevision: z.number().int().min(1),
  status: siteDirectionStatus.optional(),
  observation: note.optional(),
  evidence: z.array(z.string().trim().min(1).max(1200)).min(1).max(30).optional(),
  uncertainty: note.optional(),
  proposedOptions: z.array(z.string().trim().min(1).max(1200)).max(10).optional(),
  decisionQuestion: z.string().trim().min(1).max(2000).optional(),
  decision: note.optional(),
  decisionRationale: note.optional(),
  constraints: z.array(z.string().trim().min(1).max(1200)).max(20).optional(),
  appendHistory: historyEntry.optional()
};
const siteDirectionUpdateSchema = z.object(siteDirectionUpdateShape).strict();

export const seoRecoveryStatusShape = { siteId: entityId.optional() };
export const seoRecoveryPortfolioUpdateShape = {
  expectedRevision: z.number().int().min(0),
  mode: seoRecoveryPortfolioMode,
  incidentId: entityId.nullable().optional(),
  incidentCategory: seoIncidentCategory.optional(),
  title: z.string().trim().max(300).optional(),
  reason: note.optional(),
  evidence: z.array(z.string().trim().min(1).max(1200)).max(30).optional(),
  resolutionEvidence: z.array(z.string().trim().min(1).max(1200)).min(1).max(30).optional()
};
const seoRecoveryPortfolioUpdateSchema = z.object(seoRecoveryPortfolioUpdateShape).strict();

export const seoRecoverySiteUpdateShape = {
  siteId: entityId,
  expectedRevision: z.number().int().min(0),
  state: seoRecoverySiteState,
  strategy: seoRecoveryStrategy.default('unassessed'),
  reason: note.refine(value => value.trim().length > 0),
  evidence: z.array(z.string().trim().min(1).max(1200)).min(1).max(30),
  releaseCriteria: z.array(z.string().trim().min(1).max(1200)).min(1).max(20)
};
const seoRecoverySiteUpdateSchema = z.object(seoRecoverySiteUpdateShape).strict();

export const seoTaskGetShape = { id: entityId };
export const seoTaskCreateShape = {
  id: entityId.optional(),
  siteId: entityId,
  articleIds: z.array(entityId).max(20).default([]),
  targetUrls: z.array(webUrl).max(20).default([]),
  repo: repository,
  taskType: seoTaskType,
  priority: seoTaskPriority.default('medium'),
  title: z.string().trim().min(1).max(300),
  rationale: note.refine(value => value.trim().length > 0),
  evidence: z.array(z.string().trim().min(1).max(1200)).min(1).max(30),
  directionId: entityId.nullable().optional(),
  evaluation: seoTaskEvaluationShape.optional(),
  research: z.object({ sessionId: entityId, candidateId: entityId, candidateRevision: z.number().int().positive() }).strict().optional(),
  dedupeKey: z.string().trim().min(1).max(300),
  createdBy: z.string().trim().min(1).max(120).default('chatgpt_scheduler')
};
const seoTaskCreateSchema = z.object(seoTaskCreateShape).strict();
export const seoTaskListShape = {
  siteId: entityId.optional(),
  articleId: entityId.optional(),
  taskType: seoTaskType.optional(),
  status: seoTaskStatus.optional(),
  deploymentVerificationStatus: seoTaskDeploymentVerificationStatus.optional(),
  limit: z.number().int().min(1).max(100).default(50)
};
export const seoTaskClaimShape = {
  id: entityId,
  expectedRevision: z.number().int().min(1),
  runId: seoTaskRunId.optional(),
  actor: z.string().trim().min(1).max(120).default('seo_worker'),
  leaseMinutes: seoTaskLeaseMinutes
};
const seoTaskClaimSchema = z.object(seoTaskClaimShape).strict();
export const seoTaskHeartbeatShape = {
  id: entityId,
  expectedRevision: z.number().int().min(1),
  runId: seoTaskRunId,
  leaseMinutes: seoTaskLeaseMinutes
};
const seoTaskHeartbeatSchema = z.object(seoTaskHeartbeatShape).strict();
export const seoTaskUpdateShape = {
  id: entityId,
  expectedRevision: z.number().int().min(1),
  status: seoTaskStatus.optional(),
  priority: seoTaskPriority.optional(),
  issueNumber: z.number().int().positive().nullable().optional(),
  issueUrl: webUrl.nullable().optional(),
  issueState: issueState.nullable().optional(),
  resultCommitSha: commitSha.nullable().optional(),
  executionSummary: note.optional(),
  deploymentVerification: seoTaskDeploymentVerificationPatch.optional(),
  deliveryHandoff: seoTaskDeliveryHandoffShape.optional(),
  claimRunId: seoTaskRunId.optional(),
  appendHistory: historyEntry.optional()
};
const seoTaskUpdateSchema = z.object(seoTaskUpdateShape).strict();

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
const siteRecord = (doc: any) => ({ localProjectId: null, siteShape: 'other', ...decoded(doc) }) as SiteRecord;
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

const RECOVERY_PORTFOLIO_ID = 'organic-search';
const RECOVERY_GROWTH_TASK_TYPES = new Set(['new_article', 'site_expansion', 'data_expansion', 'schema_expansion']);
const RECOVERY_REPAIR_TASK_TYPES = ['revise', 'merge', 'delete', 'internal_links', 'technical'] as const;

function defaultRecoveryPortfolio(): SeoRecoveryPortfolioRecord {
  return {
    id: RECOVERY_PORTFOLIO_ID, mode: 'normal', incidentCategory: 'search_visibility', incidentId: null, title: '', reason: '', evidence: [],
    resolutionEvidence: [], startedAt: null, resolvedAt: null, revision: 0, createdAt: '', updatedAt: ''
  };
}

async function readRecoveryPortfolio(): Promise<{ record: SeoRecoveryPortfolioRecord; doc: any | null }> {
  const doc = await readDocument('seoRecoveryControls', RECOVERY_PORTFOLIO_ID);
  return { record: doc ? ({ ...defaultRecoveryPortfolio(), ...decoded(doc) } as SeoRecoveryPortfolioRecord) : defaultRecoveryPortfolio(), doc };
}

async function readRecoverySite(siteId: string): Promise<{ record: SeoRecoverySiteRecord | null; doc: any | null }> {
  const doc = await readDocument('seoRecoverySites', siteId);
  return { record: doc ? (decoded(doc) as SeoRecoverySiteRecord) : null, doc };
}

async function assertSeoRecoveryTaskAllowed(siteId: string, taskType: string) {
  const { record: portfolio } = await readRecoveryPortfolio();
  if (portfolio.mode !== 'recovery') return;
  const { record: site } = await readRecoverySite(siteId);
  const clearedForIncident = Boolean(site && site.state === 'cleared' && site.incidentId && site.incidentId === portfolio.incidentId);
  if (RECOVERY_GROWTH_TASK_TYPES.has(taskType) && !clearedForIncident) {
    throw new Error(`SEO recovery mode blocks taskType=${taskType} for site ${siteId} until the site is explicitly cleared for incident ${portfolio.incidentId ?? 'active'}`);
  }
}

async function commitAuditWrites(command: string, targetId: string, items: Array<{ data: object; previous?: any | null }>, auditDetail?: object) {
  const runId = randomUUID();
  const createdAt = now();
  const writes: any[] = items.map(item => {
    const update = (item.data as any).__write as { collection: string; id: string; fields: object };
    return { update: { name: firestoreDocumentName(`${update.collection}/${update.id}`), fields: encodeFields(update.fields) }, currentDocument: item.previous ? { updateTime: item.previous.updateTime } : { exists: false } };
  });
  writes.push({ update: { name: firestoreDocumentName(`runs/${runId}`), fields: encodeFields({ id: runId, command, targetId, actor: 'sites_remote_mcp', createdAt, outcome: 'succeeded', ...(auditDetail ?? {}) }) }, currentDocument: { exists: false } });
  try { await firestore(':commit', { method: 'POST', body: JSON.stringify({ writes }) }); }
  catch (error) {
    if (error instanceof FirestoreError && [400, 409, 412].includes(error.status)) throw new Error('Save failed or revision changed: read the current record and retry with its revision');
    throw error;
  }
  return runId;
}

async function auditWrite(command: string, targetId: string, data: object, previous?: any | null) {
  return commitAuditWrites(command, targetId, [{ data, previous }]);
}

const MAX_BATCH_WRITES = 200;

/**
 * Persist several records in one commit to survive tight Firestore quotas
 * during backfills. Records keep their individual documents, revisions, and
 * preconditions; only the transport is shared, with one audit record for the
 * batch. On a batch-level conflict the caller should retry items singly so
 * each record still fails honestly on its own revision.
 */
export async function auditWriteBatch(command: string, targetId: string, items: Array<{ data: object; previous?: any | null }>): Promise<string[]> {
  const runIds: string[] = [];
  for (let offset = 0; offset < items.length; offset += MAX_BATCH_WRITES) {
    const chunk = items.slice(offset, offset + MAX_BATCH_WRITES);
    const runId = await commitAuditWrites(command, `${targetId}+${chunk.length}`, chunk, { batched: chunk.length });
    await paceCloudWrite();
    runIds.push(runId);
  }
  return runIds;
}

function cloudWriteDelayMs() {
  const configured = Number(process.env.KEYWORDS_FIRESTORE_WRITE_DELAY_MS ?? 400);
  return Number.isFinite(configured) ? Math.max(0, Math.min(Math.floor(configured), 10_000)) : 400;
}

/**
 * Space out bulk control-plane writes so article-registry/projection bursts
 * stay under Firestore throttling. Reads are unaffected; throttled responses
 * still surface as errors after the bounded retry in the Firestore client.
 */
export async function paceCloudWrite() {
  const delay = cloudWriteDelayMs();
  if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
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
    collections: ['sites', 'articles', 'optimizationEvents', 'seoPlanningDigests', 'siteDirections', 'seoTasks', 'seoRecoveryControls', 'seoRecoverySites', 'sites/{siteId}/indexationUrls', 'indexationSnapshots', 'indexationQuotaDays'],
    legacyCollections: {
      metricSnapshots: 'read_only_compatibility_for_historical_optimization_evidence',
      siteDigests: 'deprecated_no_new_reads_or_writes'
    },
    analyticsStoragePolicy: {
      rawMeasurementRows: 'ephemeral_sqlite_only',
      durableAnalytics: 'seoPlanningDigests/{siteId}',
      durableUrlAnalytics: 'none',
      planningDigest: 'one_overwrite_document_per_site',
      legacyMetricSnapshots: 'read_only_compatibility_only',
      legacySiteDigests: 'unused',
      maxPlannerPages: 60,
      maxQueriesPerWindowPerPage: 3,
      maxSerializedBytes: 500000,
      durableGrowth: 'seoTasks_only_when_evidence_backed_material_action_is_ready'
    },
    indexationStoragePolicy: {
      urlCache: 'one_mutable_document_per_url_under_site',
      urlCachePurpose: 'current_inventory_and_indexation_state_not_access_analytics_history',
      history: 'weekly_site_and_page_family_snapshot_only',
      inspectionAcquisition: 'search_console_url_inspection_on_due_or_explicit_urls_only',
      defaultDailyInspectionBudgetPerProperty: Math.max(1, Math.min(Number(process.env.SITES_INDEXATION_DAILY_BUDGET ?? 1500) || 1500, 1900)),
      stablePassCadenceDays: 90,
      ordinaryPassCadenceDays: 30,
      nonPassCadenceDays: 7,
      newUrlDelayDays: 2,
      changedUrlDelayDays: 3
    },
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
    id: args.id, siteConceptId: null, localProjectId: null, name: '', repository: '', productionUrl: '', deploymentProvider: 'other', siteShape: 'other',
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
  const items = (await queryBySite('articles', args.siteId, 500)).map(item => ({ localPageId: null, canonicalUrl: null, ...item }) as SiteArticleRecord)
    .filter(item => !args.status || item.status === args.status)
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, args.limit);
  return { items };
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
  const siblings = (args.localPageId || canonicalUrl) ? (await queryBySite('articles', args.siteId, 500)).map(item => ({ localPageId: null, canonicalUrl: null, ...item }) as SiteArticleRecord) : [];
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

const articleCreateManyShape = {
  siteId: entityId,
  records: z.array(z.object({
    id: entityId,
    localPageId: entityId.nullable().optional(),
    canonicalUrl: webUrl.nullable().optional(),
    repo: repository,
    repoPath: z.string().trim().min(1).max(1000).refine(path => !path.startsWith('/') && !path.includes('\\') && !path.split('/').includes('..'), 'repoPath must be a safe repository-relative path'),
    slug: z.string().trim().min(1).max(300).regex(/^[^\s?#]+$/),
    title: z.string().trim().min(1).max(300),
    status: articleStatus.optional()
  }).strict()).min(1).max(500)
};

/**
 * Create many new articles in as few commits as possible (backfills).
 * Records keep individual documents and exists-preconditions; only transport
 * is shared. Validation mirrors siteArticleSave for new records, checked
 * against the current registry plus within-batch duplicates. On a batch
 * conflict the caller should retry items singly so each record still fails
 * honestly on its own revision.
 */
export async function siteArticleCreateMany(input: unknown) {
  const args = z.object(articleCreateManyShape).strict().parse(input);
  await ensureSite(args.siteId);
  const t = now();
  const siblings = (await queryBySite('articles', args.siteId, 500)).map(item => ({ localPageId: null, canonicalUrl: null, ...item }) as SiteArticleRecord);
  if (siblings.some(article => args.records.some(record => record.id === article.id))) {
    throw new Error('Article already exists: create it with site_article_save first or retry with its revision');
  }
  const seenPage = new Set<string>();
  const seenUrl = new Set<string>();
  const prepared = args.records.map(record => {
    if (!record.repo || !record.repoPath || !record.slug || !record.title) throw new Error('repo, repoPath, slug and title are required for a new article');
    const canonicalUrl = typeof record.canonicalUrl === 'string' ? normalizeWebIdentity(record.canonicalUrl) : record.canonicalUrl;
    if (record.localPageId) {
      if (siblings.some(article => article.localPageId === record.localPageId) || seenPage.has(record.localPageId)) {
        throw new Error(`localPageId is already linked to article ${record.localPageId}`);
      }
      seenPage.add(record.localPageId);
    }
    if (canonicalUrl) {
      const key = canonicalUrl;
      if (siblings.some(article => article.canonicalUrl && normalizeWebIdentity(article.canonicalUrl) === key) || seenUrl.has(key)) {
        throw new Error(`canonicalUrl is already linked to article ${key}`);
      }
      seenUrl.add(key);
    }
    const entry: SiteArticleRecord = {
      id: record.id, siteId: args.siteId, localPageId: record.localPageId ?? null, canonicalUrl: canonicalUrl ?? null,
      repo: record.repo, repoPath: record.repoPath, currentCommitSha: null, slug: record.slug, title: record.title,
      primaryKeywordId: null, secondaryKeywordIds: [], status: record.status ?? 'draft',
      publishedAt: null, lastUpdatedAt: null, revision: 1, createdAt: t, updatedAt: t
    } as SiteArticleRecord;
    return { entry, previous: null as null };
  });
  const runIds = await auditWriteBatch('site_article_save', args.siteId, prepared.map(item => ({
    data: { __write: { collection: 'articles', id: item.entry.id, fields: item.entry } },
    previous: item.previous
  })));
  return { created: prepared.map(item => item.entry), runIds };
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

const normalizeSiteDirection = (direction: SiteDirectionRecord): SiteDirectionRecord => ({
  ...direction,
  status: direction.status ?? 'open',
  uncertainty: direction.uncertainty ?? '',
  proposedOptions: direction.proposedOptions ?? [],
  decision: direction.decision ?? '',
  decisionRationale: direction.decisionRationale ?? '',
  constraints: direction.constraints ?? [],
  history: direction.history ?? [],
  decidedAt: direction.decidedAt ?? null
});

export async function seoRecoveryStatus(input: unknown = {}) {
  const args = z.object(seoRecoveryStatusShape).strict().parse(input);
  const { record: portfolio } = await readRecoveryPortfolio();
  let sites: SeoRecoverySiteRecord[] = [];
  if (args.siteId) {
    await ensureSite(args.siteId);
    const { record } = await readRecoverySite(args.siteId);
    if (record) sites = [record];
  } else {
    const listed = await listDocuments('seoRecoverySites', { limit: 100, orderBy: 'updatedAt desc' });
    sites = (listed.documents ?? []).map((doc: any) => decoded(doc) as SeoRecoverySiteRecord);
  }
  return {
    portfolio,
    sites,
    effectivePolicy: portfolio.mode === 'recovery' ? {
      growthFrozenByDefault: true,
      blockedTaskTypesUntilSiteClearance: [...RECOVERY_GROWTH_TASK_TYPES],
      allowedRecoveryTaskTypes: [...RECOVERY_REPAIR_TASK_TYPES],
      existingBlockedGrowthTasksAreNotClaimable: true,
      inFlightPolicy: 'continue_existing_claims_and_delivery_handoffs',
      scope: 'new_task_create_and_new_claim_only',
      incidentCategory: portfolio.incidentCategory,
      queueRule: 'Do not replenish the normal growth ready-buffer while portfolio recovery is active. Create only evidence-backed recovery/repair work; task count is not a target.',
      clearanceRule: 'Site state must be cleared for the current incident before growth task types become creatable or claimable.'
    } : {
      growthFrozenByDefault: false,
      blockedTaskTypesUntilSiteClearance: [],
      allowedRecoveryTaskTypes: [...RECOVERY_REPAIR_TASK_TYPES],
      existingBlockedGrowthTasksAreNotClaimable: false,
      inFlightPolicy: 'continue_existing_claims_and_delivery_handoffs',
      scope: 'normal_task_acquisition',
      incidentCategory: portfolio.incidentCategory,
      queueRule: 'Normal SEO operating policy applies.',
      clearanceRule: 'No recovery clearance is required while portfolio mode is normal.'
    }
  };
}

export async function seoRecoveryPortfolioUpdate(input: unknown) {
  const args = seoRecoveryPortfolioUpdateSchema.parse(input);
  const { record: current, doc: previous } = await readRecoveryPortfolio();
  if (current.revision !== args.expectedRevision) throw new Error('Revision conflict: read seo_recovery_status and retry the portfolio recovery update');
  const t = now();
  if (args.mode === 'recovery' && !args.incidentId && !current.incidentId) throw new Error('incidentId is required when entering recovery mode');
  if (current.mode === 'recovery' && args.mode === 'normal' && !args.resolutionEvidence?.length) {
    throw new Error('Returning to normal mode requires fresh resolutionEvidence; existing site clearance is not a prerequisite for a scoped policy decision.');
  }
  if (args.mode === 'recovery' && args.resolutionEvidence) {
    throw new Error('resolutionEvidence may be supplied only when returning to normal mode');
  }
  const incidentId = args.incidentId === undefined ? current.incidentId : args.incidentId;
  const startsNewIncident = args.mode === 'recovery' && (current.mode !== 'recovery' || incidentId !== current.incidentId);
  const record: SeoRecoveryPortfolioRecord = {
    ...current,
    mode: args.mode,
    incidentCategory: args.incidentCategory ?? (startsNewIncident ? 'other' : current.incidentCategory),
    incidentId,
    title: args.title === undefined ? current.title : args.title,
    reason: args.reason === undefined ? current.reason : args.reason,
    evidence: args.evidence === undefined ? current.evidence : args.evidence,
    resolutionEvidence: args.mode === 'normal' && current.mode === 'recovery'
      ? args.resolutionEvidence!
      : startsNewIncident ? [] : current.resolutionEvidence,
    startedAt: args.mode === 'recovery' ? (startsNewIncident ? t : current.startedAt) : current.startedAt,
    resolvedAt: args.mode === 'normal' ? (current.mode === 'recovery' ? t : current.resolvedAt) : null,
    revision: args.expectedRevision + 1,
    createdAt: current.createdAt || t,
    updatedAt: t
  };
  if (record.mode === 'recovery' && (!record.reason.trim() || !record.evidence.length)) throw new Error('Recovery mode requires a concrete reason and evidence');
  const runId = await auditWrite('seo_recovery_portfolio_update', record.id, { __write: { collection: 'seoRecoveryControls', id: record.id, fields: record } }, previous);
  return { ...record, runId };
}

export async function seoRecoverySiteUpdate(input: unknown) {
  const args = seoRecoverySiteUpdateSchema.parse(input);
  await ensureSite(args.siteId);
  const { record: portfolio } = await readRecoveryPortfolio();
  const { record: current, doc: previous } = await readRecoverySite(args.siteId);
  if ((current?.revision ?? 0) !== args.expectedRevision) throw new Error('Revision conflict: read seo_recovery_status for the site and retry');
  if (args.state === 'cleared' && portfolio.mode === 'recovery' && !portfolio.incidentId) throw new Error('Cannot clear a site while the active recovery incident has no incidentId');
  const t = now();
  const record: SeoRecoverySiteRecord = {
    id: args.siteId,
    siteId: args.siteId,
    incidentId: portfolio.mode === 'recovery' ? portfolio.incidentId : (current?.incidentId ?? null),
    state: args.state,
    strategy: args.strategy,
    reason: args.reason,
    evidence: args.evidence,
    releaseCriteria: args.releaseCriteria,
    revision: args.expectedRevision + 1,
    createdAt: current?.createdAt ?? t,
    updatedAt: t
  };
  const runId = await auditWrite('seo_recovery_site_update', record.id, { __write: { collection: 'seoRecoverySites', id: record.id, fields: record } }, previous);
  return { ...record, runId };
}

export async function siteDirectionGet(input: unknown) {
  const args = z.object(siteDirectionGetShape).strict().parse(input);
  const doc = await readDocument('siteDirections', args.id);
  if (!doc) throw new Error('Site direction record not found');
  return normalizeSiteDirection(decoded(doc) as SiteDirectionRecord);
}

export async function siteDirectionCreate(input: unknown) {
  const args = siteDirectionCreateSchema.parse(input);
  await ensureSite(args.siteId);
  const existing = (await queryBySite('siteDirections', args.siteId, 1000)).map(item => normalizeSiteDirection(item as SiteDirectionRecord));
  const duplicate = existing.find(direction =>
    direction.dedupeKey === args.dedupeKey &&
    ['open', 'monitor'].includes(direction.status)
  );
  if (duplicate) throw new Error(`Open site direction already exists for dedupeKey: ${duplicate.id}`);
  const idValue = args.id ?? randomUUID();
  if (await readDocument('siteDirections', idValue)) throw new Error('Site direction record already exists');
  const t = now();
  const record: SiteDirectionRecord = {
    id: idValue,
    siteId: args.siteId,
    status: args.status,
    topic: args.topic,
    title: args.title,
    observation: args.observation,
    evidence: args.evidence,
    uncertainty: args.uncertainty,
    proposedOptions: args.proposedOptions,
    decisionQuestion: args.decisionQuestion,
    decision: '',
    decisionRationale: '',
    constraints: args.constraints,
    dedupeKey: args.dedupeKey,
    history: [{ at: t, actor: args.openedBy, event: args.status === 'monitor' ? 'monitoring_started' : 'discussion_opened', detail: args.decisionQuestion }],
    openedBy: args.openedBy,
    openedAt: t,
    decidedAt: null,
    revision: 1,
    createdAt: t,
    updatedAt: t
  };
  const runId = await auditWrite('site_direction_create', record.id, { __write: { collection: 'siteDirections', id: record.id, fields: record } }, null);
  return { ...record, runId };
}

export async function siteDirectionList(input: unknown = {}) {
  const args = z.object(siteDirectionListShape).strict().parse(input);
  let items: SiteDirectionRecord[];
  if (args.siteId) {
    await ensureSite(args.siteId);
    items = (await queryBySite('siteDirections', args.siteId, 1000)).map(item => normalizeSiteDirection(item as SiteDirectionRecord));
  } else {
    const listed = await listDocuments('siteDirections', { limit: Math.min(args.limit * 5, 500), orderBy: 'updatedAt desc' });
    items = (listed.documents ?? []).map((doc: any) => normalizeSiteDirection(decoded(doc) as SiteDirectionRecord));
  }
  items = items
    .filter(direction => (!args.status || direction.status === args.status) && (!args.topic || direction.topic === args.topic))
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
    .slice(0, args.limit);
  return { items };
}

export async function siteDirectionUpdate(input: unknown) {
  const args = siteDirectionUpdateSchema.parse(input);
  const previous = await readDocument('siteDirections', args.id);
  if (!previous) throw new Error('Site direction record not found');
  const current = normalizeSiteDirection(decoded(previous) as SiteDirectionRecord);
  if (current.revision !== args.expectedRevision) throw new Error('Revision conflict: read the current site direction and reapply the edit');
  if (current.status === 'superseded') throw new Error('Superseded site direction records are immutable');
  if (['decided', 'rejected'].includes(current.status) && args.status !== 'superseded') {
    throw new Error('Decided/rejected site direction records are immutable; create a new direction and supersede this record');
  }
  const t = now();
  const { id: _id, expectedRevision, appendHistory, ...patch } = args;
  const nextStatus = patch.status ?? current.status;
  const record: SiteDirectionRecord = {
    ...current,
    ...Object.fromEntries(Object.entries(patch).filter(([, item]) => item !== undefined)),
    status: nextStatus,
    revision: expectedRevision + 1,
    updatedAt: t
  };
  if (nextStatus === 'decided') {
    if (!record.decision.trim()) throw new Error('decided site direction requires decision');
    if (!record.decisionRationale.trim()) throw new Error('decided site direction requires decisionRationale');
    record.decidedAt = current.decidedAt ?? t;
  }
  if (nextStatus === 'rejected' && !record.decisionRationale.trim()) {
    throw new Error('rejected site direction requires decisionRationale');
  }
  const history = [...(current.history ?? [])];
  if (appendHistory) history.push({ ...appendHistory, at: appendHistory.at ?? t });
  if (nextStatus !== current.status) {
    history.push({
      at: t,
      actor: appendHistory?.actor ?? 'site_direction_update',
      event: `status_${nextStatus}`,
      detail: nextStatus === 'decided' ? record.decision : record.decisionRationale || record.decisionQuestion
    });
  }
  record.history = history.slice(-100);
  const runId = await auditWrite('site_direction_update', record.id, { __write: { collection: 'siteDirections', id: record.id, fields: record } }, previous);
  return { ...record, runId };
}

async function ensureDecidedDirection(directionId: string, siteId: string) {
  const direction = await siteDirectionGet({ id: directionId });
  if (direction.siteId !== siteId) throw new Error('Site direction does not belong to the requested site');
  if (direction.status !== 'decided') throw new Error('SEO task directionId must reference a decided site direction');
  return direction;
}

const defaultDeploymentVerification = (task: Partial<SeoTaskRecord>) => ({
  // The absence of a URL is not evidence that a public check is unnecessary.
  // An explicit human decision must set not_required.
  status: 'pending' as const,
  checkedAt: null,
  productionUrl: task.targetUrls?.[0] ?? null,
  deployedCommitSha: null,
  detail: 'Production verification has not been recorded yet.'
});

const defaultDeliveryHandoff = () => ({
  state: 'none' as const,
  branch: null,
  headSha: null,
  baseSha: null,
  validationSummary: '',
  handedOffAt: null,
  prNumber: null,
  prUrl: null,
  lastError: '',
  updatedAt: null
});

const SEO_TASK_CLAIM_DEFAULT_MINUTES = 75;
const claimIsActive = (claim: SeoTaskRecord['executionClaim'] | null | undefined, at = Date.now()) =>
  Boolean(claim?.expiresAt && Date.parse(claim.expiresAt) > at);
const claimLeaseMs = (claim: SeoTaskRecord['executionClaim'] | null | undefined) => {
  if (!claim) return SEO_TASK_CLAIM_DEFAULT_MINUTES * 60_000;
  const parsed = Date.parse(claim.expiresAt) - Date.parse(claim.heartbeatAt);
  if (!Number.isFinite(parsed)) return SEO_TASK_CLAIM_DEFAULT_MINUTES * 60_000;
  return Math.max(15 * 60_000, Math.min(180 * 60_000, parsed));
};
const executionClaim = (runId: string, actor: string, claimedAt: string, heartbeatAt: string, leaseMinutes: number) => ({
  runId,
  actor,
  claimedAt,
  heartbeatAt,
  expiresAt: new Date(Date.parse(heartbeatAt) + leaseMinutes * 60_000).toISOString()
});

const normalizeSeoTask = (task: SeoTaskRecord): SeoTaskRecord => ({
  ...task,
  directionId: task.directionId ?? null,
  evaluation: task.evaluation ?? null,
  research: task.research ?? null,
  deploymentVerification: task.deploymentVerification ?? defaultDeploymentVerification(task),
  executionClaim: task.executionClaim ?? null,
  deliveryHandoff: task.deliveryHandoff ?? defaultDeliveryHandoff()
});

export async function seoTaskGet(input: unknown) {
  const args = z.object(seoTaskGetShape).strict().parse(input);
  const doc = await readDocument('seoTasks', args.id);
  if (!doc) throw new Error('SEO task not found');
  return normalizeSeoTask(decoded(doc) as SeoTaskRecord);
}

/** Connect URL-only tasks to verified registry records without inventing article metadata. */
async function taskArticleIds(task: { siteId: string; repo: string; targetUrls: string[]; articleIds: string[] }) {
  if (!task.targetUrls.length) return task.articleIds;
  const urls = new Set(task.targetUrls.map(normalizeWebIdentity));
  const articles = (await queryBySite('articles', task.siteId, 500)) as SiteArticleRecord[];
  const matched = articles.filter(article => article.repo === task.repo && article.canonicalUrl && urls.has(normalizeWebIdentity(article.canonicalUrl))).map(article => article.id);
  return [...new Set([...task.articleIds, ...matched])];
}

export async function seoTaskCreate(input: unknown) {
  const args = seoTaskCreateSchema.parse(input);
  const evaluation = args.evaluation ? assertSeoTaskEvaluation(args.evaluation, args.taskType) : null;
  await ensureSite(args.siteId);
  await assertSeoRecoveryTaskAllowed(args.siteId, args.taskType);
  if (args.directionId) await ensureDecidedDirection(args.directionId, args.siteId);
  const research = args.research ? await themeCandidateForTask(args.research.sessionId, args.research.candidateId, args.research.candidateRevision, args.siteId) : null;
  for (const articleId of args.articleIds) await ensureArticle(articleId, args.siteId);
  const siteLevelExpansion = ['data_expansion', 'schema_expansion'].includes(args.taskType);
  if (!siteLevelExpansion && !args.articleIds.length && !args.targetUrls.length) {
    throw new Error('articleIds or targetUrls is required unless taskType is data_expansion or schema_expansion');
  }
  const existing = (await queryBySite('seoTasks', args.siteId, 1000)) as SeoTaskRecord[];
  const duplicate = existing.find(task =>
    task.dedupeKey === args.dedupeKey &&
    !['completed', 'cancelled', 'superseded'].includes(task.status)
  );
  if (duplicate) throw new Error(`Open SEO task already exists for dedupeKey: ${duplicate.id}`);
  const t = now();
  const idValue = args.id ?? randomUUID();
  if (await readDocument('seoTasks', idValue)) throw new Error('SEO task already exists');
  const record: SeoTaskRecord = {
    id: idValue,
    siteId: args.siteId,
    articleIds: await taskArticleIds(args),
    targetUrls: args.targetUrls,
    repo: args.repo,
    taskType: args.taskType,
    status: 'ready',
    priority: args.priority,
    title: args.title,
    rationale: args.rationale,
    evidence: args.evidence,
    directionId: args.directionId ?? null,
    evaluation,
    research,
    dedupeKey: args.dedupeKey,
    issueNumber: null,
    issueUrl: null,
    issueState: null,
    resultCommitSha: null,
    executionSummary: '',
    deploymentVerification: defaultDeploymentVerification({ targetUrls: args.targetUrls }),
    executionClaim: null,
    deliveryHandoff: defaultDeliveryHandoff(),
    history: [{ at: t, actor: args.createdBy, event: 'ready', detail: 'Evidence-backed SEO task recorded in Sites Operator for later implementation; no GitHub Issue required.' }],
    createdBy: args.createdBy,
    revision: 1,
    createdAt: t,
    updatedAt: t,
    completedAt: null
  };
  const runId = await auditWrite('seo_task_create', record.id, { __write: { collection: 'seoTasks', id: record.id, fields: record } }, null);
  return { ...record, runId };
}

export async function seoTaskList(input: unknown) {
  const args = z.object(seoTaskListShape).strict().parse(input);
  let items: SeoTaskRecord[];
  if (args.siteId) {
    await ensureSite(args.siteId);
    items = ((await queryBySite('seoTasks', args.siteId, 1000)) as SeoTaskRecord[]).map(normalizeSeoTask);
  } else {
    const listed = await listDocuments('seoTasks', { limit: Math.min(args.limit * 5, 500), orderBy: 'updatedAt desc' });
    items = (listed.documents ?? []).map((doc: any) => normalizeSeoTask(decoded(doc) as SeoTaskRecord));
  }
  items = items.filter(task =>
    (!args.articleId || task.articleIds.includes(args.articleId)) &&
    (!args.taskType || task.taskType === args.taskType) &&
    (!args.status || task.status === args.status) &&
    (!args.deploymentVerificationStatus || task.deploymentVerification.status === args.deploymentVerificationStatus)
  ).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, args.limit);
  return { items };
}

export async function seoTaskClaim(input: unknown) {
  const args = seoTaskClaimSchema.parse(input);
  const previous = await readDocument('seoTasks', args.id);
  if (!previous) throw new Error('SEO task not found');
  const current = normalizeSeoTask(decoded(previous) as SeoTaskRecord);
  if (current.revision !== args.expectedRevision) throw new Error('Revision conflict: read the current SEO task and retry the claim');
  if (!['ready', 'issued', 'in_progress'].includes(current.status)) {
    throw new Error('SEO task is not claimable in its current status');
  }
  await assertSeoRecoveryTaskAllowed(current.siteId, current.taskType);

  const t = now();
  const requestedRunId = args.runId ?? randomUUID();
  const active = claimIsActive(current.executionClaim);
  if (active && current.executionClaim?.runId !== requestedRunId) {
    throw new Error(`SEO task has an active execution claim until ${current.executionClaim?.expiresAt}`);
  }

  const sameRun = current.executionClaim?.runId === requestedRunId;
  const reclaimed = current.status === 'in_progress' && !sameRun;
  const claimedAt = sameRun ? current.executionClaim!.claimedAt : t;
  const claim = executionClaim(requestedRunId, args.actor, claimedAt, t, args.leaseMinutes);
  const history = [...(current.history ?? []), {
    at: t,
    actor: args.actor,
    event: sameRun ? 'worker_claim_refreshed' : reclaimed ? 'worker_reclaimed' : 'worker_claimed',
    detail: reclaimed
      ? `Reclaimed stale/unleased in_progress work with run ${requestedRunId}; previous claim ${current.executionClaim?.runId ?? 'none'}.`
      : `Claimed execution with ephemeral run ${requestedRunId}; lease expires ${claim.expiresAt}.`
  }];

  const record: SeoTaskRecord = {
    ...current,
    status: 'in_progress',
    executionClaim: claim,
    history: history.slice(-100),
    revision: args.expectedRevision + 1,
    updatedAt: t
  };
  const auditRunId = await auditWrite('seo_task_claim', record.id, { __write: { collection: 'seoTasks', id: record.id, fields: record } }, previous);
  return { ...record, auditRunId };
}

export async function seoTaskHeartbeat(input: unknown) {
  const args = seoTaskHeartbeatSchema.parse(input);
  const previous = await readDocument('seoTasks', args.id);
  if (!previous) throw new Error('SEO task not found');
  const current = normalizeSeoTask(decoded(previous) as SeoTaskRecord);
  if (current.revision !== args.expectedRevision) throw new Error('Revision conflict: read the current SEO task before heartbeat');
  if (current.status !== 'in_progress' || !current.executionClaim) throw new Error('SEO task has no active execution claim to heartbeat');
  if (current.executionClaim.runId !== args.runId) throw new Error('Execution claim belongs to a different run');

  const t = now();
  const claim = executionClaim(args.runId, current.executionClaim.actor, current.executionClaim.claimedAt, t, args.leaseMinutes);
  const record: SeoTaskRecord = {
    ...current,
    executionClaim: claim,
    revision: args.expectedRevision + 1,
    updatedAt: t
  };
  const auditRunId = await auditWrite('seo_task_heartbeat', record.id, { __write: { collection: 'seoTasks', id: record.id, fields: record } }, previous);
  return { ...record, auditRunId };
}

export async function seoTaskUpdate(input: unknown) {
  const args = seoTaskUpdateSchema.parse(input);
  const previous = await readDocument('seoTasks', args.id);
  if (!previous) throw new Error('SEO task not found');
  const current = normalizeSeoTask(decoded(previous) as SeoTaskRecord);
  if (current.revision !== args.expectedRevision) throw new Error('Revision conflict: read the current SEO task and reapply the edit');
  const t = now();
  const { id: _id, expectedRevision, appendHistory, deploymentVerification: deploymentPatch, deliveryHandoff: deliveryPatch, claimRunId, ...patch } = args;
  if (current.status !== 'in_progress' && patch.status === 'in_progress') {
    throw new Error('Use seo_task_claim to enter in_progress so execution ownership is time-bounded');
  }

  const terminalTransition = Boolean(patch.status && ['completed', 'cancelled', 'superseded'].includes(patch.status));
  const deliveryLaneUpdate = current.status === 'in_progress' && !current.executionClaim && deliveryPatch !== undefined && current.deliveryHandoff.state !== 'none';
  if (current.status === 'in_progress' && current.executionClaim) {
    const matchesClaim = claimRunId === current.executionClaim.runId;
    if (claimIsActive(current.executionClaim) && !matchesClaim) {
      throw new Error(`SEO task has an active execution claim until ${current.executionClaim.expiresAt}; use its claimRunId`);
    }
    if (!claimIsActive(current.executionClaim) && !matchesClaim && !terminalTransition) {
      throw new Error('SEO task execution claim expired; reclaim it with seo_task_claim before continuing');
    }
  } else if (current.status === 'in_progress' && !current.executionClaim && !terminalTransition && !deliveryLaneUpdate) {
    throw new Error('Legacy in_progress task has no execution claim; reclaim it with seo_task_claim before continuing');
  }

  const history = [...(current.history ?? [])];
  if (appendHistory) history.push({ ...appendHistory, at: appendHistory.at ?? t });
  const status = patch.status ?? current.status;
  const deploymentVerification = deploymentPatch === undefined
    ? current.deploymentVerification
    : { ...current.deploymentVerification, ...Object.fromEntries(Object.entries(deploymentPatch).filter(([, value]) => value !== undefined)) };
  const deliveryHandoff: SeoTaskRecord['deliveryHandoff'] = deliveryPatch === undefined
    ? current.deliveryHandoff
    : { ...defaultDeliveryHandoff(), ...deliveryPatch, updatedAt: t };
  const releasingToDelivery = current.status === 'in_progress' && deliveryPatch?.state === 'branch_ready';

  if (deliveryPatch?.state === 'push_pending') {
    if (!deliveryPatch.branch || !deliveryPatch.headSha || !deliveryPatch.baseSha) {
      throw new Error('push_pending delivery handoff requires branch, expected headSha and baseSha before remote push');
    }
    if (!claimRunId || claimRunId !== current.executionClaim?.runId) {
      throw new Error('push_pending delivery handoff must be written by the active Worker claim');
    }
  }

  if (deliveryPatch?.state === 'branch_ready') {
    if (!deliveryPatch.branch || !deliveryPatch.headSha || !deliveryPatch.baseSha || !deliveryPatch.handedOffAt) {
      throw new Error('branch_ready delivery handoff requires branch, headSha, baseSha and handedOffAt');
    }
    if (!claimRunId || claimRunId !== current.executionClaim?.runId) {
      throw new Error('branch_ready delivery handoff must be written by the active Worker claim');
    }
  }
  if (deliveryPatch?.state === 'pr_open' && (!deliveryPatch.prNumber || !deliveryPatch.prUrl)) {
    throw new Error('pr_open delivery handoff requires prNumber and prUrl');
  }
  if (deliveryPatch?.state === 'merged' && !patch.resultCommitSha) {
    throw new Error('merged delivery handoff requires resultCommitSha');
  }

  let nextExecutionClaim = current.executionClaim;
  if (status !== 'in_progress' || releasingToDelivery) {
    nextExecutionClaim = null;
  } else if (current.executionClaim && claimRunId === current.executionClaim.runId) {
    // push_pending is a short write-ahead critical section: the next action should only be the remote push/readback.
    // Keep the lease bounded so a crashed Worker cannot strand the task for the normal full execution lease.
    const leaseMinutes = deliveryPatch?.state === 'push_pending'
      ? 15
      : Math.round(claimLeaseMs(current.executionClaim) / 60_000);
    nextExecutionClaim = executionClaim(
      current.executionClaim.runId,
      current.executionClaim.actor,
      current.executionClaim.claimedAt,
      t,
      leaseMinutes
    );
  }

  const record: SeoTaskRecord = {
    ...current,
    ...Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)),
    articleIds: await taskArticleIds(current),
    status,
    deploymentVerification,
    executionClaim: nextExecutionClaim,
    deliveryHandoff,
    history: history.slice(-100),
    completedAt: status === 'completed' ? (current.completedAt ?? t) : current.completedAt,
    revision: expectedRevision + 1,
    updatedAt: t
  };
  // Preserve validation for historical issued records; new work uses ready without any Issue.
  if (record.status === 'issued' && (!record.issueNumber || !record.issueUrl)) throw new Error('Legacy issued SEO task requires issueNumber and issueUrl');
  if (record.status === 'completed' && current.status !== 'completed' && !record.resultCommitSha) throw new Error('completed SEO task requires resultCommitSha from main');
  if (record.deploymentVerification.status === 'verified' && !record.deploymentVerification.checkedAt) throw new Error('verified deployment requires checkedAt');
  if (record.deploymentVerification.status === 'failed' && !record.deploymentVerification.detail.trim()) throw new Error('failed deployment verification requires detail');
  const runId = await auditWrite('seo_task_update', record.id, { __write: { collection: 'seoTasks', id: record.id, fields: record } }, previous);
  return { ...record, runId };
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

  // Site-level analytics are served from the canonical overwrite-only planning
  // digest. The old siteDigests cache is intentionally no longer read.
  if (!args.articleId) {
    try {
      const digest: any = await seoPlanningDigestGet({ siteId: args.siteId });
      if (digest?.generatedAt && digest.siteMetrics?.current7) {
        const eventRows = (await queryBySite('optimizationEvents', args.siteId, 500))
          .sort((a: any, b: any) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
        const active = eventRows.find((event: any) => event.phase === 'implemented' && event.result === 'pending') as OptimizationEvent | undefined;
        const period = digest.periods?.current7;
        const statuses = digest.statuses?.current7 ?? {};
        const snapshotFromDigest = (provider: 'gsc' | 'ga4', metricValue: Record<string, number | null> | null | undefined): MetricSnapshot | null => {
          if (!metricValue || !period) return null;
          const providerStatus = statuses?.[provider] ?? null;
          return {
            id: `seo-planning-digest-${provider}-${args.siteId}`,
            siteId: args.siteId,
            articleId: null,
            provider,
            periodStart: period.start,
            periodEnd: period.end,
            metrics: metricValue,
            queries: provider === 'gsc' ? (digest.siteQueries?.current7 ?? []) : [],
            completeness: providerStatus?.completeness === 'complete' ? 'complete' : providerStatus?.completeness === 'failed' ? 'failed' : 'partial',
            sourceVersion: `seoPlanningDigest:${digest.generatedAt}:current7:${provider}`,
            capturedAt: providerStatus?.capturedAt ?? digest.generatedAt,
            createdAt: digest.generatedAt
          };
        };
        const latestGsc = snapshotFromDigest('gsc', digest.siteMetrics?.current7?.gsc);
        const latestGa4 = snapshotFromDigest('ga4', digest.siteMetrics?.current7?.ga4);
        const snapshots = [latestGsc, latestGa4].filter((item): item is MetricSnapshot => Boolean(item));
        return {
          site, articleId: null, changeAllowed: !active, activeOptimization: active ?? null,
          cooldownUntil: active?.evaluateAfter ?? null,
          latestMetrics: { gsc: latestGsc, ga4: latestGa4 },
          metricSnapshots: snapshots.slice(0, args.metricLimit),
          optimizationEvents: eventRows.slice(0, args.eventLimit),
          articleCount: digest.inventoryCount ?? null,
          deferredCount: 0,
          servedFrom: 'seo_planning_digest' as const,
          digestGeneratedAt: digest.generatedAt,
          policy: {
            oneImplementedChangePerArticle: true,
            defaultEvaluationWaitDays: 14,
            analyticsStorage: 'seoPlanningDigests_latest_only',
            note: 'URL-level access analytics remain ephemeral SQLite evidence. Historical metricSnapshots are legacy read-only compatibility evidence only.'
          }
        };
      }
    } catch {
      // Fall through to legacy compatibility reads only when the canonical
      // planning digest is unavailable.
    }
  }

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
    servedFrom: 'legacy_metric_snapshot_fallback' as const,
    policy: {
      oneImplementedChangePerArticle: true,
      defaultEvaluationWaitDays: 14,
      analyticsStorage: 'legacy_read_only_fallback',
      note: 'This fallback exists only for historical optimization evidence and is not a current analytics write path.'
    }
  };
}

