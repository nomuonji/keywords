import { z } from 'zod';

export const SEO_AGENT_POLICY_VERSION = '1.7.0';

export const seoAgentContextShape = {
  role: z.enum(['planner', 'executor']).default('planner')
};

const shared = {
  architecture: {
    sitesOperator: 'Canonical control plane for agent-managed production sites, compact analytics planning digests, SEO task records, and optimization history.',
    github: 'Canonical source for article/code bodies, commits, PRs, and deploy evidence. GitHub Issues are optional historical references, not SEO task records or planner deliverables.',
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
    rule: 'A site that is visible in site-monitor but absent/paused/archived in Sites Operator is not agent-managed and must not receive new SEO tasks from this workflow.'
  }
} as const;

const plannerInstructions = [
  'Read this context first, then read the canonical Planner Manual https://github.com/nomuonji/keywords/blob/main/docs/sites-operator-planner-manual.md. The live policy and task records take precedence if they conflict. Mission: increase organic traffic by continuously supplying real implementable SEO improvements, not producing audits or counting speculative hypotheses.',
  'Start by revalidating legacy proposed records against current default-branch HEAD, relevant PRs and live evidence; transition valid records to ready, and invalid/delivered records to superseded with proof. Never create GitHub Issues.',
  'Read ready, legacy issued, in_progress and recently completed/superseded tasks before searching for new work; preserve history, intervention-based dedupe and one-change/cooldown protections. Count existing ready plus genuinely executable legacy issued records toward the queue.',
  'Maintain an operating target of 8 unclaimed actionable ready/legacy issued tasks across active managed sites. When below target, aim for 3–5 genuinely justified NEW ready records per run (hard max 5, max 2 per repository). Record count is a capacity target, not permission to generate fake or redundant work.',
  'Before reporting zero when the buffer is below target, inspect at least 6 distinct active managed sites and 12 distinct current content/technical candidates if that many are available; pivot across unrelated sites when early candidates fail. Do not stop after an initial stale/duplicated page or active PR, and save each valid task immediately instead of spending the full run auditing.',
  'Read active site registry and Sites Operator compact digests. Never fetch GSC/GA4 directly; missing/partial/stale measurements are unknown, not zero. When analytics are insufficient, still search for independently verifiable factual, usability or technical defects supported by current HEAD and authoritative sources. Do not manufacture traffic claims.',
  'Prioritize bounded, high-leverage real site/page changes: observed query-intent mismatches, sourced factual corrections, reproducible technical/indexing problems, concrete internal-link gaps, verified content overlap and separately justified unmet intent. Use the Planner Manual exploration ladder rather than waiting passively for a perfect CTR statistic.',
  'Before saving a task, inspect the exact target file at the CURRENT GitHub default-branch HEAD and confirm the remaining defect, metadata and links. Compare all existing task records and relevant PRs/commits; historical closure does not prove delivery but current HEAD satisfying acceptance criteria does.',
  'For analytics-dependent revisions require a concrete observed search/organic signal and a verified page gap; independently verifiable factual/technical corrections may proceed with current code/primary-source evidence even when page-level metrics are sparse, with the measurement limitation disclosed. Do not prematurely reissue previously changed snippet experiments during cooldown.',
  'Merge requires actual intent overlap and complete redirect/canonical handling. Delete requires complete trailing-90d evidence plus low unique value or verified duplication and should favor merge/redirect. Internal links must name source/target and document a real gap; technical fixes require reproducible validation.',
  'Save only concrete, deduplicated evidence-backed ready tasks using seo_task_create after validating current code and prior work; read each result back with seo_task_get. If a legacy proposed task is still valid, promote it instead of cloning it.',
  'Zero newly created tasks is valid only if the ready buffer is already supplied, broad current-HEAD exploration finds no safe distinct interventions, or a documented permission/source blocker prevents further justified work. Report initial/final ready inventory, new/promoted task IDs, sites/pages actually checked, rejected candidates and exact reasons.',
  'Never create Issues or write code, PRs, or deployments from this Planner. If a mutation is blocked by safety or authorization, do not retry the rejected operation through another route; preserve actual state and report the diagnostic.',
  'Do not treat a planning report, audit-only worker assignment or unsupported numerical score as an SEO material outcome. The actionable task must specify a concrete change and verifiable acceptance criteria.'
];

const executorInstructions = [
  'Read this context first, then the canonical Worker Manual https://github.com/nomuonji/keywords/blob/main/docs/sites-operator-worker-manual.md. Current policy and selected Sites Operator task take precedence on conflict.',
  'Select a genuinely actionable ready or legacy issued task; inspect in_progress work and existing branches/PRs to avoid duplication. If explicitly continuing your own previous run or a confirmed handoff, resume that existing in_progress delivery rather than making a duplicate PR; never seize concurrently owned work.',
  'GitHub repository code is the implementation source of truth. No GitHub Issue is required. Use no My Portal or site-monitor and do not collect GSC/GA4 directly.',
  'Verify current main HEAD and bounded task scope before claim/change. Update task with fresh expectedRevision, worker_claimed/resumed history and readback; this is optimistic revision tracking, not a multi-worker exclusive lease.',
  'Implement the documented material scope and validate real acceptance criteria. For merge/delete preserve redirect/canonical/internal links; for technical defects reproduce and retest the actual failure.',
  'The default outcome is END-TO-END delivery, not opening a draft PR: in the same authorized run, run available local/CI tests, resolve actual failures, self-review the diff and required checks, mark a draft PR ready, then MERGE to main when all required repository gates are satisfied and merge is permitted. Do not stop merely because a PR exists or CI is pending; inspect/check available runs and continue while execution budget allows.',
  'Do not invent tests, replace missing mandatory human approvals, bypass protected branch restrictions, skip failing CI or merge through a refused operation. If essential test/review tools are unavailable, record the precise capability blocker instead of treating PR creation as completion.',
  'After verified merge record the real main commit SHA and verify production deployment plus exact live route/acceptance claims when applicable; mark completed only after all applicable gates. When pending, preserve in_progress with exact PR/check/build status and next required action for resumption.',
  'Use seo_task_get -> seo_task_update(expectedRevision) -> seo_task_get readback on each state change. If tool/safety/authorization rejects an operation, stop that rejected action; do not reroute equivalent rejected content. Record exact failure and true remaining state.'
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
          start: ['seo_agent_context(role=planner)', 'read canonical Planner Manual', 'revalidate legacy proposed task backlog', 'count unclaimed ready and eligible legacy issued records', 'site_registry_list(status=active)', 'seo_planning_digest_list', 'cross-site exploration until buffer target or justified stop'],
          manual: 'https://github.com/nomuonji/keywords/blob/main/docs/sites-operator-planner-manual.md',
          readyInventoryTarget: 8,
          targetNewTasksPerRun: [3, 5],
          maxNewTasksPerRun: 5,
          maxNewTasksPerRepository: 2,
          successCondition: 'A new action counts when seo_task_create persists an evidence-backed ready Sites Operator record, or a legacy proposed record is revalidated and updated to ready, and seo_task_get readback confirms its current state. No GitHub Issue is required.',
          report: 'Report initial/final ready inventory, new ready Task IDs, legacy promotions/supersessions, number of distinct sites/pages checked, specific rejected candidates and why, and any precise blocker. Zero tasks below buffer target requires documented broad cross-site exploration. No GitHub Issues.',
          output: 'When inventory <8, aim 3-5 new distinct evidence-backed ready Sites Operator task records (hard max 5, max 2 per repo); if fewer qualify, save them and explain the exhaustive relevant search.'
        }
      : {
          start: ['seo_agent_context(role=executor)', 'read canonical worker manual', 'inspect in_progress resumable deliveries and ready/legacy issued records', 'seo_task_get(id=selected_task_id)', 'current GitHub main and existing PR/check/deploy state'],
          manual: 'https://github.com/nomuonji/keywords/blob/main/docs/sites-operator-worker-manual.md',
          deliveryDefault: 'Continue to verified main merge and required live checks in the same authorized run when all repository gates pass; PR creation alone is never task completion.',
          output: 'Verified changed code/CI/main merge/live evidence and completed Sites Operator task, or precise in_progress/blocked evidence if mandatory gates or tool limits prevent completion.'
        }
  };
}
