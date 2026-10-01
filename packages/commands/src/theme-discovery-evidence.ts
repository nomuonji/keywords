import { z } from 'zod';
import { publicEvidenceUrl } from './search-gap-research.js';
import type { ThemeDiscovery } from '../../db/src/remote-keyword-schema.js';

const text = z.string().trim().min(1).max(2000);
const time = z.string().datetime({ offset: true });
export const themeDiscoverySchema = z.object({
  siteId: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/).optional(),
  audience: z.string().max(2000).default(''),
  question: z.string().max(2000).default(''),
  observations: z.array(z.object({
    kind: z.enum(['question', 'review', 'gsc', 'competitor', 'other']),
    url: publicEvidenceUrl,
    observedAt: time,
    excerpt: text
  }).strict()).max(20).default([]),
  serpReviews: z.array(z.object({
    query: text,
    provider: z.enum(['brave', 'serper']),
    researchedAt: time,
    pages: z.array(z.object({
      url: publicEvidenceUrl,
      readAt: time,
      excerpt: text,
      coverage: z.enum(['full', 'partial']),
      answers: z.string().max(2000),
      remainingGap: z.string().max(2000)
    }).strict()).min(1).max(5)
  }).strict()).max(10).default([]),
  unmetNeed: z.string().max(4000).default(''),
  deliverable: z.string().max(4000).default(''),
  feasibility: z.string().max(4000).default(''),
  falsification: z.string().max(4000).default(''),
  nextQueries: z.array(z.object({ query: text, reason: text }).strict()).max(10).default([])
}).strict().refine(packet => Buffer.byteLength(JSON.stringify(packet), 'utf8') <= 32000, 'Discovery packet exceeds 32 KB; keep concise excerpts and bounded reviews');

export function assertDiscoveryReady(discovery: ThemeDiscovery | null | undefined) {
  if (!discovery) throw new Error('pilot_ready requires discovery evidence, not repeated narrative challenges');
  const parsed = themeDiscoverySchema.parse(discovery);
  if (![parsed.audience, parsed.question, parsed.unmetNeed, parsed.deliverable, parsed.feasibility, parsed.falsification].every(text => text.trim())) {
    throw new Error('pilot_ready requires audience, question, unmetNeed, deliverable, feasibility and falsification');
  }
  if (!parsed.observations.length || !parsed.serpReviews.some(review => review.pages.some(page => page.remainingGap.trim()))) {
    throw new Error('pilot_ready requires dated observations and a page-body review explaining the remaining gap');
  }
  return parsed;
}
