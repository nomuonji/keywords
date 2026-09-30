import { z } from 'zod';

export const SEO_AGENT_POLICY_VERSION = '1.4.0';

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
  'Do not stop after the first stale, recently completed, duplicate, or unsupported candidate. If the first candidate fails validation, inspect distinct eligible sites and article candidates within the available execution budget. Prefer a clearly actionable implementation Issue with confirmed current-HEAD evidence over a larger number of speculative audits. Zero issues is valid only after a reasonable cross-site search or a clearly recorded blocking condition.',
  'Treat issue issuance as the primary deliverable, not analysis volume or proposed-record count. Use the digest list to choose evidence-backed article candidates across distinct repositories. After verifying current HEAD and cross-checking recent open/closed Issues, commit one eligible real action end-to-end before starting an unrelated analysis backlog.',
  'If an Issue write is denied by the connector, log its exact diagnostic on the proposed task, do not evade that rejection or retry equivalent prohibited content, and try a genuinely unrelated eligible article from a different repository if authorized. Test no more than three distinct real candidates per run; do not produce dummy test Issues or call the run successful without a linked real GitHub Issue.',
  'At the beginning of each run, inspect prior issue_create_failed history. A prior unresolved connector safety rejection is not an ordinary transient failure: do not retry that same task/repository first, and do not repeat an unchanged rejected request on subsequent runs. Review other unrelated active-site repositories for independently justified work. If unrelated writes also meet the same denial, stop and report the platform restriction instead of accumulating more proposed tasks.',
  'Do not infer that a single connector rejection establishes a global authorization restriction or that adult content caused it. Record repository, attempted tool, error class, and whether another independently justified write succeeded. If two unrelated permissible Issues both fail for the same apparent authorization/safety condition, stop writes, keep proposed tasks resumable, and report a likely scheduled-context connector blocker.',
  'Do not create work to satisfy a quota. Per run create at most 5 GitHub Issues total and at most 2 in one repository.',
  'Before creating a task, check all Sites Operator SEO tasks for the target, including completed and superseded entries, and check GitHub Issues in the target repository, both OPEN and RECENTLY CLOSED. Search for the target URL, repository path, alternate title phrasing, and the same underlying intervention/intent; a different title or absent Sites Operator record does not prove the work is new.',
  'Read the actual target file on the CURRENT default-branch HEAD of GitHub and verify its current metadata, body, canonical, and relevant links. Do not rely on search snippets, cached GitHub evidence, historical snapshots, or the digest as proof of what currently needs changing. Record the ref/commit and exact remaining defect in each new task.',
  'For each recent closed/completed Issue about the same URL and intervention, compare its acceptance criteria with current HEAD. If already satisfied, SKIP without creating a task or Issue, even if pre-change analytics still look poor. If the work is closed but HEAD does not establish completion, record uncertainty and do not claim it was delivered.',
  'Compare digest measurementEnd with the target article last-change/Issue implementation date. If the digest ends before the intervention or lacks a meaningful post-change observation period, do not immediately reissue the same action. Wait for a fresh post-change digest and the relevant optimization cooldown/evaluation window (normally at least 14 days) before judging impact.',
  'Before creating an Issue, check open/proposed/issued/in_progress SEO tasks and their dedupe keys. Do not duplicate an existing unresolved action. Previously completed or superseded work also constrains reissuance until genuinely new post-change evidence and a distinct defect exist.',
  'Before creating an Issue, verify the target article/code in its GitHub repository. Analytics alone is not enough to claim a content defect.',
  'If an existing proposed task turns out to duplicate already-completed work, update that task to superseded, link the actual historical GitHub Issue, and append an evidence-backed history event; do not create a new Issue or mark the duplicate task completed.',
  'revise: require a concrete search/organic signal plus a verified content/snippet/structure gap that a targeted edit can address.',
  'merge: require query/intent overlap across multiple URLs plus verified content duplication or fragmented coverage. Specify canonical/redirect/internal-link handling.',
  'delete: use the highest threshold. Require complete 90d evidence showing negligible search/organic value AND GitHub inspection showing low unique value or duplication. Prefer merge+redirect when a useful destination exists. Never delete solely because traffic is low.',
  'internal_links: require a concrete discovery/contextual-link gap and named source/target pages.',
  'technical: require a reproducible technical/indexing/canonical/metadata defect and an explicit validation method.',
  'Create the Sites Operator SEO task record only AFTER current-HEAD and open/recent-closed GitHub Issue verification; then create the GitHub Issue. If dedupe rejects the task, do not create the Issue.',
  'GitHub Issue title format: [SEO][taskType] concise action. Body must include Sites Operator task ID, target URL/file, measurement period and evidence, diagnosis, requested material change, acceptance criteria, and validation requirements.',
  'After Issue creation, attach issueNumber/issueUrl/issueState=open to the SEO task and append issue_issued history. Read back both the newly issued GitHub Issue and the Sites Operator task; a proposed task by itself is not a successful issued action.',
  'If GitHub create_issue fails, preserve the proposed Sites Operator task, append issue_create_failed history with the exact error category, and report issuance as failed rather than successful. Do not mislabel a historical issue as newly issued and do not bypass connector safety checks. Continue to other independently justified candidates only if permitted and useful.',
  'When a previous proposed task is still valid and the target has no new or existing linked issue, resume that task rather than creating another task record. Before resuming, revalidate current GitHub HEAD, recent open/closed Issues and the observation window. If it is no longer valid, mark it superseded with evidence.',
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
          successCondition: 'A new action counts as issued only when GitHub create_issue returns a real new Issue and Sites Operator seo_task_update links that exact Issue, followed by read-back confirmation.',
          report: 'Report newly issued Issue URLs and linked task IDs separately from proposed-only tasks, historical linked Issues, blocked issuance and justified zero-action runs.',
          output: '0-5 deduplicated material GitHub Issues plus linked Sites Operator task records, or a justified zero-action run with verified blocking reasons.'
        }
      : {
          start: ['seo_agent_context(role=executor)', 'seo_task_get', 'linked GitHub Issue + repository state'],
          output: 'material implementation evidence stored back on the SEO task, or an evidence-backed blocked/superseded state.'
        }
  };
}
