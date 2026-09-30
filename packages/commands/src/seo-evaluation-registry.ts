import { z } from 'zod';
import type { SeoTaskType } from '../../db/src/site-operations-schema.js';

export const SEO_EVALUATION_REGISTRY_VERSION = '1.0.0';

const evaluatorId = z.string().trim().regex(/^[a-z0-9_]{3,100}$/);
const evaluatorVersion = z.string().trim().regex(/^\d+\.\d+\.\d+$/);
const sourceId = z.string().trim().regex(/^[a-z0-9_]{3,120}$/);
const confidence = z.enum(['low', 'low_to_medium', 'medium', 'medium_to_high', 'high']);
const evaluatorStatus = z.enum(['active', 'experimental', 'retired']);
const evaluatorScope = z.enum(['new_article', 'content_revision', 'portfolio_operations', 'technical']);

export const seoEvaluatorListShape = {
  status: evaluatorStatus.optional(),
  scope: evaluatorScope.optional(),
  includeHistorical: z.boolean().default(false)
};

export const seoEvaluatorGetShape = {
  id: evaluatorId,
  version: evaluatorVersion.optional()
};

export const seoTaskEvaluationShape = z.object({
  evaluatorId,
  evaluatorVersion,
  decision: z.enum(['proceed', 'proceed_with_caveat']),
  confidence,
  evidenceSourceIds: z.array(sourceId).min(1).max(20),
  inference: z.string().trim().min(1).max(2000)
}).strict();

export type SeoTaskEvaluationInput = z.infer<typeof seoTaskEvaluationShape>;

type SeoEvidenceSource = {
  id: string;
  type: 'primary_policy' | 'primary_guidance' | 'research' | 'secondary_analysis' | 'internal_observation';
  title: string;
  url: string | null;
  publishedAt: string | null;
  checkedAt: string;
  strength: 'strong' | 'moderate' | 'indirect';
  supports: string[];
  caveats: string[];
};

type SeoEvaluator = {
  id: string;
  version: string;
  current: boolean;
  title: string;
  status: z.infer<typeof evaluatorStatus>;
  scopes: Array<z.infer<typeof evaluatorScope>>;
  applicableTaskTypes: SeoTaskType[];
  purpose: string;
  decisionRule: string;
  principles: string[];
  hardGates: Array<{ id: string; description: string }>;
  decisionSignals: string[];
  antiMetrics: string[];
  inference: {
    statement: string;
    confidence: z.infer<typeof confidence>;
    caveats: string[];
  };
  evidenceSourceIds: string[];
  falsification: string[];
  reviewTriggers: string[];
  updatedAt: string;
};

const evidenceSources: SeoEvidenceSource[] = [
  {
    id: 'google_scaled_content_policy',
    type: 'primary_policy',
    title: 'Google Web Search spam policies — scaled content abuse',
    url: 'https://developers.google.com/search/docs/essentials/spam-policies#scaled-content',
    publishedAt: null,
    checkedAt: '2026-10-01',
    strength: 'strong',
    supports: [
      'Scaled content abuse is defined by search-manipulation purpose and low user value, not by whether AI was used.',
      'Google explicitly lists mass generation without user value and distribution across multiple sites to conceal scale as examples.'
    ],
    caveats: [
      'The policy describes prohibited practices, not a complete list of ranking signals or enforcement implementation details.'
    ]
  },
  {
    id: 'google_ai_content_guidance',
    type: 'primary_guidance',
    title: 'Google Search guidance about AI-generated content',
    url: 'https://developers.google.com/search/blog/2023/02/google-search-and-ai-content',
    publishedAt: '2023-02-08',
    checkedAt: '2026-10-01',
    strength: 'strong',
    supports: [
      'Google states that appropriate AI or automation use is not inherently against Search guidelines.',
      'Google emphasizes original, high-quality, people-first content and says spam systems analyze patterns and signals regardless of production method.'
    ],
    caveats: [
      'This is public guidance and does not expose proprietary ranking or spam-detection thresholds.'
    ]
  },
  {
    id: 'google_research_safe_2026',
    type: 'research',
    title: 'The Synthetic Gap: Automating Forensic Investigation of "AI Slop" with the Scaled Abuse Forensics Examiner (SAFE)',
    url: 'https://research.google/pubs/the-synthetic-gap-automating-forensic-investigation-of-ai-slop-with-the-scaled-abuse-forensics-examiner-safe/',
    publishedAt: '2026',
    checkedAt: '2026-10-01',
    strength: 'indirect',
    supports: [
      'Google researchers describe a multi-agent forensic system combining content, behavior, and cross-channel relationship analysis for adversarial synthetic media.',
      'The paper is evidence that operation-level and relationship-level abuse analysis is technically relevant inside Google abuse research.'
    ],
    caveats: [
      'The research is about adversarial synthetic media and online-platform abuse, especially video/channel clusters.',
      'It does not establish that SAFE is used by Google Search ranking or the Search spam update.'
    ]
  },
  {
    id: 'sej_safe_2026',
    type: 'secondary_analysis',
    title: 'Search Engine Journal — Google Has Deployed A New AI Spam Detector Called SAFE',
    url: 'https://www.searchenginejournal.com/google-has-deployed-a-new-ai-spam-detector-called-safe/590918/',
    publishedAt: '2026-09-25',
    checkedAt: '2026-10-01',
    strength: 'indirect',
    supports: [
      'Provides the secondary-source interpretation that SAFE may be relevant to Google anti-spam activity.'
    ],
    caveats: [
      'This is not a Google Search policy or deployment announcement.',
      'Its connection between SAFE and the Search spam update is interpretive and must not be stored as established fact.'
    ]
  }
];

const evaluators: SeoEvaluator[] = [
  {
    id: 'content_incremental_value',
    version: '1.0.0',
    current: true,
    title: 'Incremental content value gate',
    status: 'active',
    scopes: ['new_article', 'content_revision'],
    applicableTaskTypes: ['new_article', 'revise', 'merge', 'delete'],
    purpose: 'Prevent the operator from equating publishable text or keyword coverage with a justified page. Require a concrete user-value thesis before content work is queued.',
    decisionRule: 'For new content or substantial content expansion, proceed only when the task can state a concrete incremental value over existing site/web coverage and a verification path. AI authorship alone is neither a positive nor negative factor.',
    principles: [
      'Judge the user value and search-manipulation risk of the output, not whether AI produced it.',
      'Prefer a specific information, utility, comparison, evidence, or navigation gain over generic completeness.',
      'Treat an inability to articulate incremental value as a reason to improve an existing page or choose another intervention instead of publishing by default.'
    ],
    hardGates: [
      { id: 'no_incremental_user_value', description: 'No concrete user-facing value can be named beyond paraphrasing, recombining, or templating existing coverage.' },
      { id: 'search_manipulation_primary_purpose', description: 'The primary rationale is filling keywords/URLs at scale rather than satisfying a defensible user need.' },
      { id: 'material_claims_without_verification_path', description: 'The proposed page depends on material factual claims that the Worker cannot verify from suitable sources.' }
    ],
    decisionSignals: [
      'A clearly identified unanswered or poorly served user intent.',
      'Original synthesis, comparison, calculation, first-party data, primary-source interpretation, tooling, examples, or other concrete utility.',
      'A bounded change that is meaningfully different from existing portfolio pages.',
      'Source quality appropriate to the factual stakes of the topic.'
    ],
    antiMetrics: [
      'Article count',
      'Word count',
      'Keyword count',
      'Tasks completed',
      'Publishing velocity by itself'
    ],
    inference: {
      statement: 'Sites Operator should use a qualitative incremental-value gate as an internal operating control because Google policy targets scaled low-value search manipulation while explicitly allowing useful AI-assisted content.',
      confidence: 'medium_to_high',
      caveats: [
        'Incremental value is an internal decision framework, not a claimed Google ranking factor.',
        'A page can be useful without being radically novel; the gate should reject low-value duplication, not demand artificial novelty.'
      ]
    },
    evidenceSourceIds: ['google_scaled_content_policy', 'google_ai_content_guidance'],
    falsification: [
      'Repeated controlled portfolio outcomes show that this gate systematically blocks useful compliant pages without reducing duplication or improving user/search outcomes.',
      'Google materially revises its public policy so that production method, rather than value/purpose, becomes the controlling rule.'
    ],
    reviewTriggers: [
      'Material Google Search spam/helpful-content policy change.',
      'A major portfolio-wide performance shift that contradicts the current operational assumptions.',
      'Evidence that the gate is being gamed through formulaic "incremental value" boilerplate.'
    ],
    updatedAt: '2026-10-01'
  },
  {
    id: 'scaled_content_operation_risk',
    version: '1.0.0',
    current: true,
    title: 'Scaled-content operation risk',
    status: 'experimental',
    scopes: ['new_article', 'content_revision', 'portfolio_operations'],
    applicableTaskTypes: ['new_article', 'revise'],
    purpose: 'Make cross-site production-pattern risk visible without pretending that an unpublished Google Search detection model is known.',
    decisionRule: 'Use this evaluator as a cautionary portfolio lens, never as a standalone blocking rule. A task should be blocked only when primary Search policy or direct evidence independently supports the decision.',
    principles: [
      'Cross-site templating, semantic overlap, and synchronized volume can be operational risk indicators when they coincide with low user value.',
      'Do not infer a penalty merely from shared infrastructure, automation, or AI use.',
      'Separate confirmed Google Search policy from analogies drawn from broader Google abuse research.'
    ],
    hardGates: [],
    decisionSignals: [
      'Substantial semantic or structural overlap across multiple managed sites without a user-facing reason.',
      'High publishing velocity coupled with weak source usage or thin value-add.',
      'Repeated page families that differ mainly by keyword/entity substitution.',
      'Portfolio behavior that appears designed to distribute or conceal essentially duplicated scaled content.'
    ],
    antiMetrics: [
      'Raw publication count',
      'Use of AI',
      'Shared templates or infrastructure by themselves',
      'A single-site similarity observation without portfolio context'
    ],
    inference: {
      statement: 'Operation-level patterns may become increasingly useful for abuse detection, so Sites Operator should monitor portfolio behavior in addition to page text; however SAFE is not evidence of a Google Search ranking or spam-deployment mechanism.',
      confidence: 'low_to_medium',
      caveats: [
        'SAFE is research on adversarial synthetic media and coordinated channel abuse, not a Search ranking paper.',
        'The Search Engine Journal connection to the September 2026 spam update is secondary-source interpretation.',
        'This evaluator must not turn circumstantial similarity into a claim of Google enforcement.'
      ]
    },
    evidenceSourceIds: ['google_scaled_content_policy', 'google_ai_content_guidance', 'google_research_safe_2026', 'sej_safe_2026'],
    falsification: [
      'Google explicitly states that the inferred operation-level pattern class is not used for Search abuse enforcement.',
      'Sustained internal evidence shows that the flagged portfolio patterns have no relationship to low-value duplication or adverse outcomes while user value remains strong.',
      'New primary evidence provides a materially different explanation for SAFE or Search spam enforcement.'
    ],
    reviewTriggers: [
      'New Google Search spam update documentation or public enforcement guidance.',
      'New Google Research publication connecting operation-level synthetic-abuse analysis directly to Search.',
      'Meaningful internal evidence of cross-site duplication, deindexing, or traffic changes associated with these patterns.'
    ],
    updatedAt: '2026-10-01'
  }
];

function resolveEvaluator(id: string, version?: string) {
  const matches = evaluators.filter(item => item.id === id);
  const evaluator = version ? matches.find(item => item.version === version) : matches.find(item => item.current);
  if (!evaluator) throw new Error(version ? `SEO evaluator not found: ${id}@${version}` : `SEO evaluator not found: ${id}`);
  return evaluator;
}

function sourceMap() {
  return new Map(evidenceSources.map(source => [source.id, source]));
}

export function seoEvaluatorList(input: unknown) {
  const args = z.object(seoEvaluatorListShape).strict().parse(input);
  const items = evaluators
    .filter(item => (args.includeHistorical || item.current) && (!args.status || item.status === args.status) && (!args.scope || item.scopes.includes(args.scope)))
    .map(item => ({
      id: item.id,
      version: item.version,
      current: item.current,
      title: item.title,
      status: item.status,
      scopes: item.scopes,
      applicableTaskTypes: item.applicableTaskTypes,
      purpose: item.purpose,
      inferenceConfidence: item.inference.confidence,
      updatedAt: item.updatedAt
    }));
  return {
    registryVersion: SEO_EVALUATION_REGISTRY_VERSION,
    epistemicRule: 'Evaluators are versioned operating hypotheses, not claims that Google ranking internals are known. Primary sources outrank research analogies and secondary commentary.',
    items
  };
}

export function seoEvaluatorGet(input: unknown) {
  const args = z.object(seoEvaluatorGetShape).strict().parse(input);
  const evaluator = resolveEvaluator(args.id, args.version);
  const sources = sourceMap();
  return {
    registryVersion: SEO_EVALUATION_REGISTRY_VERSION,
    evaluator,
    evidence: evaluator.evidenceSourceIds.map(id => sources.get(id)).filter((item): item is SeoEvidenceSource => Boolean(item))
  };
}

export function assertSeoTaskEvaluation(input: unknown, taskType: SeoTaskType) {
  const parsed = seoTaskEvaluationShape.parse(input);
  const evaluator = resolveEvaluator(parsed.evaluatorId, parsed.evaluatorVersion);
  if (!evaluator.current) throw new Error(`SEO task evaluation must use the current evaluator version: ${evaluator.id}`);
  if (evaluator.status === 'retired') throw new Error(`SEO evaluator is retired: ${evaluator.id}@${evaluator.version}`);
  if (!evaluator.applicableTaskTypes.includes(taskType)) throw new Error(`SEO evaluator ${evaluator.id}@${evaluator.version} does not apply to taskType=${taskType}`);
  const allowedSources = new Set(evaluator.evidenceSourceIds);
  for (const id of parsed.evidenceSourceIds) {
    if (!allowedSources.has(id)) throw new Error(`Evidence source ${id} is not registered for ${evaluator.id}@${evaluator.version}`);
  }
  return parsed;
}

export function seoEvaluatorContextSummary() {
  return {
    registryVersion: SEO_EVALUATION_REGISTRY_VERSION,
    sourceOfTruth: 'versioned_git_registry',
    rule: 'Treat evaluator conclusions as revisable operational hypotheses. Preserve source IDs, confidence, inference, falsification criteria, and version in durable task records when an evaluator materially informs the decision.',
    scoring: 'No composite SEO score. Hard gates are explicit; softer signals remain qualitative evidence.',
    currentEvaluators: evaluators.filter(item => item.current).map(item => ({
      id: item.id,
      version: item.version,
      status: item.status,
      scopes: item.scopes,
      inferenceConfidence: item.inference.confidence
    }))
  };
}
