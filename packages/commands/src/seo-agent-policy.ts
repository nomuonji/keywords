import { z } from 'zod';

export const SEO_AGENT_POLICY_VERSION = '1.6.0';

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
  'Read this context first. List Sites Operator SEO tasks with status=proposed before finding new work. Revalidate each legacy proposed task against current GitHub HEAD, related PRs/commits and current evidence: update still-actionable tasks to ready, and supersede invalid or already-delivered tasks with explicit evidence. Do not create duplicate replacements.',
  'Read ready, issued (legacy), in_progress, completed and superseded tasks when checking for duplication. Existing issued tasks and historical GitHub Issue references remain valid; never create new GitHub Issues as a planner deliverable.',
  'Once the proposed backlog is resolved or explicitly blocked by a Sites Operator write failure, list active managed sites and compact planning digests for new candidates.',
  'Never call Google Analytics or Search Console directly from the planning session. Never use My Portal or site-monitor.',
  'Skip sites when planning digests are absent/stale or evidence required for a decision is partial/failed; missing measurements are unknown, never zero.',
  'Plan from existing articles first. Material task types are revise, merge, delete, internal_links, technical and separately justified new_article.',
  'The planner delivers evidence-backed Sites Operator task records in ready status, not GitHub Issues, code changes, PRs or deployment. Do not fabricate work to hit a quota; create at most 5 genuinely distinct ready tasks per run and at most 2 for one repository.',
  'Before creating any task, check all Sites Operator SEO tasks for the same target and intervention, including historical completed/superseded work and legacy issued tasks. Check related open/merged/closed GitHub PRs and commits (and existing historical Issues when relevant); a missing task or different title does not establish novelty.',
  'Read the actual target file at the CURRENT GitHub default-branch HEAD. Verify its metadata, body, canonical and relevant links, and record the commit/ref and exact remaining defect. Search snippets, cached GitHub evidence and digests are not proof of the current code.',
  'Compare prior implementation acceptance criteria and current HEAD. If a previous change already satisfies the proposed fix, skip it even if pre-change analytics remain poor. A closed Issue or PR alone is not delivery proof; verify the code.',
  'Compare digest measurementEnd with the target article last change and implementation evidence. If the digest predates an intervention or lacks a meaningful post-change period, do not reissue the same action; wait for a fresh digest and the applicable evaluation cooldown (normally at least 14 days).',
  'Before saving, check open proposed/ready/issued/in_progress dedupe keys and the broader same-intent action history. Previously completed or superseded interventions require genuinely new post-change evidence and a distinct remaining defect.',
  'revise requires a concrete search/organic signal plus a verified content, snippet or structure gap addressable by a targeted edit.',
  'merge requires query/intent overlap, verified duplication or fragmented coverage, and explicit canonical/redirect/internal-link requirements.',
  'delete requires complete 90-day evidence of negligible search/organic value plus verified low unique value or duplication. Prefer merge and redirect where possible; never delete for low traffic alone.',
  'internal_links requires a concrete discovery/contextual-link gap and named source and target pages. technical requires a reproducible defect and explicit validation method.',
  'Create a deduplicated Sites Operator SEO task only after current-HEAD verification and review of task/implementation history. seo_task_create directly saves a ready record; its rationale and evidence must be concrete enough for a future executor without additional planning.',
  'Read back each created or transitioned ready task using seo_task_get and verify ID, ready status, target URL, repository, intervention, rationale and evidence. A local proposal or unconfirmed write is not a successful task.',
  'If task creation/update fails or is blocked by connector safety/authorization, preserve existing state, do not retry the same rejected mutation through another path, and report the exact error and task ID. No GitHub write is required for planning.',
  'Do not stop at the first stale or duplicate candidate. Inspect distinct eligible sites and articles within the available execution budget; zero tasks is valid with documented evidence or a verified blocking condition.',
  'This planner never edits article code, creates PRs, deploys, or marks an implementation complete. Executor implementation is a separate future workflow.',
  'Completion or supersession needs explicit GitHub/current-production evidence where relevant; never infer implementation from Issue closure or the existence of a PR alone.'
];

const executorInstructions = [
  'Read this context first, then read the specific Sites Operator SEO task and its current repository state. For legacy tasks, read a linked GitHub Issue if one exists; an Issue is never mandatory.',
  'Use GitHub article/code as the implementation source of truth. Do not use My Portal or site-monitor.',
  'Implement only the material scope requested by the Sites Operator task, taking any optional historical Issue into account; do not silently widen the SEO strategy.',
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
          start: ['seo_agent_context(role=planner)', 'seo_task_list(status=proposed)', 'revalidate legacy proposed records to ready or superseded', 'then site_registry_list(status=active)', 'then seo_planning_digest_list'],
          successCondition: 'A new action counts when seo_task_create persists an evidence-backed ready Sites Operator record, or a legacy proposed record is revalidated and updated to ready, and seo_task_get readback confirms its current state. No GitHub Issue is required.',
          report: 'Report new ready Task IDs and revalidated legacy Task IDs separately from superseded, unchanged historical tasks, blocked writes and justified zero-action runs. Report zero GitHub Issues because this planner never creates them.',
          output: '0-5 deduplicated, evidence-backed ready Sites Operator task records (max 2 per repository), plus resolved legacy proposed tasks, or a justified zero-action run.'
        }
      : {
          start: ['seo_agent_context(role=executor)', 'seo_task_get(id=selected_task_id)', 'current GitHub repository state', 'optional historical linked Issue'],
          output: 'material implementation evidence stored back on the SEO task, or an evidence-backed blocked/superseded state.'
        }
  };
}
