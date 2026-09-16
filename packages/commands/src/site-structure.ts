import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { field, value, firestore, firestoreDocumentName, FirestoreError } from '../../db/src/firestore.js';
import type { SiteStructure, SiteStructureNode } from '../../db/src/site-structure-schema.js';

const id = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
const keywordId = z.string().regex(/^[a-f0-9]{32}$/);
const note = z.string().max(4000);
const keywordRole = z.enum(['primary', 'secondary', 'supporting', 'parent', 'monetization']);
const nodeSchema = z.object({
  id, parentId: id.nullable(), title: z.string().trim().min(1).max(200),
  path: z.string().max(500).regex(/^\/(?!\/)[^?#\s\\]*$/),
  kind: z.enum(['home', 'category', 'article', 'landing']),
  purpose: note.default(''), keywordIds: z.array(keywordId).max(30).default([]),
  keywordRoles: z.record(keywordId, keywordRole).default({}),
  notes: note.default('')
}).strict();
const linkSchema = z.object({ from: id, to: id, label: z.string().max(200).default('') }).strict();
const dataModelSchema = z.array(z.object({
  entity: z.string().trim().min(1).max(100),
  fields: z.array(z.object({ name: z.string().trim().min(1).max(100), type: z.string().trim().min(1).max(100), description: z.string().max(1000).default(''), required: z.boolean().default(false) }).strict()).max(100)
}).strict()).max(50);
const sourceStrategySchema = z.array(z.object({
  name: z.string().trim().min(1).max(200),
  sourceType: z.enum(['official_pricing', 'official_feature', 'official_faq', 'official_docs', 'regulator', 'other']),
  urlPattern: z.string().max(1000).default(''),
  fields: z.array(z.string().trim().min(1).max(100)).max(100).default([]),
  notes: note.default('')
}).strict()).max(100);
const pageTemplatesSchema = z.array(z.object({
  id,
  titlePattern: z.string().trim().min(1).max(300),
  kind: z.enum(['comparison', 'detail', 'directory', 'landing', 'other']),
  purpose: note.default(''),
  dataRequirements: z.array(z.string().trim().min(1).max(100)).max(100).default([])
}).strict()).max(100);
const refreshPolicySchema = z.array(z.object({
  scope: z.string().trim().min(1).max(200),
  ttlDays: z.number().int().min(1).max(3650),
  trigger: z.string().max(1000).default(''),
  notes: note.default('')
}).strict()).max(100);

export const siteStructureSaveShape = {
  id, expectedRevision: z.number().int().min(0),
  title: z.string().trim().min(1).max(200).optional(),
  concept: note.optional(), audience: note.optional(), monetization: note.optional(), notes: note.optional(),
  status: z.enum(['draft', 'active', 'archived']).optional(),
  dataModel: dataModelSchema.optional(), sourceStrategy: sourceStrategySchema.optional(), pageTemplates: pageTemplatesSchema.optional(), refreshPolicy: refreshPolicySchema.optional(),
  nodes: z.array(nodeSchema).max(200).optional(),
  links: z.array(linkSchema).max(500).optional()
};
const saveSchema = z.object(siteStructureSaveShape).strict();
export const siteStructureListShape = {
  limit: z.number().int().min(1).max(100).default(50),
  pageToken: z.string().max(4000).optional()
};
export const siteStructureGetShape = { id };

const updateNodeSchema = z.object({
  op: z.literal('updateNode'), id,
  parentId: id.nullable().optional(), title: z.string().trim().min(1).max(200).optional(),
  path: z.string().max(500).regex(/^\/(?!\/)[^?#\s\\]*$/).optional(),
  kind: z.enum(['home', 'category', 'article', 'landing']).optional(),
  purpose: note.optional(), notes: note.optional()
}).strict();
const patchOperationSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('addNode'), node: nodeSchema }).strict(),
  updateNodeSchema,
  z.object({ op: z.literal('removeNode'), id, cascade: z.boolean().default(false) }).strict(),
  z.object({ op: z.literal('addLink'), link: linkSchema }).strict(),
  z.object({ op: z.literal('removeLink'), from: id, to: id }).strict(),
  z.object({ op: z.literal('linkKeyword'), nodeId: id, keywordId, role: keywordRole.default('supporting') }).strict(),
  z.object({ op: z.literal('unlinkKeyword'), nodeId: id, keywordId }).strict()
]);
export const siteStructurePatchShape = {
  id, expectedRevision: z.number().int().min(1),
  title: z.string().trim().min(1).max(200).optional(),
  concept: note.optional(), audience: note.optional(), monetization: note.optional(), notes: note.optional(),
  status: z.enum(['draft', 'active', 'archived']).optional(),
  dataModel: dataModelSchema.optional(), sourceStrategy: sourceStrategySchema.optional(), pageTemplates: pageTemplatesSchema.optional(), refreshPolicy: refreshPolicySchema.optional(),
  operations: z.array(patchOperationSchema).min(1).max(200)
};
const patchSchema = z.object(siteStructurePatchShape).strict();

function normalizeNode(node: any): SiteStructureNode {
  const keywordIds = Array.isArray(node?.keywordIds) ? node.keywordIds : [];
  const roles = node?.keywordRoles && typeof node.keywordRoles === 'object' ? node.keywordRoles : {};
  return { ...node, parentId: node?.parentId ?? null, purpose: node?.purpose ?? '', notes: node?.notes ?? '', keywordIds, keywordRoles: Object.fromEntries(Object.entries(roles).filter(([key]) => keywordIds.includes(key))) } as SiteStructureNode;
}
function parse(doc: any): SiteStructure {
  const raw = Object.fromEntries(Object.entries(doc.fields ?? {}).map(([key, item]) => [key, value(item)])) as any;
  return {
    title: '', concept: '', audience: '', monetization: '', notes: '', status: 'draft',
    dataModel: [], sourceStrategy: [], pageTemplates: [], refreshPolicy: [], nodes: [], links: [],
    revision: 0, createdAt: '', updatedAt: '',
    ...raw,
    id: doc.name.split('/').pop(),
    nodes: (Array.isArray(raw.nodes) ? raw.nodes : []).map(normalizeNode),
    links: Array.isArray(raw.links) ? raw.links : [],
    dataModel: Array.isArray(raw.dataModel) ? raw.dataModel : [],
    sourceStrategy: Array.isArray(raw.sourceStrategy) ? raw.sourceStrategy : [],
    pageTemplates: Array.isArray(raw.pageTemplates) ? raw.pageTemplates : [],
    refreshPolicy: Array.isArray(raw.refreshPolicy) ? raw.refreshPolicy : []
  } as SiteStructure;
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
    for (const roleKeywordId of Object.keys(node.keywordRoles ?? {})) if (!node.keywordIds.includes(roleKeywordId)) throw new Error(`Keyword role must reference a linked keyword: ${roleKeywordId}`);
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
    dataModel: [], sourceStrategy: [], pageTemplates: [], refreshPolicy: [],
    createdAt: now, ...current, ...patch,
    nodes: args.nodes ? args.nodes.map(normalizeNode) : current?.nodes ?? [],
    revision: expectedRevision + 1, updatedAt: now
  };
  validateGraph(plan);
  const keywordIds = [...new Set(plan.nodes.flatMap(node => node.keywordIds))];
  if (keywordIds.length > 500) throw new Error('A site structure can reference at most 500 keywords');
  if (keywordIds.length) {
    const rows = await firestore(':batchGet', { method: 'POST', body: JSON.stringify({ documents: keywordIds.map(key => firestoreDocumentName(`keywordTreasury/${key}`)) }) });
    if (rows.some((row: any) => row.missing) || rows.filter((row: any) => row.found).length !== keywordIds.length) throw new Error('Unknown treasury keyword ID: save research to keyword_treasury_save first');
  }
  const encodeFields = (data: object) => Object.fromEntries(Object.entries(data).map(([key, item]) => [key, field(item)]));
  if (Buffer.byteLength(JSON.stringify(plan), 'utf8') > 600_000) throw new Error('Site structure is too large');
  const runId = randomUUID();
  try {
    await firestore(':commit', { method: 'POST', body: JSON.stringify({ writes: [
      { update: { name: firestoreDocumentName(`siteStructures/${plan.id}`), fields: encodeFields(plan) }, currentDocument: previous ? { updateTime: previous.updateTime } : { exists: false } },
      { update: { name: firestoreDocumentName(`runs/${runId}`), fields: encodeFields({ id: runId, command: 'site_structure_save', targetId: plan.id, actor: 'remote_mcp', beforeRevision: expectedRevision, revision: plan.revision, createdAt: now, outcome: 'succeeded' }) }, currentDocument: { exists: false } }
    ] }) });
  } catch (error) {
    if (error instanceof FirestoreError && [400, 409, 412].includes(error.status)) throw new Error('Save failed or revision changed: call site_structure_get before retrying');
    throw error;
  }
  return { ...plan, runId };
}

function descendants(nodes: SiteStructureNode[], rootId: string) {
  const ids = new Set<string>([rootId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of nodes) if (node.parentId && ids.has(node.parentId) && !ids.has(node.id)) { ids.add(node.id); changed = true; }
  }
  return ids;
}

export async function siteStructurePatch(input: unknown) {
  const args = patchSchema.parse(input);
  const previous = await read(args.id);
  if (!previous) throw new Error('Site structure not found');
  const current = parse(previous);
  if (current.revision !== args.expectedRevision) throw new Error('Revision conflict: call site_structure_get and reapply your edit');
  let nodes = current.nodes.map(node => ({ ...node, keywordIds: [...node.keywordIds], keywordRoles: { ...node.keywordRoles } }));
  let links = current.links.map(link => ({ ...link }));

  for (const operation of args.operations) {
    if (operation.op === 'addNode') {
      if (nodes.some(node => node.id === operation.node.id)) throw new Error(`Page already exists: ${operation.node.id}`);
      nodes.push(normalizeNode(operation.node));
      continue;
    }
    if (operation.op === 'updateNode') {
      const index = nodes.findIndex(node => node.id === operation.id);
      if (index < 0) throw new Error(`Unknown page: ${operation.id}`);
      const { op: _op, id: _id, ...patch } = operation;
      nodes[index] = normalizeNode({ ...nodes[index], ...patch });
      continue;
    }
    if (operation.op === 'removeNode') {
      const target = nodes.find(node => node.id === operation.id);
      if (!target) throw new Error(`Unknown page: ${operation.id}`);
      const removal = descendants(nodes, operation.id);
      if (!operation.cascade && removal.size > 1) throw new Error('removeNode has children; set cascade=true to remove the subtree');
      if (!operation.cascade && links.some(link => link.from === operation.id || link.to === operation.id)) throw new Error('removeNode has internal links; remove them first or set cascade=true');
      nodes = nodes.filter(node => !removal.has(node.id));
      links = links.filter(link => !removal.has(link.from) && !removal.has(link.to));
      continue;
    }
    if (operation.op === 'addLink') {
      if (links.some(link => link.from === operation.link.from && link.to === operation.link.to)) throw new Error('Duplicate internal link');
      links.push(operation.link);
      continue;
    }
    if (operation.op === 'removeLink') {
      links = links.filter(link => !(link.from === operation.from && link.to === operation.to));
      continue;
    }
    if (operation.op === 'linkKeyword') {
      const node = nodes.find(item => item.id === operation.nodeId);
      if (!node) throw new Error(`Unknown page: ${operation.nodeId}`);
      if (!node.keywordIds.includes(operation.keywordId)) node.keywordIds.push(operation.keywordId);
      node.keywordRoles[operation.keywordId] = operation.role;
      continue;
    }
    const node = nodes.find(item => item.id === operation.nodeId);
    if (!node) throw new Error(`Unknown page: ${operation.nodeId}`);
    node.keywordIds = node.keywordIds.filter(item => item !== operation.keywordId);
    delete node.keywordRoles[operation.keywordId];
  }

  return siteStructureSave({
    id: args.id,
    expectedRevision: args.expectedRevision,
    title: args.title,
    concept: args.concept,
    audience: args.audience,
    monetization: args.monetization,
    notes: args.notes,
    status: args.status,
    dataModel: args.dataModel,
    sourceStrategy: args.sourceStrategy,
    pageTemplates: args.pageTemplates,
    refreshPolicy: args.refreshPolicy,
    nodes,
    links
  });
}
