# Market research agent integration — operator boundary and CI contract

Canonical **chat orchestration instructions**: My Portal `chatSkills/market-research-orchestrator` (revision checked on every edit). **Do not mirror or override that full skill here.** The present file documents executable ownership, compatibility, and how to validate changes in GitHub CI.

## Runtime architecture
The ChatGPT agent orchestrates; operators remain independent. There is **no new cross-operator database, background poller or credential-sharing server**.

| Stage / concern | Evidence-owning system | Representative capability (examples, not permanent list) | What it does not prove |
| --- | --- | --- | --- |
| Blind market/traffic observation | Keywords | `distribution_case_discovery`, `market_signal_scan` | Visitors, sales, promotion rights |
| Product and creator-market observations | Keywords | `market_product_discovery`, `marketplace_research` | Transaction count, conversion |
| Independent verification | Keywords | `keyword_research_pipeline` or `keyword_demand_research`, `market_intelligence_research`, `search_gap_research` | Guaranteed demand |
| Acquisition venue investigation | Keywords + user-requested public Web | `traffic_route_discovery` and actually observed venue URLs | Permission to post, conversions |
| Existing-site performance | Sites | `site_query_opportunities`, registered sites, GSC/GA4 summaries | A change will produce visits |
| Actual distributions / growth experiment | Sites | `growth_initiative_*`, `distribution_experiment_*` *if actually exposed in current session* | Successful launch/measurement |
| Advertiser approval and contracts | Affiliate Operator | `affiliate_offer_search`, `affiliate_program_search` | Every item in catalog is approved |
| Real social posts and measured results | Tweets Operator | Read-only account/post stats where available | Referral attribution unless measured |
| Project routing, durable decisions, chat protocol | My Portal | `world_map_get`, `chat_skill_get`, project Contexts | New independent market evidence |

**Agent selects capabilities, not fixed platform/taxonomy/version.** Every new research invocation: check the actual exposed tool schema, then use only relevant specialists. `remote_*_status.tools` reports deployed server endpoints, **not necessarily tools currently exposed to the chat client**. A missing tool must be treated as unavailable; do not fabricate its arguments or "simulate" a write to a different collection.

## Evidence handoff
Prefer compact, provenance-preserving packets: observed source URL, source system, observed date, metric name and definition, independence, competing evidence, buyer intent, distribution permission, actual purchase/traffic data or `unknown`, verdict and cheapest next test. Don't write all raw observations to My Portal or create a second research database. Save only on explicit request and to the owner of the particular data type. If no verified landing page/site is known, **do not create** a Sites experiment to satisfy an abstract workflow.

The default route is **observable market first**, post-observation creative reinterpretation second, revalidation third. "Gadget", "anime", "fan", "career" and any other user examples are **not exhaustive taxonomies**. Real platform tags and linked documents can introduce new niche names; preserve original labels and URLs. A provider-tag count is not an independent platform count.

## Costs, outages and missing connectors
- Low-cost and distinct observations first: at most 2–3 sensor families by default. Expensive quota-bearing follow-up only for selected 1–2 candidates. Before invoking a high-cost source check current quota if cheaply available.
- Firestore 429: stop repeated queries to that backend for the turn. Use unaffected read-only operators or public Web, retain explicit missing evidence, never treat it as market absence or bypass publishing/approval gates.
- Site server/client MCP exposure can drift, but **the earlier 47/55 mismatch is no longer active**. After the user refreshed Sites Operator on 2026-10-14, the current ChatGPT connection exposes all 55 methods, including 8 growth/experiment endpoints; production `remote_sites_status` agrees. The observed remaining failure is `growth_initiative_list({limit:1})` returning **Firestore 429 at runtime** despite correct tool exposure. Its specific root cause is not yet established. Do not prescribe reinstallation or refresh as a fix for 429. No SEO-task or optimization-event workaround. The incorrect connection-mismatch report was closed as [#182](https://github.com/nomuonji/keywords/issues/182).
- Keywords server/client schema can also drift even when the tool name is exposed; `niche` or `observedVenueUrls` must be passed **only when advertised by the invoked session tool schema**.
- Actual publication, product affiliation and referral attribution are distinct checks. Never report a suggested route as a completed distribution experiment.

## CI / change-management
- `scripts/market-agent-routing-smoke.ts` checks the **Keywords MCP contract** for core capabilities, not a frozen total count of tools. Renaming/removing any critical function without a replacement in its capability group should fail CI. Tests also check that optional branches, missing cross-operator chat tool exposure and Firestore429 degrade safely.
- This is a **repo-level compatibility guard**. It cannot prove My Portal's skill revision, third-party permissions, MCP-client metadata or live data source health. Do not call it a completed end-to-end test.
- After changes to an operator: inspect current tool list and argument schema in ChatGPT; run an inexpensive blind observation and one focused selection; test a source outage and provenance. Test a site or affiliate write only with an explicitly authorized verified target and actually exposed permission, never just for a smoke test. Compare GitHub CI and Vercel deployment SHA.
- Updating route logic: change the My Portal canonical skill, then its specialist skill pointers, and the contract/CI checks if a critical capability was renamed. The runbook exists to make this obvious; do not maintain a second verbatim skill description in GitHub.
- If a connector has stale tool exposure, record a single integration issue with exact server/client tool names, version/sha and reproduction. Do not add repeated retries or a parallel database to mask the problem.

## Minimal acceptance by request category
1. Broad unknown-market request: observe at least two independent sensor families when possible, retain an unanticipated market with its real URL, don't start by guessing industry names.
2. Product/affiliate request: observe named real item and selling evidence, seek independent demand and actual advertiser eligibility, not only search rank.
3. Acquisition request: real origin and destination URL plus link permission check or explicit unknown, no invented referral count.
4. Existing-site growth: actual registered site, analytics baseline, appropriately authorized experiment endpoint; incomplete if either missing.
5. Review/follow-up: actual dated outcomes can overturn previous hypothesis; no inferred automatic training from inaccessible analytics.

**Success criterion:** a research hypothesis can travel across relevant specialists while keeping proof/unknown/owner boundaries intact, with explicit soft failures for missing capabilities.
