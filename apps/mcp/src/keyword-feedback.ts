import {
  keywordResearchPipeline,
  keywordScreenBatch,
  keywordTreasurySave
} from '@keywords/commands/keyword-research-pipeline';

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
  }
];

export const isKeywordFeedbackTool = (name: string) => keywordFeedbackTools.some(tool => tool.name === name);

export async function callKeywordFeedbackTool(name: string, args: any) {
  if (!isKeywordFeedbackTool(name)) throw new Error(`Unknown keyword feedback tool: ${name}`);
  const { projectId: _projectId, ...input } = args ?? {};
  if (name === 'keyword_screen_batch') return keywordScreenBatch(input);
  if (name === 'keyword_research_pipeline') return keywordResearchPipeline(input);
  return keywordTreasurySave(input);
}
