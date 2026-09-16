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
