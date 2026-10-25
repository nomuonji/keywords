import { z } from 'zod';
import { keywordSuggest, type KeywordSuggestInput, type KeywordSuggestResult } from '../../research/src/keyword-suggest.js';

const keywordText = z.string().trim().min(1).max(200);

export const keywordSuggestShape = {
  seeds: z.array(keywordText).min(1).max(5),
  sources: z.array(z.enum(['google', 'youtube', 'ads', 'bing'])).min(1).max(4).default(['google']),
  bingDays: z.number().int().min(7).max(180).optional(),
  expand: z.enum(['none', 'kana', 'alphabet', 'full', 'pre']).optional(),
  position: z.enum(['after', 'before', 'both']).optional(),
  adsMatch: z.enum(['seed', 'any']).optional(),
  modifierPreset: z.enum(['intent_ja', 'intent_en']).optional(),
  modifiers: z.array(keywordText).max(50).optional(),
  includeVolumes: z.union([z.boolean(), z.literal('auto')]).default(false),
  hl: z.string().regex(/^[a-zA-Z]{2,3}(-[a-zA-Z]{2,4})?$/).optional(),
  gl: z.string().regex(/^[a-zA-Z]{2}$/).optional(),
  languageConstant: z.string().optional(),
  geoTargetConstants: z.array(z.string()).optional(),
  minHits: z.number().int().min(1).max(50).default(1),
  limit: z.number().int().min(1).max(1000).default(300)
};

export async function keywordSuggestCommand(input: unknown, deps: { suggest?: (input: KeywordSuggestInput) => Promise<KeywordSuggestResult> } = {}) {
  const { minHits, limit, ...args } = z.object(keywordSuggestShape).strict().parse(input);
  const result = await (deps.suggest ?? keywordSuggest)(args);
  const filtered = result.suggestions.filter(row => row.hits >= minHits || row.sources.includes('ads') || row.sources.includes('bing'));
  return {
    ...result,
    totalBeforeFilter: result.suggestions.length,
    count: Math.min(filtered.length, limit),
    truncated: filtered.length > limit,
    suggestions: filtered.slice(0, limit),
    caveat: 'Autocomplete shows how searches are phrased, not volume. Use includeVolumes or keyword_screen_batch for demand, and serp_research before treating a phrase as an opportunity.'
  };
}
