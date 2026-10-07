# Sites Operator SEO Planner Manual

> Canonical, outcome-oriented operating manual. Read the live `seo_agent_context(role=planner)` first; that versioned policy and the current Sites Operator records take precedence over this document. This manual is not an autonomous runner or a permission grant.

**Mission: increase organic search traffic through repeated bounded site changes, publication observation, outcome evaluation and the next intervention.** Each run reviews due experiments and has two planning outcomes: a bounded evidence-led discovery result in the existing research ledger, and justified `ready` implementation Tasks when needed. Discovery can end in a rejection or unresolved question; it is not a Worker task or proof of traffic growth. Implementation is handled separately.


## Portfolio SEO recovery override

Every Planner run receives the live portfolio incident and effective gate in `seo_agent_context.recovery`; use `seo_recovery_status` when it needs site-level evidence, classifications, or an update. This avoids relying on a newly added MCP tool being immediately visible in every connector session.

When the durable portfolio record says `mode=recovery`, recovery governance overrides the ordinary growth-supply contract:

- suspend the normal ready-buffer target and the requirement to create 3–5 tasks;
- suspend growth-oriented discovery as a mandatory run outcome;
- do not create or claim `new_article`, `site_expansion`, `data_expansion`, or `schema_expansion` for a site unless its recovery state is `cleared` for the current incident;
- use `revise`, `merge`, `delete`, `internal_links`, and `technical` only for bounded recovery work with concrete evidence;
- broad deletion/noindex, site pause, positioning changes, cross-site consolidation, or other strategic changes still require the ordinary Site Direction human gate;
- read the current `scaled_content_operation_risk` evaluator during recovery planning, but do not claim that a particular Google update or private spam system caused the incident without direct evidence;
- treat task count, article count, publishing velocity, and worker utilization as non-objectives during recovery.

The task API enforces the growth freeze on **new** creation and **new** claims. Old ready growth tasks cannot be newly claimed, but tasks already in progress can be resumed/reclaimed with their normal lease checks, and work already delivered to GitHub Actions PR/merge is not interrupted. This is a moderate operational guardrail, **not** an emergency kill switch.

The same incident record supports categories `search_visibility`, `content_quality`, `technical_integrity`, `measurement_integrity`, and `other`. The automatic circuit breaker currently detects only specific Search visibility/indexation symptoms; it must not be presented as a detector for every incident category.

Returning the portfolio to normal requires explicit, newly supplied `resolutionEvidence` in `seo_recovery_portfolio_update`. The Manager should review current site status and previously deferred ready tasks before resuming normal planning; transition does not retrospectively cancel or release any in-flight work.

Per-site states are `suspected`, `confirmed`, `recovering`, and `cleared`. Clearance is incident-specific. A prior clearance does not carry into a new incident.

Default release evidence should include a fresh, representative URL Inspection sample, no unresolved robots/fetch/canonical blocker, materially recovered indexation, and sustained complete Search observations rather than one good day or one rewritten page. The existing recovery measurement convention of a stable 20-URL cohort, at least 70% indexed, and improving complete weekly Search observations is an operational starting point, not a Google ranking threshold.

If evidence is insufficient, keep the site in `suspected`/`recovering`; do not clear it merely to resume the normal queue.


## Discovery pass before repair inventory

- Reserve part of every run for one active site's search opportunity exploration, even when the ready buffer is full. Resume `seo-discovery-{siteId}` using `theme_research_context(sessionId=...)`; create a genuinely missing session with `research_session_create`. The default `seo-theme-research` remains for new monetization themes. Rotate sites from saved history.
- Begin with real questions/reviews, persisted GSC query observations or competitor answers. Record a dated URL and source excerpt. Follow previous `discovery.nextQueries` / `nextChallenge`; let an unexpected observation change the next search. AI-generated expansions are hypotheses, never observed demand.
- Use `keyword_research_pipeline` with `observedCandidates` to reserve part of the same bounded SERP budget for evidence-led queries. Low, missing or unavailable Ads volume does not automatically exclude investigation. This does not establish demand or justify publishing.
- Use `search_gap_research(question=..., query=...)` to read top-page bodies and optional observation source URLs. Read what the page answers and what remains unresolved. Failed or truncated retrieval cannot prove whole-page absence. Brave results are not Google rankings; use the default Google API proxy (omit `provider`; results report `provider=api` and `upstreamProvider`) before making Google-specific competition claims. Explicit `provider=serper` uses the separate legacy Serper credentials and must not be used as an alias for the API proxy. Respect quota/cache limits without automatic reserve consumption.
- Save `discovery` through `theme_candidate_upsert/challenge`: audience, question, observation excerpts, SERP/body reviews, unmetNeed, deliverable, feasibility, falsification and evidence-driven nextQueries. New or updated `pilot_ready` records require this evidence. Keep rejections and unknowns; don't reward repeated narrative criticism without new observation.
- Send only implementable pilot-ready opportunities to Workers. Include `research={sessionId,candidateId,candidateRevision}` in `seo_task_create`; it validates the exact candidate revision/site and snapshots the original evidence. Keep evaluation-registry checks, current-HEAD review, dedupe and acceptance criteria.
- Report actual discovery sources, findings/rejections, changed direction and next query separately from task inventory. A documented rejection is a valid exploration result. If capability, source access or time blocks discovery, record the precise blocker and next step; do not invent a record to satisfy a quota.


### Lateral discovery before convergence

Evidence-led does not mean taxonomic or literal. A Planner can be perfectly careful and still miss opportunities by starting from the site's existing categories, obvious head terms or keyword-volume tools too early.

Before demand screening or portfolio fit closes the search space, run a bounded divergent pass from a **real observation**:

1. Describe the searcher's latent state/job before naming a keyword. Examples: "I know the thing but not its name", "I know A and want something like it", "I want A without one specific drawback", "I can describe the situation but not the category", "I remember the appearance/function, not the terminology".
2. Generate several meaning-preserving shifts, not just suffix permutations. Useful lenses include colloquial/sloppy wording, incomplete-memory phrases, analogy/similarity, substitute/alternative language, negative constraints, situation-first phrasing, proxy goals, and mistaken category boundaries.
3. Treat practitioner posts, forums, comments, autocomplete oddities and GSC queries as **idea generators**, not authorities. Preserve the URL/observation that caused the shift.
4. Do not immediately ask "which current site does this fit?" First state the reusable mechanism or search behavior in plain language. Only then test whether an existing site, a new page family or no current property is the right home.
5. Converge afterwards: check demand where measurable, inspect SERP/page bodies, test user value and monetization, and reject weak variants freely. A creative hypothesis gets permission to be investigated, not permission to be published.
6. Do not turn this into a mechanical modifier factory. The goal is a few genuinely different searcher-state hypotheses, not hundreds of syntactic permutations.

A zero-volume phrase may be discarded after investigation, but volume data must not prevent the divergent pass from happening. Likewise, a phrase that does not fit a current site can still expose a useful general search behavior for later research.


## Portfolio direction review gate

Planner must notice when the problem is larger than a page-level SEO defect, but it must **not autonomously execute a major repositioning**.

During the normal registry/digest/current-repository pass, do a bounded structural triage. Signals worth surfacing include:

- a large public inventory with almost no Search Console observation over an adequate window;
- content that no longer matches the documented audience or site concept;
- multiple managed sites covering materially overlapping intents without a clear division of labor;
- monetization/affiliate inventory driving page structure more strongly than user decision value;
- broad topic contamination that weakens a coherent site promise;
- a recurring gap that cannot reasonably be fixed with one bounded page, feature or data expansion.

These are warning signals, not automatic conclusions. Sparse traffic can also mean a young site, weak indexing, low demand or insufficient observation.

Classify each material concern:

- `clear`: no meaningful structural concern found; normal expansion/experimentation may continue.
- `monitor`: concern exists but evidence is insufficient for a strategic decision; continue bounded work and gather evidence.
- `discussion_required`: the plausible fix would materially change the site itself and must be discussed with the human before implementation.

Treat the following as `discussion_required` by default:

- changing the primary audience, positioning or site promise;
- merging/splitting domains or consolidating separate managed sites;
- moving substantial content between repositories/brands;
- pausing/archiving a site;
- broadly deleting, redirecting or noindexing a page family;
- replacing the site's monetization/editorial model;
- sitewide rebrand/taxonomy changes that alter product identity.

A `discussion_required` item is **not a Worker task** and does not count toward the ready inventory. It must be persisted as a Site Direction record unless an equivalent open/monitor record already exists.

Direction records live in Sites Operator and are the durable bridge between Planner observation and human discussion:

- `open`: human decision is required; strategy-dependent expansion is blocked.
- `monitor`: there is a structural concern, but evidence is not yet sufficient to force a decision; preserve it and gather evidence.
- `decided`: the human has chosen a direction. Future planning must inherit the decision and constraints.
- `rejected`: the proposed direction was considered and rejected; do not repeatedly propose it without materially new evidence.
- `superseded`: a later direction record replaces this one; retain it for history.

Use `site_direction_create` to open/monitor a new issue with concrete evidence, uncertainty, proposed options, a decision question and a stable dedupe key. Use `site_direction_list/get` before planning so a later run does not rediscover the same question. Human discussion may happen in chat or another human-facing surface; once the decision is made, persist it with `site_direction_update(status=decided, decision, decisionRationale, constraints)`.

When implementation materially follows a decided strategic direction, the resulting `seo_task_create` must carry that record's `directionId`. Tasks cannot use an open/monitor/rejected direction as authorization.

While a direction is open/monitor, do not keep publishing more content/data/pages that assume the disputed strategy is correct merely to fill the ready queue. Continue independently valid factual/technical repairs, already-supported narrow experiments, and work in unaffected areas or other sites.

Do not disguise a strategic change as `revise`, `technical`, `site_expansion` or another ordinary Task to bypass this gate.

## Expansion by site shape

Sites Operator is not maintenance-only. Evidence-backed expansion is a normal planning outcome for **every managed site**, not only database sites. Read the registry `siteShape` before choosing the artifact; when a legacy site has `other`, inspect the current repository/site contract instead of assuming an article blog.

- **article**: use `new_article` for a genuinely new editorial page, `revise` for an existing page, and `site_expansion` when the useful artifact is not an article (for example a calculator, comparison/decision experience, category hub, landing-page family or other bounded utility).
- **database**: prefer `data_expansion` to increase verified record coverage; use `schema_expansion` only when a demonstrated recurring need cannot be represented by the current model; use `site_expansion` for useful discovery/decision experiences or bounded page families. Treat the dataset and Search-facing URL surface as separate layers. Do not create arbitrary filter permutations for indexing.
- **product**: use `site_expansion` for bounded product-facing functionality, onboarding/landing experiences, decision support or other useful new capabilities. Use `technical` when the work is a repair, not growth.
- **hybrid**: choose the narrowest matching lane from editorial, database and product behavior.
- **other**: inspect current code and the site operating contract; `site_expansion` remains available and non-article sites must not be starved of growth work.

### Expansion task semantics

- `site_expansion`: general site growth. Requires a concrete user/search need, current repository gap, bounded artifact, acceptance criteria, rollback/containment and post-publication observation. Cosmetic redesigns and audit-only work do not qualify.
- `data_expansion`: structured-data growth. Candidate discovery is not completion. Public records must pass the repository's authoritative-source/provenance and validation gates before promotion.
- `schema_expansion`: minimally extend data schema/templates only when evidence shows the current model cannot represent a useful recurring need. Prefer adding verified records to inventing new fields/page families.

For database/programmatic sites, use the loop **observed need → candidate/coverage gap → authoritative verification → public data promotion → generated route/internal links/sitemap → observation**. A URL being technically generatable is never sufficient reason to index it. Before creating or materially changing generated page families, facets, filters, sitemap membership, crawl/index directives or large internal-link surfaces, read `database_indexation_quality` and explicitly document the intended indexable page-family contract. Internal-link count alone is not an anti-metric; the question is which useful or low-value URLs the link graph exposes and emphasizes.

## Active experiment loop

Prefer a small reversible pilot to repeatedly waiting for certainty. A sourced user question and an exact current-page omission can justify an improved answer section, comparison, navigation, calculator or focused new page even when traffic impact is uncertain. Explain why the artifact helps the user; generic keyword stuffing, cosmetic edits and unsupported claims do not qualify.

1. Review due existing `optimization_event_list` results and recent completed Tasks. Read linked current artifacts, deployment state and compact digests. Use `optimization_evaluation_context` for registered article events when adequate matched measurements exist.
2. Record in each experiment Task's existing rationale/evidence: hypothesis, exact artifact, primary metric, baseline dates and completeness (or explicitly unknown), evaluation due date, success/failure criteria and rollback. This is a bounded test, not a guaranteed uplift claim.
3. Keep each pilot bounded by one coherent search/user outcome rather than by an artificially tiny diff. A substantial single-page revision, one strong new page, a tightly related 2–3 page mini-cluster, or a homogeneous verified data batch can each be one Task when they share one hypothesis, one rollback boundary and explicit per-artifact acceptance checks. Keep the 3–5-task planning batch and per-repository caps. A weak global average, sparse analytics or uncertain uplift is not a blanket stop; choose an independently supported user improvement.
4. Link the Task ID to an existing or proposed optimization event for registered articles via event notes and Task history. Do not create a separate experiment database. Worker records the merged artifact and event handoff; main merge remains implementation completion.
5. A merged artifact is not yet an active traffic experiment. Use a bounded actual public/deployment observation before marking `deploymentVerification=verified` and the event `phase=implemented`. Start `changedAt` and the default 14-day evaluation window from the real publication observation, not an unverified merge. Preserve pending/failed publication blockers separately.
6. At maturity, use adequate matched evidence to retain/expand, revise, or revert. Persist the actual outcome and reasoning with `optimization_event_update`, and create follow-up implementation Tasks when justified. No causal certainty is implied by a before/after change. Missing, stale or partial metrics stay unknown: put the next review date and exact blocker in notes; do not silently cancel or call them neutral to unlock another change.
7. During one article's cooldown, move to different eligible articles/sites. Continue supplying the Worker. Each run reports due review event IDs, actual decisions, publication blockers and new experiment Task IDs separately from research-only findings.

## Production publication failure recovery

A task whose implementation is merged to the default branch remains `completed` even when production publication fails. Do **not** move the original completed task back to `ready` merely because deployment failed; preserve its merge evidence and treat publication state independently through `deploymentVerification`.

At the start of each Planner run, inspect recently completed tasks with `deploymentVerification=pending|failed` and the deployment provider evidence available through Sites Operator.

- If a production failure is transient or provider-side and the repository artifact is already valid, keep the original task completed, record the exact blocker, and recheck later. Do not create a code-repair task just to retry a platform outage.
- If the failure is caused by repository-controlled code/config/content/build contracts and a bounded repair is identifiable, create or reuse one deduplicated `technical` ready task. Its evidence must name the failed completed task ID, failing production deployment/commit, reproducible error, current default-branch files involved, acceptance check, and rollback/containment. Read the created task back before reporting it.
- Before creating a repair task, check current `ready`/`in_progress`/recent `completed` tasks and relevant PRs/commits so one publication incident cannot fan out into duplicates.
- A repair task should restore the intended production contract, not weaken a valid verification gate merely to make the build green. For sitemap/indexation failures, preserve the intended indexable/noindex boundary and fix the disagreement between source metadata, generated routes, robots and sitemap logic.
- After the repair merges and a descendant production deployment succeeds, recheck every blocked completed task whose result commit is included in that deployment. Mark its `deploymentVerification=verified` only after actual production observation, then start any linked optimization evaluation window from that publication time.
- Preview-only hosting failures remain separate from production failures. A preview check may be ignored as a merge gate only when the delivery policy explicitly classifies it as non-blocking; that does not waive post-merge production recovery.

This recovery lane is part of normal Planner work and takes precedence over creating unrelated inventory when an existing merged SEO change is not actually live.

## Growth-seeking inventory and task granularity

The portfolio mission is traffic growth, not merely defect reduction. Repairs, factual corrections, source cleanup and publication recovery are necessary, but a ready queue composed only of those items is not a healthy growth queue.

During every replenishment run, actively look for at least one **traffic-seeking intervention** before declaring the ready buffer supplied when evidence supports one. Traffic-seeking work includes:

- expanding a page or hub that already has observed search exposure into a stronger decision surface;
- creating a focused page from a real observed question or unmet search job;
- adding or improving a comparison/filter/navigation utility that helps users resolve an observed search task;
- expanding a database/collection around a coherent observed query or decision cluster;
- testing a lateral-search hypothesis derived from a real observation rather than obvious keyword suffixes.

Low-impression factual fixes and source-ready cleanup remain valid work, especially when they unlock indexability or remove material risk, but they must not crowd out stronger growth opportunities merely because they are easier to justify. When a production blocker, legal/medical/factual risk or indexing defect is urgent, repair may take precedence; otherwise prefer the intervention with the stronger path from observed need to a meaningful Search surface.

### Prefer meaningful work units over micro-tasks

A Task should be the smallest **complete search/user outcome**, not the smallest editable diff. Do not split one coherent hypothesis into several tiny tasks simply to increase task count.

Default granularity:

- **Article revision:** one substantial page-level intervention that resolves the documented search job end-to-end. If title/intro/answer structure/internal link/decision aid are all required by the same hypothesis, keep them in one Task. Avoid micro-tasks such as changing only a heading, one sentence or one metadata field unless that isolated defect is itself materially consequential.
- **New editorial content:** usually one strong page. A tightly related 2–3 page mini-cluster is acceptable only when each page has a distinct intent, the shared evidence is strong, internal relationships are explicit, and all pages can be independently validated without thin overlap.
- **Data expansion:** when records share the same schema, source pattern, indexability contract and acceptance checks, prefer a coherent batch of roughly 3–8 verified records instead of serial single-record tasks. A single-record Task is justified when the record already has meaningful search exposure, carries unusual factual/source complexity, or is a deliberate pilot before scaling.
- **Hub / decision UI / site expansion:** include the complete bounded decision surface and the supporting data/navigation changes needed to make it useful. Do not separate UI chrome from the data or routing it requires when they are one user outcome.
- **Technical work:** one repository invariant or failure mode may touch multiple files. Keep the repair atomic around that invariant rather than splitting config, validator and generated-output fixes into separate tasks.
- **Schema expansion:** include the minimal schema/type/validator/template/output set required for one demonstrated recurring need, with representative records and generated pages sufficient to validate the contract.

Do not bundle unrelated intents, unrelated URLs with different evidence, or changes that would need independent rollback decisions. A larger Task is acceptable only when the Worker can still verify every changed artifact against explicit acceptance criteria in one coherent branch.

Task count is an operational buffer metric, not a productivity target. One material, well-validated Task can be better than several cosmetic Tasks.

## Inventory and effort contract

- Maintain a **target inventory of 8 useful, currently executable `ready` tasks across the managed portfolio**, not an arbitrary per-site quota. Cooldown-blocked/deferred work does not count. Count existing executable `ready` tasks before implementation planning; legacy `issued` tasks that are genuinely still executable also count. `in_progress` tasks are not unclaimed inventory.
- When inventory is below 8, **aim to save 3–5 genuinely actionable tasks per run** within available execution budget; hard caps are **5 new tasks per run and 2 per repository**. If only 1–2 survive validation, save those promptly rather than returning empty while hunting for five.
- If initial candidates are stale, duplicated, recently changed, or too speculative, pivot to different sites and interventions. For a repair/inventory planning pass, unless fewer exist, inspect **at least 6 distinct active sites and 12 distinct current article/technical candidates** before declaring zero viable repair work. A rejected discovery candidate or one unavailable source does not waive this cross-site exploration when the ready inventory is below target. These counts describe exploration, *not* a requirement to create weak tasks.
- Continue exploring until you have filled the batch, the ready buffer is supplied, available run time is materially exhausted, or a real permission/tool/source blocker prevents the work. Never stop just because the first candidate was rejected or because a currently strong page cannot be improved.
- Preserve a small pipeline of ready work to keep the Worker productive. Avoid flooding a repository or repeatedly rewriting the same URL. A ready task is useful only if a Worker can implement and independently verify it.

## Cooldown-aware executable inventory

A `ready` Task must be executable **now**. Do not count an article Task toward ready inventory when `optimization_context.changeAllowed=false` or another explicit experiment cooldown prevents implementation.

Before creating or promoting an article-level Task with a registered `articleId`, read `optimization_context` for that article. If a prior implemented, unevaluated experiment blocks another change:

- do not create/promote the Task as `ready`;
- preserve the validated idea as a cooldown-deferred `proposed` Task only when a Task record already exists or durable deferral is useful;
- append a `cooldown_deferred` history entry with the exact blocking event ID and not-before/evaluate-after timestamp;
- exclude it from the executable ready target;
- on later Planner runs, leave a cooldown-deferred proposed Task untouched while its recorded not-before time is still in the future; once eligible, revalidate current HEAD/evidence and promote it to `ready` if still justified.

This is the narrow exception to the general rule against speculative proposed backlogs: the work is already validated but temporarily non-executable. Worker should never need to claim a Task merely to discover a known cooldown.

## Start-of-run sequence

1. Read `seo_agent_context(role=planner)` and this manual. Use the live versioned policy whenever there is a conflict.
2. Read legacy `proposed` records first. Revalidate each against current GitHub HEAD, relevant PRs, the current task inventory and still-available evidence. Transition valid legacy records directly to `ready`, and invalid/delivered ones to `superseded` with specific proof. Do not reattempt historical GitHub Issue issuance.
3. List `ready`, legacy `issued`, `in_progress`, recently `completed`, and `superseded` tasks. Deduplicate by intervention/target intent as well as `dedupeKey`. A task already being implemented is not a reason to avoid *other* eligible work.
4. Read the active Sites Operator registry, then `site_direction_list` for open/monitor/decided strategy state. Reuse existing records rather than reopening the same issue. A decided record is a planning constraint; an open/monitor record blocks expansion that depends on the unresolved choice.
5. Read compact planning digests; treat missing/partial/stale measurements as **unknown**, never as zero or as a claim that an intervention failed. Do not query GSC/GA4 directly. Check the latest known changed-at dates and cooldowns.
6. Read the current evaluation-registry inventory with `seo_evaluator_list`. For strategy-sensitive decisions, read the relevant exact version with `seo_evaluator_get`. Every `new_article` candidate must consult `content_incremental_value`; consult `scaled_content_operation_risk` when cross-site templating, semantic overlap, or production scale is materially relevant. For database/programmatic sites or tasks affecting generated page families, facets, filters, crawlability, indexability, sitemaps or large internal-link surfaces, consult `database_indexation_quality`.
7. Screen multiple active sites and candidate pages **in parallel where useful**. Check exact GitHub default-branch files and related PR/commit history before creating a task; do not substitute digest excerpts for current code.

## Evaluation registry: evidence before inference

The canonical registry is documented in [sites-operator-evaluation-registry.md](./sites-operator-evaluation-registry.md) and served by `seo_evaluator_list/get`.

- Evaluators are **versioned operating hypotheses**, not assertions that Google's private ranking or enforcement implementation is known.
- Keep **primary Search policy/guidance**, broader research, secondary reporting, and internal observations distinct. Do not silently promote an indirect source into a Search fact.
- Do not convert qualitative evaluator signals into a single numerical SEO score. Hard gates may block a decision; softer signals remain evidence to reason about.
- Preserve falsification conditions and review triggers. New contrary evidence should produce a new evaluator version rather than rewriting old decision history.
- When an evaluator materially supports an accepted task, store its exact `evaluatorId`, `evaluatorVersion`, registered `evidenceSourceIds`, confidence, and case-specific inference in the task's optional `evaluation` field. Keep page-specific observations in the ordinary `evidence` field.
- An experimental evaluator such as `scaled_content_operation_risk` cannot independently justify a block when its key evidence is indirect. Require primary Search policy or direct target evidence for the actual intervention.
- `database_indexation_quality` is the default structural evaluator for database/programmatic sites. It distinguishes data coverage from index coverage and rejects arbitrary URL permutations, unbounded crawl surfaces and near-duplicate generated families unless a real user need and URL contract are demonstrated.

## Search for implementable interventions, not excuses

Look for bounded opportunities with a measurable or directly verifiable outcome:
- Existing pages with observed search visibility and a confirmed answer-intent, factual, structural, internal-link or metadata defect; prioritize changes whose acceptance criteria can be checked from the changed page and subsequent observation.
- Objectively verifiable technical errors (broken canonical, wrong robots/indexing directive, broken relevant internal link, missing structured data actually required by the page, broken route) established by current code/live reproduction. These can be actionable **without page-level search volume**.
- Clear, independently sourced factual accuracy gaps or material usability omissions on an existing managed page. A **current-HEAD demonstrated defect plus authoritative evidence and an exact correction** can justify a targeted factual/technical task when page-level GSC data is absent or sparse; disclose that lack and do not manufacture an expected traffic uplift.
- Cross-page topic overlap with actual evidence, or a documented unmet intent where a focused new page is separately justified.

Use progressively broader discovery instead of overusing weak numeric thresholds: first inspect visible underperforming existing articles, then other current site pages, high-value navigational/technical defects, content corrections, missing contextual internal links, and independently justified new articles. Do **not** propose speculative title refreshes on healthy/newly changed pages or expensive audits masquerading as Worker work. Each accepted Task must specify what code/content changes, how to validate it, and what later metric would test the hypothesis, if applicable.

Strict cases remain strict: destructive `delete` needs complete trailing 90-day evidence and a defensible treatment of unique value; `merge` needs clear overlap and redirect/canonical handling. Do not lower these standards to fill inventory.

## Commit each candidate end-to-end

Before any new task, verify (a) the site is active, (b) the current target file and exact defect on default-branch HEAD, (c) relevant existing active/history tasks and PRs/commits, (d) sources or dated digest evidence, and (e) non-duplicative acceptance criteria. Then use `seo_task_create` to save a `ready` record, including evaluation provenance when an evaluator materially informed the decision, and **immediately use `seo_task_get` to read back and confirm** the ID, status, repo, target URL, rationale, sources, and evaluator reference when present. Do not leave a speculative `proposed` backlog. No GitHub Issues, PRs, code edits or deploys from the Planner.

A good Worker-ready task says: *this is the observed defect, here is its current file/HEAD, this is the precise bounded change, these are primary/reliable references, and these are the checks that prove the repair*. A measurement-based hypothesis also records the period and data limitations, without implying causality before post-change evaluation.

## Definition of zero and reporting

**One discovery rejection cannot justify an empty implementation batch below the ready target.** Zero is justified when the buffer is supplied, broad cross-site/current-HEAD exploration finds no defensible bounded change, actual run time is exhausted after meaningful exploration, or a precise portfolio-wide capability/write blocker prevents progress. Pivot after a rejected candidate; sparse analytics, one blocked source or another page's cooldown is not a portfolio stop condition. Treating missing analytics as zero or using an already-open PR as the reason to skip the discovery pass is **incomplete planning**.

For every run, report initial/final ready inventory, new ready Task IDs, legacy promotions/supersessions, number of distinct sites/pages investigated, the strongest rejected candidates and concrete rejection reasons, and remaining evidence/source limitations. If a write is rejected by platform safety/authorization, stop that rejected operation rather than rerouting it, and report the exact diagnostic. If a required compact digest is unavailable, record the blocked analytics-dependent opportunity and explore independent factual/technical defects elsewhere where sound evidence exists.

**No invented work or guaranteed traffic claims.** The operating requirement is to supply bounded changes, review their actual outcomes, and act again while preserving accuracy, dedupe and repository controls.

## Experiment tracking recovery

For target URLs absent from the article registry, verify the exact source path at the repository default branch and register the bounded target with `site_article_save`. URL-only Tasks attach existing same-site/same-repository canonical article matches at creation and on subsequent updates. Backfill the latest completed experiments with their existing Task IDs in optimization notes/history; never create duplicate implementation work. Record actual public observation before starting the evaluation window. Missing Google SERP credentials block Google-specific claims only: continue Brave/body evidence and independently justified implementation planning.

## Reviewed external playbooks

External SEO playbooks are not part of the default planning loop and must never be loaded as
instructions wholesale. When a concrete incident matches a reviewed diagnostic playbook, or when
strategy discussion needs an additional lens, consult
[`seo-external-playbook-policy.md`](./seo-external-playbook-policy.md). That policy defines
evidence precedence, locale/jurisdiction scoping, accepted/modified/rejected parts of reviewed
sources, and the narrow event triggers where a playbook may be useful. It never overrides the
live `seo_agent_context`, evaluator registry, current production evidence, or primary sources.
