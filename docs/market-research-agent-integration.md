# Market research agent integration — operator boundary and CI contract

Canonical **chat orchestration instructions**: My Portal `chatSkills/market-research-orchestrator` (revision checked on every edit). **Do not mirror or override that full skill here.** The present file documents executable ownership, compatibility, and how to validate changes in GitHub CI.

## Runtime architecture
The ChatGPT agent orchestrates; operators remain independent. There is **no new cross-operator database, background poller or credential-sharing server**.

`market_discovery_run` accepts a focused candidate with a name, query and optional research question. Database-specific fields are optional. Focused checks run one candidate at a time; after a 429/quota failure, any remaining candidates are reported as skipped for that call.

| Stage / concern | Evidence-owning system | Representative capability (examples, not permanent list) | What it does not prove |
| --- | --- | --- | --- |
| Blind market/traffic observation | Keywords | `market_discovery_run(phase=observe)` or relevant source-specific tools | Visitors, sales, promotion rights |
| Product and creator-market observations | Keywords | `market_product_discovery`, `marketplace_research` | Transaction count, conversion |
| Focused verification | Keywords | `market_discovery_run(phase=validate)` or relevant demand, SERP, social and source-specific tools | Guaranteed demand or viability |
| Acquisition venue investigation | Keywords + user-requested public Web | `traffic_route_discovery` and actually observed venue URLs | Permission to post, conversions |
| Existing-site performance | Sites | `site_query_opportunities`, registered sites, GSC/GA4 summaries | A change will produce visits |
| Actual distributions / growth experiment | Sites | `growth_initiative_*`, `distribution_experiment_*` *if actually exposed in current session* | Successful launch/measurement |
| Advertiser approval and contracts | Affiliate Operator | `affiliate_offer_search`, `affiliate_program_search` | Every item in catalog is approved |
| Real social posts and measured results | Tweets Operator | Read-only account/post stats where available | Referral attribution unless measured |
| Project routing, durable decisions, chat protocol | My Portal | `world_map_get`, `chat_skill_get`, project Contexts | New independent market evidence |

**Agent selects capabilities, not fixed platform/taxonomy/version.** Every new research invocation: check the actual exposed tool schema, then use only relevant specialists. `remote_*_status.tools` reports deployed server endpoints, **not necessarily tools currently exposed to the chat client**. A missing tool must be treated as unavailable; do not fabricate its arguments or "simulate" a write to a different collection.

## Evidence handoff
Prefer compact, provenance-preserving packets: observed source URL, source system, observed date, metric name and definition, independence, competing evidence, buyer intent, distribution permission, actual purchase/traffic data or `unknown`, verdict and cheapest next test. Don't write all raw observations to My Portal or create a second research database. Save only on explicit request and to the owner of the particular data type. If no verified landing page/site is known, **do not create** a Sites experiment to satisfy an abstract workflow.

For an open-ended market request, begin with observed public records before describing discovered markets. For a previously known candidate, a narrow countercheck or an update, begin directly with the question at hand. `market_discovery_run` exposes separate read-only `observe` and `validate` actions; neither is a mandatory predecessor of the other. `sources` selects observed sensor adapters, and `withDemand` is opt-in because a demand lookup has a distinct cost. The runner reports scope, provenance and failures; it does not decide sufficiency or produce ideas. Post-observation creative reinterpretation and any decision remain agent work. "Gadget", "anime", "fan", "career" and any other user examples are **not exhaustive taxonomies**. Real platform tags and linked documents can introduce new niche names; preserve original labels and URLs. A provider-tag count is not an independent platform count.

## Costs, outages and missing connectors
- Select breadth, freshness and depth from the requested decision and the evidence already in hand. Use cheap distinct observations for an unknown field; use a focused read for a known candidate. Call expensive quota-bearing sources only when the answer can change the decision. Before a high-cost source, check current quota if cheaply available. Stop when the expected value of another read is low, but report unresolved uncertainty.
- Firestore 429: stop repeated queries to that backend for the turn. Use unaffected read-only operators or public Web, retain explicit missing evidence, never treat it as market absence or bypass publishing/approval gates.
- Site server/client MCP exposure can drift, but **the earlier 47/55 mismatch is no longer active**. After the user refreshed Sites Operator on 2026-10-14, the current ChatGPT connection exposes all 55 methods, including 8 growth/experiment endpoints; production `remote_sites_status` agrees. The observed remaining failure is `growth_initiative_list({limit:1})` returning **Firestore 429 at runtime** despite correct tool exposure. Its specific root cause is not yet established. Do not prescribe reinstallation or refresh as a fix for 429. No SEO-task or optimization-event workaround. The incorrect connection-mismatch report was closed as [#182](https://github.com/nomuonji/keywords/issues/182).
- Keywords server/client schema can also drift even when the tool name is exposed; `niche` or `observedVenueUrls` must be passed **only when advertised by the invoked session tool schema**.
- Actual publication, product affiliation and referral attribution are distinct checks. Never report a suggested route as a completed distribution experiment.

## Evidence and conclusion threshold
- Label actual observations, deductions, creative hypotheses, independent reconfirmations, contrary facts and unavailable checks. An observed URL, a search count or a read competitor page is not a finding of unmet demand. Two feeds pointing to the same page or two pages from one publisher are not independent corroboration.
- Idea exploration may return many unverified concepts without detailed SERP reads for every idea. A strong build, SEO or revenue recommendation needs evidence for its consequential assumptions, including a credible data supply, user behavior, competition, acquisition and monetization where relevant, plus a genuine counterexample. If a necessary check is missing, hold the conclusion. Numeric metrics retain their own definitions; missing numbers do not automatically disqualify a noncommercial or hard-to-measure field.
- The agent chooses the cheapest next check that could change the conclusion. No fixed observation count or tool-call count certifies sufficiency. User-specified limits and quota boundaries take precedence.

## CI / change-management
- `scripts/market-discovery-runner-smoke.ts` exercises selective low-cost observation, direct candidate validation without a prior observe step, provenance, optional demand, and source failures. This is a mock regression, not live market proof.
- `scripts/market-agent-routing-smoke.ts` checks the **Keywords MCP contract** for core capabilities, not a frozen total count of tools. Renaming/removing any critical function without a replacement in its capability group should fail CI. Tests also check that optional branches, missing cross-operator chat tool exposure and Firestore429 degrade safely.
- This is a **repo-level compatibility guard**. It cannot prove My Portal's skill revision, third-party permissions, MCP-client metadata or live data source health. Do not call it a completed end-to-end test.
- After changes to an operator: inspect current tool list and argument schema in ChatGPT; run an inexpensive blind observation and one focused selection; test a source outage and provenance. Test a site or affiliate write only with an explicitly authorized verified target and actually exposed permission, never just for a smoke test. Compare GitHub CI and Vercel deployment SHA.
- Updating route logic: change the My Portal canonical skill, then its specialist skill pointers, and the contract/CI checks if a critical capability was renamed. The runbook exists to make this obvious; do not maintain a second verbatim skill description in GitHub.
- If a connector has stale tool exposure, record a single integration issue with exact server/client tool names, version/sha and reproduction. Do not add repeated retries or a parallel database to mask the problem.

## Minimal acceptance by request category
1. Broad unknown-market request: sample distinct public sensors as needed, retain unanticipated subjects and real URLs, and label idea expansion as hypothesis. Do not turn sensor count into a sufficiency certificate.
2. Product/affiliate request: observe named real item and selling evidence, seek independent demand and actual advertiser eligibility, not only search rank.
3. Acquisition request: real origin and destination URL plus link permission check or explicit unknown, no invented referral count.
4. Existing-site growth: actual registered site, analytics baseline, appropriately authorized experiment endpoint; incomplete if either missing.
5. Review/follow-up: actual dated outcomes can overturn previous hypothesis; no inferred automatic training from inaccessible analytics.

**Success criterion:** a research hypothesis can travel across relevant specialists while keeping proof/unknown/owner boundaries intact, with explicit soft failures for missing capabilities.


## Country-aware international discovery (2026-10-16)
- `market_discovery_run` accepts `country` (ISO 3166 alpha-2, default `JP`) and `language` (optional BCP-47-style two-letter language, inferred for common target countries). Both `observe` and `validate` report the effective `market`.
- For non-JP observe, the default is `open_signals` only. Google Trends is requested for the selected country. Hacker News is explicitly `international_unlocalized` and **must not be interpreted as an American/British/etc. sample**. `curated_links` (Japanese Hatena) and `commerce_rankings` (Japanese Rakuten) are reported as unavailable for non-JP regions even if explicitly requested; they are never relabeled as local proof.
- For focused validation, SERP query, locale and competitor page reads use the selected country/language. Do not infer a country from the language of an English-language article.
- To compare markets, make equivalent, bounded country-scoped calls, retain each region's source and observation date, and compare only genuinely comparable measures; never aggregate unrelated rankings, engagement and estimated search traffic into a global demand figure.
- Canonical Idea Memory now supports `marketCountries` and `contentLanguages` as optional metadata in upsert/patch, with region labels in the inbox. One creative idea can target multiple locales while preserving **one** canonical idea ID, user verdict, history and nonexclusive output destinations. A translated variant is not automatically a new independent idea. New regions with distinct user tasks/data structures may deserve a separately researched idea, not assumed duplicate.
- `market_signal_scan`, `market_intelligence_research`, `serp_research` and `keyword_research_pipeline` remain available for targeted regional depth. The live international entry is not yet an automatic multilingual daily research scheduler. Overseas marketplaces, local Reddit communities and country-specific TikTok trends require separate source evaluation; unavailable sources are missing evidence, not proof of no opportunity.
