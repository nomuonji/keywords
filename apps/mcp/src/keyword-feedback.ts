import {
  keywordResearchPipeline,
  keywordScreenBatch,
  keywordTreasurySave
} from '@keywords/commands/keyword-research-pipeline';

const string = { type: 'string' };
const number = { type: 'number' };
const boolean = { type: 'boolean' };
const stringArray = { type: 'array', items: string };
const criteria = {
  type: 'object',
  properties: {
    minVolume: number,
    minCpcMicros: number,
    minCompetitionIndex: number,
    maxCompetitionIndex: number
  },
  additionalProperties: false
};

export const keywordFeedbackTools = [
  {
    name: 'keyword_screen_batch',
    description: 'Shared low-cost first-stage keyword screening. Google Ads proxy is tried first, then direct Google Ads fallback. This tool never calls SERP.',
    inputSchema: {
      type: 'object' as const,
      properties: { projectId: string, keywords: stringArray, criteria, languageConstant: string, geoTargetConstants: stringArray, includeAdultKeywords: boolean },
      required: ['projectId', 'keywords']
    }
  },
  {
    name: 'keyword_research_pipeline',
    description: 'Shared bounded Ads-first pipeline. Google Ads screens the whole batch, then only passing top candidates receive cached/quota-aware SERP checks. Never auto-saves Treasury.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectId: string, keywords: stringArray, criteria, maxSerpChecks: number,
        languageConstant: string, geoTargetConstants: stringArray, includeAdultKeywords: boolean,
        country: string, language: string, location: string, num: number, provider: { type: 'string', enum: ['brave', 'serper'] }
      },
      required: ['projectId', 'keywords']
    }
  },
  {
    name: 'keyword_treasury_save',
    description: 'Save only selected evidence-backed keyword candidates to the shared Firestore Treasury. For GSC feedback, preserve source=gsc_feedback and snapshot provenance in evidence.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectId: string,
        candidates: { type: 'array', items: { type: 'object', additionalProperties: true } }
      },
      required: ['projectId', 'candidates']
    }
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
