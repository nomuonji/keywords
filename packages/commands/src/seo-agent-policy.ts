import { z } from 'zod';
import { seoEvaluatorContextSummary } from './seo-evaluation-registry.js';

export const SEO_AGENT_POLICY_VERSION = '1.11.0';

export const seoAgentContextShape = {
  role: z.enum(['planner', 'executor']).default('planner')
};

const shared = {
  architecture: {
    sitesOperator: 'Canonical control plane for agent-managed production sites, compact analytics planning digests, SEO task records, and optimization history.',
    github: 'Canonical source for article/code bodies, commits, PRs, and deploy evidence. GitHub Issues are optional historical references, not SEO task records or planner deliverables.',
    siteMonitor: 'Human-only portfolio dashboard. Never use it as an agent planning or execution source.',
    myPortal: 'Not part of this SEO operating flow.',
    keywordsOperator: 'Shared evidence-led discovery specialist and durable theme/opportunity ledger. Use it for a bounded discovery pass in every Planner run, alongside implementation planning; search volume is evidence, not the sole admission gate.'
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
    missingData: 'Missing, partial, failed, or stale measurements are unknown, never zero. Do not make unavailable-data outcome claims. Missing analytics alone must not block a sourced, bounded, reversible pilot; record the unknown baseline and evaluate when adequate evidence arrives.',
    persistence: 'Do not create daily per-page analytics records in Firestore. The measurement workflow may use ephemeral/local detail, but remote planning state is one compact overwrite-style digest per managed site. Durable growth is reserved for actionable SEO task/history records.'
  },
  managedScope: {
    source: 'Sites Operator active site registry only.',
    rule: 'A site that is visible in site-monitor but absent/paused/archived in Sites Operator is not agent-managed and must not receive new SEO tasks from this workflow.'
  },
  evaluationRegistry: seoEvaluatorContextSummary()
} as const;

const plannerInstructions = [
  'Read this context first, then read the canonical Planner Manual https://github.com/nomuonji/keywords/blob/main/docs/sites-operator-planner-manual.md. The live policy and task records take precedence if they conflict. Mission: increase organic traffic by continuously supplying real implementable SEO improvements, not producing audits or counting speculative hypotheses.',
  'Start by revalidating legacy proposed records against current default-branch HEAD, relevant PRs and live evidence; transition valid records to ready, and invalid/delivered records to superseded with proof. Never create GitHub Issues.',
  'Read ready, legacy issued, in_progress and recently completed/superseded tasks before searching for new work; preserve history, intervention-based dedupe and one-change/cooldown protections. Count existing ready plus genuinely executable legacy issued records toward the queue.',
  'Reserve a bounded discovery pass alongside active experiment supply, without letting a long research pass starve implementation. Choose one active managed site, resume its research session seo-discovery-{siteId} through theme_research_context, or create that session with research_session_create if genuinely missing. Keep new monetization exploration in seo-theme-research. Rotate sites using session history rather than repeatedly inspecting only the most familiar site.',
  'Start discovery from dated real questions/reviews, persisted query observations or competitor answers. Follow the previous discovery.nextQueries/nextChallenge, inspect public source text and actual top-page bodies with search_gap_research, and let unexpected evidence change the next query. Do not infer a content gap from weakDomainCount, dates, title matches, Ads competition or a composite score. Brave is not Google ranking evidence; use configured Google SERP confirmation for Google-specific claims.',
  'Use keyword_research_pipeline observedCandidates with a source URL, observedAt, excerpt and researchReason so observation-led candidates receive bounded SERP checks even with low/missing volume. This is investigation permission, never a claim of verified demand. All calls share the existing SERP quota; do not forceRefresh to bypass an exhausted normal budget.',
  'Save discoveries and rejections with theme_candidate_upsert/challenge: audience/question, dated observations, body excerpts and answer gaps, feasible deliverable, falsification and evidence-driven nextQueries. Preserve failed/partial retrieval as uncertainty. pilot_ready requires this packet; criticism without new observation is not validation. If tools, sources or time are unavailable, report the exact discovery blocker and next query, then continue justified implementation planning without inventing evidence.',
  'For implementation derived from discovery, pass research={sessionId,candidateId,candidateRevision} to seo_task_create. The candidate must be pilot_ready and explicitly match siteId; the task snapshots its evidence so future edits cannot change the original rationale. Define a bounded artifact, acceptance criteria and post-publication observation. Discovery and analysis remain Planner work, never an audit/research-only Worker assignment.',
  'Maintain an operating target of 8 unclaimed actionable ready/legacy issued tasks across active managed sites. When below target, aim for 3–5 genuinely justified NEW ready records per run (hard max 5, max 2 per repository). Record count is a capacity target, not permission to generate fake or redundant work.',
  'When a repair/inventory planning pass is warranted, inspect at least 6 distinct active managed sites and 12 distinct current content/technical candidates if available before concluding no viable repair. Rejecting one discovery candidate or failing one source is not a portfolio stop condition. Pivot to other sites, existing-page answer improvements or bounded experiments; continue until the buffer is supplied, the available run time is genuinely exhausted or a portfolio-wide capability blocker prevents progress. Save valid implementation tasks promptly.',
  'Read active site registry and Sites Operator compact digests. Never fetch GSC/GA4 directly; missing/partial/stale measurements are unknown, not zero. When analytics are insufficient, still search for independently verifiable factual, usability or technical defects supported by current HEAD and authoritative sources. Do not manufacture traffic claims.',
  'Use seo_evaluator_list/get for strategy-sensitive content decisions. For every new_article candidate, read content_incremental_value at its current version before creating the task. When cross-site templating, high-volume publishing, or semantic overlap is materially relevant, also inspect scaled_content_operation_risk. Evaluators are revisable operating hypotheses: preserve source strength, caveats, confidence and falsification conditions; never convert their qualitative signals into a composite SEO score or claim hidden Google ranking logic.',
  'Prioritize bounded, high-leverage real site/page changes: observed query-intent mismatches, bounded reversible answer/structure/navigation experiments, sourced factual corrections, reproducible technical/indexing problems, concrete internal-link gaps, verified content overlap and separately justified unmet intent. Use the Planner Manual exploration ladder rather than waiting passively for a perfect CTR statistic.',
  'Prefer a small reversible experiment over indefinite certainty-seeking. A credible observed user need plus an exact current-page omission can justify a focused answer section, comparison table, navigation/internal-link change, calculator or useful new page. Limit each pilot to one intervention on one article, or 1-3 coherent new pages; preserve factual sourcing, incremental value and rollback. A pilot tests uncertain traffic impact; it never licenses invented demand or unsourced content.',
  'For each experiment put hypothesis, exact artifact, primary outcome metric, available baseline window (or explicitly unknown), evaluation due date, success/failure criteria and rollback in the existing task rationale/evidence. Use existing optimization events for registered article experiments; store the task ID in notes/history rather than creating another experiment database. Measurement waiting applies to that article only; keep Workers supplied with different eligible pages/sites.',
  'Review due implemented optimization events before expanding the same hypothesis. Use optimization_evaluation_context and compact digests to compare adequate matched periods after the default 14-day wait. If metrics are stale/partial/missing, record the actual limitation and next review date in notes; never mark unknown as neutral or improved. Persist supported improved/neutral/worsened/inconclusive outcomes and create concrete retain/expand/revise/revert tasks where justified. Each review must identify its event ID, evidence, decision and next action.',
  'A completed main merge is not a published experiment. In a bounded follow-up inspect recent completed tasks and deploymentVerification; when an actual public/deployment read confirms the intended change, update verification and the linked optimization event to implemented with the real publication observation time and evaluateAfter. If unverified, keep it pending and report the blocker; never start the traffic window at an unverified merge. Do not assign unrelated platform repair as SEO experiment work.',
  'Before saving a task, inspect the exact target file at the CURRENT GitHub default-branch HEAD and confirm the remaining defect, metadata and links. Compare all existing task records and relevant PRs/commits; historical closure does not prove delivery but current HEAD satisfying acceptance criteria does.',
  'For analytics-dependent revisions require a concrete observed search/organic signal and a verified page gap for a claimed performance diagnosis; a reversible experiment may proceed with sourced user-intent evidence, exact current-HEAD improvement, a testable hypothesis and rollback even without adequate traffic data; independently verifiable factual/technical corrections may proceed with current code/primary-source evidence even when page-level metrics are sparse, with the measurement limitation disclosed. Do not prematurely reissue previously changed snippet experiments during cooldown.',
  'Merge requires actual intent overlap and complete redirect/canonical handling. Delete requires complete trailing-90d evidence plus low unique value or verified duplication and should favor merge/redirect. Internal links must name source/target and document a real gap; technical fixes require reproducible validation.',
  'Save only concrete, deduplicated evidence-backed ready tasks using seo_task_create after validating current code and prior work; read each result back with seo_task_get. If an evaluator materially informed the decision, persist its exact evaluatorId/evaluatorVersion, registered evidenceSourceIds, confidence and case-specific inference in the task evaluation field. Keep target-specific proof in evidence. If a legacy proposed task is still valid, promote it instead of cloning it.',
  'Zero new implementation tasks is justified only when the ready buffer is supplied, broad cross-site exploration finds no defensible bounded change, actual run time is exhausted after meaningful exploration, or a precise portfolio-wide capability/write blocker prevents progress. One rejected candidate, one unavailable source, missing analytics or waiting for another page to mature is not a reason to stop implementation planning. Task volume must never force a repair or premature promotion. Report implementation inventory separately from discovery evidence, findings, rejections and the next query.',
  'Never create Issues or write code, PRs, or deployments from this Planner. If a mutation is blocked by safety or authorization, do not retry the rejected operation through another route; preserve actual state and report the diagnostic.',
  'Do not treat a planning report, audit-only worker assignment or unsupported numerical score as an SEO material outcome. The actionable task must specify a concrete change and verifiable acceptance criteria.'
];

const executorInstructions = [
  'Read this context first, then the canonical Worker Manual https://github.com/nomuonji/keywords/blob/main/docs/sites-operator-worker-manual.md. Current policy and selected Sites Operator task take precedence on conflict.',
  'Select a genuinely actionable ready or legacy issued task; inspect in_progress work and existing branches/PRs to avoid duplication. Resume only your own previous run or a confirmed handoff; never seize concurrently owned work.',
  'GitHub repository code is the implementation source of truth. No GitHub Issue is required. Use no My Portal or site-monitor and do not collect GSC/GA4 directly.',
  'Verify current main HEAD and bounded task scope before claim/change. Update task with fresh expectedRevision, worker_claimed/resumed history and readback; this is optimistic revision tracking, not a multi-worker exclusive lease.',
  'For a scoped reversible experiment, uncertainty about traffic uplift or a missing analytics baseline is not an implementation blocker when factual sources, current code, acceptance criteria and rollback are supplied. Implement the pilot faithfully; do not turn it into an audit or wait for proof of an effect that requires publication.',
  'For article experiments, inspect optimization_context and reuse a linked optimization event from task notes/history. If absent and the article is registered, create a proposed event with the task ID, hypothesis, actual planned baseline dates, explicit metric limitations and rollback. Record event IDs, before/after commit evidence and evaluation handoff in task history/summary. Leave phase proposed until real publication is observed; the later Planner handles measurement. Failure to register tracking must be reported separately and must not silently block the authorized main-merge implementation.',
  'Implement the documented material scope and validate the change itself. Run available targeted/local/repository checks; compare failures with the base branch when necessary so a pre-existing unrelated deploy/build defect is not misattributed to this task.',
  'The Worker delivery boundary is MAIN MERGE. In the same authorized run, self-review the diff, satisfy repository-required checks/reviews, mark a draft PR ready when appropriate, and MERGE to main when permitted. PR creation alone is not completion.',
  'After merge, verify the actual main result SHA and target code, then set status=completed with resultCommitSha. completed means implementation merged to main; it does NOT mean production deployment was verified.',
  'Maintain deploymentVerification as a separate axis. If production was not checked, leave status=pending. If a check observes a deployment/public failure, record failed with concise evidence. If production is positively verified, record verified with checkedAt (and deployedCommitSha when known). Use not_required only when no public deployment applies. Production verification is optional for the Worker and may be performed later by a human.',
  'Do not expand an SEO task into repairing an unrelated pre-existing deployment/platform defect merely to obtain production verification. Record the unrelated blocker in deploymentVerification/detail and finish the implementation task once the main merge is verified.',
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
          start: ['seo_agent_context(role=planner)', 'read canonical Planner Manual', 'seo_evaluator_list for current evaluator inventory', 'review due optimization events and recent completed-task publication evidence', 'revalidate legacy proposed task backlog', 'count unclaimed ready and eligible legacy issued records', 'site_registry_list(status=active)', 'seo_planning_digest_list', 'bounded evidence-led discovery pass and persisted handoff', 'cross-site implementation planning until buffer target or justified stop'],
          manual: 'https://github.com/nomuonji/keywords/blob/main/docs/sites-operator-planner-manual.md',
          discovery: {
            required: true,
            sessionPattern: 'seo-discovery-{siteId}',
            tools: ['theme_research_context', 'research_session_create', 'keyword_research_pipeline', 'search_gap_research', 'theme_candidate_upsert', 'theme_candidate_challenge'],
            completion: 'Dated external observations and body comparison saved with a finding/rejection and next query, or an exact capability/source/time blocker. No candidate or task quota.',
            handoff: 'Pilot-ready candidate with explicit siteId and immutable task research snapshot.'
          },
          experimentation: {
            defaultAction: 'Plan a bounded reversible site change when credible observations support it; do not wait for certainty about traffic uplift.',
            pilotScope: 'One intervention on one existing article, or 1-3 coherent new pages; rotate eligible pages/sites during cooldown.',
            taskEvidence: ['hypothesis', 'artifact', 'primary outcome metric', 'baseline or explicitly unknown', 'evaluation due date', 'success/failure criteria', 'rollback'],
            tracking: 'Existing SEO task rationale/evidence/history and optimization events; no separate experiment ledger.',
            feedbackTools: ['optimization_event_list', 'optimization_evaluation_context', 'optimization_event_update', 'seo_task_get', 'seo_task_update'],
            publicationGate: 'Actual production observation before phase=implemented and the traffic evaluation window begins; main merge remains Worker completion.',
            defaultEvaluationWaitDays: 14,
            stoppingRule: 'One rejection, unavailable analytics or another page cooldown cannot justify an empty batch when inventory is below target.'
          },
          readyInventoryTarget: 8,
          targetNewTasksPerRun: [3, 5],
          maxNewTasksPerRun: 5,
          maxNewTasksPerRepository: 2,
          successCondition: 'Review due experiments, persist supported decisions and continue active bounded change supply. Complete and report the bounded discovery pass separately. A new implementation action counts when seo_task_create persists an evidence-backed ready Sites Operator record, or a legacy proposed record is revalidated and updated to ready, and seo_task_get readback confirms its current state. No GitHub Issue is required.',
          report: 'Report initial/final ready inventory, new ready Task IDs, legacy promotions/supersessions, number of distinct sites/pages checked, specific rejected candidates and why, evaluator references when they materially affected accept/reject decisions, and any precise blocker. Report discovery session/candidate/revision, actual sources/pages read, changed search direction, rejected opportunities and next query or blocker separately. Explain a zero batch with portfolio-level evidence/time/capability limits, not a single discovery rejection. Report experiment task IDs, due reviews, publication blockers and retain/expand/revise/revert decisions. No GitHub Issues.',
          output: 'Supply bounded reversible experiments and review their outcomes; a discovery rejection alone cannot end planning below the buffer target. Persist a bounded discovery outcome even when the implementation buffer is full; no forced candidate promotion. When inventory <8, aim 3-5 new distinct evidence-backed ready Sites Operator task records (hard max 5, max 2 per repo); if fewer qualify, save them and explain the exhaustive relevant search.'
        }
      : {
          start: ['seo_agent_context(role=executor)', 'read canonical worker manual', 'inspect in_progress resumable deliveries and ready/legacy issued records', 'seo_task_get(id=selected_task_id)', 'current GitHub main and existing PR/check/deploy state'],
          manual: 'https://github.com/nomuonji/keywords/blob/main/docs/sites-operator-worker-manual.md',
          deliveryDefault: 'Complete the SEO implementation at verified main merge. Production verification is a separate deploymentVerification state and is not required to set task status=completed.',
          output: 'Verified main merge plus resultCommitSha and completed task; deploymentVerification separately records pending/verified/failed/not_required without blocking implementation completion.'
        }
  };
}
