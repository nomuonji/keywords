import { createHash } from 'node:crypto';
import { z } from 'zod';
import { changeIndexationRows, readIndexationRows } from './site-indexation-storage.js';
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
  // slash-insensitive URL remains the stable row identity.
  const url = new URL(input);
  url.hash = '';
  if ((url.protocol === 'https:' && url.port === '443') || (url.protocol === 'http:' && url.port === '80')) url.port = '';
  return url.toString();
}
function urlId(url: string) { return hash(normalizeWebIdentity(url)).slice(0, 40); }

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



function inspectionSignature(record: Pick<IndexationUrlRecord, 'verdict' | 'coverageState' | 'robotsTxtState' | 'indexingState' | 'pageFetchState' | 'googleCanonical' | 'userCanonical'>) {
  // Hash precisely the observed Google fields, never the mutable URL record.
  // Hashing the whole record included timestamps/revisions and prevented the
  // unchanged-result streak from growing, effectively disabling backoff.
  return hash({
    verdict: record.verdict ?? null,
    coverageState: record.coverageState ?? null,
    robotsTxtState: record.robotsTxtState ?? null,
    indexingState: record.indexingState ?? null,
    pageFetchState: record.pageFetchState ?? null,
    googleCanonical: record.googleCanonical ?? null,
    userCanonical: record.userCanonical ?? null
  });
}

function normalizedIndexState(verdict: string): ObservedIndexState {
  if (verdict === 'PASS') return 'indexed';
  if (verdict === 'FAIL' || verdict === 'NEUTRAL') return 'not_indexed';
  return 'unknown';
}

function nextAfterInspection(observedAt: string, verdict: string, consecutiveSameResults: number) {
  // Spend newly available inspection budget where a changing result is actionable.
  // A repeated unchanged negative result is progressively backoff-limited.
  if (verdict === 'PASS') return daysFrom(observedAt, consecutiveSameResults >= 3 ? 60 : 21);
  return daysFrom(observedAt, consecutiveSameResults >= 4 ? 14 : consecutiveSameResults >= 2 ? 7 : 3);
}

function dailyBudget() {
  const configured = Number(process.env.SITES_INDEXATION_DAILY_BUDGET ?? 1900);
  return Number.isFinite(configured) ? Math.max(1, Math.min(Math.floor(configured), 1900)) : 1900;
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
  // The configured guard can change within a quota day (e.g. after deploy).
  // Do not continue exposing the old persisted limit from a previous version.
  return { id, siteUrl, date, used, limit, remaining: Math.max(0, limit - used), updatedAt: row.updatedAt ?? null };
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


function listDue(records: IndexationUrlRecord[], limit: number): IndexationUrlRecord[] {
  const at = now();
  return records
    .filter(row => row.inventoryState === 'current' && row.indexable && row.nextInspectionAt && row.nextInspectionAt <= at)
    .sort((a, b) => String(a.nextInspectionAt).localeCompare(String(b.nextInspectionAt)))
    .slice(0, limit);
}

/** Legacy backlog is considered before routine rechecks without querying Firestore per URL. */
function listUninspectedBacklog(records: IndexationUrlRecord[], limit: number, exclude: Set<string>): IndexationUrlRecord[] {
  const at = now();
  return records
    .filter(record => record.inventoryState === 'current' && record.indexable &&
      !record.lastInspectedAt && !exclude.has(record.id) &&
      initialInspectionAt(at, record.lastPublishedAt) <= at)
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
    .slice(0, limit);
}


async function inspectOne(site: SiteRecord, record: IndexationUrlRecord) {
  if (!site.searchConsoleProperty) throw new Error('Site has no Search Console property');
  const observation = await searchConsoleInspect({ url: record.inspectionUrl, siteUrl: site.searchConsoleProperty });
  return { record, observation };
}

function applyInspection(site: SiteRecord, base: IndexationUrlRecord, record: IndexationUrlRecord, observation: Awaited<ReturnType<typeof searchConsoleInspect>>): IndexationUrlRecord {
  const previousSignature = inspectionSignature(base);
  const nextSignature = inspectionSignature({
    verdict: observation.verdict, coverageState: observation.coverageState,
    robotsTxtState: observation.robotsTxtState, indexingState: observation.indexingState,
    pageFetchState: observation.pageFetchState, googleCanonical: observation.googleCanonical,
    userCanonical: observation.userCanonical
  });
  const same = Boolean(base.lastInspectedAt) && previousSignature === nextSignature;
  const consecutiveSameResults = same ? base.consecutiveSameResults + 1 : 1;
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

/** One small manifest per site replaces daily full-cache sitemap comparisons.
 * Updated only after a complete, successful reconciliation, so an interrupted
 * batch cannot incorrectly mark an inventory as synchronized. */
export async function siteIndexationInventorySyncGet(siteId: string) {
  const id = entityId.parse(siteId);
  const doc = await readPath(`sites/${id}/indexationSync/manifest`);
  if (!doc) return null;
  const row = decoded(doc) as any;
  return {
    fingerprint: String(row.fingerprint ?? ''),
    sitemapUrlCount: Number(row.sitemapUrlCount ?? 0),
    lastReconciledAt: String(row.lastReconciledAt ?? '')
  };
}

export async function siteIndexationInventorySyncSave(siteId: string, fingerprintValue: string, sitemapUrlCount: number) {
  const id = entityId.parse(siteId);
  const parsedFingerprint = z.string().regex(/^[a-f0-9]{64}$/).parse(fingerprintValue);
  const count = z.number().int().nonnegative().parse(sitemapUrlCount);
  const record = { siteId: id, fingerprint: parsedFingerprint, sitemapUrlCount: count, lastReconciledAt: now() };
  await firestore(`/sites/${id}/indexationSync/manifest`, {
    method: 'PATCH',
    body: JSON.stringify({ fields: encodeFields(record) })
  });
  return record;
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
    else if (inspectionTargetChanged) nextInspectionAt = t;
    else if (fingerprintChanged || changedAtChanged) nextInspectionAt = new Date(Date.parse(t) + SIX_HOURS_MS).toISOString();
    return {
      ...base, url: normalized, inspectionUrl: exactInspectionUrl,
      ...(inspectionTargetChanged ? {
        lastInspectedAt: null, observedIndexState: 'unknown' as ObservedIndexState,
        verdict: null, coverageState: null, robotsTxtState: null, indexingState: null,
        pageFetchState: null, googleCanonical: null, userCanonical: null,
        lastCrawlTime: null, consecutiveSameResults: 0
      } : {}),
      // Previously stable observations must not get a 60-day backoff after
      // the URL's source content changed or it was reactivated.
      ...(fingerprintChanged || changedAtChanged || reactivated ? { consecutiveSameResults: 0 } : {}),
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
    a.url === b.url && a.inspectionUrl === b.inspectionUrl &&
    a.pageFamily === b.pageFamily && a.inventoryState === b.inventoryState &&
    a.indexable === b.indexable && a.sourceFingerprint === b.sourceFingerprint &&
    a.lastPublishedAt === b.lastPublishedAt && a.lastChangedAt === b.lastChangedAt &&
    a.nextInspectionAt === b.nextInspectionAt;

  // A whole inventory batch now results in at most one Firestore document write
  // (or only changed shards for an exceptionally large site).
  return changeIndexationRows(site.id, decodeRecord, existing => {
    const byId = new Map(existing.map(record => [record.id, record]));
    let created = 0, updated = 0, unchanged = 0, removed = 0, scheduled = 0;
    const failures: Array<{ url: string; error: string }> = [];
    for (const row of args.records) {
      try {
        const normalized = assertUrlWithinSite(site, row.url);
        const id = urlId(normalized);
        const current = byId.get(id) ?? null;
        const t = now();
        const preview = buildInventoryRecord(normalized, row, current, t);
        if (current && equivalent(current, preview)) {
          unchanged++;
          if (current.inventoryState === 'removed') removed++;
          if (current.nextInspectionAt) scheduled++;
          continue;
        }
        const next = { ...preview, revision: (current?.revision ?? 0) + 1, updatedAt: t };
        byId.set(id, next);
        if (current) updated++; else created++;
        if (next.inventoryState === 'removed') removed++;
        if (next.nextInspectionAt) scheduled++;
      } catch (error) {
        failures.push({ url: row.url, error: error instanceof Error ? error.message : String(error) });
      }
    }
    return { rows: [...byId.values()], result: {
      siteId: site.id, received: args.records.length, created, updated, unchanged,
      removed, scheduled, failed: failures.length, failures: failures.slice(0, 20)
    } };
  });
}

export async function siteIndexationInspect(input: unknown) {
  const args = z.object(siteIndexationInspectShape).strict().parse(input);
  const site = await readSite(args.siteId);
  if (!site.searchConsoleProperty) throw new Error('Site ' + site.id + ' has no Search Console property');
  const all = await readIndexationRows(site.id, decodeRecord);
  const byId = new Map(all.map(record => [record.id, record]));
  let records: IndexationUrlRecord[];
  if (args.urls?.length) {
    records = args.urls.map(inputUrl => {
      const url = assertUrlWithinSite(site, inputUrl);
      const stored = byId.get(urlId(url)) ?? baseRecord(site.id, url, now());
      return { ...stored, inspectionUrl: inspectionIdentity(inputUrl) };
    });
  } else {
    records = args.accelerateUninspected ? listUninspectedBacklog(all, args.limit, new Set()) : [];
    if (records.length < args.limit) {
      const due = listDue(all, args.limit);
      const seen = new Set(records.map(record => record.id));
      records.push(...due.filter(record => !seen.has(record.id)).slice(0, args.limit - records.length));
    }
  }
  const take = args.urls?.length ? Math.min(args.urls.length, 50) : args.limit;
  records = records.filter(row => row.inventoryState === 'current' && row.indexable).slice(0, take);
  if (!records.length) return {
    siteId: site.id, property: site.searchConsoleProperty,
    inspected: 0, failed: 0, skipped: 0, reason: 'no_due_urls',
    quota: await readQuota(site.searchConsoleProperty)
  };
  if (!searchConsoleCredentialsConfigured()) {
    throw new Error('Search Console credentials are not configured; URL Inspection quota was not reserved');
  }
  const reservation = await reserveQuota(site.searchConsoleProperty, records.length);
  const selected = records.slice(0, reservation.reserved);
  const checked = await runWithConcurrency(selected, 5, record => inspectOne(site, record));
  const successes = checked.flatMap(result => result.ok ? [result.value] : []);
  const failures = checked.flatMap((result, index) =>
    'error' in result ? [{ url: selected[index].url, error: result.error }] : []);
  let saved: IndexationUrlRecord[] = [];
  if (successes.length) {
    // Store all successful Google responses atomically as one site-level update.
    saved = await changeIndexationRows(site.id, decodeRecord, existing => {
      const map = new Map(existing.map(record => [record.id, record]));
      const results: IndexationUrlRecord[] = [];
      for (const { record, observation } of successes) {
        const current = map.get(record.id) ?? record;
        const next = applyInspection(site, current, record, observation);
        map.set(record.id, next);
        results.push(next);
      }
      return { rows: [...map.values()], result: results };
    });
  }
  return {
    siteId: site.id, property: site.searchConsoleProperty,
    requested: records.length, inspected: saved.length,
    failed: failures.length, skipped: records.length - selected.length,
    quota: reservation,
    results: saved.map(row => ({
      url: row.url, inspectionUrl: row.inspectionUrl, observedIndexState: row.observedIndexState,
      verdict: row.verdict, coverageState: row.coverageState,
      lastInspectedAt: row.lastInspectedAt, nextInspectionAt: row.nextInspectionAt
    })),
    failures: failures.slice(0, 20)
  };
}

export async function siteIndexationList(input: unknown) {
  const args = z.object(siteIndexationListShape).strict().parse(input);
  await readSite(args.siteId);
  const rows = await readIndexationRows(args.siteId, decodeRecord);
  const sorted = rows.slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const offset = args.pageToken ? Number(args.pageToken) : 0;
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('Invalid indexation pageToken');
  const items = sorted.slice(offset, offset + args.limit);
  return { items, nextPageToken: offset + args.limit < sorted.length ? String(offset + args.limit) : null };
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
  const rows = await readIndexationRows(siteId, decodeRecord);
  for (const record of rows) {
    addToAggregate(total, record, at);
    const key = record.pageFamily || '(unclassified)';
    byPageFamily[key] ??= emptyAggregate();
    addToAggregate(byPageFamily[key], record, at);
  }
  return {
    generatedAt: at, ...rates(total),
    byPageFamily: Object.fromEntries(Object.entries(byPageFamily).map(([key, value]) => [key, rates(value)]))
  };
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


/**
 * Read weekly snapshots created by the scheduled site-indexation sweep.
 * Deterministic snapshot IDs let us batch-get a fixed number of weeks
 * without collection scans, composite indexes or new Google API requests.
 */
export const siteIndexationHistoryShape = {
  siteId: entityId,
  weeks: z.number().int().min(1).max(26).default(16)
};

export async function siteIndexationHistory(input: unknown) {
  const args = z.object(siteIndexationHistoryShape).strict().parse(input);
  // Also verifies the site exists. The mutable URL cache provides today's
  // observed state; weekly snapshots remain immutable-by-week observations.
  const current = await siteIndexationSummary({ siteId: args.siteId });
  const monday = new Date(`${weekStartDate()}T00:00:00.000Z`);
  const weekStarts = Array.from({ length: args.weeks }, (_, index) => {
    const date = new Date(monday);
    date.setUTCDate(date.getUTCDate() - (args.weeks - index - 1) * 7);
    return date.toISOString().slice(0, 10);
  });
  const names = weekStarts.map(weekStart =>
    firestoreDocumentName(`indexationSnapshots/${hash({ siteId: args.siteId, weekStart }).slice(0, 40)}`)
  );
  const results = await firestore(':batchGet', {
    method: 'POST',
    body: JSON.stringify({ documents: names })
  }) as Array<{ found?: any }>;
  const allowedWeeks = new Set(weekStarts);
  const snapshots = results
    .flatMap(result => result.found ? [decoded(result.found)] : [])
    .filter(row => row.siteId === args.siteId && allowedWeeks.has(String(row.weekStart)))
    .sort((a, b) => String(a.weekStart).localeCompare(String(b.weekStart)))
    .map(row => ({
      weekStart: row.weekStart,
      capturedAt: row.capturedAt,
      summary: row.summary
    }));
  return { siteId: args.siteId, current, snapshots, requestedWeeks: args.weeks };
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
