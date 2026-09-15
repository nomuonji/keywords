import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { field, value, firestore, firestoreDocumentName, FirestoreError } from '../../db/src/firestore.js';
import type { SiteStructure } from '../../db/src/site-structure-schema.js';

const id = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
const note = z.string().max(4000);
const nodeSchema = z.object({
  id, parentId: id.nullable(), title: z.string().trim().min(1).max(200),
  path: z.string().max(500).regex(/^\/(?!\/)[^?#\s\\]*$/),
  kind: z.enum(['home', 'category', 'article', 'landing']),
  purpose: note.default(''), keywordIds: z.array(z.string().regex(/^[a-f0-9]{32}$/)).max(30).default([]),
  notes: note.default('')
}).strict();
const linkSchema = z.object({ from: id, to: id, label: z.string().max(200).default('') }).strict();
export const siteStructureSaveShape = {
  id, expectedRevision: z.number().int().min(0),
  title: z.string().trim().min(1).max(200).optional(),
  concept: note.optional(), audience: note.optional(), monetization: note.optional(), notes: note.optional(),
  status: z.enum(['draft', 'active', 'archived']).optional(),
  nodes: z.array(nodeSchema).max(200).optional(),
  links: z.array(linkSchema).max(500).optional()
};
const saveSchema = z.object(siteStructureSaveShape).strict();
export const siteStructureListShape = {
  limit: z.number().int().min(1).max(100).default(50),
  pageToken: z.string().max(4000).optional()
};
export const siteStructureGetShape = { id };

function parse(doc: any): SiteStructure {
  return { ...Object.fromEntries(Object.entries(doc.fields ?? {}).map(([key, item]) => [key, value(item)])), id: doc.name.split('/').pop() } as SiteStructure;
}
async function read(structureId: string) {
  try { return await firestore(`/siteStructures/${id.parse(structureId)}`); }
  catch (error) { if (error instanceof FirestoreError && error.status === 404) return null; throw error; }
}
function validateGraph(plan: SiteStructure) {
  const nodes = new Map(plan.nodes.map(node => [node.id, node]));
  if (nodes.size !== plan.nodes.length) throw new Error('Page IDs must be unique');
  if (new Set(plan.nodes.map(node => node.path)).size !== plan.nodes.length) throw new Error('Page paths must be unique');
  for (const node of plan.nodes) {
    if (node.parentId && !nodes.has(node.parentId)) throw new Error(`Unknown parent: ${node.parentId}`);
    const seen = new Set<string>([node.id]);
    let parent = node.parentId;
    while (parent) {
      if (seen.has(parent)) throw new Error('Page hierarchy contains a cycle');
      seen.add(parent); parent = nodes.get(parent)?.parentId ?? null;
    }
  }
  const edges = new Set<string>();
  for (const link of plan.links) {
    if (!nodes.has(link.from) || !nodes.has(link.to) || link.from === link.to) throw new Error('Internal links require two different existing pages');
    const key = `${link.from}:${link.to}`;
    if (edges.has(key)) throw new Error('Duplicate internal link');
    edges.add(key);
  }
}

export async function siteStructureList(input: unknown = {}) {
  const args = z.object(siteStructureListShape).strict().parse(input);
  const params = new URLSearchParams({ pageSize: String(args.limit), orderBy: 'updatedAt desc' });
  if (args.pageToken) params.set('pageToken', args.pageToken);
  const result = await firestore(`/siteStructures?${params}`);
  return { items: (result.documents ?? []).map(parse) as SiteStructure[], nextPageToken: result.nextPageToken ?? null };
}

export async function siteStructureGet(input: unknown) {
  const args = z.object(siteStructureGetShape).strict().parse(input);
  const doc = await read(args.id);
  if (!doc) throw new Error('Site structure not found');
  const plan = parse(doc);
  const keywordIds = [...new Set(plan.nodes.flatMap(node => node.keywordIds))];
  const keywords: Record<string, unknown>[] = [];
  // Batch reads resolve the original research without copying metrics into plans.
  if (keywordIds.length) {
    const result = await firestore(':batchGet', { method: 'POST', body: JSON.stringify({ documents: keywordIds.map(key => firestoreDocumentName(`keywordTreasury/${key}`)) }) });
    for (const row of result) if (row.found) keywords.push({ id: row.found.name.split('/').pop(), ...Object.fromEntries(Object.entries(row.found.fields ?? {}).map(([key, item]) => [key, value(item)])) });
  }
  return { ...plan, keywords };
}

export async function siteStructureSave(input: unknown) {
  const args = saveSchema.parse(input);
  const previous = await read(args.id);
  const current = previous ? parse(previous) : null;
  if ((current?.revision ?? 0) !== args.expectedRevision) throw new Error('Revision conflict: call site_structure_get and reapply your edit');
  if (!current && !args.title) throw new Error('title is required for a new site structure');
  const now = new Date().toISOString();
  const { expectedRevision, ...patch } = args;
  const plan: SiteStructure = {
    title: '', concept: '', audience: '', monetization: '', notes: '', status: 'draft', links: [],
    createdAt: now, ...current, ...patch,
    nodes: args.nodes ? args.nodes.map(node => ({ ...node, parentId: node.parentId ?? null })) : current?.nodes ?? [],
    revision: expectedRevision + 1, updatedAt: now
  };
  validateGraph(plan);
  const keywordIds = [...new Set(plan.nodes.flatMap(node => node.keywordIds))];
  if (keywordIds.length > 500) throw new Error('A site structure can reference at most 500 keywords');
  if (keywordIds.length) {
    const rows = await firestore(':batchGet', { method: 'POST', body: JSON.stringify({ documents: keywordIds.map(key => firestoreDocumentName(`keywordTreasury/${key}`)) }) });
    if (rows.some((row: any) => row.missing) || rows.filter((row: any) => row.found).length !== keywordIds.length) throw new Error('Unknown treasury keyword ID: save research to keyword_treasury_save first');
  }
  const fields = (data: object) => Object.fromEntries(Object.entries(data).map(([key, item]) => [key, field(item)]));
  // Firestore has a 1 MiB document limit; leave room for encoded field names.
  if (Buffer.byteLength(JSON.stringify(plan), 'utf8') > 600_000) throw new Error('Site structure is too large');
  const runId = randomUUID();
  try {
    await firestore(':commit', { method: 'POST', body: JSON.stringify({ writes: [
      { update: { name: firestoreDocumentName(`siteStructures/${plan.id}`), fields: fields(plan) }, currentDocument: previous ? { updateTime: previous.updateTime } : { exists: false } },
      { update: { name: firestoreDocumentName(`runs/${runId}`), fields: fields({ id: runId, command: 'site_structure_save', targetId: plan.id, actor: 'remote_mcp', beforeRevision: expectedRevision, revision: plan.revision, createdAt: now, outcome: 'succeeded' }) }, currentDocument: { exists: false } }
    ] }) });
  } catch (error) {
    if (error instanceof FirestoreError && [400, 409, 412].includes(error.status)) throw new Error('Save failed or revision changed: call site_structure_get before retrying');
    throw error;
  }
  return { ...plan, runId };
}
