import { createHash } from 'node:crypto';
import { z } from 'zod';
import { and, asc, eq } from 'drizzle-orm';
import { getDatabase, schema } from '@keywords/db';
import type { CommandContext } from '@keywords/domain';
import { readConsumerModel } from './consumer-model.js';

/**
 * Seed pools hold the concrete subjects an angle can be applied to (an artist, a word,
 * a product, a behaviour). They live in SQLite, not Firestore with the model definition:
 * pools churn weekly while the model changes rarely, and every generated seed needs to be
 * traceable to the pool item and label that produced it.
 *
 * A pool item is material, never evidence. `label` records where it came from
 * (HYPOTHESIS = someone's intuition, REPORTED = a public ranking/survey).
 */
const { db } = getDatabase();
const now = () => new Date().toISOString();
const normalize = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ');
const idFor = (poolId: string, text: string) => createHash('sha256').update(`${poolId}\u0000${normalize(text)}`).digest('hex').slice(0, 32);
const POOL_ID = /^[a-z0-9][a-z0-9-]{1,63}$/;

export type SeedPoolItem = {
  text: string;
  category?: string | null;
  label?: 'HYPOTHESIS' | 'REPORTED' | 'OBSERVED' | 'UNKNOWN';
  sourceRef?: string | null;
  originRef?: string | null;
  note?: string | null;
  modelId?: string | null;
  status?: 'active' | 'stale' | 'archived';
  observedAt?: string | null;
};

function assertPoolId(poolId: string) {
  const raw = poolId?.trim() ?? '';
  if (!POOL_ID.test(raw)) throw new Error('Pool id must be a lowercase slug (2-64 chars: a-z, 0-9, -)');
  return raw;
}

export const consumerSeedPoolCommands = {
  /**
   * Upsert pool items. Idempotent: the same pool + text updates in place, so re-importing a
   * seed file does not duplicate or reorder research material.
   */
  import: async (_ctx: CommandContext, input: { poolId: string; items: SeedPoolItem[] }) => {
    const poolId = assertPoolId(input.poolId);
    if (!Array.isArray(input.items) || !input.items.length) throw new Error('items is required');
    if (input.items.length > 2000) throw new Error('Import at most 2000 items per call');
    let created = 0; let updated = 0; let skipped = 0;
    const timestamp = now();
    for (const item of input.items) {
      const text = item?.text?.trim();
      if (!text) { skipped++; continue; }
      if (text.length > 300) throw new Error(`Pool item text is too long: ${text.slice(0, 40)}…`);
      const id = idFor(poolId, text);
      const normalized = normalize(text);
      const existing = db.select({ id: schema.consumerModelSeeds.id }).from(schema.consumerModelSeeds).where(eq(schema.consumerModelSeeds.id, id)).get();
      const row = {
        poolId, modelId: item.modelId ?? null, text, normalized,
        category: item.category ?? null, label: item.label ?? 'HYPOTHESIS',
        sourceRef: item.sourceRef ?? null, originRef: item.originRef ?? null, note: item.note ?? null,
        status: item.status ?? 'active', observedAt: item.observedAt ?? null, updatedAt: timestamp
      };
      if (existing) {
        db.update(schema.consumerModelSeeds).set(row).where(eq(schema.consumerModelSeeds.id, id)).run();
        updated++;
      } else {
        db.insert(schema.consumerModelSeeds).values({ id, ...row, createdAt: timestamp }).run();
        created++;
      }
    }
    return { poolId, created, updated, skipped, total: created + updated };
  },

  /** Read pool items. Never returns a pool as evidence of demand. */
  list: async (_ctx: CommandContext, input: { poolId?: string; label?: string; status?: string; category?: string; limit?: number } = {}) => {
    const limit = Math.max(1, Math.min(Math.floor(input.limit ?? 50), 500));
    const filters = [];
    if (input.poolId) filters.push(eq(schema.consumerModelSeeds.poolId, assertPoolId(input.poolId)));
    if (input.label) filters.push(eq(schema.consumerModelSeeds.label, input.label));
    if (input.status) filters.push(eq(schema.consumerModelSeeds.status, input.status));
    if (input.category) filters.push(eq(schema.consumerModelSeeds.category, input.category));
    const where = filters.length ? and(...filters) : undefined;
    const rows = where
      ? db.select().from(schema.consumerModelSeeds).where(where).orderBy(asc(schema.consumerModelSeeds.poolId), asc(schema.consumerModelSeeds.originRef)).limit(limit).all()
      : db.select().from(schema.consumerModelSeeds).orderBy(asc(schema.consumerModelSeeds.poolId), asc(schema.consumerModelSeeds.originRef)).limit(limit).all();
    const totals = db.select({ poolId: schema.consumerModelSeeds.poolId }).from(schema.consumerModelSeeds).all();
    const byPool: Record<string, number> = {};
    for (const row of totals) byPool[row.poolId] = (byPool[row.poolId] ?? 0) + 1;
    return { byPool, items: rows.map(row => ({ ...row, normalized: undefined })) };
  },

  /**
   * Cross the model's angles with pool items to produce research seeds.
   * Deterministic rotation by model+date keeps repeat runs from proposing the same top list,
   * and every seed keeps the angle, pool item and label that produced it.
   */
  generate: async (_ctx: CommandContext, input: { modelId: string; poolId?: string; count?: number; label?: string; category?: string; rotationKey?: string }) => {
    const model = await readConsumerModel(input.modelId);
    const angles = (model.seeds ?? []).filter(angle => angle?.template?.includes('{item}'));
    if (!angles.length) throw new Error(`Consumer model ${model.id} has no seed angles with {item}; add seeds before generating`);
    const filters = [eq(schema.consumerModelSeeds.status, 'active')];
    if (input.poolId) filters.push(eq(schema.consumerModelSeeds.poolId, assertPoolId(input.poolId)));
    if (input.label) filters.push(eq(schema.consumerModelSeeds.label, input.label));
    if (input.category) filters.push(eq(schema.consumerModelSeeds.category, input.category));
    const items = db.select().from(schema.consumerModelSeeds).where(and(...filters)).all();
    if (!items.length) throw new Error('No active pool items match; import a pool first');
    const count = Math.max(1, Math.min(Math.floor(input.count ?? 20), 100));
    const key = input.rotationKey ?? now().slice(0, 10);
    // An angle may declare which pool categories it applies to (substring match). Without it, it
    // applies everywhere, which is how nonsense like "person + 代わり" gets generated.
    const fitsAngle = (angle: { appliesTo?: string[] }, category: string | null) => {
      const patterns = (angle.appliesTo ?? []).filter(Boolean);
      if (!patterns.length) return true;
      const haystack = (category ?? '').toLowerCase();
      return patterns.some(pattern => haystack.includes(pattern.toLowerCase()));
    };
    const rank = (value: string) => createHash('sha256').update(`${model.id}\u0000${key}\u0000${value}`).digest('hex');
    const orderedItems = [...items].sort((a, b) => rank(`item:${a.id}`).localeCompare(rank(`item:${b.id}`)));
    const orderedAngles = [...angles].sort((a, b) => rank(`angle:${a.label}`).localeCompare(rank(`angle:${b.label}`)));
    const seen = new Set<string>();
    const generated: Array<Record<string, unknown>> = [];
    // Spread the requested seeds over angles instead of exhausting one angle first.
    const perAngle = Math.max(1, Math.floor(count / orderedAngles.length));
    for (let index = 0; generated.length < count && index < orderedItems.length * orderedAngles.length; index++) {
      const item = orderedItems[index % orderedItems.length];
      const angle = orderedAngles[Math.floor(index / perAngle) % orderedAngles.length];
      if (!fitsAngle(angle, item.category)) continue;
      const text = angle.template.split('{item}').join(item.text).replace(/\s+/g, ' ').trim();
      if (seen.has(normalize(text))) continue;
      seen.add(normalize(text));
      generated.push({
        text,
        angle: angle.label,
        item: item.text,
        itemLabel: item.label,
        itemSource: item.sourceRef,
        itemOrigin: item.originRef,
        poolId: item.poolId,
        note: item.note
      });
    }
    return {
      modelId: model.id, modelVersion: model.version, rotationKey: key,
      pools: [...new Set(items.map(item => item.poolId))],
      angleCount: angles.length, itemCount: items.length,
      seeds: generated,
      caveat: 'Each seed is an angle applied to pool material. The pool item is not evidence of demand; measure search volume and SERP before saving anything as a keyword.'
    };
  }
};

export const consumerSeedPoolImportShape = {
  poolId: z.string().min(2).max(64),
  items: z.array(z.object({
    text: z.string().min(1).max(300),
    category: z.string().max(120).nullable().optional(),
    label: z.enum(['HYPOTHESIS', 'REPORTED', 'OBSERVED', 'UNKNOWN']).optional(),
    sourceRef: z.string().max(80).nullable().optional(),
    originRef: z.string().max(80).nullable().optional(),
    note: z.string().max(500).nullable().optional(),
    modelId: z.string().max(64).nullable().optional(),
    status: z.enum(['active', 'stale', 'archived']).optional(),
    observedAt: z.string().max(40).nullable().optional()
  })).min(1).max(2000)
};

export const consumerSeedPoolListShape = {
  poolId: z.string().max(64).optional(),
  label: z.string().max(40).optional(),
  status: z.string().max(40).optional(),
  category: z.string().max(120).optional(),
  limit: z.number().int().min(1).max(500).optional()
};

export const consumerModelSeedsShape = {
  modelId: z.string().min(2).max(64),
  poolId: z.string().max(64).optional(),
  count: z.number().int().min(1).max(100).optional(),
  label: z.string().max(40).optional(),
  category: z.string().max(120).optional(),
  rotationKey: z.string().max(80).optional()
};
