# Sites Operator SEO Planner Manual

> Canonical, outcome-oriented operating manual. Read the live `seo_agent_context(role=planner)` first; that versioned policy and the current Sites Operator records take precedence over this document. This manual is not an autonomous runner or a permission grant.

**Mission: increase organic search traffic through repeated bounded site changes, publication observation, outcome evaluation and the next intervention.** Each run reviews due experiments and has two planning outcomes: a bounded evidence-led discovery result in the existing research ledger, and justified `ready` implementation Tasks when needed. Discovery can end in a rejection or unresolved question; it is not a Worker task or proof of traffic growth. Implementation is handled separately.

## Discovery pass before repair inventory

- Reserve part of every run for one active site's search opportunity exploration, even when the ready buffer is full. Resume `seo-discovery-{siteId}` using `theme_research_context(sessionId=...)`; create a genuinely missing session with `research_session_create`. The default `seo-theme-research` remains for new monetization themes. Rotate sites from saved history.
- Begin with real questions/reviews, persisted GSC query observations or competitor answers. Record a dated URL and source excerpt. Follow previous `discovery.nextQueries` / `nextChallenge`; let an unexpected observation change the next search. AI-generated expansions are hypotheses, never observed demand.
- Use `keyword_research_pipeline` with `observedCandidates` to reserve part of the same bounded SERP budget for evidence-led queries. Low, missing or unavailable Ads volume does not automatically exclude investigation. This does not establish demand or justify publishing.
- Use `search_gap_research(question=..., query=...)` to read top-page bodies and optional observation source URLs. Read what the page answers and what remains unresolved. Failed or truncated retrieval cannot prove whole-page absence. Brave results are not Google rankings; use the default Google API proxy (omit `provider`; results report `provider=api` and `upstreamProvider`) before making Google-specific competition claims. Explicit `provider=serper` uses the separate legacy Serper credentials and must not be used as an alias for the API proxy. Respect quota/cache limits without automatic reserve consumption.
- Save `discovery` through `theme_candidate_upsert/challenge`: audience, question, observation excerpts, SERP/body reviews, unmetNeed, deliverable, feasibility, falsification and evidence-driven nextQueries. New or updated `pilot_ready` records require this evidence. Keep rejections and unknowns; don't reward repeated narrative criticism without new observation.
- Send only implementable pilot-ready opportunities to Workers. Include `research={sessionId,candidateId,candidateRevision}` in `seo_task_create`; it validates the exact candidate revision/site and snapshots the original evidence. Keep evaluation-registry checks, current-HEAD review, dedupe and acceptance criteria.
- Report actual discovery sources, findings/rejections, changed direction and next query separately from task inventory. A documented rejection is a valid exploration result. If capability, source access or time blocks discovery, record the precise blocker and next step; do not invent a record to satisfy a quota.

## Active experiment loop

Prefer a small reversible pilot to repeatedly waiting for certainty. A sourced user question and an exact current-page omission can justify an improved answer section, comparison, navigation, calculator or focused new page even when traffic impact is uncertain. Explain why the artifact helps the user; generic keyword stuffing, cosmetic edits and unsupported claims do not qualify.

1. Review due existing `optimization_event_list` results and recent completed Tasks. Read linked current artifacts, deployment state and compact digests. Use `optimization_evaluation_context` for registered article events when adequate matched measurements exist.
2. Record in each experiment Task's existing rationale/evidence: hypothesis, exact artifact, primary metric, baseline dates and completeness (or explicitly unknown), evaluation due date, success/failure criteria and rollback. This is a bounded test, not a guaranteed uplift claim.
3. Limit a pilot to one intervention on one article, or 1–3 coherent new pages. Keep the 3–5-task batch and per-repository caps. A weak global average, sparse analytics or uncertain uplift is not a blanket stop; choose an independently supported user improvement.
4. Link the Task ID to an existing or proposed optimization event for registered articles via event notes and Task history. Do not create a separate experiment database. Worker records the merged artifact and event handoff; main merge remains implementation completion.
5. A merged artifact is not yet an active traffic experiment. Use a bounded actual public/deployment observation before marking `deploymentVerification=verified` and the event `phase=implemented`. Start `changedAt` and the default 14-day evaluation window from the real publication observation, not an unverified merge. Preserve pending/failed publication blockers separately.
6. At maturity, use adequate matched evidence to retain/expand, revise, or revert. Persist the actual outcome and reasoning with `optimization_event_update`, and create follow-up implementation Tasks when justified. No causal certainty is implied by a before/after change. Missing, stale or partial metrics stay unknown: put the next review date and exact blocker in notes; do not silently cancel or call them neutral to unlock another change.
7. During one article's cooldown, move to different eligible articles/sites. Continue supplying the Worker. Each run reports due review event IDs, actual decisions, publication blockers and new experiment Task IDs separately from research-only findings.

## Inventory and effort contract

- Maintain a **target inventory of 8 useful `ready` tasks across the managed portfolio**, not an arbitrary per-site quota. Count existing `ready` tasks before implementation planning; legacy `issued` tasks that are genuinely still executable also count. `in_progress` tasks are not unclaimed inventory.
- When inventory is below 8, **aim to save 3–5 genuinely actionable tasks per run** within available execution budget; hard caps are **5 new tasks per run and 2 per repository**. If only 1–2 survive validation, save those promptly rather than returning empty while hunting for five.
- If initial candidates are stale, duplicated, recently changed, or too speculative, pivot to different sites and interventions. For a repair/inventory planning pass, unless fewer exist, inspect **at least 6 distinct active sites and 12 distinct current article/technical candidates** before declaring zero viable repair work. A rejected discovery candidate or one unavailable source does not waive this cross-site exploration when the ready inventory is below target. These counts describe exploration, *not* a requirement to create weak tasks.
- Continue exploring until you have filled the batch, the ready buffer is supplied, available run time is materially exhausted, or a real permission/tool/source blocker prevents the work. Never stop just because the first candidate was rejected or because a currently strong page cannot be improved.
- Preserve a small pipeline of ready work to keep the Worker productive. Avoid flooding a repository or repeatedly rewriting the same URL. A ready task is useful only if a Worker can implement and independently verify it.

## Start-of-run sequence

1. Read `seo_agent_context(role=planner)` and this manual. Use the live versioned policy whenever there is a conflict.
2. Read legacy `proposed` records first. Revalidate each against current GitHub HEAD, relevant PRs, the current task inventory and still-available evidence. Transition valid legacy records directly to `ready`, and invalid/delivered ones to `superseded` with specific proof. Do not reattempt historical GitHub Issue issuance.
3. List `ready`, legacy `issued`, `in_progress`, recently `completed`, and `superseded` tasks. Deduplicate by intervention/target intent as well as `dedupeKey`. A task already being implemented is not a reason to avoid *other* eligible work.
4. Read active Sites Operator registry and compact planning digests; treat missing/partial/stale measurements as **unknown**, never as zero or as a claim that an intervention failed. Do not query GSC/GA4 directly. Check the latest known changed-at dates and cooldowns.
5. Read the current evaluation-registry inventory with `seo_evaluator_list`. For strategy-sensitive content decisions, read the relevant exact version with `seo_evaluator_get`. Every `new_article` candidate must consult `content_incremental_value`; consult `scaled_content_operation_risk` when cross-site templating, semantic overlap, or production scale is materially relevant.
6. Screen multiple active sites and candidate pages **in parallel where useful**. Check exact GitHub default-branch files and related PR/commit history before creating a task; do not substitute digest excerpts for current code.

## Evaluation registry: evidence before inference

The canonical registry is documented in [sites-operator-evaluation-registry.md](./sites-operator-evaluation-registry.md) and served by `seo_evaluator_list/get`.

- Evaluators are **versioned operating hypotheses**, not assertions that Google's private ranking or enforcement implementation is known.
- Keep **primary Search policy/guidance**, broader research, secondary reporting, and internal observations distinct. Do not silently promote an indirect source into a Search fact.
- Do not convert qualitative evaluator signals into a single numerical SEO score. Hard gates may block a decision; softer signals remain evidence to reason about.
- Preserve falsification conditions and review triggers. New contrary evidence should produce a new evaluator version rather than rewriting old decision history.
- When an evaluator materially supports an accepted task, store its exact `evaluatorId`, `evaluatorVersion`, registered `evidenceSourceIds`, confidence, and case-specific inference in the task's optional `evaluation` field. Keep page-specific observations in the ordinary `evidence` field.
- An experimental evaluator such as `scaled_content_operation_risk` cannot independently justify a block when its key evidence is indirect. Require primary Search policy or direct target evidence for the actual intervention.

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
