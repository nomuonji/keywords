/**
 * Site-scoped, compressed URL Inspection cache. A site normally costs one
 * Firestore document read/write per batch, not one operation per URL.
 *
 * Existing indexationUrls records are read only for a one-time, non-destructive
 * migration. When a compressed document approaches Firestore's 1 MiB limit,
 * it is partitioned into deterministic hash shards automatically.
 */
import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { field, value, firestore, firestoreDocumentName, FirestoreError } from '../../db/src/firestore.js';

const MAX_DATA_BYTES = 750_000; // Leave a generous margin below Firestore's 1 MiB/document cap.
const MAX_SHARDS = 128;
const rootPath = (siteId: string) => `sites/${siteId}/indexationBundle/current`;
const shardPath = (siteId: string, index: number) => `sites/${siteId}/indexationBundle/shard-${index}`;

type StoredDoc = any;
type Snapshot<T> = {
  rows: T[];
  root: StoredDoc | null;
  parts: Array<StoredDoc | null>;
  count: number;
  rootFields: Record<string, unknown> | null;
  partFields: Array<Record<string, unknown> | null>;
};
type Mutation<T, R> = (existing: T[]) => { rows: T[]; result: R };
const decoded = (doc: StoredDoc) =>
  Object.fromEntries(Object.entries(doc.fields ?? {}).map(([key, item]) => [key, value(item as any)])) as Record<string, any>;

async function readPath(path: string) {
  try { return await firestore(`/${path}`); }
  catch (error) {
    if (error instanceof FirestoreError && error.status === 404) return null;
    throw error;
  }
}

function zip(rows: unknown[]) {
  return gzipSync(Buffer.from(JSON.stringify(rows)), { level: 6 }).toString('base64');
}

function unzip<T>(payload: unknown): T[] {
  if (typeof payload !== 'string') throw new Error('Indexation bundle is missing compressed data');
  const rows = JSON.parse(gunzipSync(Buffer.from(payload, 'base64')).toString('utf8'));
  if (!Array.isArray(rows)) throw new Error('Indexation bundle data must be an array');
  return rows as T[];
}

function bucket(row: any, count: number) {
  const identity = String(row.id ?? row.url ?? '');
  const digest = createHash('sha256').update(identity).digest();
  return digest.readUInt32BE(0) % count;
}

function partition<T>(rows: T[], count: number) {
  const groups: T[][] = Array.from({ length: count }, () => []);
  for (const row of rows) groups[bucket(row, count)].push(row);
  return groups;
}

async function legacyRows<T>(siteId: string, decodeLegacy: (doc: any) => T): Promise<T[]> {
  const rows: T[] = [];
  let token: string | undefined;
  do {
    const params = new URLSearchParams({ pageSize: '1000' });
    if (token) params.set('pageToken', token);
    const result = await firestore(`/sites/${siteId}/indexationUrls?${params.toString()}`);
    rows.push(...(result.documents ?? []).map(decodeLegacy));
    if (rows.length > 100_000) throw new Error('Indexation legacy migration exceeds 100,000 URLs; use a bounded offline migration');
    token = result.nextPageToken;
  } while (token);
  return rows;
}

async function snapshot<T>(siteId: string, decodeLegacy: (doc: any) => T): Promise<Snapshot<T>> {
  const root = await readPath(rootPath(siteId));
  if (!root) {
    return { rows: await legacyRows(siteId, decodeLegacy), root: null, parts: [], count: 0, rootFields: null, partFields: [] };
  }
  const rootFields = decoded(root);
  if (rootFields.format === 'single') {
    return { rows: unzip<T>(rootFields.data), root, parts: [], count: 0, rootFields, partFields: [] };
  }
  if (rootFields.format !== 'sharded') throw new Error('Unsupported indexation bundle format');
  const count = Number(rootFields.shardCount);
  if (!Number.isInteger(count) || count < 2 || count > MAX_SHARDS) throw new Error('Invalid indexation shard count');
  const parts: Array<StoredDoc | null> = [];
  // Avoid unbounded concurrent reads for exceptionally large sites.
  for (let offset = 0; offset < count; offset += 12) {
    parts.push(...await Promise.all(Array.from({ length: Math.min(12, count - offset) },
      (_, i) => readPath(shardPath(siteId, offset + i)))));
  }
  if (parts.some(doc => !doc)) throw new Error('Indexation shard missing; refusing partial data');
  const partFields = parts.map(doc => decoded(doc));
  return { rows: partFields.flatMap(p => unzip<T>(p.data)), root, parts, count, rootFields, partFields };
}

function write(path: string, fields: Record<string, unknown>, previous: StoredDoc | null) {
  return {
    update: {
      name: firestoreDocumentName(path),
      fields: Object.fromEntries(Object.entries(fields).map(([key, item]) => [key, field(item)]))
    },
    currentDocument: previous ? { updateTime: previous.updateTime } : { exists: false }
  };
}

function chooseLayout<T>(rows: T[], previousCount: number) {
  if (!previousCount) {
    const data = zip(rows);
    if (Buffer.byteLength(data) <= MAX_DATA_BYTES) return { count: 0, groups: [data] };
  }
  let count = previousCount || 4;
  while (count <= MAX_SHARDS) {
    const groups = partition(rows, count).map(zip);
    if (groups.every(group => Buffer.byteLength(group) <= MAX_DATA_BYTES)) return { count, groups };
    count *= 2;
  }
  throw new Error('Indexation bundle exceeds shard limit; legacy data is retained');
}

async function persist<T>(siteId: string, state: Snapshot<T>, rows: T[]) {
  const layout = chooseLayout(rows, state.count);
  const timestamp = new Date().toISOString();
  const writes: any[] = [];

  if (layout.count === 0) {
    const fields = { format: 'single', encoding: 'gzip-base64', data: layout.groups[0], updatedAt: timestamp };
    if (state.rootFields?.format === 'single' && state.rootFields.data === fields.data) return;
    writes.push(write(rootPath(siteId), fields, state.root));
  } else {
    // Root is a concurrency gate for every shard commit, including a reshard.
    // A stale writer cannot overwrite records after another writer's reshard.
    const fields = { format: 'sharded', encoding: 'gzip-base64', shardCount: layout.count, updatedAt: timestamp };
    let changed = state.count !== layout.count || !state.root;
    for (let i = 0; i < layout.count; i++) {
      if (state.count === layout.count && state.partFields[i]?.data === layout.groups[i]) continue;
      changed = true;
      writes.push(write(shardPath(siteId, i), { data: layout.groups[i] }, state.parts[i] ?? null));
    }
    if (!changed) return;
    writes.push(write(rootPath(siteId), fields, state.root));
  }
  // Firestore REST Commit is atomic. Precondition conflicts are handled by caller.
  await firestore(':commit', { method: 'POST', body: JSON.stringify({ writes }) });
}

export async function changeIndexationRows<T, R>(
  siteId: string,
  decodeLegacy: (doc: any) => T,
  mutation: Mutation<T, R>
): Promise<R> {
  for (let attempt = 0; attempt < 6; attempt++) {
    const state = await snapshot(siteId, decodeLegacy);
    const update = mutation(state.rows);
    try {
      await persist(siteId, state, update.rows);
      return update.result;
    } catch (error) {
      if (!(error instanceof FirestoreError) || ![400, 409, 412].includes(error.status) || attempt === 5) throw error;
    }
  }
  throw new Error('Indexation site-bundle update failed after retry');
}

export async function readIndexationRows<T>(siteId: string, decodeLegacy: (doc: any) => T): Promise<T[]> {
  // First read also migrates legacy data. Existing URL docs are retained for rollback.
  return changeIndexationRows(siteId, decodeLegacy, rows => ({ rows, result: rows }));
}
