/**
 * Firestore control-plane models for deployed sites.
 *
 * SiteConcepts remain in siteStructures. These records describe real sites and
 * their operating history. Article bodies intentionally do not live here: the
 * Git repository + repoPath/currentCommitSha are the source of truth.
 */
export type SiteStatus = 'planned' | 'building' | 'active' | 'paused' | 'archived';
export type SiteDeploymentProvider = 'vercel' | 'cloudflare_pages' | 'github_pages' | 'other';

export type SiteRecord = {
  id: string;
  siteConceptId: string | null;
  /** Existing SQLite `projects.id`; explicit bridge, never inferred from names. */
  localProjectId: string | null;
  name: string;
  repository: string;
  productionUrl: string;
  deploymentProvider: SiteDeploymentProvider;
  ga4PropertyId: string | null;
  searchConsoleProperty: string | null;
  status: SiteStatus;
  revision: number;
  createdAt: string;
  updatedAt: string;
};

export type SiteArticleStatus = 'draft' | 'published' | 'paused' | 'archived';
export type SiteArticleRecord = {
  id: string;
  siteId: string;
  /** Existing SQLite `pages.id`; optional explicit bridge for article-level metrics. */
  localPageId: string | null;
  canonicalUrl: string | null;
  repo: string;
  repoPath: string;
  currentCommitSha: string | null;
  slug: string;
  title: string;
  primaryKeywordId: string | null;
  secondaryKeywordIds: string[];
  status: SiteArticleStatus;
  publishedAt: string | null;
  lastUpdatedAt: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
};

export type MetricProvider = 'gsc' | 'ga4';
export type MetricSnapshot = {
  id: string;
  siteId: string;
  articleId: string | null;
  provider: MetricProvider;
  periodStart: string;
  periodEnd: string;
  metrics: Record<string, number | null>;
  queries: Array<{
    query: string;
    clicks: number | null;
    impressions: number | null;
    ctr: number | null;
    averagePosition: number | null;
  }>;
  completeness: 'complete' | 'partial' | 'failed';
  sourceVersion: string;
  capturedAt: string;
  createdAt: string;
};

export type OptimizationActionType =
  | 'content_expand'
  | 'title_snippet'
  | 'internal_links'
  | 'cta_ui'
  | 'freshness'
  | 'indexing'
  | 'new_article'
  | 'other';
export type OptimizationPhase = 'proposed' | 'implemented' | 'evaluated' | 'cancelled';
export type OptimizationResult = 'pending' | 'improved' | 'neutral' | 'worsened' | 'inconclusive';

export type OptimizationEvent = {
  id: string;
  siteId: string;
  articleId: string;
  observation: string;
  diagnosis: string;
  hypothesis: string;
  actionType: OptimizationActionType;
  beforeCommit: string | null;
  afterCommit: string | null;
  baselinePeriod: { start: string; end: string };
  changedAt: string | null;
  evaluateAfter: string | null;
  phase: OptimizationPhase;
  result: OptimizationResult;
  evaluationMetrics: Record<string, number | null>;
  notes: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
};


export type SeoTaskType = 'revise' | 'merge' | 'delete' | 'internal_links' | 'technical' | 'new_article';
/** ready is the record-only planner handoff; proposed/issued are retained for historical records. */
export type SeoTaskStatus = 'proposed' | 'ready' | 'issued' | 'in_progress' | 'completed' | 'cancelled' | 'superseded';
export type SeoTaskPriority = 'high' | 'medium' | 'low';
export type SeoTaskDeploymentVerificationStatus = 'pending' | 'verified' | 'failed' | 'not_required';
export type SeoTaskDeploymentVerification = {
  status: SeoTaskDeploymentVerificationStatus;
  checkedAt: string | null;
  productionUrl: string | null;
  deployedCommitSha: string | null;
  detail: string;
};

export type SeoTaskHistoryEntry = {
  at: string;
  actor: string;
  event: string;
  detail: string;
};

export type SeoTaskRecord = {
  id: string;
  siteId: string;
  articleIds: string[];
  targetUrls: string[];
  repo: string;
  taskType: SeoTaskType;
  status: SeoTaskStatus;
  priority: SeoTaskPriority;
  title: string;
  rationale: string;
  evidence: string[];
  dedupeKey: string;
  /** Optional historical GitHub Issue reference; no longer required for newly planned tasks. */
  issueNumber: number | null;
  issueUrl: string | null;
  issueState: 'open' | 'closed' | null;
  resultCommitSha: string | null;
  executionSummary: string;
  /** Separate from implementation status: completed means merged to main; this records optional production verification. */
  deploymentVerification: SeoTaskDeploymentVerification;
  history: SeoTaskHistoryEntry[];
  createdBy: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};
