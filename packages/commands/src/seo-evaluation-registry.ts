import { z } from 'zod';
import type { SeoTaskType } from '../../db/src/site-operations-schema.js';

export const SEO_EVALUATION_REGISTRY_VERSION = '1.2.0';

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
    id: 'google_faceted_navigation_guidance',
    type: 'primary_guidance',
    title: 'Google Crawling Infrastructure — Managing crawling of faceted navigation URLs',
    url: 'https://developers.google.com/crawling/docs/faceted-navigation',
    publishedAt: null,
    checkedAt: '2026-10-03',
    strength: 'strong',
    supports: [
      'Faceted navigation can create very large or effectively infinite URL spaces that waste crawl resources and delay discovery of useful URLs.',
      'When faceted URLs do not need to appear in Search, Google recommends preventing crawling rather than exposing every generated combination.'
    ],
    caveats: [
      'This is crawl-management guidance, not a statement that faceted navigation or database-backed sites are inherently penalized.'
    ]
  },
  {
    id: 'google_canonicalization_guidance',
    type: 'primary_guidance',
    title: 'Google Search Central — What is URL canonicalization',
    url: 'https://developers.google.com/search/docs/crawling-indexing/canonicalization',
    publishedAt: null,
    checkedAt: '2026-10-03',
    strength: 'strong',
    supports: [
      'Duplicate and near-duplicate URLs can be consolidated through canonicalization signals instead of being treated as distinct search pages.',
      'Sorting, filtering, parameters and alternate URL forms are common sources of duplicate or near-duplicate content.'
    ],
    caveats: [
      'Canonicalization consolidates duplicate signals; it does not convert a low-value page family into useful search content.'
    ]
  },
  {
    id: 'google_crawl_budget_guidance',
    type: 'primary_guidance',
    title: 'Google Crawling Infrastructure — Crawl budget management for large sites',
    url: 'https://developers.google.com/crawling/docs/crawl-budget',
    publishedAt: null,
    checkedAt: '2026-10-03',
    strength: 'strong',
    supports: [
      'Crawl-budget optimization is mainly relevant to very large or very frequently changing sites; smaller sites should not assume crawl budget is the root cause of weak Search performance.',
      'Crawl demand and crawl capacity are separate from whether a URL is ultimately useful enough to index and rank.'
    ],
    caveats: [
      'Google gives approximate large-site thresholds rather than a universal page-count cutoff.'
    ]
  },
  {
    id: 'google_internal_link_structure_guidance',
    type: 'primary_guidance',
    title: 'Google Search Central — Help Google understand your ecommerce site structure',
    url: 'https://developers.google.com/search/docs/specialty/ecommerce/help-google-understand-your-ecommerce-site-structure',
    publishedAt: null,
    checkedAt: '2026-10-03',
    strength: 'strong',
    supports: [
      'Google uses link relationships to discover pages and understand site structure and relative importance.',
      'There is no public Google rule that a database site is harmed simply because it contains many internal links; the practical concern is which URLs those links expose and emphasize.'
    ],
    caveats: [
      'The document is written for ecommerce, but the internal-link discovery and site-structure principles are applicable to other large structured sites.'
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
    id: 'database_indexation_quality',
    version: '1.0.0',
    current: true,
    title: 'Database indexation and URL-surface quality',
    status: 'active',
    scopes: ['portfolio_operations', 'technical'],
    applicableTaskTypes: ['technical', 'site_expansion', 'data_expansion', 'schema_expansion'],
    purpose: 'Keep structured/database sites from equating generatable URLs, records, filters or internal-link volume with URLs that should be crawlable and indexable.',
    decisionRule: 'For database/programmatic page families, explicitly separate the data corpus from the indexable URL surface. Index a generated page family only when each public search page represents a recurring user need and provides distinct decision, navigation, comparison, evidence or explanatory value beyond recombining metadata. Control crawl/index exposure for arbitrary filters, sort orders and near-duplicate permutations.',
    principles: [
      'A database may contain many records without exposing every record or permutation as an indexable Search URL.',
      'Internal-link count by itself is not a penalty signal; evaluate which URLs the links expose, how they communicate hierarchy, and whether they create low-value crawl surfaces.',
      'Treat faceted navigation, filters, sort orders and parameter combinations as crawl/index architecture problems before treating them as SEO page opportunities.',
      'Use canonicalization for genuine duplicates or alternate URL forms, not as a substitute for deciding whether a page family has user value.',
      'Do not blame crawl budget by default on modest inventories; first distinguish crawl discovery, indexing quality, demand and page value.',
      'Prefer a deliberate indexable allowlist/page-family contract over publishing every technically generatable route.'
    ],
    hardGates: [
      { id: 'arbitrary_permutation_indexing', description: 'The proposal would index filter/sort/facet combinations primarily because they can be generated, without a demonstrated recurring user/search need.' },
      { id: 'near_duplicate_page_family', description: 'The generated page family differs mainly by metadata recombination, ordering or entity substitution and lacks distinct user-facing value.' },
      { id: 'unbounded_url_space', description: 'Navigation or parameters can expose an unbounded or combinatorial crawl surface without an explicit crawl/index control strategy.' }
    ],
    decisionSignals: [
      'A documented indexable page-family contract that names who the page is for, what decision/question it answers, and why it deserves a stable URL.',
      'Clear separation between data records, UI-only filters, crawlable routes and indexable routes.',
      'A finite curated hub/pathway structure that helps users discover useful records without exposing arbitrary permutations.',
      'Canonical, robots, sitemap and internal-link behavior are consistent with the intended indexable set.',
      'Large existing inventories are evaluated by page-family value and observed search/user behavior rather than raw URL count.'
    ],
    antiMetrics: [
      'Total database record count',
      'Total internal-link count by itself',
      'Total generated URL count',
      'Percent of records with a public route',
      'Crawl budget as a default explanation for weak performance on modest-sized sites'
    ],
    inference: {
      statement: 'For structured sites, the operating risk comes from exposing low-value or duplicate URL surfaces at scale, not from database architecture or internal-link volume by themselves. Sites Operator should therefore treat indexation as a curated product surface separate from the underlying dataset.',
      confidence: 'high',
      caveats: [
        'This is an operational synthesis of Google crawl, canonicalization, linking and spam guidance; Google does not publish a single metric called database indexation quality.',
        'A useful database may legitimately have many indexable pages when individual pages satisfy real user needs and remain technically well controlled.',
        'No universal page-count or link-count threshold is asserted.'
      ]
    },
    evidenceSourceIds: [
      'google_faceted_navigation_guidance',
      'google_canonicalization_guidance',
      'google_crawl_budget_guidance',
      'google_internal_link_structure_guidance',
      'google_scaled_content_policy'
    ],
    falsification: [
      'Google materially changes its public crawl/index guidance so that arbitrary filter/permutation indexing is recommended for discovery.',
      'Repeated portfolio evidence shows that deliberate index-surface curation systematically harms useful database discovery without reducing duplicate/low-value exposure.',
      'A future primary source establishes a direct penalty based on raw internal-link count or database-backed architecture independent of page value and URL behavior.'
    ],
    reviewTriggers: [
      'Material Google update to faceted-navigation, canonicalization, crawl-budget or large-site internal-link guidance.',
      'A database site shows a large gap between generated URLs, crawled URLs and indexed/observed useful pages.',
      'A new page family would materially increase parameterized, faceted or programmatically generated URLs.'
    ],
    updatedAt: '2026-10-03'
  },
  {
    id: 'scaled_content_operation_risk',
    version: '1.0.0',
    current: false,
    title: 'Scaled-content operation risk',
    status: 'experimental',
    scopes: ['new_article', 'content_revision', 'portfolio_operations'],
    applicableTaskTypes: ['new_article', 'revise'],
    purpose: 'Historical experimental portfolio-risk lens retained for provenance.',
    decisionRule: 'Use as a cautionary portfolio lens only; this historical version cannot independently block work.',
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
    antiMetrics: ['Raw publication count','Use of AI','Shared templates or infrastructure by themselves','A single-site similarity observation without portfolio context'],
    inference: {
      statement: 'Operation-level patterns may be relevant to abuse detection, but this version did not have enough direct portfolio evidence to act as a hard operational gate.',
      confidence: 'low_to_medium',
      caveats: ['SAFE is not evidence of a Google Search ranking/spam deployment mechanism.']
    },
    evidenceSourceIds: ['google_scaled_content_policy','google_ai_content_guidance','google_research_safe_2026','sej_safe_2026'],
    falsification: ['New primary evidence materially changes the interpretation of scaled-content risk.'],
    reviewTriggers: ['Meaningful internal evidence of cross-site duplication, deindexing, or traffic changes associated with these patterns.'],
    updatedAt: '2026-10-01'
  },
  {
    id: 'scaled_content_operation_risk',
    version: '1.1.0',
    current: true,
    title: 'Scaled-content operation and recovery risk',
    status: 'active',
    scopes: ['new_article', 'content_revision', 'portfolio_operations'],
    applicableTaskTypes: ['new_article','revise','merge','delete','internal_links','technical','site_expansion','data_expansion','schema_expansion'],
    purpose: 'Make scaled-content risk a first-class portfolio operating constraint when primary Search policy and direct portfolio observations justify a recovery response, without claiming knowledge of Google\'s private enforcement mechanism.',
    decisionRule: 'When durable Sites Operator recovery mode is active because direct portfolio evidence shows broad indexation/visibility deterioration, suspend net-new Search-surface expansion by default. Allow only bounded repair, consolidation, quality, internal-link, or technical work until a site is explicitly cleared for the active incident. This is a risk-control decision, not a causal claim that a specific Google update penalized the site.',
    principles: [
      'Primary Google Search policy and direct portfolio observations outrank speculative abuse-detection analogies.',
      'A broad cross-site indexation or visibility collapse is sufficient reason to stop adding Search surface while diagnosis is unresolved.',
      'Recovery work should reduce low-value duplication, strengthen unique user value, repair verified technical defects, and clarify the intended indexable surface.',
      'Do not infer that AI use, shared infrastructure, or raw publishing volume alone caused the incident.',
      'Do not resume growth merely because a page was rewritten; require explicit site clearance backed by fresh indexation and search evidence.'
    ],
    hardGates: [
      { id: 'active_recovery_growth_freeze', description: 'While durable portfolio recovery mode is active, new_article/site_expansion/data_expansion/schema_expansion are blocked unless the site is cleared for the current incident.' },
      { id: 'keyword_substitution_without_value', description: 'Do not create or preserve page families that mainly substitute entities/keywords without distinct user-facing utility.' },
      { id: 'scale_pressure_overrides_user_value', description: 'Task-buffer or publishing-volume targets cannot justify adding Search surface during recovery.' }
    ],
    decisionSignals: [
      'Multiple managed sites show broad URL Inspection exclusion or a sudden Search visibility collapse in the same operating period.',
      'Pages or page families were created in synchronized batches around keyword/entity permutations with weak incremental value.',
      'A site has a narrow, source-backed, distinctive product surface worth protecting rather than indiscriminately shrinking.',
      'Consolidation can reduce overlap while preserving a stronger destination and redirect path.',
      'Fresh indexation plus complete Search observations show sustained recovery sufficient for explicit site clearance.'
    ],
    antiMetrics: [
      'Raw article count',
      'Raw task count',
      'Use of AI by itself',
      'One URL Inspection result by itself',
      'A single week of improvement as automatic recovery proof'
    ],
    inference: {
      statement: 'Given Google\'s public scaled-content policy and direct portfolio evidence of broad deindexation/visibility deterioration, a temporary growth freeze is a prudent internal control until each site demonstrates recovery. The control does not assert which Google system caused the deterioration.',
      confidence: 'medium_to_high',
      caveats: [
        'The September 2026 spam update is temporally relevant but causality is not established.',
        'URL Inspection reports the inspected URL state and must not be generalized beyond the observed inventory.',
        'Some affected sites may have unrelated technical, topic, adult-content, or quality causes and require separate diagnosis.'
      ]
    },
    evidenceSourceIds: ['google_scaled_content_policy','google_ai_content_guidance'],
    falsification: [
      'Direct portfolio evidence shows the sites remained broadly indexed and visible despite the incident observations being corrected as measurement error.',
      'Google materially revises public scaled-content policy in a way that makes the recovery control inappropriate.',
      'Repeated recovery outcomes show that the freeze creates harm without reducing duplicated/low-value Search surfaces or improving durable indexation.'
    ],
    reviewTriggers: [
      'Google marks the September 2026 spam update complete or publishes additional relevant guidance.',
      'A managed site reaches its explicit recovery release criteria.',
      'A new cross-site indexation snapshot materially contradicts the incident diagnosis.',
      'The portfolio returns to normal mode.'
    ],
    updatedAt: '2026-10-08'
  }];

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
