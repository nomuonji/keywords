import {
  keywordResearchPipeline,
  keywordScreenBatch,
  keywordTreasurySave
} from '@keywords/commands/keyword-research-pipeline';
import {
  treasuryDuplicateCheck,
  treasuryListCommand,
  treasurySearchCommand
} from '@keywords/commands/treasury-query';
import { keywordCapabilityCatalog, resolveKeywordTool } from '@keywords/commands/tool-parity';

const s = (description: string, properties: Record<string, unknown>, required: string[] = []) => ({
  type: 'object' as const,
  description,
  properties,
  required
});

export const keywordFeedbackTools = [
  {
    name: 'keyword_screen_batch',
    description: 'Shared low-cost first-stage keyword screening. Google Ads proxy is tried first, then direct Google Ads fallback. This tool never calls SERP.',
    inputSchema: s('Ads-first keyword screen', {
      projectId: { type: 'string' },
      keywords: { type: 'array', items: { type: 'string' } },
      criteria: { type: 'object', properties: {
        minVolume: { type: 'number' }, minCpcMicros: { type: 'number' }, minCompetitionIndex: { type: 'number' }, maxCompetitionIndex: { type: 'number' }
      }, additionalProperties: false },
      languageConstant: { type: 'string' },
      geoTargetConstants: { type: 'array', items: { type: 'string' } },
      includeAdultKeywords: { type: 'boolean' }
    }, ['projectId', 'keywords'])
  },
  {
    name: 'keyword_research_pipeline',
    description: 'Shared bounded Ads-first pipeline. Google Ads screens the whole batch, then only passing top candidates receive cached/quota-aware SERP checks. Never auto-saves Treasury.',
    inputSchema: s('Bounded keyword research pipeline', {
      projectId: { type: 'string' },
      keywords: { type: 'array', items: { type: 'string' } },
      criteria: { type: 'object', properties: {
        minVolume: { type: 'number' }, minCpcMicros: { type: 'number' }, minCompetitionIndex: { type: 'number' }, maxCompetitionIndex: { type: 'number' }
      }, additionalProperties: false },
      maxSerpChecks: { type: 'number' },
      languageConstant: { type: 'string' },
      geoTargetConstants: { type: 'array', items: { type: 'string' } },
      includeAdultKeywords: { type: 'boolean' },
      country: { type: 'string' },
      language: { type: 'string' },
      location: { type: 'string' },
      num: { type: 'number' },
      provider: { type: 'string', enum: ['brave', 'serper'] }
    }, ['projectId', 'keywords'])
  },
  {
    name: 'keyword_treasury_save',
    description: 'Save only selected evidence-backed keyword candidates to the shared Firestore Treasury. For GSC feedback, preserve source=gsc_feedback and snapshot provenance in evidence.',
    inputSchema: s('Treasury save', {
      projectId: { type: 'string' },
      candidates: { type: 'array', items: { type: 'object', additionalProperties: true } }
    }, ['projectId', 'candidates'])
  },
  {
    name: 'keyword_treasury_search',
    description: 'Search the shared Firestore treasury by demand, CPC, advertising competition, opportunity score, status, seed/theme and research date. Read-only, needs no operation. Use it before researching a name again and to reuse earlier measurements or rejected verdicts.',
    inputSchema: s('Treasury search', {
      query: { type: 'string' },
      seed: { type: 'string' },
      status: { type: 'string', enum: ['inbox', 'shortlisted', 'rejected', 'published'] },
      minVolume: { type: 'number' },
      maxVolume: { type: 'number' },
      minCpc: { type: 'number' },
      maxCpc: { type: 'number' },
      minCompetition: { type: 'number' },
      maxCompetition: { type: 'number' },
      minOpportunityScore: { type: 'number' },
      linkedToSite: { type: 'boolean' },
      researchedAfter: { type: 'string' },
      researchedBefore: { type: 'string' },
      sortBy: { type: 'string', enum: ['updatedAt', 'keyword', 'avgMonthlySearches', 'averageCpcMicros', 'competitionIndex', 'opportunityScore'] },
      sortOrder: { type: 'string', enum: ['asc', 'desc'] },
      pageToken: { type: 'string' },
      limit: { type: 'number' }
    })
  },
  {
    name: 'keyword_treasury_list',
    description: 'Backward-compatible simple list of keyword candidates saved in the Firestore treasury. Read-only, needs no operation.',
    inputSchema: s('Treasury list', {
      status: { type: 'string', enum: ['inbox', 'shortlisted', 'rejected', 'published'] },
      query: { type: 'string' },
      limit: { type: 'number' }
    })
  },
  {
    name: 'keyword_treasury_duplicate_check',
    description: 'Check up to 50 proposed keywords against the treasury in one call and return the existing rows (status, volume, earlier notes). Read-only, needs no operation. Run this before spending Ads or SERP budget on names that may already be measured or rejected.',
    inputSchema: s('Treasury duplicate check', {
      keywords: { type: 'array', items: { type: 'string' } }
    }, ['keywords'])
  },
  {
    name: 'keyword_capability_catalog',
    description: 'Resolve which keyword capability this runtime actually has. Skill text names the remote-era tools (serp_research, keyword_demand_research, search_gap_research, market_discovery_run ...); the local stdio operator uses different names and lacks some of them. Read this before improvising: a capability with empty local[] is unavailable here and must be reported as unverified. Optionally pass a skill tool name to resolve just that one.',
    inputSchema: s('Capability catalog', {
      name: { type: 'string', description: 'Optional skill-era tool name to resolve, e.g. serp_research' }
    })
  }
];

export const isKeywordFeedbackTool = (name: string) => keywordFeedbackTools.some(tool => tool.name === name);

export async function callKeywordFeedbackTool(name: string, args: any) {
  if (!isKeywordFeedbackTool(name)) throw new Error(`Unknown keyword feedback tool: ${name}`);
  const { projectId: _projectId, ...input } = args ?? {};
  if (name === 'keyword_screen_batch') return keywordScreenBatch(input);
  if (name === 'keyword_research_pipeline') return keywordResearchPipeline(input);
  if (name === 'keyword_treasury_search') return treasurySearchCommand(input);
  if (name === 'keyword_treasury_list') return treasuryListCommand(input);
  if (name === 'keyword_treasury_duplicate_check') return treasuryDuplicateCheck(input);
  if (name === 'keyword_capability_catalog') {
    if (typeof input?.name === 'string' && input.name.trim()) {
      const resolved = resolveKeywordTool(input.name);
      return resolved ?? { name: input.name, resolved: false, note: 'Unknown capability name. Call without arguments for the full catalog.' };
    }
    return keywordCapabilityCatalog();
  }
  return keywordTreasurySave(input);
}
