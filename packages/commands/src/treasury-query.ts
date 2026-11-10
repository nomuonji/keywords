import { z } from 'zod';
import { treasuryList, treasurySearch } from '../../keyword-treasury/src/index.js';

const statusShape = z.enum(['inbox', 'shortlisted', 'rejected', 'published']);

/**
 * Same surface as the remote operator's keyword_treasury_search so an agent
 * written against either MCP reads the same treasury. The local stdio MCP only
 * exposed keyword_treasury_save, which made duplicate checking and reject-memory
 * impossible in local sessions without a bespoke script.
 */
const treasurySearchShape = z.object({
  query: z.string().max(300).optional(),
  seed: z.string().max(300).optional(),
  status: statusShape.optional(),
  minVolume: z.number().min(0).optional(),
  maxVolume: z.number().min(0).optional(),
  minCpc: z.number().min(0).optional(),
  maxCpc: z.number().min(0).optional(),
  minCompetition: z.number().min(0).max(100).optional(),
  maxCompetition: z.number().min(0).max(100).optional(),
  minOpportunityScore: z.number().min(0).max(100).optional(),
  linkedToSite: z.boolean().optional(),
  researchedAfter: z.string().max(40).optional(),
  researchedBefore: z.string().max(40).optional(),
  sortBy: z.enum(['updatedAt', 'keyword', 'avgMonthlySearches', 'averageCpcMicros', 'competitionIndex', 'opportunityScore']).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional(),
  pageToken: z.string().max(2000).optional(),
  limit: z.number().int().min(1).max(100).optional()
}).strict();

const treasuryListShape = z.object({
  status: statusShape.optional(),
  query: z.string().max(300).optional(),
  limit: z.number().int().min(1).max(100).optional()
}).strict();

export async function treasurySearchCommand(input: unknown) {
  const args = treasurySearchShape.parse(input ?? {});
  return treasurySearch(args);
}

export async function treasuryListCommand(input: unknown) {
  const args = treasuryListShape.parse(input ?? {});
  return treasuryList(args);
}

/**
 * Duplicate check for a batch of proposed keywords. Returns the treasury rows
 * that already exist for any of them so a run does not re-research, or silently
 * re-propose, names that were already measured or rejected.
 */
export async function treasuryDuplicateCheck(input: unknown) {
  const args = z.object({ keywords: z.array(z.string().min(1).max(500)).min(1).max(50) }).strict().parse(input);
  const found = [];
  for (const keyword of args.keywords) {
    const result = await treasurySearch({ query: keyword, limit: 5 });
    const exact = result.items.filter(item => String(item.keyword).toLocaleLowerCase().normalize('NFKC') === keyword.toLocaleLowerCase().normalize('NFKC'));
    if (exact.length) found.push({ keyword, matches: exact.map(item => ({ id: item.id, keyword: item.keyword, status: item.status, volume: item.avgMonthlySearches ?? item.volume ?? null, notes: item.notes?.slice(0, 400) ?? null })) });
  }
  return { checked: args.keywords.length, matched: found.length, found };
}
