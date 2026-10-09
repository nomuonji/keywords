import { createHash } from 'node:crypto';
import { z } from 'zod';
import { searchConsoleCredentialsConfigured, searchConsoleInspect } from '../../research/src/index.js';
import { field, value, firestore, firestoreDocumentName, FirestoreError } from '../../db/src/firestore.js';
import type { SiteRecord } from '../../db/src/site-operations-schema.js';

const entityId = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
const webUrl = z.string().url().refine(value => /^https?:\/\//i.test(value), 'URL must use http or https');
const isoTime = z.string().datetime({ offset: true });
const pageFamily = z.string().trim().min(1).max(160);
const fingerprint = z.string().trim().min(1).max(256);

const inventoryRow = z.object({
  url: webUrl,
  pageFamily: pageFamily.nullable().optional(),
  indexable: z.boolean().default(true),
  inventoryState: z.enum(['current', 'removed']).default('current'),
  sourceFingerprint: fingerprint.nullable().optional(),
  lastPublishedAt: isoTime.nullable().optional(),
  lastChangedAt: isoTime.nullable().optional()
}).strict();

export const siteIndexationInventorySaveShape = {
  siteId: entityId,
  records: z.array(inventoryRow).min(1).max(200)
};

export const siteIndexationInspectShape = {
  siteId: entityId,
  urls: z.array(webUrl).min(1).max(50).optional(),
  limit: z.number().int().min(1).max(50).default(25),
  accelerateUninspected: z.boolean().default(false)
};

export const siteIndexationListShape = {
  siteId: entityId,
  limit: z.number().int().min(1).max(500).default(100),
  pageToken: z.string().max(4000).optional()
};

export const siteIndexationSummaryShape = { siteId: entityId };
export const siteIndexationSnapshotSaveShape = { siteId: entityId };

type InventoryState = 'current' | 'removed';
type ObservedIndexState = 'indexed' | 'not_indexed' | 'unknown';

export type IndexationUrlRecord = {
  id: string;
  siteId: string;
  url: string;
  /** Exact sitemap/canonical URL inspected by Google; identity url deliberately ignores trailing slash. */
  inspectionUrl: string;
  pageFamily: string | null;
  inventoryState: InventoryState;
  indexable: boolean;
  sourceFingerprint: string | null;
  lastPublishedAt: string | null;
  lastChangedAt: string | null;
  siteUrl: string | null;
  observedIndexState: ObservedIndexState;
  verdict: string | null;
  coverageState: string | null;
  robotsTxtState: string | null;
  indexingState: string | null;
  pageFetchState: string | null;
  googleCanonical: string | null;
  userCanonical: string | null;
  lastCrawlTime: string | null;
  lastInspectedAt: string | null;
  nextInspectionAt: string | null;
  consecutiveSameResults: number;
  inspectionCount: number;
  revision: number;
  createdAt: string;
  updatedAt: string;
};

const now = () => new Date().toISOString();
const daysFrom = (base: string, days: number) => new Date(Date.parse(base) + days * 86_400_000).toISOString();
const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

/** Known older pages can be inspected as soon as capacity is available.
 * Newly published pages get a short crawl grace period, not a blanket 48h delay. */
function initialInspectionAt(queuedAt: string, publishedAt?: string | null) {
  if (!publishedAt) return queuedAt;
  const published = Date.parse(publishedAt), queued = Date.parse(queuedAt);
  if (!Number.isFinite(published) || published <= queued - SIX_HOURS_MS) return queuedAt;
  return new Date(Math.min(queued + SIX_HOURS_MS, Math.max(queued, published + SIX_HOURS_MS))).toISOString();
}

const hash = (value: unknown) => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const encodeFields = (data: object) => Object.fromEntries(Object.entries(data).map(([key, item]) => [key, field(item)]));
const decoded = (doc: any) => ({ id: doc.name.split('/').pop(), ...Object.fromEntries(Object.entries(doc.fields ?? {}).map(([key, item]) => [key, value(item)])) });

function normalizeWebIdentity(input: string) {
  const url = new URL(input);
  url.hash = '';
  if ((url.protocol === 'https:' && url.port === '443') || (url.protocol === 'http:' && url.port === '80')) url.port = '';
  if (url.pathname !== '/') url.pathname = url.pathname.replace(/\/+$/, '') || '/';
  return url.toString();
}

function inspectionIdentity(input: string) {
  // Keep slash fidelity when talking to Search Console. The normalized,
  // slash-insensitive URL remains the Firestore document key only.
  const url = new URL(input);
  url.hash = '';
  if ((url.protocol === 'https:' && url.port === '443') || (url.protocol === 'http:' && url.port === '80')) url.port = '';
  return url.toString();
}
function urlId(url: string) { return hash(normalizeWebIdentity(url)).slice(0, 40); }
function cachePath(siteId: string, id: string) { return `sites/${siteId}/indexationUrls/${id}`; }

async function readPath(path: string) {
  try { return await firestore(`/${path}`); }
  catch (error) { if (error instanceof FirestoreError && error.status === 404) return null; throw error; }
}

async function readSite(siteId: string): Promise<SiteRecord> {
  const doc = await readPath(`sites/${entityId.parse(siteId)}`);
  if (!doc) throw new Error('Site not found');
  return ({ siteShape: 'other', localProjectId: null, ...decoded(doc) }) as SiteRecord;
}

function assertUrlWithinSite(site: SiteRecord, input: string) {
  const url = new URL(normalizeWebIdentity(input));
  const base = new URL(site.productionUrl);
  if (url.origin !== base.origin) throw new Error(`URL is outside registered production origin: ${url.toString()}`);
  const prefix = base.pathname === '/' ? '/' : base.pathname.replace(/\/+$/, '') + '/';
  if (prefix !== '/' && url.pathname !== base.pathname.replace(/\/+$/, '') && !url.pathname.startsWith(prefix)) {
    throw new Error(`URL is outside registered production path: ${url.toString()}`);
  }
  return url.toString();
}

function baseRecord(siteId: string, url: string, createdAt: string): IndexationUrlRecord {
  return {
    id: urlId(url), siteId, url, inspectionUrl: url, pageFamily: null, inventoryState: 'current', indexable: true,
    sourceFingerprint: null, lastPublishedAt: null, lastChangedAt: null, siteUrl: null,
    observedIndexState: 'unknown', verdict: null, coverageState: null, robotsTxtState: null,
    indexingState: null, pageFetchState: null, googleCanonical: null, userCanonical: null,
    lastCrawlTime: null, lastInspectedAt: null, nextInspectionAt: createdAt,
    consecutiveSameResults: 0, inspectionCount: 0, revision: 0, createdAt, updatedAt: createdAt
  };
}

function decodeRecord(doc: any): IndexationUrlRecord {
  const row = decoded(doc) as any;
  return {
    ...baseRecord(String(row.siteId ?? ''), String(row.url ?? ''), String(row.createdAt ?? now())),
    ...row,
    inspectionUrl: row.inspectionUrl ?? row.url,
    pageFamily: row.pageFamily ?? null,
    inventoryState: row.inventoryState ?? 'current',
    indexable: row.indexable !== false,
    sourceFingerprint: row.sourceFingerprint ?? null,
    observedIndexState: row.observedIndexState ?? 'unknown'
  } as IndexationUrlRecord;
}

async function writeRecord(record: IndexationUrlRecord, previous: any | null) {
  const write = {
    update: { name: firestoreDocumentName(cachePath(record.siteId, record.id)), fields: encodeFields(record) },
    currentDocument: previous ? { updateTime: previous.updateTime } : { exists: false }
  };
  await firestore(':commit', { method: 'POST', body: JSON.stringify({ writes: [write] }) });
}

async function saveWithRetry(siteId: string, url: string, build: (current: IndexationUrlRecord | null) => IndexationUrlRecord) {
  const id = urlId(url);
  for (let attempt = 0; attempt < 4; attempt++) {
    const previous = await readPath(cachePath(siteId, id));
    const current = previous ? decodeRecord(previous) : null;
    const next = build(current);
    try {
      await writeRecord(next, previous);
      return next;
    } catch (error) {
      if (!(error instanceof FirestoreError) || ![400, 409, 412].includes(error.status) || attempt === 3) throw error;
    }
  }
  throw new Error('Indexation cache save failed after retry');
}

function inspectionSignature(record: Pick<IndexationUrlRecord, 'verdict' | 'coverageState' | 'robotsTxtState' | 'indexingState' | 'pageFetchState' | 'googleCanonical' | 'userCanonical'>) {
  return hash(record);
}

function normalizedIndexState(verdict: string): ObservedIndexState {
  if (verdict === 'PASS') return 'indexed';
  if (verdict === 'FAIL' || verdict === 'NEUTRAL') return 'not_indexed';
  return 'unknown';
}

function nextAfterInspection(observedAt: string, verdict: string, consecutiveSameResults: number) {
  if (verdict === 'PASS') return daysFrom(observedAt, consecutiveSameResults >= 3 ? 90 : 30);
  return daysFrom(observedAt, 7);
}

function dailyBudget() {
  const configured = Number(process.env.SITES_INDEXATION_DAILY_BUDGET ?? 1500);
  return Number.isFinite(configured) ? Math.max(1, Math.min(Math.floor(configured), 1900)) : 1500;
}

function utcDate(input = new Date()) { return input.toISOString().slice(0, 10); }
function quotaId(siteUrl: string, date: string) { return hash({ siteUrl, date }).slice(0, 40); }

async function readQuota(siteUrl: string, date = utcDate()) {
  const id = quotaId(siteUrl, date);
  const doc = await readPath(`indexationQuotaDays/${id}`);
  const limit = dailyBudget();
  if (!doc) return { id, siteUrl, date, used: 0, limit, remaining: limit, updatedAt: null as string | null };
  const row = decoded(doc) as any;
  const used = Math.max(0, Number(row.used ?? 0));
  return { id, siteUrl, date, used, limit: Number(row.limit ?? limit), remaining: Math.max(0, Number(row.limit ?? limit) - used), updatedAt: row.updatedAt ?? null };
}

async function reserveQuota(siteUrl: string, requested: number) {
  if (requested < 1) throw new Error('requested quota must be positive');
  const date = utcDate();
  const id = quotaId(siteUrl, date);
  const limit = dailyBudget();
  for (let attempt = 0; attempt < 5; attempt++) {
    const previous = await readPath(`indexationQuotaDays/${id}`);
    const current = previous ? decoded(previous) as any : { used: 0 };
    const used = Math.max(0, Number(current.used ?? 0));
    const allowed = Math.min(requested, Math.max(0, limit - used));
    if (!allowed) return { requested, reserved: 0, used, limit, remaining: 0, date };
    const record = { id, siteUrl, date, used: used + allowed, limit, updatedAt: now() };
    const write = {
      update: { name: firestoreDocumentName(`indexationQuotaDays/${id}`), fields: encodeFields(record) },
      currentDocument: previous ? { updateTime: previous.updateTime } : { exists: false }
    };
    try {
      await firestore(':commit', { method: 'POST', body: JSON.stringify({ writes: [write] }) });
      return { requested, reserved: allowed, used: used + allowed, limit, remaining: limit - used - allowed, date };
    } catch (error) {
      if (!(error instanceof FirestoreError) || ![400, 409, 412].includes(error.status) || attempt === 4) throw error;
    }
  }
  throw new Error('Unable to reserve URL Inspection quota');
}

async function listDue(siteId: string, limit: number): Promise<IndexationUrlRecord[]> {
  const result = await firestore(`/sites/${siteId}:runQuery`, {
    method: 'POST',
    body: JSON.stringify({ structuredQuery: {
      from: [{ collectionId: 'indexationUrls' }],
      where: { fieldFilter: { field: { fieldPath: 'nextInspectionAt' }, op: 'LESS_THAN_OR_EQUAL', value: field(now()) } },
      orderBy: [{ field: { fieldPath: 'nextInspectionAt' }, direction: 'ASCENDING' }],
      limit: Math.min(Math.max(limit * 2, limit), 100)
    } })
  });
  return (Array.isArray(result) ? result : []).flatMap((row: any) => row.document ? [decodeRecord(row.document)] : [])
    .filter(row => row.inventoryState === 'current' && row.indexable)
    .slice(0, limit);
}

/** One-time catch-up for old inventories created under the legacy 48h blanket hold.
 * A single-field IS_NULL query avoids a composite index and walks the backlog
 * as inspections overwrite lastInspectedAt. This does not bypass quota. */
async function listUninspectedBacklog(siteId: string, limit: number, exclude: Set<string>): Promise<IndexationUrlRecord[]> {
  const result = await firestore(`/sites/${siteId}:runQuery`, {
    method: 'POST',
    body: JSON.stringify({ structuredQuery: {
      from: [{ collectionId: 'indexationUrls' }],
      where: { unaryFilter: { op: 'IS_NULL', field: { fieldPath: 'lastInspectedAt' } } },
      limit: Math.min(200, Math.max(limit * 4, 100))
    } })
  });
  const at = now();
  return (Array.isArray(result) ? result : []).flatMap((row: any) => row.document ? [decodeRecord(row.document)] : [])
    .filter(record => record.inventoryState === 'current' &&
      record.indexable && !record.lastInspectedAt &&
      !exclude.has(record.id) &&
      initialInspectionAt(at, record.lastPublishedAt) <= at)
    .slice(0, limit);
}

async function inspectOne(site: SiteRecord, record: IndexationUrlRecord) {
  if (!site.searchConsoleProperty) throw new Error(`Site ${site.id} has no Search Console property`);
  const observation = await searchConsoleInspect({ url: record.inspectionUrl, siteUrl: site.searchConsoleProperty });
  const previousSignature = inspectionSignature(record);
  const nextSignature = inspectionSignature({
    verdict: observation.verdict,
    coverageState: observation.coverageState,
    robotsTxtState: observation.robotsTxtState,
    indexingState: observation.indexingState,
    pageFetchState: observation.pageFetchState,
    googleCanonical: observation.googleCanonical,
    userCanonical: observation.userCanonical
  });
  const same = Boolean(record.lastInspectedAt) && previousSignature === nextSignature;
  const consecutiveSameResults = same ? record.consecutiveSameResults + 1 : 1;
  return saveWithRetry(site.id, record.url, current => {
    const base = current ?? record;
    return {
      ...base,
      inspectionUrl: record.inspectionUrl,
      siteUrl: site.searchConsoleProperty,
      observedIndexState: normalizedIndexState(observation.verdict),
      verdict: observation.verdict,
      coverageState: observation.coverageState,
      robotsTxtState: observation.robotsTxtState,
      indexingState: observation.indexingState,
      pageFetchState: observation.pageFetchState,
      googleCanonical: observation.googleCanonical,
      userCanonical: observation.userCanonical,
      lastCrawlTime: observation.lastCrawlTime,
      lastInspectedAt: observation.observedAt,
      nextInspectionAt: nextAfterInspection(observation.observedAt, observation.verdict, consecutiveSameResults),
      consecutiveSameResults,
      inspectionCount: (base.inspectionCount ?? 0) + 1,
      revision: (base.revision ?? 0) + 1,
      updatedAt: observation.observedAt
    };
  });
}

async function runWithConcurrency<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>) {
  const out: Array<{ ok: true; value: R } | { ok: false; error: string }> = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      try { out[index] = { ok: true, value: await fn(items[index]) }; }
      catch (error) { out[index] = { ok: false, error: error instanceof Error ? error.message : String(error) }; }
    }
  });
  await Promise.all(workers);
  return out;
}

export async function siteIndexationInventorySave(input: unknown) {
  const args = z.object(siteIndexationInventorySaveShape).strict().parse(input);
  const site = await readSite(args.siteId);
  const buildInventoryRecord = (normalized: string, row: z.infer<typeof inventoryRow>, current: IndexationUrlRecord | null, t: string) => {
    const base = current ?? baseRecord(site.id, normalized, t);
    const exactInspectionUrl = inspectionIdentity(row.url);
    const inspectionTargetChanged = Boolean(current && current.inspectionUrl !== exactInspectionUrl);
    const fingerprintChanged = Boolean(current && row.sourceFingerprint !== undefined && row.sourceFingerprint !== current.sourceFingerprint);
    const changedAtChanged = Boolean(current && row.lastChangedAt !== undefined && row.lastChangedAt !== current.lastChangedAt);
    const isCurrentIndexable = row.inventoryState === 'current' && row.indexable;
    const reactivated = Boolean(current && isCurrentIndexable && (current.inventoryState !== 'current' || !current.indexable || !current.nextInspectionAt));
    let nextInspectionAt = base.nextInspectionAt;
    if (!isCurrentIndexable) nextInspectionAt = null;
    else if (!current || reactivated) nextInspectionAt = initialInspectionAt(t, row.lastPublishedAt ?? base.lastPublishedAt);
    else if (inspectionTargetChanged) nextInspectionAt = t; // repair prior non-canonical observations immediately
    else if (fingerprintChanged || changedAtChanged) nextInspectionAt = new Date(Date.parse(t) + SIX_HOURS_MS).toISOString();
    return {
      ...base,
      url: normalized,
      inspectionUrl: exactInspectionUrl,
      ...(inspectionTargetChanged ? {
        lastInspectedAt: null, observedIndexState: 'unknown' as ObservedIndexState,
        verdict: null, coverageState: null, robotsTxtState: null,
        indexingState: null, pageFetchState: null, googleCanonical: null,
        userCanonical: null, lastCrawlTime: null, consecutiveSameResults: 0
      } : {}),
      pageFamily: row.pageFamily === undefined ? base.pageFamily : row.pageFamily,
      inventoryState: row.inventoryState,
      indexable: row.indexable,
      sourceFingerprint: row.sourceFingerprint === undefined ? base.sourceFingerprint : row.sourceFingerprint,
      lastPublishedAt: row.lastPublishedAt === undefined ? base.lastPublishedAt : row.lastPublishedAt,
      lastChangedAt: row.lastChangedAt === undefined ? base.lastChangedAt : row.lastChangedAt,
      nextInspectionAt
    } as IndexationUrlRecord;
  };
  const equivalent = (a: IndexationUrlRecord, b: IndexationUrlRecord) =>
    a.url === b.url &&
    a.inspectionUrl === b.inspectionUrl &&
    a.pageFamily === b.pageFamily &&
    a.inventoryState === b.inventoryState &&
    a.indexable === b.indexable &&
    a.sourceFingerprint === b.sourceFingerprint &&
    a.lastPublishedAt === b.lastPublishedAt &&
    a.lastChangedAt === b.lastChangedAt &&
    a.nextInspectionAt === b.nextInspectionAt;

  const results = await runWithConcurrency(args.records, 10, async row => {
    const normalized = assertUrlWithinSite(site, row.url);
    const t = now();
    const existingDoc = await readPath(cachePath(site.id, urlId(normalized)));
    const existing = existingDoc ? decodeRecord(existingDoc) : null;
    const preview = buildInventoryRecord(normalized, row, existing, t);
    if (existing && equivalent(existing, preview)) {
      return { kind: 'unchanged' as const, record: existing };
    }
    const saved = await saveWithRetry(site.id, normalized, current => {
      const next = buildInventoryRecord(normalized, row, current, t);
      return { ...next, revision: (current?.revision ?? 0) + 1, updatedAt: t };
    });
    return { kind: existing ? 'updated' as const : 'created' as const, record: saved };
  });
  const successes = results.flatMap(result => result.ok ? [result.value] : []);
  const failures = results.flatMap((result, index) => 'error' in result ? [{ url: args.records[index].url, error: result.error }] : []);
  return {
    siteId: site.id,
    received: args.records.length,
    created: successes.filter(item => item.kind === 'created').length,
    updated: successes.filter(item => item.kind === 'updated').length,
    unchanged: successes.filter(item => item.kind === 'unchanged').length,
    removed: successes.filter(item => item.record.inventoryState === 'removed').length,
    scheduled: successes.filter(item => Boolean(item.record.nextInspectionAt)).length,
    failed: failures.length,
    failures: failures.slice(0, 20)
  };
}

export async function siteIndexationInspect(input: unknown) {
  const args = z.object(siteIndexationInspectShape).strict().parse(input);
  const site = await readSite(args.siteId);
  if (!site.searchConsoleProperty) throw new Error(`Site ${site.id} has no Search Console property`);
  let records: IndexationUrlRecord[];
  if (args.urls?.length) {
    records = [];
    for (const inputUrl of args.urls) {
      const url = assertUrlWithinSite(site, inputUrl);
      const doc = await readPath(cachePath(site.id, urlId(url)));
      const stored = doc ? decodeRecord(doc) : baseRecord(site.id, url, now());
      // Explicit reinspection must honor the caller's exact URL, not the
      // old slash-stripped cache value; it also corrects the cache target.
      records.push({ ...stored, inspectionUrl: inspectionIdentity(inputUrl) });
    }
  } else {
    records = await listDue(site.id, args.limit);
    if (args.accelerateUninspected && records.length < args.limit) {
      const extra = await listUninspectedBacklog(
        site.id, args.limit - records.length, new Set(records.map(record => record.id))
      );
      records.push(...extra);
    }
  }
  const take = args.urls?.length ? Math.min(args.urls.length, 50) : args.limit;
  records = records.filter(row => row.inventoryState === 'current' && row.indexable).slice(0, take);
  if (!records.length) return { siteId: site.id, property: site.searchConsoleProperty, inspected: 0, failed: 0, skipped: 0, reason: 'no_due_urls', quota: await readQuota(site.searchConsoleProperty) };
  // Calls without credentials cannot reach Google. Do not consume the shared
  // daily property budget (or report a failed Google inspection) for them.
  if (!searchConsoleCredentialsConfigured()) {
    throw new Error('Search Console credentials are not configured; URL Inspection quota was not reserved');
  }
  const reservation = await reserveQuota(site.searchConsoleProperty, records.length);
  const selected = records.slice(0, reservation.reserved);
  const results = await runWithConcurrency(selected, 5, record => inspectOne(site, record));
  const succeeded = results.flatMap(result => result.ok ? [result.value] : []);
  const failures = results.flatMap((result, index) => 'error' in result ? [{ url: selected[index].url, error: result.error }] : []);
  return {
    siteId: site.id,
    property: site.searchConsoleProperty,
    requested: records.length,
    inspected: succeeded.length,
    failed: failures.length,
    skipped: records.length - selected.length,
    quota: reservation,
    results: succeeded.map(row => ({ url: row.url, inspectionUrl: row.inspectionUrl, observedIndexState: row.observedIndexState, verdict: row.verdict, coverageState: row.coverageState, lastInspectedAt: row.lastInspectedAt, nextInspectionAt: row.nextInspectionAt })),
    failures: failures.slice(0, 20)
  };
}

export async function siteIndexationList(input: unknown) {
  const args = z.object(siteIndexationListShape).strict().parse(input);
  await readSite(args.siteId);
  const params = new URLSearchParams({ pageSize: String(args.limit), orderBy: 'updatedAt desc' });
  if (args.pageToken) params.set('pageToken', args.pageToken);
  const result = await firestore(`/sites/${args.siteId}/indexationUrls?${params.toString()}`);
  return { items: (result.documents ?? []).map(decodeRecord), nextPageToken: result.nextPageToken ?? null };
}

type Aggregate = {
  inventoryTotal: number;
  currentTotal: number;
  indexableCount: number;
  inspectedCount: number;
  indexedObservedCount: number;
  notIndexedObservedCount: number;
  unknownObservedCount: number;
  dueCount: number;
};

function emptyAggregate(): Aggregate {
  return { inventoryTotal: 0, currentTotal: 0, indexableCount: 0, inspectedCount: 0, indexedObservedCount: 0, notIndexedObservedCount: 0, unknownObservedCount: 0, dueCount: 0 };
}

function addToAggregate(target: Aggregate, record: IndexationUrlRecord, at: string) {
  target.inventoryTotal++;
  if (record.inventoryState !== 'current') return;
  target.currentTotal++;
  if (!record.indexable) return;
  target.indexableCount++;
  if (record.nextInspectionAt && record.nextInspectionAt <= at) target.dueCount++;
  if (!record.lastInspectedAt) return;
  target.inspectedCount++;
  if (record.observedIndexState === 'indexed') target.indexedObservedCount++;
  else if (record.observedIndexState === 'not_indexed') target.notIndexedObservedCount++;
  else target.unknownObservedCount++;
}

function rates(row: Aggregate) {
  const classified = row.indexedObservedCount + row.notIndexedObservedCount;
  return {
    ...row,
    inspectionCoverage: row.indexableCount ? row.inspectedCount / row.indexableCount : null,
    observedIndexationRate: classified ? row.indexedObservedCount / classified : null
  };
}

async function aggregateSite(siteId: string) {
  const at = now();
  const total = emptyAggregate();
  const byPageFamily: Record<string, Aggregate> = {};
  let pageToken: string | undefined;
  let scanned = 0;
  do {
    const params = new URLSearchParams({ pageSize: '1000' });
    if (pageToken) params.set('pageToken', pageToken);
    const result = await firestore(`/sites/${siteId}/indexationUrls?${params.toString()}`);
    for (const doc of result.documents ?? []) {
      const record = decodeRecord(doc);
      scanned++;
      addToAggregate(total, record, at);
      const key = record.pageFamily || '(unclassified)';
      byPageFamily[key] ??= emptyAggregate();
      addToAggregate(byPageFamily[key], record, at);
      if (scanned > 100_000) throw new Error('Indexation inventory exceeds 100,000 URLs; add a materialized family aggregate before expanding further');
    }
    pageToken = result.nextPageToken;
  } while (pageToken);
  return { generatedAt: at, ...rates(total), byPageFamily: Object.fromEntries(Object.entries(byPageFamily).map(([key, value]) => [key, rates(value)])) };
}

export async function siteIndexationSummary(input: unknown) {
  const args = z.object(siteIndexationSummaryShape).strict().parse(input);
  const site = await readSite(args.siteId);
  const aggregate = await aggregateSite(site.id);
  const quota = site.searchConsoleProperty ? await readQuota(site.searchConsoleProperty) : null;
  return { siteId: site.id, property: site.searchConsoleProperty, ...aggregate, quota };
}

function weekStartDate(input = new Date()) {
  const copy = new Date(Date.UTC(input.getUTCFullYear(), input.getUTCMonth(), input.getUTCDate()));
  const day = copy.getUTCDay();
  const delta = day === 0 ? -6 : 1 - day;
  copy.setUTCDate(copy.getUTCDate() + delta);
  return copy.toISOString().slice(0, 10);
}

export async function siteIndexationSnapshotSave(input: unknown) {
  const args = z.object(siteIndexationSnapshotSaveShape).strict().parse(input);
  const summary = await siteIndexationSummary(args) as any;
  const weekStart = weekStartDate();
  const id = hash({ siteId: args.siteId, weekStart }).slice(0, 40);
  const record = { id, siteId: args.siteId, weekStart, capturedAt: now(), summary };
  await firestore(`/indexationSnapshots/${id}`, { method: 'PATCH', body: JSON.stringify({ fields: encodeFields(record) }) });
  return { ...record, reusedWeeklySlot: true };
}
