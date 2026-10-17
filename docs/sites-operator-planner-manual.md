# Sites Operator SEO Planner Manual

> Canonical, outcome-oriented operating manual. Read the live `seo_agent_context(role=planner)` first; that versioned policy and the current Sites Operator records take precedence over this document. This manual is not an autonomous runner or a permission grant.

**Mission: increase organic search traffic through repeated bounded site changes, publication observation, outcome evaluation and the next intervention.** Each run reviews due experiments and has two planning outcomes: a bounded evidence-led discovery result in the existing research ledger, and justified `ready` implementation Tasks when needed. Discovery can end in a rejection or unresolved question; it is not a Worker task or proof of traffic growth. Implementation is handled separately.

## Central acceptance and publication loop (2026-10-16)

- Before issuing a ready Task, define the material outcome in the Task rationale and confirm current GitHub HEAD/source. `acceptanceChecks` exact-text/internal-link assertions are optional and should only be supplied when they catch a real regression. Never block a useful Task just to manufacture an exact string.
- Count `ready`, `in_progress`, and `push_pending` separately. Target a small 3–6 Task buffer only when current demand, page/source evidence, Macro Policy and independent files support it. Recheck proposed Tasks against current HEAD and acceptance conditions. A 429 stops the run without resubmitting equivalent writes.
- Central Actions validates the persisted checkpoint and builds the exact target SHA before merging. Missing build profile, generated target HTML or canonical is a blocked delivery requiring correction; explicit optional content/link assertions must pass when supplied.
- Immediately after the central delivery controller durably marks a merged Task `completed`, the **same** GitHub Actions run receives only the exact newly completed Task IDs, waits up to four minutes in bounded intervals for Cloudflare Pages (or successful production GitHub Deployment) at the merge SHA or an actual descendant, and checks live HTTP/body/canonical plus any Task-specific acceptance assertions. A transient mismatch while Pages propagates stays `pending`; a verified page advances the linked Optimization Event. No additional Worker event or separate publication workflow is created.
- Existing central SEO Actions two-hourly recovery and manual verification sweep collect older `completed + pending/failed` Tasks (up to twelve due each, rotating to avoid starvation). Missing or delayed production evidence remains pending, not incorrectly marked live. The verifier must never mark a Task `verified` from a merge, successful build, or HTTP 200 alone. A unique proposed Optimization Event linked by article ID and commit starts its measurement window only after verified publication.


- GitHub Actions publication prerequisites: repository variable **or secret** `CLOUDFLARE_ACCOUNT_ID` and repository secret `CLOUDFLARE_API_TOKEN` (read-only Pages scope) must be configured for Cloudflare Pages projects. The Vercel/Sites Operator environment having these credentials **does not** propagate them to GitHub Actions. A missing provider credential is a failed verifier job, not a verified publication or a silently successful sweep. For GitHub Deployment fallback, use the workflow's `deployments: read` GitHub Actions token, independently of the delivery PAT.

## System throughput / queue health (2026-10-16)

- The Manager is responsible for a **useful executable backlog**, not an arbitrary number of Tasks. At the start of each run count actual `ready`, `in_progress`, and `push_pending`/delivery handoffs separately; exclude `proposed`, `cancelled`, expired/duplicate/safety-refused work from executable capacity. Keep the difference between queue starvation and delivery/CI stagnation visible in the run report.
- With roughly hourly Workers, aim for a **small rolling buffer of approximately 3–6 genuinely independent, fully scoped ready Tasks across repositories** as a guidance target, never a minimum quota. When fewer than three valid ready Tasks exist, prioritize fresh evidence-backed discovery and reconsider existing eligible `proposed` work before less urgent reporting. Enforce the active Macro Policy `risk.maxNewTasksPerRun`, repository concentration and pre-existing owner-approved strategy. Never invent low-value edits just to fill capacity.
- Every candidate must have concrete reader/search value, up-to-date GitHub HEAD evidence, disjoint file ownership, primary-source checks, a bounded acceptance plan and rollback. If its build environment or required authoritative information is unavailable, leave it out of the `ready` buffer and record the precise resume prerequisite. **More Workers cannot repair an unbuildable Task.** Do not send the same blocked Task through another transport after a safety/authorization refusal.
- Independently maintain the published-work truth: existing `completed + deploymentVerification=pending/failed` is **not** ready Worker inventory. Review old 1–2 verifiable items with full deployment/HTTP/body/canonical proof and route genuinely incomplete proofs to the common publication-verification lane. Do not mark a Task verified from HTTP 200, passing build, or a merged commit alone. Do not create special Task records or separate schedules merely for follow-up.
- Central Actions may handle multiple handoffs per run; prioritize the bottleneck stage actually empty or blocked rather than increasing every timer. Do not change any ChatGPT scheduled task frequencies/enablement as a side effect of these diagnostics.



## クールダウン中のTaskをreadyキューから退避する（2026-10-15）

実装可能なTaskのみを`ready`に置く。対象記事の`optimization_context.changeAllowed=false`で評価待ち／cooldownが判明した場合、Workerはclaimせず、Managerが対象Taskの`status`を`proposed`へ戻し、一度だけ`appendHistory.event=cooldown_deferred`で対象記事・`cooldownUntil`のUTC・理由を記録する。新しいDB／独立スケジュールを作らず、`proposed`はready capacityに算入しない。

Managerは通常の`seo_task_list(status=proposed)`の再評価時、`cooldown_deferred`を持つTaskを**期限到来順に少数だけ**見直す。保留中に他者が同じ差分をPR化／main反映した場合は再実装させない。期限が到来しても`optimization_context.changeAllowed=false`なら復活させず、評価Eventの適切な評価／終了を検討する。真に変更可能（`changeAllowed=true`）となり、現行HEAD／未完了PR／安全拒否履歴／Task受入条件／マクロ政策を再検証してなお未実装であれば、同じTask IDの`status=ready`へ戻す。重複Taskを新規発行しない。

中断／保留原因が環境・CI障害の場合も、その時点で実装不能なら`ready`に放置し続けず、`proposed`と具体的再開条件へ整理する。ただし、Taskを`cancelled`してユーザーが依頼した実装を消したり、受入基準を緩めたり、スケジュール頻度を勝手に変えたりしない。

## SEO知見 → 実行 → 計測の閉ループ（2026-10-14）

**この節は既存のSEO Manager/Worker、SEO Task、Optimization Event、Keywords Operator SEO Source Poolの使い方を具体化する。新しいDB、スケジュール、評価器やURL単位の分析履歴を作らない。** 先にlive `seo_agent_context(role=planner)` と現在のMacro Policyを読み、矛盾すればそちらを優先。

1. **公開確認:** `seo_task_list(status=completed)` のうち `deploymentVerification.status=pending/failed` で、証拠を追加できる古い1〜2件を優先確認。提案中・取消・supersededを「公開確認滞留」に含めない。Cloudflare Pagesの最新成功・非skip productionが対象コミットそのもの、またはGitHubで祖先関係を確認できるものかを見て、さらに対象URLの実HTTP、表示内容、canonical等のTask固有の受入条件を検証する。**単にPRがマージ済み／ビルド成功／サブドメインがあるだけなら verified にしない。** 足りない証拠と次の確認条件を現行Taskに残し、同一証拠の再調査で更新を量産しない。
2. **成果判定:** `optimization_event_list` から **公開確認済みでphase=implemented、evaluateAfterが到来したものだけ** を `optimization_evaluation_context` で確認する。旧`metricSnapshotList`と現在の上書き型`seo_planning_digest_get`は互換ではない。digestのrolling current/previous 28日を、eventに固定された別日付のbaselineに見せかけない。完全で同じ長さの比較窓がないなら **unknown/pending** として出典・期限を記録。方針上の十分な観測期間（目安14/28日、疎なら56日）を経過しても比較可能な記録がなく、実公開日とevaluateAfterが検証できる場合は、既存Eventへ理由を付けて **inconclusive** として閉じてよい。**neutral/改善なし/悪化と捏造しない。** 提案中・未公開は閉じない。効果は新鮮なクロール/インデックスとGSC実績を分離する。
3. **知見照合:** 特定の問題・施策に関連する場合だけ `seo_source_pool_context` / `seo_source_get` で直近Findingを少数確認。必要があれば、そのうち1〜2ソースのみ原文を確認し `seo_source_scan_record` に保存する。毎回14ソースを走査してFirestoreを消費しない。二次情報の所感と一次資料を区別し、関連sourceId、scanId、原典URL、公開日、確度を**既存Task evidence/rationale**に残す。関連Evaluatorは現行版の`evidenceSourceIds`を使う（SEO Source PoolのIDをEvaluatorの一次資料IDとして流用しない）。知見が採用されなかった場合も理由を記す。証拠のない採用・Evaluator自動変更は禁止。
4. **次の判断:** 改善後、根拠のある`supported / contradicted / inconclusive`と対象の`taskId` / `eventId` / 実測期間を既存Event notesに記録し、**同種の次の候補だけ** へ「再検証すべき仮説」として引き継ぐ。結果がまだ出ていなければ「未評価」と明記する。単一ページから全サイト共通ルールを作らない。

Source Poolが429等で利用不可なら、その一回の該当ソース調査はスキップしてSource利用をでっち上げず、残りの公開・計測確認は継続する。新規Taskの作成は従来のMacro Policy割当と重複防止に従い、上記の公開/計測レビューに予算を使うための架空Taskを作らない。

## 現行Managerが使う汎用Macro Policy

Actorの正本は [sites-operator-actor-model.md](./sites-operator-actor-model.md)。このマニュアルの"Planner"は、3時間ごとに起動する**単一のSEO Manager**の旧API role名(`role=planner`)であり、別エージェントではない。旧My PortalのSEO Managerはarchive済。

各Manager Runは最初に `seo_agent_context(role=planner)`、`seo_portfolio_policy_get`、`seo_portfolio_allocation_status`、`seo_recovery_status` を読み、**最新の政策レコードを正本**とする。これらを読まずに旧run contractの数値や前回会話のポリシーに従わない。

現在の政策は `Objective / Allocation / Risk / Constraints / Evaluation` から構成される。配分比率・bucket ID・task数の目標・レビュー周期・回復時のgrowth許可は**マネージャー実装の固定定数ではない**。以降、投資方針が変更されてもManager/Workerのアーキテクチャを書き換えず、`seo_portfolio_policy_update(expectedRevision, policy, decisionReason, updatedBy)` で差し替える。

Managerが行う仕事:
- managed siteのSearch実績・source readiness・技術状態・既存ready/in_progress・実装receiptを横断観測し、policy.objectiveに照らして候補を比較する。
- allocation.bucketsの方針と`seo_portfolio_allocation_status`の見積り投入量を参照し、弱い配分を機械的に放置せず、政策に応じて集中・探索・保守・品質改善を選ぶ。指定比率を満たすための架空タスクは作らない。
- `risk`にある新規task数・同一repoへの集中上限・1タスクの最大見積り単位を守る。大規模でも独立して検証できる有用な施策なら実施する。検索需要や収益を捏造しない。
- `seo_task_create`には実装根拠に加え、政策bucket（`allocationBucket`）と実行キャパシティ見積り（`estimatedEffortUnits`）をつける。適用政策revisionはサーバー側で記録される。旧タスクはunallocatedと表示し、虚偽のbucket配分を割り当てない。
- evaluationを再評価の目安として使う。Googleのクロールや順位改善に期限の保証はない。真のSearch成果はGSC/GA4/公開実績で別途判断。
- `constraints.incidentGrowthIntake`でincident別の新規growth可否を判断し、API gateを回避しない。重大な方向転換と一括noindex・site停止は従来の人間承認を維持する。

**現在の政策例:** 2026-10-08の初期バージョンはGSC organic clicksのmaximize、積極リスク、proven_demand 40%、structural 40%、speculative 20%、週次レビュー。ただしこれらはpolicy recordの現行値であり、マニュアル内の固定ルールではない。

Google policy: https://developers.google.com/search/docs/essentials/spam-policies および https://developers.google.com/search/docs/fundamentals/creating-helpful-content 。scaled low-value pagesやdoorway pagesを新たな投資施策にしない。

## Discovery pass before repair inventory

- Reserve part of every run for one active site's search opportunity exploration, even when the ready buffer is full. Resume `seo-discovery-{siteId}` using `theme_research_context(sessionId=...)`; create a genuinely missing session with `research_session_create`. The default `seo-theme-research` remains for new monetization themes. Rotate sites from saved history.
- Begin with real questions/reviews, persisted GSC query observations or competitor answers. Record a dated URL and source excerpt. Follow previous `discovery.nextQueries` / `nextChallenge`; let an unexpected observation change the next search. AI-generated expansions are hypotheses, never observed demand.
- Use `keyword_research_pipeline` with `observedCandidates` to reserve part of the same bounded SERP budget for evidence-led queries. Low, missing or unavailable Ads volume does not automatically exclude investigation. This does not establish demand or justify publishing.
- Use `search_gap_research(question=..., query=...)` to read top-page bodies and optional observation source URLs. Read what the page answers and what remains unresolved. Failed or truncated retrieval cannot prove whole-page absence. Brave results are not Google rankings; use the default Google API proxy (omit `provider`; results report `provider=api` and `upstreamProvider`) before making Google-specific competition claims. Explicit `provider=serper` uses the separate legacy Serper credentials and must not be used as an alias for the API proxy. Respect quota/cache limits without automatic reserve consumption.
- Save `discovery` through `theme_candidate_upsert/challenge`: audience, question, observation excerpts, SERP/body reviews, unmetNeed, deliverable, feasibility, falsification and evidence-driven nextQueries. New or updated `pilot_ready` records require this evidence. Keep rejections and unknowns; don't reward repeated narrative criticism without new observation.
- For a discovery-derived Task with a **successfully persisted, site-matched `pilot_ready` candidate**, include `research={sessionId,candidateId,candidateRevision}` in `seo_task_create` so the evidence is snapshotted and validated. `research` is optional for independently substantiated factual/technical repairs and other legitimate Task candidates. Never invent a candidate ID/revision or assert research provenance when its write failed. The normal evaluation, current-HEAD, dedupe, cooldown, policy, Site Direction and acceptance gates still apply.
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

## Indexation evidence is mandatory for each candidate site (2026-10-09)

Every site selected for a potentially material SEO Task requires **two independently observed inputs** before Task creation: (1) the complete 28-day GSC/GA4 digest and (2) `site_indexation_summary({siteId})`. Read exact representative canonical records with `site_indexation_list({siteId})` whenever the choice depends on crawl/indexation. Keep these facts distinct:

- `inventoryTotal/indexableCount`: known URLs intended for indexation, **not** actual Google indexed pages.
- `inspectedCount/inspectionCoverage`: observed sample and coverage; **0 inspected means unknown**, not 0 indexed.
- `indexedObservedCount/notIndexedObservedCount`, verdict, coverageState, robotsTxtState, pageFetchState, lastCrawlTime, userCanonical vs GoogleCanonical: inspection-specific evidence, time-limited and possibly lagging newly deployed code.
- `inspectionUrl` is the **exact inspected canonical**, which may preserve the trailing slash even when the storage record's `url` has a slashless cache key; do not repeat the invalid redirect-variant baseline or generalize these readings to uninspected URLs.
- Contrast with complete GSC current28/previous28 impressions and actual production verification. Low search visibility can be caused by non-indexing, weak demand or reach, poor content value, ranking movements, or incomplete data. An SEO task must say which diagnosis is substantiated and which remains unknown.
- Acquisition belongs to scheduled **`site-indexation` central GitHub Actions** (four times/day) with `GOOGLE_APPLICATION_CREDENTIALS` and quota guard. The ChatGPT-side Sites MCP runtime can lack OAuth even while that Actions job succeeds; do not treat missing MCP credentials as failure of the entire inspection acquisition lane. The SEO Manager is a *cached evidence consumer* and must not spend URL Inspection calls as a routine planning step.
- If zero or stale inspected coverage, document a concrete acquisition/refresh blocker and next due inspection date or job status, rather than creating many speculative pages. Existing in-progress Worker delivery still proceeds by established centralized `seo/*` PR/CI/main path.
- Indexation evaluation is **not optional for article sites** and **not limited to database/page-family expansion**. An unknown must be recorded as unknown and may justify a smaller, reversible experiment, not fabricated indexing certainty.

## Indexation-first editorial recovery and article-quality gate (2026-10-13)

**Same SEO Manager, same SEO Worker and same GitHub delivery lane.** This is an additional mandatory editorial decision step, not an independent scheduler, autonomous audit-only Worker, policy-objective change, or new indexed-page quota. The active Macro Policy continues to govern task allocation and risk.

### 1. Triage before rewriting

For each site considered for substantial work, read the compact GSC/GA4 digest and cached `site_indexation_summary`. Review a **small representative subset** of exact `inspectionUrl` records through `site_indexation_list` where indexing is relevant. Prioritize old, successfully crawled, indexable-but-unindexed pages for investigation alongside real visible demand and urgent deployment/technical failures; do **not** assume missing samples are excluded.

- **Technical:** verified robots/noindex, fetch failure, 404/5xx, redirect or canonical discrepancy → bounded technical repair, not article padding.
- **Discovery / pending:** not yet discovered/crawled or `lastCrawlTime` predates confirmed latest publication → check sitemap, internal links and production; the new article has **not** yet been evaluated by Google.
- **Editorial audit candidate:** Google successfully fetched the exact canonical after a prior publication, indexing was allowed, but observed indexation is absent and no technical cause is verified → hypothesis-driven full-body audit; the cause is **not known** merely from the URL Inspection verdict.
- **Indexed but low exposure:** check actual query demand and user intent; do not treat this as an indexing defect.
- **Stale, uninspected, variant-only:** **unknown**. Preserve existing quota and obtain current canonical observations through the scheduled indexation acquisition lane, not direct routine Manager inspection.

When the site has severe observed exclusion, preference for existing-page recovery may override easier new-URL ideas, but remain within active portfolio allocation, incident gates, Site Direction approvals, current ready inventory and cooldown rules. Never freeze all new-article work solely because an inspected sample is poor.

### 2. Audit the *actual* article, not its title

Before issuing a substantial `revise` task, inspect the exact latest default-branch article/code, current rendered production HTML where accessible, and nearby existing site pages. Name the **reader's actual question** using observed GSC queries or an independently supported concrete intent.

Use Keywords Operator `search_gap_research` when it can answer a real comparison question. Start with cached configured Google SERP; read 2–3 actual top-page bodies, date/source URLs, retrieval coverage, and factual primary sources. If budget/provider/HTML retrieval fails, record the limitation. Do not invent competitor gaps, call Brave results Google rankings, or block a well-evidenced isolated technical/factual repair merely because SERP research is unavailable.

Apply the active `indexation_content_quality` evaluator together with relevant `content_incremental_value`/technical evaluators. **Reject generic briefs** such as “add more information” or “expand to 2,000 words.” Instead, the Worker-ready `seo_task_create` packet must identify:

- exact canonical/indexation evidence and inspection freshness vs confirmed production date;
- source/current HEAD excerpt and concrete missing reader answers or unverifiable claims;
- actual competitor body/source excerpts or explicit source/budget uncertainty;
- requested sections, examples, comparisons or decision paths and the primary/official sources required for facts;
- observable **rendered-body** acceptance criteria plus canonical/internal-link verification, rollback and later outcome test.

Keep this in the existing Task `rationale`/`evidence` and optional versioned `evaluation`. No separate Firestore per-URL audit history is created. If no justified implementable change exists, keep the diagnosis at Manager level rather than giving an audit-only task to the Worker.

### 3. Worker rewriting and publication

Worker follows the existing SEO Task claim / `seo/*` push / central PR-CI-merge sequence. For material editorial changes, it **must read back the changed body**, verify factual claims against sources and compare it against the Task's testable user-value acceptance criteria. If the page remains weak, rewrite inside the **same Task** rather than fail and abandon it, or create new thin URLs. Limit redundant passes; log factual/data blockers explicitly. The ordinary code/CI tests continue independently.

After actual production verification, use the same `optimization_event` and indexed URL cache to wait for a subsequent **Google crawl of the changed page**. Do not count a merge, passing CI, sitemap entry, URL Inspection before publication, or missing Google re-crawl as a recovered index. Then examine fresh indexing observations and complete 14/28-day matched GSC windows if available; record inconclusive where evidence is immature. Raw indexed-page count is an intermediary observation; the final objective remains organic clicks.

### 4. Operating efficiency

No additional scheduled crawler, Google API quota, bulk SERP scan, dashboard database or independent permanent agent. Sample by site/page-family/inspection reason; reuse existing digest/indexation cache, cached Keywords Operator SERP, existing Task, GitHub diffs and Optimization Events. Never claim knowledge of hidden Google ranking formulas or guarantee indexation.

--- 

## Search acquisition outcome gate (2026-10-09)

**Diagnostic:** An implementation-complete Task is a delivery fact, not evidence that the site has acquired a new reader. The active SEO Macro Policy still optimizes GSC clicks; do not silently change it to an all-channel growth policy. This section makes the existing Search mandate act like an investment manager rather than a local-edit queue.

### Required portfolio decision before replenishing Tasks

1. **Start with the failure mode, not an editable page.** Read complete 28d and previous-28d *site-level* GSC impressions/clicks plus organic GA4 landings where available. Classify each considered site as `visibility_collapse`, `stable_but_low_exposure`, `search_clickthrough_problem`, `acquisition_and_engagement_gap` or `insufficient_evidence`. These labels are internal diagnostic shorthand, **not** a Google penalty diagnosis. If visibility collapses, investigate indexability, crawling, canonical, query displacement and measurement before assuming content demand is missing. Include dates, completeness and whether the observed window predates a newly deployed change.
2. **State the traffic bottleneck and the searcher's actual job.** Before choosing a Task, write a one-sentence plausible acquisition mechanism: `observed question → search-visible surface → distinctive useful answer/tool → entry URL → downstream decision`. A keyword count, more total URLs, stronger branding or a passed build is not an acquisition mechanism by itself.
3. **Compare at least three materially distinct responses when evidence permits:** (a) recovery of existing Search visibility/production; (b) substantial on-site product/decision-hub/verified-data improvement; and (c) a bounded creative/structural Search experiment. A site-specific source or technical blocker may justifiably eliminate options, but must be named. Prefer one meaningful work unit to a cluster of cosmetic edits.
4. **Choose by expected *incremental* Search value, not easiest-to-ship changes.** Consider searcher urgency, source strength, distinctive benefit beyond existing top answers, discoverability, indexing constraints, implementation effort, reversibility, and the earliest measurable falsification. Ads competition is not SEO ranking difficulty. Current-`ready` work that no longer meets these conditions should be revalidated under existing task state rules instead of producing more inventory to dilute it.
5. **Force a real feedback check.** Review `completed` Tasks with deployment status `pending`/`failed`, due `optimization_event_list`, and existing same-page cooldowns *before* unrelated new ideas. Record the exact status: `merged_not_live`, `live_not_evaluable_yet`, `evaluated_improved`, `evaluated_not_improved` or `unknown`; use actual API states for persistence, with these labels only in reports. A failed Pages build or `commit_message` skip cannot be waved away as a successful launch. No changedAt or outcome attribution until actual production verification.
6. **Record an action or a blocker with its next test.** A run may legitimately produce zero Tasks, but a zero-Task run still must say which concrete acquisition constraint is currently preventing a useful action and the next recheck condition. Never call task throughput, code merged, SEO score or optimistic forecasts business outcomes.

### Channel-ownership boundary and required handoff

Site Operator's current `seo_task_create` schema and `gsc_clicks` objective **do not contain distribution experiments, social publishing, referral conversion or retention as first-class outcomes**. The SEO Manager must therefore **not** fabricate an `internal_links`, `new_article` or `technical` SEO task for posting an X thread or creating a distribution campaign.

When a site already has useful differentiated material but no discovery/distribution path, report a distinct **`distribution_gap`** with a site URL, concrete shareable asset, target audience, likely channel, measurement gap and an explicit statement that this is *outside the current SEO implementation contract*. Do not assert such a campaign was queued, executed or measured. If publishing can be justified as a useful **onsite** organic-Search decision aid, that real site artifact can still use `site_expansion` with an honest Search outcome and no fake off-site delivery.

The proposed additive first-class distribution/cross-channel model is in [sites-operator-acquisition-expansion.md](./sites-operator-acquisition-expansion.md); it is **not active policy**. Turning it on requires an owner-approved policy objective, an explicitly connected publisher/metrics path and working delivery/measurement acceptance. The scheduled SEO Manager and its worker remain the single SEO actor while this is unresolved.

### Concrete diagnostic regression examples

- **Job World (2026-09-08..10-05):** previous 28d GSC 441 impressions / 4 clicks → current 28d 6 impressions / 0 clicks. A strong job-graph redesign merged on 2026-10-09 cannot explain an observation period that ended four days earlier. Analyze lost visibility and indexed canonical job pages before publishing dozens more occupation summaries; a real image/graph distribution pilot is *currently a separately tracked capability gap*.
- **Yohaku:** previous28 impressions 16 → current28 4, no GSC clicks; the older dating corpus versus broader 20s topics and indexation coverage are strategic/technical uncertainties. A new calculator may create useful user value, but without launch verification and real entry distribution it is not demonstrated growth.
- **AWS credential choice hub:** Task `seo-invest-shikaku-aws-cert-path-20261008` merged but its saved publication check was `failed` because Pages `[CF-Pages-Skip]` guard skipped the deployment. Treat this as unpublished work and investigate the provider/repository gate, not as a completed acquisition win. Never start its 14/28-day evaluation clock from a skipped release.
- **Indexation baseline:** the prior trailing-slash variant inspection was invalid; empty canonical inspection cache means **unknown**, not 0% indexed. If URL Inspection credentials are absent, report the credential blocker without reserving quota or inventing indexing status.

## Active experiment loop

Prefer a small reversible pilot to repeatedly waiting for certainty. A sourced user question and an exact current-page omission can justify an improved answer section, comparison, navigation, calculator or focused new page even when traffic impact is uncertain. Explain why the artifact helps the user; generic keyword stuffing, cosmetic edits and unsupported claims do not qualify.

1. Review due existing `optimization_event_list` results and recent completed Tasks. Read linked current artifacts, deployment state and compact digests. Use `optimization_evaluation_context` for registered article events when adequate matched measurements exist.
2. Record in each experiment Task's existing rationale/evidence: hypothesis, exact artifact, primary metric, baseline dates and completeness (or explicitly unknown), evaluation due date, success/failure criteria and rollback. This is a bounded test, not a guaranteed uplift claim.
3. Keep each pilot bounded by one coherent search/user outcome rather than by an artificially tiny diff. A substantial single-page revision, one strong new page, a tightly related 2–3 page mini-cluster, or a homogeneous verified data batch can each be one Task when they share one hypothesis, one rollback boundary and explicit per-artifact acceptance checks. Keep the 3–5-task planning batch and per-repository caps. A weak global average, sparse analytics or uncertain uplift is not a blanket stop; choose an independently supported user improvement.
4. Link the Task ID to an existing or proposed optimization event for registered articles via event notes and Task history. Do not create a separate experiment database. Worker records the merged artifact and event handoff; main merge remains implementation completion.
5. A merged artifact is not yet an active traffic experiment. Use a bounded actual public/deployment observation before marking `deploymentVerification=verified` and the event `phase=implemented`. Start `changedAt` and the default 14-day evaluation window from the real publication observation, not an unverified merge. Preserve pending/failed publication blockers separately.
6. At maturity, compare the pre-change hypothesis (the reader's question, the current page's specific deficit, and observed competitor-body differences) with the change actually delivered in GitHub and the page actually published. Use the existing exact-canonical URL Inspection cache to establish whether Google recrawled the changed page after publication, then use complete, comparable 14-day and 28-day GSC windows when available. Evaluate the hypothesis as `supported`, `contradicted`, or `inconclusive`; record the evidence, observation window and data completeness, confounders, and limits of the conclusion in the existing Optimization Event with `optimization_event_update`. Indexation alone does not establish article-quality improvement. If Google has not recrawled the updated page, the result is unknown/inconclusive, not a failed improvement. A simple before/after comparison does not establish causality. When evidence supports a pattern, carry it into the next comparable article plan as a tentative, source-event-linked hypothesis; do not turn one case into a universal SEO rule. Missing, stale, or partial metrics stay unknown: record the next review date and exact blocker in the event notes; do not silently cancel the evaluation or call it neutral to unlock another change.
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

## Independent Task admission and failure isolation

**Research persistence is not an unconditional prerequisite for all SEO Task creation.** Maintain two independent outcomes in each run: (A) Keywords Operator discovery ledger work and (B) Sites Operator implementation admission. After confirming an actionable defect, complete its Task eligibility decision even if the separate discovery write fails, subject to the following safeguards.

1. **Evidence and readiness:** Check the active site, current default-branch body/file, source-backed precise defect or observed reader job, same-site indexation summary and digest, existing tasks/PRs, article cooldown, direction/incident policy, bounded artifact, acceptance criteria, rollback and follow-up. Neither an unsaved exploratory hypothesis nor a rejected `pilot_ready` promotion is evidence by itself.
2. **Research provenance:** If an eligible candidate was saved as site-matched `pilot_ready`, pass its exact `research` triplet to `seo_task_create`. If research saving failed because of a transient outage, quota, or an unrelated validation issue, an **independently justified** factual/technical or narrow reversible Task may use the API's optional `research` omission; record actual source URLs and observations in `rationale/evidence`, mark research persistence unconfirmed, and never invent a candidate ID/revision. Do not mislabel an unsaved discovery as `pilot_ready`.
3. **Safety and authorization:** A platform safety/permission refusal is not merely a quota error. Do **not** resubmit that refused operation under another tool, schema or label, and do not translate the same refused substantive action into a Task as a workaround. Record the refused action and diagnostic; continue only unrelated, independently allowed candidates. If the refusal scope is ambiguous, treat the refused candidate as blocked pending clarification.
4. **Continue across the portfolio:** A single candidate failing research persistence, a single rejected Task or one URL's cooldown must not terminate portfolio search. With a deficient ready buffer, pivot to other eligible sites/page families and independent repairs within the active risk caps and actual time budget. Save each eligible Task promptly instead of waiting for the research batch to finish.
5. **Truthful receipts:** For each candidate examined, distinguish `eligible_and_saved`, `eligible_but_write_failed`, `cooldown`, `duplicate`, `needs_evidence`, `strategic_decision_required`, `policy_blocked`, and `safety_refused` as applicable. Read each created Task back. Report initial/final ready counts, candidates/sites considered, actual creation attempts, the exact error category, and why any executable candidate was not registered. New Tasks are never promised merely to hit a quota.

No new database, retry worker, exception to an incident gate, or safety circumvention is introduced by this decision path.

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

Before any new task, verify (a) the site is active, (b) the current target file and exact defect on default-branch HEAD, (c) relevant existing active/history tasks and PRs/commits, (d) sources or dated digest evidence, and (e) non-duplicative acceptance criteria. Decide Task admissibility **independently of research-ledger persistence**, under the failure-isolation rules above. Then use `seo_task_create` to save a `ready` record, including evaluation provenance when an evaluator materially informed the decision, and **immediately use `seo_task_get` to read back and confirm** the ID, status, repo, target URL, rationale, sources, and evaluator reference when present. Do not leave a speculative `proposed` backlog. No GitHub Issues, PRs, code edits or deploys from the Planner.

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
