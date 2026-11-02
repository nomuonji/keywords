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

/**
 * One measured search query, with the side of the exchange it belongs to.
 *
 * `side` guards the classic misuse of a consumer model: `self` is what the persona types into
 * a search box, `surrounding` is what the people they push costs onto type. A model whose
 * evidence is mostly `surrounding` describes the victims, not the consumer, and any discovery
 * premised on it will sell to the wrong buyer.
 */
export type ConsumerSearchEvidence = {
  keyword: string;
  side: 'self' | 'surrounding' | 'unknown';
  volume?: number | null;
  competition?: string | null;
  competitionIndex?: number | null;
  cpcYen?: number | null;
  /** Top-of-page bid range. Historical metrics rarely return averageCpc, so this is where the money shows. */
  bidLowYen?: number | null;
  bidHighYen?: number | null;
  /**
   * `mixed` marks a query typed by both sides (退職代行 is searched by people fleeing a bad
   * workplace as much as by people dodging one). Its volume must not be read as this model's demand.
   */
  sideCertainty?: 'clear' | 'mixed';
  intent?: string;
  source: string;
  measuredAt: string;
  note?: string;
};

/**
 * A first-person post by someone on the persona's side of the exchange, quoted verbatim.
 *
 * Personas are authored; voices are what keeps them honest. `fit` is the reader's judgement and
 * stays INFERRED: a post that contradicts the model is recorded with `contradicts`, not dropped.
 */
export type ConsumerVoice = {
  url: string;
  quote: string;
  platform: string;
  postedAt?: string;
  observedAt: string;
  fit: 'fits' | 'partial' | 'contradicts';
  reading: string;
  personaKeys?: string[];
  variables?: string[];
};

/** The moment money moves: what happened, what they typed, what they paid for. */
export type ConsumerTrigger = { event: string; query: string; pays: string };

/** Who the money comes from. Stated explicitly so the premise cannot be read backwards. */
export type ConsumerBuyer = { pays: string; doesNotPay: string };

/**
 * An illustrative individual inside a segment. A consumer model describes a segment; a persona
 * is one imagined member of it, written concretely enough to start a train of thought.
 *
 * `isComposite` is required and must be true. Personas are illustrations, never real people:
 * writing one from a specific private individual is how a market premise turns into an attack.
 */
export type ConsumerPersona = {
  key: string;
  name: string;
  segment?: string;
  oneLine: string;
  situation?: string;
  daily?: string[];
  phrases?: string[];
  wants?: string[];
  avoids?: string[];
  buys?: string[];
  notBuys?: string[];
  searchWords?: string[];
  /** How they see themselves. Without it the persona is only the surrounding party's complaint. */
  selfImage?: string;
  /** Why people stay around them anyway. A persona with no reason to be tolerated is a caricature. */
  whyTolerated?: string[];
  triggers?: ConsumerTrigger[];
  isComposite: true;
  note?: string;
};

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
  /** Who pays for this persona's problem, and who explicitly does not. */
  buyer?: ConsumerBuyer;
  /** Illustrative individuals inside the segment, for ideation. Composites only. */
  personas?: ConsumerPersona[];
  /** Measured queries split by whose search box they appear in. */
  searchEvidence?: ConsumerSearchEvidence[];
  /** First-person posts from the persona's side, quoted verbatim with their URL. */
  voices?: ConsumerVoice[];
  seeds?: ConsumerSeedAngle[];
  evidencePolicy: Record<string, unknown>;
  antiPatterns: string[];
  researchProcedure: string[];
  changeGate: Record<string, unknown>;
  provenance: Record<string, unknown>;
};

export type ConsumerModel = ConsumerModelFields & { revision: number; createdAt: string; updatedAt: string; updatedBy?: string | null };
export type ConsumerModelSummary = Pick<ConsumerModel, 'id' | 'name' | 'version' | 'status' | 'summary' | 'revision' | 'updatedAt'> & { variableCount: number; targetCount: number; keywordCount: number; selfKeywordCount: number; mixedKeywordCount: number; personaCount: number; voiceCount: number };

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
    targetCount: Array.isArray((model.definition as any)?.notAssumed) ? (model.definition as any).notAssumed.length : 0,
    keywordCount: Array.isArray(model.searchEvidence) ? model.searchEvidence.length : 0,
    selfKeywordCount: Array.isArray(model.searchEvidence) ? model.searchEvidence.filter(item => item?.side === 'self').length : 0,
    // self rows that people outside the model also type; their volume is not this model's demand
    mixedKeywordCount: Array.isArray(model.searchEvidence) ? model.searchEvidence.filter(item => item?.side === 'self' && item?.sideCertainty === 'mixed').length : 0,
    personaCount: Array.isArray(model.personas) ? model.personas.length : 0,
    voiceCount: Array.isArray(model.voices) ? model.voices.length : 0
  };
}
function body(payload: Record<string, unknown>) {
  return JSON.stringify({ fields: Object.fromEntries(Object.entries(payload).filter(([, item]) => item !== undefined).map(([key, item]) => [key, field(item)])) });
}
/** Reject half-recorded measurements: a number without a source cannot be re-checked later. */
function normalizeSearchEvidence(item: ConsumerSearchEvidence): ConsumerSearchEvidence {
  const keyword = String(item?.keyword ?? '').trim();
  if (!keyword) throw new Error('Every search evidence row needs a keyword');
  const side = String(item?.side ?? '') as ConsumerSearchEvidence['side'];
  if (!['self', 'surrounding', 'unknown'].includes(side)) throw new Error(`Search evidence "${keyword}" needs side: self | surrounding | unknown`);
  const source = String(item?.source ?? '').trim();
  if (!source) throw new Error(`Search evidence "${keyword}" needs a source`);
  const measuredAt = String(item?.measuredAt ?? '').trim();
  if (!measuredAt) throw new Error(`Search evidence "${keyword}" needs measuredAt`);
  const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : null);
  return {
    keyword, side, volume: num(item.volume),
    competition: item.competition ?? null, competitionIndex: num(item.competitionIndex), cpcYen: num(item.cpcYen),
    bidLowYen: num(item.bidLowYen), bidHighYen: num(item.bidHighYen),
    ...(item.sideCertainty === 'mixed' || item.sideCertainty === 'clear' ? { sideCertainty: item.sideCertainty } : {}),
    ...(item.intent ? { intent: String(item.intent) } : {}),
    source, measuredAt,
    ...(item.note ? { note: String(item.note) } : {})
  };
}
/** Quotes stay short and verbatim; the URL is what lets the next reader check the judgement. */
const VOICE_QUOTE_MAX = 125;
function normalizeVoice(item: ConsumerVoice): ConsumerVoice {
  const url = String(item?.url ?? '').trim();
  if (!/^https?:\/\//.test(url)) throw new Error(`Voice needs an http(s) url: ${url}`);
  const quote = String(item?.quote ?? '').trim();
  if (!quote) throw new Error(`Voice ${url} needs a verbatim quote`);
  if (quote.length > VOICE_QUOTE_MAX) throw new Error(`Voice ${url} quote exceeds ${VOICE_QUOTE_MAX} chars; quote less and put the rest in reading`);
  const platform = String(item?.platform ?? '').trim();
  if (!platform) throw new Error(`Voice ${url} needs a platform`);
  const observedAt = String(item?.observedAt ?? '').trim();
  if (!observedAt) throw new Error(`Voice ${url} needs observedAt`);
  if (!['fits', 'partial', 'contradicts'].includes(item?.fit)) throw new Error(`Voice ${url} needs fit: fits | partial | contradicts`);
  const reading = String(item?.reading ?? '').trim();
  if (!reading) throw new Error(`Voice ${url} needs a reading that says what it shows about the model`);
  const list = (values?: string[]) => (values ?? []).map(value => String(value).trim()).filter(Boolean);
  return {
    url, quote, platform, ...(item.postedAt ? { postedAt: String(item.postedAt) } : {}), observedAt,
    fit: item.fit, reading, personaKeys: list(item.personaKeys), variables: list(item.variables)
  };
}
/** Spacing differs between how a query is written and how Google Ads echoes it back. */
export function searchKey(keyword: string): string {
  return keyword.replace(/\s+/g, '').toLowerCase();
}
function normalizeBuyer(buyer: ConsumerBuyer | undefined): ConsumerBuyer | null {
  if (!buyer) return null;
  const pays = String(buyer.pays ?? '').trim();
  const doesNotPay = String(buyer.doesNotPay ?? '').trim();
  if (!pays || !doesNotPay) throw new Error('buyer needs both pays and doesNotPay, so the premise cannot be read backwards');
  return { pays, doesNotPay };
}
/**
 * A persona is an illustration of the segment. Requiring `isComposite` keeps that explicit:
 * a persona written from a specific private individual stops being a market premise.
 */
function normalizePersonas(personas: ConsumerPersona[] | undefined): ConsumerPersona[] {
  const list = (values?: string[]) => (values ?? []).map(value => String(value).trim()).filter(Boolean);
  return (personas ?? []).map(persona => {
    const key = String(persona?.key ?? '').trim();
    if (!MODEL_ID.test(key)) throw new Error(`Persona key must be a lowercase slug (2-64 chars): ${key}`);
    const name = String(persona?.name ?? '').trim();
    if (!name) throw new Error(`Persona ${key} needs a name`);
    const oneLine = String(persona?.oneLine ?? '').trim();
    if (!oneLine) throw new Error(`Persona ${key} needs oneLine`);
    if (persona?.isComposite !== true) throw new Error(`Persona ${key} must set isComposite:true — personas are illustrations, never real people`);
    return {
      key, name, oneLine, isComposite: true as const,
      ...(persona.segment ? { segment: String(persona.segment).trim() } : {}),
      ...(persona.situation ? { situation: String(persona.situation).trim() } : {}),
      daily: list(persona.daily), phrases: list(persona.phrases),
      wants: list(persona.wants), avoids: list(persona.avoids),
      buys: list(persona.buys), notBuys: list(persona.notBuys), searchWords: list(persona.searchWords),
      ...(persona.selfImage ? { selfImage: String(persona.selfImage).trim() } : {}),
      whyTolerated: list(persona.whyTolerated),
      triggers: (persona.triggers ?? []).map(trigger => {
        const event = String(trigger?.event ?? '').trim();
        const query = String(trigger?.query ?? '').trim();
        const pays = String(trigger?.pays ?? '').trim();
        if (!event || !query || !pays) throw new Error(`Persona ${key} trigger needs event, query and pays`);
        return { event, query, pays };
      }),
      ...(persona.note ? { note: String(persona.note) } : {})
    };
  });
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
    const searchEvidence = (input.searchEvidence ?? []).map(normalizeSearchEvidence);
    const buyer = normalizeBuyer(input.buyer);
    const personas = normalizePersonas(input.personas);
    const voices = (input.voices ?? []).map(normalizeVoice);
    const warnings: string[] = [];
    // A model is a premise about a consumer. Evidence that only describes the people they
    // impose costs on produces a model of the victim, so the mismatch is surfaced, not hidden.
    if (searchEvidence.length && !searchEvidence.some(item => item.side === 'self')) {
      warnings.push('searchEvidence has no side:"self" row. The buyer of a consumer model is the persona; rows labelled "surrounding" describe the people they push costs onto.');
    }
    if (searchEvidence.length && !buyer) {
      warnings.push('buyer is not set. State who pays and who does not, so the premise cannot be read backwards.');
    }
    if (personas.length && !personas.some(persona => persona.searchWords?.length)) {
      warnings.push('personas carry no searchWords. Personas exist to make recall concrete; without example queries they only decorate the segment.');
    }
    // A persona query nobody measured is the author's imagination wearing a persona's clothes.
    const measured = new Set(searchEvidence.map(item => searchKey(item.keyword)));
    const unmeasured = [...new Set(personas.flatMap(persona => persona.searchWords ?? []))].filter(word => !measured.has(searchKey(word)));
    if (searchEvidence.length && unmeasured.length) {
      warnings.push(`persona searchWords not in searchEvidence (unmeasured): ${unmeasured.join(', ')}`);
    }
    if (personas.length && !voices.length) {
      warnings.push('personas have no voices. Without first-person posts from the persona side, personas are written from the surrounding party\'s complaints.');
    }
    const personaKeys = new Set(personas.map(persona => persona.key));
    for (const voice of voices) {
      for (const key of voice.personaKeys ?? []) if (!personaKeys.has(key)) warnings.push(`voice ${voice.url} references unknown persona ${key}`);
    }
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
      buyer: buyer ?? existing?.buyer ?? null, personas: personas.length ? personas : (existing?.personas ?? []),
      searchEvidence: searchEvidence.length ? searchEvidence : (existing?.searchEvidence ?? []),
      voices: voices.length ? voices : (existing?.voices ?? []),
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
    return { ...payload, previousRevision: existing?.revision ?? null, warnings } as ConsumerModel & { previousRevision: number | null; warnings: string[] };
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
  buyer: z.object({ pays: z.string().min(1).max(600), doesNotPay: z.string().min(1).max(600) }).optional(),
  personas: z.array(z.object({
    key: z.string().min(2).max(64),
    name: z.string().min(1).max(120),
    segment: z.string().max(120).optional(),
    oneLine: z.string().min(1).max(600),
    situation: z.string().max(600).optional(),
    daily: z.array(z.string().max(300)).max(30).optional(),
    phrases: z.array(z.string().max(300)).max(30).optional(),
    wants: z.array(z.string().max(200)).max(30).optional(),
    avoids: z.array(z.string().max(200)).max(30).optional(),
    buys: z.array(z.string().max(300)).max(30).optional(),
    notBuys: z.array(z.string().max(300)).max(30).optional(),
    searchWords: z.array(z.string().max(200)).max(60).optional(),
    selfImage: z.string().max(600).optional(),
    whyTolerated: z.array(z.string().max(300)).max(20).optional(),
    triggers: z.array(z.object({ event: z.string().min(1).max(300), query: z.string().min(1).max(200), pays: z.string().min(1).max(300) })).max(20).optional(),
    isComposite: z.literal(true),
    note: z.string().max(600).optional()
  })).max(20).optional(),
  searchEvidence: z.array(z.object({
    keyword: z.string().min(1).max(200),
    side: z.enum(['self', 'surrounding', 'unknown']),
    volume: z.number().int().min(0).nullable().optional(),
    competition: z.string().max(20).nullable().optional(),
    competitionIndex: z.number().int().min(0).max(100).nullable().optional(),
    cpcYen: z.number().min(0).nullable().optional(),
    bidLowYen: z.number().min(0).nullable().optional(),
    bidHighYen: z.number().min(0).nullable().optional(),
    sideCertainty: z.enum(['clear', 'mixed']).optional(),
    intent: z.string().max(300).optional(),
    source: z.string().min(1).max(100),
    measuredAt: z.string().min(4).max(40),
    note: z.string().max(500).optional()
  })).max(400).optional(),
  voices: z.array(z.object({
    url: z.string().url().max(500),
    quote: z.string().min(1).max(125),
    platform: z.string().min(1).max(60),
    postedAt: z.string().max(40).optional(),
    observedAt: z.string().min(4).max(40),
    fit: z.enum(['fits', 'partial', 'contradicts']),
    reading: z.string().min(1).max(800),
    personaKeys: z.array(z.string().max(64)).max(20).optional(),
    variables: z.array(z.string().max(64)).max(20).optional()
  })).max(200).optional(),
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
