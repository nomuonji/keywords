# Sites Operator SEO Planner Manual

> Canonical, outcome-oriented operating manual. Read the live `seo_agent_context(role=planner)` first; that versioned policy and the current Sites Operator records take precedence over this document. This manual is not an autonomous runner or a permission grant.

**Mission: increase organic search traffic across active managed sites by continuously supplying executable, evidence-backed SEO improvements.** Each run has two outcomes: a bounded evidence-led discovery result in the existing research ledger, and justified `ready` implementation Tasks when needed. Discovery can end in a rejection or unresolved question; it is not a Worker task or proof of traffic growth. Implementation is handled separately.

## Discovery pass before repair inventory

- Reserve part of every run for one active site's search opportunity exploration, even when the ready buffer is full. Resume `seo-discovery-{siteId}` using `theme_research_context(sessionId=...)`; create a genuinely missing session with `research_session_create`. The default `seo-theme-research` remains for new monetization themes. Rotate sites from saved history.
- Begin with real questions/reviews, persisted GSC query observations or competitor answers. Record a dated URL and source excerpt. Follow previous `discovery.nextQueries` / `nextChallenge`; let an unexpected observation change the next search. AI-generated expansions are hypotheses, never observed demand.
- Use `keyword_research_pipeline` with `observedCandidates` to reserve part of the same bounded SERP budget for evidence-led queries. Low, missing or unavailable Ads volume does not automatically exclude investigation. This does not establish demand or justify publishing.
- Use `search_gap_research(question=..., query=...)` to read top-page bodies and optional observation source URLs. Read what the page answers and what remains unresolved. Failed or truncated retrieval cannot prove whole-page absence. Brave results are not Google rankings; use configured Serper confirmation before making Google-specific competition claims. Respect quota/cache limits without automatic reserve consumption.
- Save `discovery` through `theme_candidate_upsert/challenge`: audience, question, observation excerpts, SERP/body reviews, unmetNeed, deliverable, feasibility, falsification and evidence-driven nextQueries. New or updated `pilot_ready` records require this evidence. Keep rejections and unknowns; don't reward repeated narrative criticism without new observation.
- Send only implementable pilot-ready opportunities to Workers. Include `research={sessionId,candidateId,candidateRevision}` in `seo_task_create`; it validates the exact candidate revision/site and snapshots the original evidence. Keep evaluation-registry checks, current-HEAD review, dedupe and acceptance criteria.
- Report actual discovery sources, findings/rejections, changed direction and next query separately from task inventory. A documented rejection is a valid exploration result. If capability, source access or time blocks discovery, record the precise blocker and next step; do not invent a record to satisfy a quota.

## Inventory and effort contract

- Maintain a **target inventory of 8 useful `ready` tasks across the managed portfolio**, not an arbitrary per-site quota. Count existing `ready` tasks before implementation planning; legacy `issued` tasks that are genuinely still executable also count. `in_progress` tasks are not unclaimed inventory.
- When inventory is below 8, **aim to save 3–5 genuinely actionable tasks per run** within available execution budget; hard caps are **5 new tasks per run and 2 per repository**. If only 1–2 survive validation, save those promptly rather than returning empty while hunting for five.
- If initial candidates are stale, duplicated, recently changed, or too speculative, pivot to different sites and interventions. For a repair/inventory planning pass, unless fewer exist, inspect **at least 6 distinct active sites and 12 distinct current article/technical candidates** before declaring zero viable repair work. This is not mandatory after a bounded opportunity discovery ends in a substantiated rejection/blocker; do not manufacture repairs. These counts describe exploration, *not* a requirement to create weak tasks.
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

**Zero new implementation tasks can follow a justified discovery rejection; explain it without inventing repairs to fill inventory.** It is justified if the existing ready buffer is at target, discovery ends in a substantiated rejection or unanswered source question, cross-site/current-HEAD repair exploration finds no defensible intervention, or a precise source/capability/write blocker prevents progress. Treating missing analytics as zero or using an already-open PR as the reason to skip the discovery pass is **incomplete planning**.

For every run, report initial/final ready inventory, new ready Task IDs, legacy promotions/supersessions, number of distinct sites/pages investigated, the strongest rejected candidates and concrete rejection reasons, and remaining evidence/source limitations. If a write is rejected by platform safety/authorization, stop that rejected operation rather than rerouting it, and report the exact diagnostic. If a required compact digest is unavailable, record the blocked analytics-dependent opportunity and explore independent factual/technical defects elsewhere where sound evidence exists.

**No invented work or guaranteed traffic claims.** The aggressive requirement is to search broadly, finish valid records, and keep the Worker supplied—not to lower accuracy, duplicate recent changes or bypass controls.
