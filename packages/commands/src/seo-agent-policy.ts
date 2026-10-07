import { z } from 'zod';
import { seoEvaluatorContextSummary } from './seo-evaluation-registry.js';

export const SEO_AGENT_POLICY_VERSION = '1.25.0';

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
  indexation: {
    acquisition: 'Search Console URL Inspection is a separate bounded observation workflow, not part of the Planner analytics fetch. Use site_indexation_inspect only in the acquisition lane or for an explicit diagnostic; the default per-property daily budget is shared across sites that use the same Search Console property.',
    planningSource: 'Use site_indexation_summary for current cached site/page-family coverage and site_indexation_snapshot_save for one overwrite-style weekly historical point.',
    semantics: 'Indexation metrics are observed coverage of the inventoried/inspected URL set, not a claim that Search Console exposes an exact total indexed-page count. Treat uninspected URLs as unknown.',
    persistence: 'Keep one mutable URL cache document under the site, plus one weekly site/page-family snapshot and a tiny daily per-property quota ledger. Do not append URL-level inspection history.'
  },
  managedScope: {
    source: 'Sites Operator active site registry only.',
    rule: 'A site that is visible in site-monitor but absent/paused/archived in Sites Operator is not agent-managed and must not receive new SEO tasks from this workflow.'
  },
  recoveryGovernance: {
    source: 'Durable portfolio/site recovery state via seo_recovery_status. Read immediately after this context on every Planner and Executor run.',
    priority: 'An active portfolio recovery incident overrides normal discovery, expansion, ready-buffer, and publishing-volume targets.',
    growthFreeze: 'During recovery, new_article/site_expansion/data_expansion/schema_expansion are blocked by the control plane unless the target site is explicitly cleared for the current incident.',
    repairLane: 'Allowed work is bounded revise/merge/delete/internal_links/technical recovery work, subject to existing direction gates for broad deletion/noindex/positioning changes.',
    queueRule: 'The normal target of 8 ready tasks and 3-5 new tasks per run is suspended while portfolio recovery is active. Task count is not a recovery objective.',
    evidenceRule: 'Do not claim a specific Google update caused the incident without direct evidence. Use direct indexation/Search observations plus primary Search policy to justify risk controls.',
    clearance: 'Resume growth only after a site is explicitly marked cleared for the active incident with fresh evidence and written release criteria; one rewrite or one improved metric is insufficient.'
  },
  directionReview: {
    principle: 'Planner must detect material strategic mismatch, persist unresolved/decided strategy in Site Direction records, and never implement a major direction change before human discussion.',
    recordSource: 'Sites Operator siteDirections collection via site_direction_get/create/list/update.',
    statuses: ['open', 'monitor', 'decided', 'rejected', 'superseded'],
    topics: ['positioning', 'audience', 'consolidation', 'content_scope', 'monetization_model', 'page_family', 'other'],
    majorChangeExamples: [
      'changing the primary audience or site positioning',
      'merging or splitting sites/domains',
      'pausing/archiving a site or deindexing/deleting a broad page family',
      'moving substantial content between repositories or brands',
      'replacing the monetization/editorial model',
      'sitewide taxonomy/rebrand changes that alter the product identity'
    ],
    behavior: 'Read direction records before planning. For a new material concern, persist open/monitor rather than a Worker task. Human discussion resolves it to decided/rejected; later implementation tasks may reference only a decided directionId.',
    queueRule: 'Direction records do not count toward ready inventory and must not be converted into fake maintenance tasks to satisfy the queue target.'
  },
  expansion: {
    principle: 'Managed sites are not maintenance-only. Planner should expand useful site value when evidence supports it, regardless of site shape.',
    siteShapes: {
      article: 'Use new_article/revise/internal_links for editorial growth, and site_expansion for non-article utilities, hubs, calculators, comparison experiences, landing-page families or other useful additions.',
      database: 'Prefer data_expansion for verified record coverage, schema_expansion only when the current model cannot represent a demonstrated user/search need, and site_expansion for new useful discovery/decision experiences. Treat the dataset and the indexable URL surface as separate layers; do not create thin filter permutations or expose every generatable route to Search.',
      product: 'Use site_expansion for useful product-facing functionality, decision support, onboarding/landing experiences or bounded new capabilities; use technical/revise where the need is repair rather than expansion.',
      hybrid: 'Choose the narrowest matching expansion lane from article, database and product behavior based on the actual artifact.',
      other: 'Do not assume article-first behavior. Inspect the repository/site contract and use site_expansion for evidence-backed useful additions.'
    },
    taskTypes: {
      site_expansion: 'General cross-site expansion: add a useful non-maintenance capability/page family/decision aid/landing experience that is not adequately described as a new article.',
      data_expansion: 'Structured-data expansion: add and verify public records/attributes from authoritative sources using the repository data model and promotion gates.',
      schema_expansion: 'Data-model expansion: minimally extend schema/templates only when a demonstrated need cannot be represented safely in the current model.'
    }
  },
  evaluationRegistry: seoEvaluatorContextSummary()
} as const;

const plannerInstructions = [
  'Read this context first, then read the canonical Planner Manual https://github.com/nomuonji/keywords/blob/main/docs/sites-operator-planner-manual.md. The live policy and task records take precedence if they conflict. Mission: increase organic traffic by continuously supplying real implementable SEO improvements, not producing audits or counting speculative hypotheses.',
  'Immediately call seo_recovery_status before inventory/discovery. If portfolio.mode=recovery, switch to recovery operations: do not replenish the normal growth queue, do not pursue net-new Search-surface expansion, and plan only evidence-backed recovery/repair work on uncleared sites. The API hard-gates growth task creation and claims; do not route around it.',
  'Start by revalidating legacy proposed records against current default-branch HEAD, relevant PRs and live evidence; transition valid records to ready, and invalid/delivered records to superseded with proof. Never create GitHub Issues.',
  'Read ready, legacy issued, in_progress and recently completed/superseded tasks before searching for new work; preserve history, intervention-based dedupe and one-change/cooldown protections. Count existing ready plus genuinely executable legacy issued records toward the queue.',
  'In normal mode, reserve a bounded discovery pass alongside active experiment supply. In portfolio recovery mode, suspend growth-oriented discovery as a required run obligation; use research only when it directly supports recovery diagnosis, consolidation, quality repair, or a site-clearance decision.',
  'Start discovery from dated real questions/reviews, persisted query observations or competitor answers. Follow the previous discovery.nextQueries/nextChallenge, inspect public source text and actual top-page bodies with search_gap_research, and let unexpected evidence change the next query. Do not infer a content gap from weakDomainCount, dates, title matches, Ads competition or a composite score. Brave is not Google ranking evidence; use configured Google SERP confirmation for Google-specific claims.',
  'Before converging on obvious keyword variants, perform a bounded lateral-discovery pass from the concrete observation. First describe the searcher\'s latent state or job-to-be-done, then try several non-taxonomic transformations such as colloquial wording, incomplete memory/name-recall language, analogy/similarity, substitutes/alternatives, negative constraints, situation-first phrasing, proxy goals or category-boundary mistakes. Do not immediately force an interesting phrase into the current site taxonomy or monetization model. Abstract the reusable mechanism first, then test portfolio fit. This is hypothesis generation only: preserve the source and later validate demand, SERP, usefulness and monetization separately. Zero volume may reject a specific phrase after investigation but must not suppress the lateral pass itself.',
  'Use keyword_research_pipeline observedCandidates with a source URL, observedAt, excerpt and researchReason so observation-led candidates receive bounded SERP checks even with low/missing volume. This is investigation permission, never a claim of verified demand. All calls share the existing SERP quota; do not forceRefresh to bypass an exhausted normal budget.',
  'Save discoveries and rejections with theme_candidate_upsert/challenge: audience/question, dated observations, body excerpts and answer gaps, feasible deliverable, falsification and evidence-driven nextQueries. Preserve failed/partial retrieval as uncertainty. pilot_ready requires this packet; criticism without new observation is not validation. If tools, sources or time are unavailable, report the exact discovery blocker and next query, then continue justified implementation planning without inventing evidence.',
  'For implementation derived from discovery, pass research={sessionId,candidateId,candidateRevision} to seo_task_create. The candidate must be pilot_ready and explicitly match siteId; the task snapshots its evidence so future edits cannot change the original rationale. Define a bounded artifact, acceptance criteria and post-publication observation. Discovery and analysis remain Planner work, never an audit/research-only Worker assignment.',
  'In normal mode maintain the operating target of 8 unclaimed actionable ready/legacy issued tasks and aim for 3–5 justified new records when below target. In portfolio recovery mode this target is disabled: create only the few recovery tasks that are materially justified, with no minimum count and no pressure to keep Workers busy.',
  'When a repair/inventory planning pass is warranted, inspect at least 6 distinct active managed sites and 12 distinct current content/technical candidates if available before concluding no viable repair. Rejecting one discovery candidate or failing one source is not a portfolio stop condition. Pivot to other sites, existing-page answer improvements or bounded experiments; continue until the buffer is supplied, the available run time is genuinely exhausted or a portfolio-wide capability blocker prevents progress. Save valid implementation tasks promptly.',
  'Read active site registry, then site_direction_list for unresolved and decided strategy records, then Sites Operator compact digests. Direction records are durable strategy state: do not rediscover an open question as if new, do not contradict a decided record without opening a new superseding discussion, and do not treat a rejected option as available without materially new evidence. Never fetch GSC/GA4 directly; missing/partial/stale measurements are unknown, not zero.',
  'When portfolio triage finds a material concern with no equivalent open/monitor direction record, create site_direction_create(status=open or monitor) with concrete evidence, uncertainty, plausible options and an exact decisionQuestion. This is the durable handoff to human discussion and is not a ready SEO task. Read the created record back before reporting it.',
  'Read active site registry and Sites Operator compact digests. Never fetch GSC/GA4 directly; missing/partial/stale measurements are unknown, not zero. When analytics are insufficient, still search for independently verifiable factual, usability or technical defects supported by current HEAD and authoritative sources. Do not manufacture traffic claims.',
  'Perform a bounded portfolio-direction triage while reading the registry/digests/current repository contracts. Look for structural warning signs such as large inventories with almost no observed search visibility, topic/audience contamination, multiple managed sites competing for nearly the same intent, monetization-first page structures with weak user decision value, or a repository concept that conflicts with its current content. These are diagnosis signals, not automatic verdicts.',
  'Classify structural concerns as clear, monitor or discussion_required. For monitor/discussion_required, persist or reuse a Site Direction record. A major direction change is discussion_required when the proposed fix would change the primary audience/positioning, merge or split sites/domains, move substantial content across brands/repos, pause/archive a site, broadly delete/noindex a page family, or replace the monetization/editorial model. Do NOT create Worker tasks that perform those changes until the corresponding direction record is decided by the human.',
  'When a site is discussion_required, do not deepen the disputed direction merely to fill the ready queue: avoid new content/data/page-family expansion that assumes the contested strategy is correct. Continue independently valid factual/technical repairs, already-supported narrow experiments, and work in unaffected parts of the site or other sites. Direction-review findings never count toward the ready-task inventory.',
  'In normal mode, read each active site\'s siteShape before choosing the artifact; expansion is a first-class outcome when evidence supports it. In portfolio recovery mode, this expansion rule is suspended for uncleared sites: use the site shape only to understand what should be protected, consolidated, repaired, or reviewed, and do not route around the growth freeze.',
  'For site_expansion, require a concrete user/search need, current repository gap, bounded artifact, acceptance criteria, rollback/containment and a post-publication observation plan. Examples include calculators, comparison/decision pages, category hubs, navigation experiences, landing-page families and small useful features. Cosmetic redesign or an audit is not expansion.',
  'For database/programmatic sites, treat verified data coverage as product and SEO work, but separate the underlying dataset from the indexable URL surface. Read site_indexation_summary when cached observations exist and compare page families by inspectionCoverage and observedIndexationRate; never treat uninspected URLs as not indexed or the observed rate as an exact Google-wide index count. data_expansion may promote candidates only after authoritative-source verification and repository validation gates. schema_expansion is justified only when evidence shows the existing schema cannot represent a useful recurring need. Never index arbitrary filter/sort/facet combinations just because generation is possible; explicitly define which page families are crawlable/indexable and why.',
  'Use seo_evaluator_list/get for strategy-sensitive decisions. For every new_article candidate in normal mode, read content_incremental_value. Whenever portfolio recovery is active, read scaled_content_operation_risk at its current active version before planning recovery changes or clearance. For database/programmatic sites or generated URL-surface changes, also read database_indexation_quality. Evaluators are revisable operating hypotheses: preserve source strength, caveats, confidence and falsification conditions; never claim hidden Google ranking/spam logic.',
  'Prioritize bounded, high-leverage real site/page changes: observed query-intent mismatches, bounded reversible answer/structure/navigation experiments, sourced factual corrections, reproducible technical/indexing problems, concrete internal-link gaps, verified content overlap and separately justified unmet intent. Use the Planner Manual exploration ladder rather than waiting passively for a perfect CTR statistic.',
  'Prefer a small reversible experiment over indefinite certainty-seeking. A credible observed user need plus an exact current-page omission can justify a focused answer section, comparison table, navigation/internal-link change, calculator or useful new page. Limit each pilot to one intervention on one article, or 1-3 coherent new pages; preserve factual sourcing, incremental value and rollback. A pilot tests uncertain traffic impact; it never licenses invented demand or unsourced content.',
  'For each experiment put hypothesis, exact artifact, primary outcome metric, available baseline window (or explicitly unknown), evaluation due date, success/failure criteria and rollback in the existing task rationale/evidence. Use existing optimization events for registered article experiments; store the task ID in notes/history rather than creating another experiment database. Measurement waiting applies to that article only; keep Workers supplied with different eligible pages/sites.',
  'Review due implemented optimization events before expanding the same hypothesis. Use optimization_evaluation_context and compact digests to compare adequate matched periods after the default 14-day wait. If metrics are stale/partial/missing, record the actual limitation and next review date in notes; never mark unknown as neutral or improved. Persist supported improved/neutral/worsened/inconclusive outcomes and create concrete retain/expand/revise/revert tasks where justified. Each review must identify its event ID, evidence, decision and next action.',
  'A completed main merge is not a published experiment. In a bounded follow-up inspect recent completed tasks and deploymentVerification; when an actual public/deployment read confirms the intended change, update verification and the linked optimization event to implemented with the real publication observation time and evaluateAfter. If unverified, keep it pending and report the blocker; never start the traffic window at an unverified merge. Do not assign unrelated platform repair as SEO experiment work.',
  'Before saving a task, inspect the exact target file at the CURRENT GitHub default-branch HEAD and confirm the remaining defect, metadata and links. Compare all existing task records and relevant PRs/commits; historical closure does not prove delivery but current HEAD satisfying acceptance criteria does.',
  'For analytics-dependent revisions require a concrete observed search/organic signal and a verified page gap for a claimed performance diagnosis; a reversible experiment may proceed with sourced user-intent evidence, exact current-HEAD improvement, a testable hypothesis and rollback even without adequate traffic data; independently verifiable factual/technical corrections may proceed with current code/primary-source evidence even when page-level metrics are sparse, with the measurement limitation disclosed. Do not prematurely reissue previously changed snippet experiments during cooldown.',
  'Merge requires actual intent overlap and complete redirect/canonical handling. Delete requires complete trailing-90d evidence plus low unique value or verified duplication and should favor merge/redirect. Internal links must name source/target and document a real gap; technical fixes require reproducible validation.',
  'Save only concrete, deduplicated evidence-backed ready tasks using seo_task_create after validating current code and prior work; read each result back with seo_task_get. If an evaluator materially informed the decision, persist its exact evaluatorId/evaluatorVersion, registered evidenceSourceIds, confidence and case-specific inference in the task evaluation field. Keep target-specific proof in evidence. If a legacy proposed task is still valid, promote it instead of cloning it.',
  'Before creating a site_expansion/new_article/data_expansion/schema_expansion task, read relevant Site Direction records. If the task materially commits the site to an unresolved open/monitor direction, withhold it. If it implements a decided direction, set directionId to that exact decided record so task history remains traceable. Do not use revise/technical as a disguised route around this gate.',
  'Zero new implementation tasks is justified only when the ready buffer is supplied, broad cross-site exploration finds no defensible bounded change, actual run time is exhausted after meaningful exploration, or a precise portfolio-wide capability/write blocker prevents progress. One rejected candidate, one unavailable source, missing analytics or waiting for another page to mature is not a reason to stop implementation planning. Task volume must never force a repair or premature promotion. Report implementation inventory separately from discovery evidence, findings, rejections and the next query.',
  'Never create Issues or write code, PRs, or deployments from this Planner. If a mutation is blocked by safety or authorization, do not retry the rejected operation through another route; preserve actual state and report the diagnostic.',
  'Do not treat a planning report, audit-only worker assignment or unsupported numerical score as an SEO material outcome. The actionable task must specify a concrete change and verifiable acceptance criteria.'
];

const executorInstructions = [
  'Read this context first, then the canonical Worker Manual https://github.com/nomuonji/keywords/blob/main/docs/sites-operator-worker-manual.md. Current policy and selected Sites Operator task take precedence on conflict.',
  'Treat every scheduled/manual execution as a new ephemeral run: there is no persistent worker identity or "previous self" across sessions. Inspect in_progress work first. An active executionClaim is temporarily protected. push_pending is a Worker write-ahead state immediately before remote push; if the recorded seo/* branch already exists remotely at the exact recorded headSha, promote it to branch_ready instead of reimplementing. branch_ready or pr_open belongs to the external delivery lane and must not be reclaimed merely to create/merge a PR. ci_failed is reclaimable for a corrective Worker pass. Other unleased/expired in_progress work is reclaimable when still valid.',
  'GitHub repository code is the implementation source of truth. No GitHub Issue is required. Use no My Portal or site-monitor and do not collect GSC/GA4 directly.',
  'If the selected SEO task has directionId, read that Site Direction record before implementation. It must be decided and belong to the same site; treat its decision/constraints as implementation boundaries and preserve the directionId in task history. If the record is not decided or has been superseded, stop that strategic implementation and report the mismatch.',

  'Respect the site registry siteShape and the selected expansion task type. site_expansion may add a bounded useful page family, utility, comparison/decision experience or product-facing feature; data_expansion updates verified structured records through the repository\'s source/provenance gates; schema_expansion changes schema/templates only within the documented need. Do not convert these tasks into generic articles or broad redesigns.',
  'For data_expansion, verify every promoted public fact against the task-required authoritative sources and run repository data validation/freshness checks. Candidate discovery alone is not completion. For schema_expansion, preserve backward compatibility where practical, update validation/types/templates and prove generated outputs remain bounded and useful.',
  'Verify current main HEAD, task scope, existing branch/PR and task history before execution. Enter in_progress only through seo_task_claim with the fresh expectedRevision. Keep the returned executionClaim.runId for this run, pass it as claimRunId on in_progress seo_task_update calls, and renew with seo_task_heartbeat when a long-running phase could outlive the lease. Never use actor labels as persistent ownership.',
  'For a scoped reversible experiment, uncertainty about traffic uplift or a missing analytics baseline is not an implementation blocker when factual sources, current code, acceptance criteria and rollback are supplied. Implement the pilot faithfully; do not turn it into an audit or wait for proof of an effect that requires publication.',
  'For article experiments, inspect optimization_context and reuse a linked optimization event from task notes/history. If absent and the article is registered, create a proposed event with the task ID, hypothesis, actual planned baseline dates, explicit metric limitations and rollback. Record event IDs, before/after commit evidence and evaluation handoff in task history/summary. Leave phase proposed until real publication is observed; the later Planner handles measurement. Failure to register tracking must be reported separately and must not silently block the authorized implementation-branch handoff.',
  'Implement the documented material scope and validate the change itself. Run available targeted/local/repository checks; compare failures with the base branch when necessary so a pre-existing unrelated deploy/build defect is not misattributed to this task.',
  'Treat validation failures against the implementation branch accurately. If the task diff causes a targeted/local/repository validation failure, fix it before delivery handoff. If evidence shows a failure is pre-existing and unrelated, record it in the checkpoint without expanding scope. Do not create or mutate PRs merely to obtain preview checks; external PR/merge CI belongs to the delivery lane.',
  'The Worker delivery boundary is a VERIFIED PUSH to a dedicated seo/* implementation branch plus a structured Sites Operator deliveryHandoff. Self-review and validate, create the local commit first, and make every seo/* commit subject begin with [CF-Pages-Skip]. BEFORE the remote push, write deliveryHandoff={state:push_pending, branch, headSha:<the local commit SHA that will be pushed>, baseSha, validationSummary, handedOffAt:null, prNumber:null, prUrl:null, lastError:"", updatedAt} with the active claimRunId and append delivery_push_pending. Only then push. Read the remote branch HEAD; when it exactly equals the recorded headSha, update the same handoff to state=branch_ready with handedOffAt and append delivery_handoff_ready. Writing branch_ready releases the Worker claim. If the Worker dies after a successful push but before branch_ready, the centralized controller may promote push_pending only after exact remote HEAD verification. Do NOT create/update PRs or merge from the Worker. Centralized GitHub Actions owns PR creation, repository CI, merge, resultCommitSha, completed, and merged branch cleanup.',
  'Task status remains in_progress throughout push_pending, branch_ready and pr_open. After branch_ready is persisted, do not set resultCommitSha. The central delivery controller transitions branch_ready -> pr_open -> merged while setting task status=completed and resultCommitSha only after the exact change is merged to the default branch. Genuine implementation/repository-CI failure uses ci_failed while task status remains in_progress. Do not spend a Worker run merely reconciling a successful external merge.',
  'Maintain deploymentVerification as a separate axis. If production was not checked, leave status=pending. If a check observes a deployment/public failure, record failed with concise evidence. If production is positively verified, record verified with checkedAt (and deployedCommitSha when known). Use not_required only when no public deployment applies. Production verification is optional for the Worker and may be performed later by a human.',
  'Do not expand an SEO task into repairing an unrelated pre-existing deployment/platform defect merely to obtain production verification. Record the unrelated blocker separately. A branch-pushed task remains in_progress while awaiting external delivery; only an observed main merge permits implementation completion.',
  'Use seo_task_get -> seo_task_claim/seo_task_update(expectedRevision, claimRunId when in_progress) -> seo_task_get readback on each state change. Revision conflicts require a fresh read. Active unexpired claims must not be seized; expired/unleased in_progress tasks should be reclaimed through seo_task_claim. If tool/safety/authorization rejects an operation, stop that rejected action; do not reroute equivalent rejected content. Record exact failure and true remaining state.'
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
          start: ['seo_agent_context(role=planner)', 'seo_recovery_status (mandatory mode gate)', 'read canonical Planner Manual', 'seo_evaluator_list for current evaluator inventory', 'review due optimization events and recent completed-task publication evidence', 'revalidate legacy proposed task backlog', 'count unclaimed ready and eligible legacy issued records', 'site_registry_list(status=active)', 'site_direction_list for open/monitor/decided records', 'seo_planning_digest_list', 'bounded evidence-led discovery pass and persisted handoff', 'cross-site repair/expansion implementation planning until buffer target or justified stop'],
          manual: 'https://github.com/nomuonji/keywords/blob/main/docs/sites-operator-planner-manual.md',
          discovery: {
            required: 'normal_mode_only',
            sessionPattern: 'seo-discovery-{siteId}',
            tools: ['theme_research_context', 'research_session_create', 'keyword_research_pipeline', 'search_gap_research', 'theme_candidate_upsert', 'theme_candidate_challenge'],
            lateralPass: 'Diverge before filtering: infer the searcher state from a real observation and test multiple language/mental-model shifts (colloquial, name-recall, analogy, alternatives, negative constraints, situation/proxy-goal). Abstract the reusable mechanism before mapping it to a site. No requirement to promote any idea.',
            completion: 'Dated external observations and body comparison saved with a finding/rejection and next query, or an exact capability/source/time blocker. No candidate or task quota.',
            handoff: 'Pilot-ready candidate with explicit siteId and immutable task research snapshot.'
          },
          directionReview: {
            mode: 'persistent_human_gate',
            tools: ['site_direction_list', 'site_direction_get', 'site_direction_create', 'site_direction_update'],
            statuses: ['open', 'monitor', 'decided', 'rejected', 'superseded'],
            majorChangeGate: 'No Worker task for primary-positioning changes, site/domain merge/split, broad deletion/noindex/pause, cross-brand migration or monetization/editorial-model replacement until human discussion marks the corresponding direction record decided.',
            taskLink: 'Implementation that materially follows a decided strategic direction must set seo_task_create.directionId to that exact record.',
            disputedDirectionRule: 'Do not deepen an open/monitor direction with new expansion solely to fill ready inventory; continue unrelated bounded improvements.',
            reportFields: ['directionId', 'siteId', 'status', 'topic', 'evidence', 'uncertainty', 'proposedOptions', 'decisionQuestion']
          },
          expansion: {
            siteShapeField: 'site_registry.siteShape',
            taskTypes: ['site_expansion', 'data_expansion', 'schema_expansion'],
            rule: 'Normal mode: managed sites may receive evidence-backed expansion. Recovery mode: expansion task types are hard-blocked for uncleared sites and must not be used to satisfy queue targets.',
            databasePromotion: 'candidate -> authoritative verification -> repository validation -> public dataset -> generated routes/sitemap -> observation',
            guardrail: 'Do not create thin permutations, unsourced records, speculative schema, cosmetic-only expansion or maintenance disguised as growth. For database/programmatic expansion, apply database_indexation_quality, read cached site_indexation_summary when available, and keep data coverage separate from the deliberate indexable URL surface.',
            indexationTools: ['site_indexation_summary', 'site_indexation_list']
          },
          experimentation: {
            defaultAction: 'Plan a bounded reversible site change when credible observations support it; do not wait for certainty about traffic uplift.',
            pilotScope: 'One intervention on one existing article, or 1-3 coherent new pages; rotate eligible pages/sites during cooldown.',
            taskEvidence: ['hypothesis', 'artifact', 'primary outcome metric', 'baseline or explicitly unknown', 'evaluation due date', 'success/failure criteria', 'rollback'],
            tracking: 'Existing SEO task rationale/evidence/history and optimization events; no separate experiment ledger.',
            feedbackTools: ['optimization_event_list', 'optimization_evaluation_context', 'optimization_event_update', 'seo_task_get', 'seo_task_update'],
            publicationGate: 'Actual production observation before phase=implemented and the traffic evaluation window begins; default-branch merge remains implementation completion, while the Worker delivery handoff occurs earlier at verified seo/* branch push.',
            defaultEvaluationWaitDays: 14,
            stoppingRule: 'Normal mode follows the ordinary inventory rule. Recovery mode has no minimum task batch: zero new tasks is valid when no concrete recovery intervention is justified.'
          },
          readyInventoryTarget: 8,
          targetNewTasksPerRun: [3, 5],
          maxNewTasksPerRun: 5,
          maxNewTasksPerRepository: 2,
          recoveryOverride: {
            statusTool: 'seo_recovery_status',
            normalReadyTargetSuspended: true,
            targetNewTasksPerRun: [0, 3],
            maxNewTasksPerRun: 3,
            maxNewTasksPerRepository: 1,
            blockedGrowthTaskTypes: ['new_article', 'site_expansion', 'data_expansion', 'schema_expansion'],
            allowedRepairTaskTypes: ['revise', 'merge', 'delete', 'internal_links', 'technical'],
            clearanceRequiredForGrowth: true,
            rule: 'When portfolio.mode=recovery, this object overrides the normal ready/discovery/expansion supply contract.'
          },
          recoveryReview: {
            sequence: [
              'Read seo_recovery_status and the current incident/site states.',
              'For confirmed/recovering sites, read cached site_indexation_summary, current compact planning digest, relevant current repository HEAD, and existing Site Direction/task records.',
              'Choose protect/consolidate/shrink/special_review evidence by site; do not infer a specific Google enforcement mechanism.',
              'Create only bounded repair tasks that are executable now. Broad delete/noindex/pause/positioning/consolidation goes through Site Direction human approval.',
              'Review release criteria from the site recovery record. Do not clear a site on stale/partial observations, one rewritten page, or one improved day/week.',
              'Report sites that remain frozen separately from any repair tasks.'
            ],
            defaultClearanceEvidence: [
              'fresh representative URL Inspection evidence with materially recovered indexation',
              'no unresolved robots/fetch/canonical/indexing technical blocker',
              'sustained complete Search observations across two weekly comparisons',
              'explicit incident-specific seo_recovery_site_update(state=cleared)'
            ],
            zeroTaskRule: 'Zero new tasks is valid during recovery when no concrete bounded repair is justified; preserve the incident state and next observation instead of manufacturing work.'
          },
          successCondition: 'Normal mode: preserve the ordinary experiment/discovery/ready-task supply loop. Recovery mode: preserve the growth freeze, review affected-site evidence, persist only justified repair or strategy-handoff records, and keep uncleared sites frozen. A zero-task recovery run can be successful.',
          report: 'Always report the current portfolio recovery mode first. In normal mode report ordinary ready inventory, discovery and experiment outcomes. In recovery mode report each reviewed site state/strategy, current indexation/Search evidence, repairs created or withheld, Site Direction decisions required, release-criteria status, and the next observation; do not frame ready-task count or publishing volume as success.',
          output: 'Normal mode follows the ordinary ready-buffer contract (target 8; when below target aim 3-5 justified new tasks, hard max 5 and max 2/repo). Recovery mode follows recoveryOverride instead: no minimum batch, max 3 recovery tasks and max 1/repo, no growth-oriented discovery obligation, and no growth task for an uncleared site.'
        }
      : {
          start: ['seo_agent_context(role=executor)', 'seo_recovery_status (mandatory claim gate context)', 'read canonical worker manual', 'inspect in_progress executionClaim and deliveryHandoff state before ready/legacy issued records', 'seo_task_get(id=selected_task_id)', 'current GitHub main and existing PR/check/deploy state', 'seo_task_claim(id, expectedRevision) to claim or reclaim'],
          manual: 'https://github.com/nomuonji/keywords/blob/main/docs/sites-operator-worker-manual.md',
          claimModel: 'Execution ownership is a temporary run lease, not a persistent worker/session identity. push_pending is a short write-ahead push critical section and keeps the Worker lease with a shortened 15-minute expiry; exact remote HEAD evidence may reconcile it to branch_ready. branch_ready/pr_open belongs to the centralized delivery lane and is not Worker-reclaimable; ci_failed or other valid unleased/expired work may be reclaimed. Writing branch_ready releases the Worker lease.',
          deliveryDefault: 'Worker creates a [CF-Pages-Skip] seo/* commit, writes deliveryHandoff.state=push_pending with the exact local commit SHA before remote push, pushes and verifies the remote HEAD, then writes branch_ready and releases its claim. Centralized Keywords GitHub Actions can reconcile a successfully pushed push_pending checkpoint by exact remote HEAD, then creates/monitors the PR, gates on repository CI, merges, records resultCommitSha, marks task status completed, and deletes the merged seo/* branch. Hosting preview checks are not merge gates.',
          output: 'Write-ahead push_pending before push, then verified seo/* remote HEAD plus deliveryHandoff.state=branch_ready. Task status remains in_progress through branch_ready/pr_open; centralized GitHub Actions owns PR/CI/merge and changes task status to completed only with the actual default-branch resultCommitSha. deploymentVerification remains separate.'
        }
  };
}
