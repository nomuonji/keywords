import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
// Relative .js imports also resolve after Vercel transpiles workspace sources.
import { firestore, field, value } from '../../db/src/firestore.js';
import { getDatabase, schema } from '@keywords/db';
import type { CommandContext } from '@keywords/domain';

/**
 * Consumer models are the market-research premise: which consumer behaviour model
 * a discovery run assumes before it observes anything.
 *
 * Definitions live in Firestore (keywords project), not in local SQLite, because the
 * remote MCP is serverless and cannot persist SQLite. Local and remote read the same
 * collection, so a local-only period does not fork the canonical model.
 *
 * The project binding and the per-run premise stay in SQLite: they describe this
 * workspace's jobs, not the model itself.
 */
const COLLECTION = 'consumerModels';
const ALIAS_COLLECTION = 'consumerModelAliases';
const now = () => new Date().toISOString();
const MODEL_ID = /^[a-z0-9][a-z0-9-]{1,63}$/;
const VERSION_ID = /^[0-9]+(\.[0-9]+){0,2}$/;

const { db } = getDatabase();

export type ConsumerModelStatus = 'active' | 'paused' | 'archived';

/** A claim about how the collective decides. Always labelled: a model is a hypothesis set, not facts. */
export type ConsumerThinking = { statement: string; label?: string; evidenceRefs?: string[] };
/** What this collective gravitates to and drops. */
export type ConsumerPreferences = { like?: string[]; avoid?: string[] };
/** An angle the collective reacts to. `template` must contain {item} so it can cross with a seed pool. */
export type ConsumerSeedAngle = { key?: string; label: string; template: string; kind?: string; appliesTo?: string[] };

export type ConsumerModelFields = {
  schemaVersion?: number;
  id: string;
  slug: string;
  name: string;
  version: string;
  status: ConsumerModelStatus;
  role: string;
  summary: string;
  aliases?: string[];
  definition: Record<string, unknown>;
  objectives: Record<string, unknown>;
  variables: Array<Record<string, unknown>>;
  thinking?: ConsumerThinking[];
  preferences?: ConsumerPreferences;
  seeds?: ConsumerSeedAngle[];
  evidencePolicy: Record<string, unknown>;
  antiPatterns: string[];
  researchProcedure: string[];
  changeGate: Record<string, unknown>;
  provenance: Record<string, unknown>;
};

export type ConsumerModel = ConsumerModelFields & { revision: number; createdAt: string; updatedAt: string; updatedBy?: string | null };
export type ConsumerModelSummary = Pick<ConsumerModel, 'id' | 'name' | 'version' | 'status' | 'summary' | 'revision' | 'updatedAt'> & { variableCount: number; targetCount: number };

function assertModelId(id: unknown): string {
  const raw = typeof id === 'string' ? id.trim() : '';
  if (!MODEL_ID.test(raw)) throw new Error('Consumer model id must be a lowercase slug (2-64 chars: a-z, 0-9, -)');
  return raw;
}
function assertVersion(version: unknown): string {
  const raw = typeof version === 'string' ? version.trim() : '';
  if (!VERSION_ID.test(raw)) throw new Error('Consumer model version must look like 1 or 1.0 or 1.0.0');
  return raw;
}
function toItem(doc: any): ConsumerModel {
  return { ...Object.fromEntries(Object.entries(doc?.fields ?? {}).map(([key, item]) => [key, value(item)])), id: String(doc?.name ?? '').split('/').pop() ?? doc?.id } as ConsumerModel;
}
/**
 * Keep the alias index in step with the model. An alias that points at another model, or collides
 * with a real model id, is refused rather than silently overwritten.
 */
async function syncAliases(modelId: string, next: string[], previous: string[]) {
  const wanted = [...new Set(next.map(alias => {
    const raw = String(alias ?? '').trim();
    if (!MODEL_ID.test(raw)) throw new Error(`Alias must be a lowercase slug (2-64 chars): ${raw}`);
    if (raw === modelId) throw new Error('An alias cannot be the model id itself');
    return raw;
  }))];
  for (const alias of wanted) {
    const clash = await readModel(alias);
    if (clash) throw new Error(`Alias ${alias} collides with an existing model id`);
    try {
      const doc = await firestore(`/${ALIAS_COLLECTION}/${alias}`);
      const owner = String(doc?.fields?.modelId?.stringValue ?? '');
      if (owner && owner !== modelId) throw new Error(`Alias ${alias} already points to ${owner}`);
    } catch (error) {
      if (!(error instanceof Error && /failed \(404\)/.test(error.message))) throw error;
    }
  }
  for (const alias of wanted) {
    await firestore(`/${ALIAS_COLLECTION}/${alias}`, { method: 'PATCH', body: body({ alias, modelId, updatedAt: now() }) });
  }
  for (const alias of previous) {
    if (wanted.includes(alias)) continue;
    try { await firestore(`/${ALIAS_COLLECTION}/${alias}`, { method: 'DELETE' }); } catch { /* already gone */ }
  }
}

function summarize(model: ConsumerModel): ConsumerModelSummary {  return {
    id: model.id, name: model.name, version: model.version, status: model.status, summary: model.summary,
    revision: model.revision, updatedAt: model.updatedAt,
    variableCount: Array.isArray(model.variables) ? model.variables.length : 0,
    targetCount: Array.isArray((model.definition as any)?.notAssumed) ? (model.definition as any).notAssumed.length : 0
  };
}
function body(payload: Record<string, unknown>) {
  return JSON.stringify({ fields: Object.fromEntries(Object.entries(payload).filter(([, item]) => item !== undefined).map(([key, item]) => [key, field(item)])) });
}
async function readModel(id: string): Promise<ConsumerModel | null> {
  try {
    return toItem(await firestore(`/${COLLECTION}/${id}`));
  } catch (error) {
    if (error instanceof Error && /failed \(404\)/.test(error.message)) return null;
    throw error;
  }
}

/**
 * Resolve a model id through its aliases, so a model can be addressed by a working name
 * ("baka-model") as well as its canonical slug. Aliases are documents, not a hardcoded map.
 */
async function resolveModelId(id: string): Promise<string> {
  const direct = await readModel(id);
  if (direct) return id;
  try {
    const alias = await firestore(`/${ALIAS_COLLECTION}/${id}`);
    const modelId = (alias?.fields?.modelId?.stringValue ?? '') as string;
    return MODEL_ID.test(modelId) ? modelId : id;
  } catch (error) {
    if (error instanceof Error && /failed \(404\)/.test(error.message)) return id;
    throw error;
  }
}

export const consumerModelCommands = {
  /** List the registered market-research premises. */
  list: async (_ctx: CommandContext, input: { status?: ConsumerModelStatus; query?: string; limit?: number } = {}) => {
    const limit = Math.max(1, Math.min(Math.floor(input.limit ?? 50), 200));
    let response: any;
    try {
      response = await firestore(`/${COLLECTION}?pageSize=${limit}`);
    } catch (error) {
      if (error instanceof Error && /failed \(404\)/.test(error.message)) return [];
      throw error;
    }
    const items: ConsumerModel[] = (response?.documents ?? []).map((doc: any) => ({
      ...Object.fromEntries(Object.entries(doc.fields ?? {}).map(([key, item]) => [key, value(item)])),
      id: String(doc.name).split('/').pop()
    })) as ConsumerModel[];
    const query = input.query?.trim().toLowerCase();
    return items
      .filter(model => !input.status || model.status === input.status)
      .filter(model => !query || `${model.id} ${model.name} ${model.summary ?? ''}`.toLowerCase().includes(query))
      .map(summarize)
      .sort((a, b) => (a.status === b.status ? a.name.localeCompare(b.name) : a.status === 'active' ? -1 : 1));
  },

  /** Read one model, optionally a frozen historical version. Accepts an alias. */
  get: async (_ctx: CommandContext, input: { id: string; version?: string }) => {
    const id = await resolveModelId(assertModelId(input.id));
    if (input.version) {
      const version = assertVersion(input.version);
      const doc = await firestore(`/${COLLECTION}/${id}/versions/${version}`);
      return toItem(doc);
    }
    const model = await readModel(id);
    if (!model) throw new Error(`Consumer model not found: ${input.id}`);
    return model;
  },

  /** Create or update a model. Updates require the caller's expectedRevision. */
  save: async (ctx: CommandContext, input: ConsumerModelFields & { expectedRevision?: number; changeReason?: string }) => {
    const id = assertModelId(input.id);
    const version = assertVersion(input.version);
    if (!input.name?.trim()) throw new Error('Consumer model name is required');
    if (!input.summary?.trim()) throw new Error('Consumer model summary is required');
    if (!input.definition || typeof input.definition !== 'object') throw new Error('Consumer model definition is required');
    if (!Array.isArray(input.variables) || input.variables.length === 0) throw new Error('Consumer model requires at least one observable variable');
    if (!Array.isArray(input.researchProcedure) || input.researchProcedure.length === 0) throw new Error('Consumer model requires a research procedure');
    // Angles without a slot cannot be crossed with a seed pool, so they would be silently unused.
    for (const angle of input.seeds ?? []) {
      if (!angle?.label?.trim()) throw new Error('Every seed angle needs a label');
      if (!angle?.template?.includes('{item}')) throw new Error(`Seed angle "${angle.label}" must contain {item} so it can be crossed with a seed pool`);
    }
    const thinking = (input.thinking ?? []).map(item => {
      if (!item?.statement?.trim()) throw new Error('Every thinking claim needs a statement');
      return { statement: item.statement.trim(), label: item.label ?? 'HYPOTHESIS', evidenceRefs: item.evidenceRefs ?? [] };
    });
    const existing = await readModel(id);
    if (existing && input.expectedRevision === undefined) throw new Error(`Consumer model ${id} already exists (revision ${existing.revision}); pass expectedRevision to update it`);
    if (existing && existing.revision !== input.expectedRevision) throw new Error(`Consumer model ${id} revision changed (expected ${input.expectedRevision}, actual ${existing.revision})`);
    const revision = existing ? existing.revision + 1 : 1;
    const timestamp = now();
    const payload = {
      schemaVersion: input.schemaVersion ?? 1, id, slug: id, name: input.name.trim(), version,
      status: input.status ?? existing?.status ?? 'active', role: input.role ?? 'market_research_premise',
      summary: input.summary.trim(), aliases: [...new Set((input.aliases ?? existing?.aliases ?? []).map(alias => String(alias).trim()).filter(Boolean))],
      definition: input.definition, objectives: input.objectives ?? {},
      variables: input.variables, thinking, preferences: input.preferences ?? {}, seeds: input.seeds ?? [],
      evidencePolicy: input.evidencePolicy ?? {}, antiPatterns: input.antiPatterns ?? [],
      researchProcedure: input.researchProcedure, changeGate: input.changeGate ?? {},
      provenance: { ...(input.provenance ?? {}), ...(input.changeReason ? { lastChangeReason: input.changeReason } : {}) },
      revision, createdAt: existing?.createdAt ?? timestamp, updatedAt: timestamp, updatedBy: ctx.actorId ?? ctx.actor
    };
    await firestore(`/${COLLECTION}/${id}`, { method: 'PATCH', body: body(payload) });
    // Freeze the definition that this revision published so later edits cannot rewrite history.
    await firestore(`/${COLLECTION}/${id}/versions/${version}`, {
      method: 'PATCH',
      body: body({ ...payload, revision, frozenAt: timestamp, changeReason: input.changeReason ?? null })
    });
    await syncAliases(id, input.aliases ?? [], existing?.aliases ?? []);
    return { ...payload, previousRevision: existing?.revision ?? null } as ConsumerModel & { previousRevision: number | null };
  },

  /** Stop using a model as a premise without deleting its history. */
  archive: async (ctx: CommandContext, input: { id: string; reason?: string; expectedRevision: number }) => {
    const id = assertModelId(input.id);
    const existing = await readModel(id);
    if (!existing) throw new Error(`Consumer model not found: ${id}`);
    if (existing.revision !== input.expectedRevision) throw new Error(`Consumer model ${id} revision changed (expected ${input.expectedRevision}, actual ${existing.revision})`);
    const timestamp = now();
    const revision = existing.revision + 1;
    await firestore(`/${COLLECTION}/${id}`, {
      method: 'PATCH',
      body: body({ status: 'archived', revision, updatedAt: timestamp, updatedBy: ctx.actorId ?? ctx.actor, archiveReason: input.reason ?? null })
    });
    return { id, status: 'archived', revision };
  },

  /**
   * Import a frozen seed file from the repository (local runtime only).
   * Idempotent: the same id+version+content hash is not rewritten twice.
   */
  importSeed: async (ctx: CommandContext, input: { seedPath: string }) => {
    const absolute = resolve(process.cwd(), input.seedPath);
    const raw = await readFile(absolute, 'utf8');
    const seed = JSON.parse(raw) as ConsumerModelFields;
    const seedSha256 = createHash('sha256').update(raw).digest('hex');
    const id = assertModelId(seed.id);
    const version = assertVersion(seed.version);
    const existing = await readModel(id);
    const existingProvenance = (existing?.provenance ?? {}) as Record<string, unknown>;
    if (existing && existingProvenance.seedSha256 === seedSha256 && existing.version === version) {
      return { status: 'unchanged', id, version, revision: existing.revision, seedSha256 };
    }
    const saved = await consumerModelCommands.save(ctx, {
      ...seed, id, version,
      expectedRevision: existing?.revision,
      changeReason: existing ? `Re-import seed ${input.seedPath}` : `Initial import from seed ${input.seedPath}`,
      provenance: { ...seed.provenance, seedPath: input.seedPath, seedSha256 }
    } as ConsumerModelFields & { expectedRevision?: number; changeReason?: string });
    return { status: existing ? 'updated' : 'created', id, version, revision: saved.revision, seedSha256 };
  }
};

/** Read a model directly (used by seed-pool generation). Accepts an alias. Throws when it does not exist. */
export async function readConsumerModel(id: string): Promise<ConsumerModel> {
  const resolved = await resolveModelId(assertModelId(id));
  const model = await readModel(resolved);
  if (!model) throw new Error(`Consumer model not found: ${id}`);
  return model;
}

/** Parse a stored id list, tolerating legacy null/blank values. */
export function parseIds(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string' && MODEL_ID.test(item)) : [];
  } catch { return []; }
}

/**
 * The premise a discovery run records. Explicit only: deciding which model a project should
 * assume is the orchestrator's job, not the operator's, so nothing is inherited implicitly.
 */
export function normalizePremiseIds(ids?: string[]): string[] {
  if (!ids?.length) return [];
  return [...new Set(ids.map(assertModelId))];
}

export const consumerModelListShape = {
  status: z.enum(['active', 'paused', 'archived']).optional(),
  query: z.string().max(200).optional(),
  limit: z.number().int().min(1).max(200).optional()
};

export const consumerModelGetShape = {
  id: z.string().min(2).max(64),
  version: z.string().max(12).optional()
};

export const consumerModelSaveShape = {
  id: z.string().min(2).max(64),
  name: z.string().min(1).max(200),
  version: z.string().min(1).max(12),
  status: z.enum(['active', 'paused', 'archived']).optional(),
  role: z.string().max(80).optional(),
  summary: z.string().min(1).max(4000),
  aliases: z.array(z.string().min(2).max(64)).max(10).optional(),
  definition: z.record(z.string(), z.unknown()),
  objectives: z.record(z.string(), z.unknown()).optional(),
  variables: z.array(z.record(z.string(), z.unknown())).min(1).max(40),
  thinking: z.array(z.object({ statement: z.string().min(1).max(1000), label: z.string().max(40).optional(), evidenceRefs: z.array(z.string().max(200)).max(20).optional() })).max(60).optional(),
  preferences: z.object({ like: z.array(z.string().max(300)).max(60).optional(), avoid: z.array(z.string().max(300)).max(60).optional() }).optional(),
  seeds: z.array(z.object({ key: z.string().max(80).optional(), label: z.string().min(1).max(200), template: z.string().min(1).max(300), kind: z.string().max(40).optional(), appliesTo: z.array(z.string().max(80)).max(20).optional() })).max(60).optional(),
  evidencePolicy: z.record(z.string(), z.unknown()).optional(),
  antiPatterns: z.array(z.string().max(1000)).max(60).optional(),
  researchProcedure: z.array(z.string().max(2000)).min(1).max(60),
  changeGate: z.record(z.string(), z.unknown()).optional(),
  provenance: z.record(z.string(), z.unknown()).optional(),
  expectedRevision: z.number().int().min(1).optional(),
  changeReason: z.string().max(2000).optional()
};

export const consumerModelArchiveShape = {
  id: z.string().min(2).max(64),
  reason: z.string().max(2000).optional(),
  expectedRevision: z.number().int().min(1)
};
