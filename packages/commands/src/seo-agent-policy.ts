import { z } from 'zod';

export const SEO_AGENT_POLICY_VERSION = '1.0.0';

export const seoAgentContextShape = {
  role: z.enum(['planner', 'executor']).default('planner')
};

const shared = {
  architecture: {
    sitesOperator: 'Canonical control plane for agent-managed production sites, compact analytics planning digests, SEO task records, and optimization history.',
    github: 'Canonical source for article/code bodies, implementation changes, Issues, commits, PRs, and deploy evidence.',
    siteMonitor: 'Human-only portfolio dashboard. Never use it as an agent planning or execution source.',
    myPortal: 'Not part of this SEO operating flow.',
    keywordsOperator: 'Optional specialist for keyword demand/SERP research only when the Sites Operator evidence indicates that demand research can materially change a decision.'
  },
  measurement: {
    acquisition: 'Externalized. Agents must not spend a planning run fetching Google Analytics or Search Console directly.',
    planningSource: 'Use the latest Sites Operator compact SEO planning digest.',
    requiredWindows: ['7d', '28d', '90d'],
    signals: [
      'page-level Search Console clicks/impressions/CTR/average position',
      'Organic Search GA4 landing-page sessions/users/engagement/views',
      'top queries for 28d/90d',
      'matched prior-period comparisons when available'
    ],
    missingData: 'Missing, partial, failed, or stale measurements are unknown, never zero. Skip decisions that depend on unavailable evidence.',
    persistence: 'Do not create daily per-page analytics records in Firestore. The measurement workflow may use ephemeral/local detail, but remote planning state is one compact overwrite-style digest per managed site. Durable growth is reserved for actionable SEO task/history records.'
  },
  managedScope: {
    source: 'Sites Operator active site registry only.',
    rule: 'A site that is visible in site-monitor but absent/paused/archived in Sites Operator is not agent-managed and must not receive SEO Issues from this workflow.'
  }
} as const;

const plannerInstructions = [
  'Read this context first, then list active managed sites, compact planning digests, and open SEO task records.',
  'Never call Google Analytics or Search Console directly from the planning session. Never use My Portal or site-monitor.',
  'Skip a site when its planning digest is absent/stale or the evidence required for a decision is partial/failed.',
  'Plan from existing articles first. Allowed material task types are revise, merge, delete, internal_links, technical, and new_article when separately justified.',
  'Do not create work to satisfy a quota. Per run create at most 5 GitHub Issues total and at most 2 in one repository.',
  'Before creating an Issue, check open/proposed/issued/in_progress SEO tasks and their dedupe keys. Do not duplicate an existing unresolved action.',
  'Before creating an Issue, verify the target article/code in its GitHub repository. Analytics alone is not enough to claim a content defect.',
  'revise: require a concrete search/organic signal plus a verified content/snippet/structure gap that a targeted edit can address.',
  'merge: require query/intent overlap across multiple URLs plus verified content duplication or fragmented coverage. Specify canonical/redirect/internal-link handling.',
  'delete: use the highest threshold. Require complete 90d evidence showing negligible search/organic value AND GitHub inspection showing low unique value or duplication. Prefer merge+redirect when a useful destination exists. Never delete solely because traffic is low.',
  'internal_links: require a concrete discovery/contextual-link gap and named source/target pages.',
  'technical: require a reproducible technical/indexing/canonical/metadata defect and an explicit validation method.',
  'Create the Sites Operator SEO task record before the GitHub Issue. If dedupe rejects the task, do not create the Issue.',
  'GitHub Issue title format: [SEO][taskType] concise action. Body must include Sites Operator task ID, target URL/file, measurement period and evidence, diagnosis, requested material change, acceptance criteria, and validation requirements.',
  'After Issue creation, attach issueNumber/issueUrl/issueState=open to the SEO task and append issue_issued history. If Issue creation fails, keep the task resumable and append failure history.',
  'This planner does not edit articles/code, create PRs, deploy, or mark implementation complete. A separate executor performs the material work.',
  'When reconciling an existing Issue, never infer implementation from Issue closure alone. Store result commit/execution summary only from explicit GitHub evidence.'
];

const executorInstructions = [
  'Read this context first, then read the specific Sites Operator SEO task and linked GitHub Issue before changing anything.',
  'Use GitHub article/code as the implementation source of truth. Do not use My Portal or site-monitor.',
  'Implement only the material scope requested by the linked task/Issue; do not silently widen the SEO strategy.',
  'For merge/delete tasks, preserve redirect/canonical/internal-link requirements and validate the destination before removing a source URL.',
  'For technical tasks, reproduce the defect before changing it and validate the exact acceptance criteria afterward.',
  'Record the resulting commit SHA and concise execution summary on the Sites Operator SEO task. Do not fabricate deploy/live verification.',
  'If requirements are unsafe, contradictory, stale, or no longer supported by current production/GitHub state, do not force the change; append a blocked/superseded history record with evidence.'
];

export function seoAgentContext(input: unknown) {
  const { role } = z.object(seoAgentContextShape).strict().parse(input);
  return {
    policyVersion: SEO_AGENT_POLICY_VERSION,
    role,
    ...shared,
    instructions: role === 'planner' ? plannerInstructions : executorInstructions,
    runContract: role === 'planner'
      ? {
          start: ['seo_agent_context(role=planner)', 'site_registry_list(status=active)', 'seo_planning_digest_list', 'seo_task_list(open statuses)'],
          output: '0-5 deduplicated material GitHub Issues plus Sites Operator task records, or a justified zero-action run.'
        }
      : {
          start: ['seo_agent_context(role=executor)', 'seo_task_get', 'linked GitHub Issue + repository state'],
          output: 'material implementation evidence stored back on the SEO task, or an evidence-backed blocked/superseded state.'
        }
  };
}
