/**
 * Read-only portfolio projection of the URL Inspection cache.
 * Bundles are already maintained by the scheduled site-indexation workflow.
 * One batched Firestore document read per site; no Google calls and no migrations.
 */
import { gunzipSync } from 'node:zlib';
import { firestore, firestoreDocumentName, value } from '../../db/src/firestore.js';

type BundleRecord = {
  inventoryState?: string;
  indexable?: boolean;
  lastInspectedAt?: string | null;
  observedIndexState?: string;
};
type Summary = {
  status: 'ready' | 'not_inspected' | 'no_inventory';
  indexableCount: number;
  inspectedCount: number;
  indexedObservedCount: number;
  notIndexedObservedCount: number;
  lastInspectedAt: string | null;
};
type BatchResponse = Array<{ found?: { name: string; fields?: Record<string, any> } }>;
const decode = (doc: { fields?: Record<string, any> }) =>
  Object.fromEntries(Object.entries(doc.fields ?? {}).map(([k, v]) => [k, value(v)])) as Record<string, unknown>;
const rowsFrom = (content: unknown): BundleRecord[] => {
  if (typeof content !== 'string') throw new Error('Invalid indexation bundle payload');
  const rows: unknown = JSON.parse(gunzipSync(Buffer.from(content, 'base64')).toString('utf8'));
  if (!Array.isArray(rows)) throw new Error('Invalid indexation bundle rows');
  return rows as BundleRecord[];
};

async function batchGet(paths: string[]) {
  if (!paths.length) return new Map<string, Record<string, unknown>>();
  const result = await firestore(':batchGet', {
    method: 'POST',
    body: JSON.stringify({ documents: paths.map(path => firestoreDocumentName(path)) })
  }) as BatchResponse;
  return new Map(result.filter(row => row.found)
    .map(row => [row.found!.name, decode(row.found!)]));
}

function summarize(rows: BundleRecord[]): Summary {
  let indexableCount = 0, inspectedCount = 0, indexedObservedCount = 0, notIndexedObservedCount = 0;
  let lastInspectedAt: string | null = null;
  for (const row of rows) {
    if (row.inventoryState === 'removed' || row.indexable === false) continue;
    indexableCount++;
    if (!row.lastInspectedAt) continue;
    inspectedCount++;
    if (row.observedIndexState === 'indexed') indexedObservedCount++;
    else if (row.observedIndexState === 'not_indexed') notIndexedObservedCount++;
    if (!lastInspectedAt || row.lastInspectedAt > lastInspectedAt) lastInspectedAt = row.lastInspectedAt;
  }
  return {
    status: indexableCount === 0 ? 'no_inventory' : inspectedCount === 0 ? 'not_inspected' : 'ready',
    indexableCount, inspectedCount, indexedObservedCount, notIndexedObservedCount, lastInspectedAt
  };
}

export async function siteIndexationPortfolioOverview(siteIds: string[]) {
  const ids = [...new Set(siteIds)];
  if (ids.length > 100 || ids.some(id => !/^[a-zA-Z0-9_-]{1,100}$/.test(id))) throw new Error('Invalid site IDs');
  const rootPaths = ids.map(id => `sites/${id}/indexationBundle/current`);
  const roots = await batchGet(rootPaths);
  const shardPaths: string[] = [];
  for (const path of rootPaths) {
    const item = roots.get(firestoreDocumentName(path));
    if (!item || item.format !== 'sharded') continue;
    const count = Number(item.shardCount);
    if (!Number.isSafeInteger(count) || count < 2 || count > 128) throw new Error('Invalid indexation shard count');
    const prefix = path.slice(0, -'current'.length);
    for (let i = 0; i < count; i++) shardPaths.push(`${prefix}shard-${i}`);
  }
  const shards = new Map<string, Record<string, unknown>>();
  // Firestore batchGet permits multiple documents in a request, but cap
  // batches so unusually large sharded sites never produce an unbounded body.
  for (let offset = 0; offset < shardPaths.length; offset += 100) {
    for (const [key, doc] of await batchGet(shardPaths.slice(offset, offset + 100))) shards.set(key, doc);
  }
  const result: Record<string, Summary | null> = {};
  for (const id of ids) {
    const path = `sites/${id}/indexationBundle/current`;
    const doc = roots.get(firestoreDocumentName(path));
    if (!doc) { result[id] = null; continue; }
    if (doc.format === 'single') {
      result[id] = summarize(rowsFrom(doc.data));
    } else if (doc.format === 'sharded') {
      const count = Number(doc.shardCount);
      const rows: BundleRecord[] = [];
      for (let i = 0; i < count; i++) {
        const shard = shards.get(firestoreDocumentName(`sites/${id}/indexationBundle/shard-${i}`));
        if (!shard) throw new Error('Indexation bundle shard missing');
        rows.push(...rowsFrom(shard.data));
      }
      result[id] = summarize(rows);
    } else {
      throw new Error('Unsupported indexation bundle format');
    }
  }
  return result;
}
