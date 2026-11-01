import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { getDatabase, schema } from '@keywords/db';
import type { CommandContext } from '@keywords/domain';
import { readConsumerModel } from './consumer-model.js';

/**
 * Readings against a consumer model. The model says which variables, angles and claims to look at;
 * these rows record what was actually seen, each with its own evidence label.
 *
 * Without this layer a model can only be re-typed, never improved: the changeGate asks for
 * "observations the previous version could not explain", and that phrase needs somewhere to live.
 */
const { db } = getDatabase();
const now = () => new Date().toISOString();
const LABELS = ['OBSERVED', 'REPORTED', 'INFERRED', 'HYPOTHESIS', 'COUNTEREVIDENCE', 'UNKNOWN'] as const;
const TARGET_TYPES = ['variable', 'angle', 'thinking'] as const;

type TargetType = typeof TARGET_TYPES[number];
type Label = typeof LABELS[number];

export const consumerObservationCommands = {
  /** Record one reading against one target. */
  record: async (ctx: CommandContext, input: {
    modelId: string; targetType: TargetType; targetKey: string; finding: string;
    label?: Label; value?: string | number | null; confidence?: number | null;
    subjectType?: string | null; subjectId?: string | null; sourceUrl?: string | null;
    observedAt?: string | null; population?: string | null; denominator?: string | null; limitation?: string | null; runRef?: string | null;
  }) => {
    const finding = input.finding?.trim();
    if (!finding) throw new Error('finding is required: record what was seen, not a topic');
    if (!TARGET_TYPES.includes(input.targetType)) throw new Error(`targetType must be one of ${TARGET_TYPES.join('/')}`);
    const targetKey = input.targetKey?.trim();
    if (!targetKey) throw new Error('targetKey is required (a variable key, an angle key or a thinking index)');
    const label = input.label ?? 'HYPOTHESIS';
    if (!LABELS.includes(label)) throw new Error(`label must be one of ${LABELS.join('/')}`);
    if (input.confidence !== undefined && input.confidence !== null && (input.confidence < 0 || input.confidence > 1)) throw new Error('confidence must be between 0 and 1');
    const model = await readConsumerModel(input.modelId);
    const row = {
      id: randomUUID(), modelId: model.id, modelVersion: model.version,
      targetType: input.targetType, targetKey, finding,
      value: input.value === undefined || input.value === null ? null : String(input.value),
      label, confidence: input.confidence ?? null,
      subjectType: input.subjectType ?? null, subjectId: input.subjectId ?? null,
      sourceUrl: input.sourceUrl ?? null, observedAt: input.observedAt ?? null,
      population: input.population ?? null, denominator: input.denominator ?? null,
      limitation: input.limitation ?? null, runRef: input.runRef ?? ctx.workSessionId ?? null,
      createdAt: now()
    };
    db.insert(schema.consumerModelObservations).values(row).run();
    return row;
  },

  /**
   * What the model actually has behind each part of itself: counts per label, counterevidence,
   * and the targets that have never been tested.
   */
  evidence: async (_ctx: CommandContext, input: { modelId: string; limit?: number } = {} as { modelId: string; limit?: number }) => {
    const model = await readConsumerModel(input.modelId);
    const rows = db.select().from(schema.consumerModelObservations).where(eq(schema.consumerModelObservations.modelId, model.id)).all();
    const limit = Math.max(1, Math.min(Math.floor(input.limit ?? 5), 50));
    const bucket = (targetType: TargetType, targetKey: string) => {
      const mine = rows.filter(row => row.targetType === targetType && row.targetKey === targetKey);
      const byLabel: Record<string, number> = {};
      for (const row of mine) byLabel[row.label] = (byLabel[row.label] ?? 0) + 1;
      const subjects = new Set(mine.map(row => row.subjectId).filter(Boolean));
      return {
        observations: mine.length,
        byLabel,
        counterevidence: byLabel.COUNTEREVIDENCE ?? 0,
        subjects: subjects.size,
        latest: mine.map(row => row.createdAt).sort().at(-1) ?? null,
        recentFindings: mine.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit)
          .map(row => ({ finding: row.finding, label: row.label, value: row.value, subject: row.subjectId, source: row.sourceUrl }))
      };
    };
    const variables = (model.variables ?? []).map(variable => ({
      key: String(variable.key), label: String(variable.label ?? variable.key), ...bucket('variable', String(variable.key))
    }));
    const angles = (model.seeds ?? []).map(angle => ({
      key: String(angle.key ?? angle.label), label: angle.label, ...bucket('angle', String(angle.key ?? angle.label))
    }));
    const thinking = (model.thinking ?? []).map((claim, index) => ({
      key: String(index + 1), statement: claim.statement, claimLabel: claim.label ?? 'HYPOTHESIS',
      evidenceRefs: claim.evidenceRefs ?? [], ...bucket('thinking', String(index + 1))
    }));
    const known = new Set([
      ...variables.map(item => `variable:${item.key}`),
      ...angles.map(item => `angle:${item.key}`),
      ...thinking.map(item => `thinking:${item.key}`)
    ]);
    const unknownTargets = [...new Set(rows.map(row => `${row.targetType}:${row.targetKey}`).filter(key => !known.has(key)))];
    const untested = {
      variables: variables.filter(item => item.observations === 0).map(item => item.key),
      angles: angles.filter(item => item.observations === 0).map(item => item.key),
      thinking: thinking.filter(item => item.observations === 0).map(item => item.key)
    };
    const byLabel: Record<string, number> = {};
    for (const row of rows) byLabel[row.label] = (byLabel[row.label] ?? 0) + 1;
    return {
      modelId: model.id, modelVersion: model.version,
      totals: { observations: rows.length, byLabel },
      variables, angles, thinking,
      coverage: {
        variablesTested: variables.filter(item => item.observations > 0).length, variablesTotal: variables.length,
        anglesTested: angles.filter(item => item.observations > 0).length, anglesTotal: angles.length,
        thinkingTested: thinking.filter(item => item.observations > 0).length, thinkingTotal: thinking.length
      },
      untested, unknownTargets,
      caveat: 'Counts are readings, not proof. A variable with many HYPOTHESIS rows is still untested.'
    };
  }
};

export const consumerModelObserveShape = {
  modelId: z.string().min(2).max(64),
  targetType: z.enum(TARGET_TYPES),
  targetKey: z.string().min(1).max(80),
  finding: z.string().min(1).max(2000),
  label: z.enum(LABELS).optional(),
  value: z.union([z.string().max(200), z.number()]).nullable().optional(),
  confidence: z.number().min(0).max(1).nullable().optional(),
  subjectType: z.string().max(40).nullable().optional(),
  subjectId: z.string().max(200).nullable().optional(),
  sourceUrl: z.string().max(2000).nullable().optional(),
  observedAt: z.string().max(40).nullable().optional(),
  population: z.string().max(300).nullable().optional(),
  denominator: z.string().max(200).nullable().optional(),
  limitation: z.string().max(600).nullable().optional(),
  runRef: z.string().max(200).nullable().optional()
};

export const consumerModelEvidenceShape = {
  modelId: z.string().min(2).max(64),
  limit: z.number().int().min(1).max(50).optional()
};
