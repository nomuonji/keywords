import {
  keywordResearchPipeline,
  keywordScreenBatch,
  keywordTreasurySave
} from '@keywords/commands/keyword-research-pipeline';
import {
  localSiteOptimizationCandidate,
  localSiteOptimizationContext,
  localSiteOptimizationCreate,
  localSiteOptimizationMarkImplemented
} from '@keywords/commands/site-optimization-workflow';

const s = (description: string, properties: Record<string, unknown>, required: string[] = []) => ({
  type: 'object' as const,
  description,
  properties,
  required
});

const siteOptimizationTools = [
  {
    name: 'site_optimization_candidate',
    description: 'Read the single strongest fresh article-level GSC decline on the linked Sites record. Uses only complete equal-length saved snapshots and never edits content or creates an optimization.',
    inputSchema: s('Site optimization candidate', {
      projectId: { type: 'string' }
    }, ['projectId'])
  },
  {
    name: 'site_optimization_context',
    description: 'Read one linked article, its saved metrics and active/proposed optimization state before deciding whether a change is allowed.',
    inputSchema: s('Site optimization context', {
      projectId: { type: 'string' },
      articleId: { type: 'string' }
    }, ['projectId', 'articleId'])
  },
  {
    name: 'site_optimization_create',
    description: 'Persist exactly one proposed Sites optimization before editing the mapped article. Baseline period is server-derived from the pinned complete GSC snapshot. Requires an active shared Operation and action budget.',
    inputSchema: s('Create proposed site optimization', {
      projectId: { type: 'string' },
      eventId: { type: 'string' },
      articleId: { type: 'string' },
      baselineSnapshotId: { type: 'string' },
      comparisonSnapshotId: { type: 'string' },
      observation: { type: 'string' },
      diagnosis: { type: 'string' },
      hypothesis: { type: 'string' },
      actionType: { type: 'string', enum: ['content_expand', 'title_snippet', 'internal_links', 'cta_ui', 'freshness', 'indexing', 'new_article', 'other'] },
      beforeCommit: { type: ['string', 'null'] },
      notes: { type: 'string' }
    }, ['projectId', 'eventId', 'articleId', 'baselineSnapshotId', 'observation', 'diagnosis', 'hypothesis', 'actionType'])
  },
  {
    name: 'site_optimization_mark_implemented',
    description: 'Mark a pending proposed Sites optimization implemented after the execution workflow has verified delivery. Requires the real afterCommit; evaluation remains pending for the traffic-aware wait.',
    inputSchema: s('Mark site optimization implemented', {
      projectId: { type: 'string' },
      eventId: { type: 'string' },
      expectedRevision: { type: 'number' },
      afterCommit: { type: 'string' },
      changedAt: { type: 'string' },
      notes: { type: 'string' }
    }, ['projectId', 'eventId', 'expectedRevision', 'afterCommit'])
  }
];

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
  ...siteOptimizationTools
];

export const isKeywordFeedbackTool = (name: string) => keywordFeedbackTools.some(tool => tool.name === name);

export async function callKeywordFeedbackTool(name: string, args: any) {
  if (!isKeywordFeedbackTool(name)) throw new Error(`Unknown keyword feedback/site optimization tool: ${name}`);
  if (name === 'site_optimization_candidate') return localSiteOptimizationCandidate(args);
  if (name === 'site_optimization_context') return localSiteOptimizationContext(args);
  if (name === 'site_optimization_create') return localSiteOptimizationCreate(args);
  if (name === 'site_optimization_mark_implemented') return localSiteOptimizationMarkImplemented(args);
  const { projectId: _projectId, ...input } = args ?? {};
  if (name === 'keyword_screen_batch') return keywordScreenBatch(input);
  if (name === 'keyword_research_pipeline') return keywordResearchPipeline(input);
  return keywordTreasurySave(input);
}
