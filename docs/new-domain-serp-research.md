# New-domain SERP research (Keywords Operator)

## Objective

Find **observable new-domain entry into SERPs**, then inspect the real page content before forming an SEO hypothesis. This is an **evidence discovery tool**, not a ranking-factor detector or a second Sites Operator task queue.

### MCP

Use \`young_domain_serp_research\` (Keywords Operator MCP, introduced with v1.21.0):

\`\`\`json
{
  "queries": ["flowkey vs simply piano", "flowkey vs simply piano for adult beginners"],
  "country": "us",
  "language": "en",
  "num": 10,
  "ageDays": 365,
  "maxRdapChecks": 8,
  "maxPageReads": 2
}
\`\`\`

- **1–5 actual query strings** per call; do not use anonymous industry guessing as a substitute for observed queries. Reuse shared \`serpResearchCached\` with provider provenance, monthly quota, and cache. Default provider=\`api\` uses the configured Reserp/Bright Data proxy; \`brave\` is exploratory and **never Google rank data**. Default SERP max cache age = 168 hours.
- Group hostnames into likely registrable domains, with explicit exclusion of common multi-tenant hosting services. This is a limited public-suffix heuristic; unusual suffixes must be checked manually.
- Inspect up to **8 public RDAP records** via \`rdap.org\`, a registry bootstrap service with a documented public rate limit. Fetch redirects through the existing DNS/SSRF-safe bounded public JSON adapter; no new key is required.
- The RDAP \`registration\` event may establish **domain registration age**, not site creation time, first index date, ownership continuity, content novelty or actual authority. The tool returns separate \`recentRegistrationCandidates\`, \`unknownRegistrationCandidates\`, older and unchecked counts. Unknown is not zero age.
- Fetch up to **4 actual pages** from recent/unknown candidates with the existing safe public-web reader; pages can fail, truncate, redirect or change since indexing. Page text is factual evidence, not an automatically inferred SEO gap.
- Every SERP appearance retains query, observed position, URL, provider, upstream provider, and snapshot timestamp. The read-only response includes coverage and error counts and does not invent traffic, persistence of ranks or "success."
- SERP budget/provider exhaustion **stops the remaining batch**. Domain RDAP failures remain explicit unknowns and do not qualify as confirmed young domains.

### Analysis procedure

1. Use observed queries from existing keyword/market research (or genuine user problems), preferably several adjacent intents. Collect **multiple** appearances per domain when available.
2. Treat the result as a **discovery shortlist**, not a ranked winner list. Verify RDAP dates independently where domain grouping is uncertain. Exclude abandoned/repurposed domains and acquisitions using historical page records and prior-brand/backlink evidence, which this tool does **not** yet verify automatically.
3. Review full competing page bodies, primary evidence, site-level navigation, commercial mechanics, and unique artifacts. Separate visible format from actual reader utility. Collect both growing and non-growing comparisons.
4. Form falsifiable hypotheses, not Google algorithm claims. A current SERP position is not GSC traffic, stable rank or an SEO causal explanation.
5. If actionable for a managed site, investigate in the corresponding Keywords research ledger. Only Sites Operator can create the actual SEO Task through its normal planner/worker and measured experimentation process. This tool does not modify Site SEO policy, dispatch tasks, publish pages or create recurring jobs.

### Limits / future extensions

There is no domain-age database or bulk historical index yet. RDAP can be unavailable, and up to eight lookups may yield mostly established domains. Use narrower queries or skip known competitors through \`excludeDomains\`, and perform additional bounded calls when necessary. At present the tool runs **on demand only**; historical rank tracking, automatic Wayback/first-seen corroboration, cross-domain backlinks, UI presentation and time-based monitoring are out of scope of this initial MCP release.

Check with \`npm run test:mcp\`, \`npm run typecheck\`; the new smoke test isolates multi-query aggregation, registered-domain grouping, recent vs older vs unknown dates, body retrieval, and quota stop. Production capability must be confirmed by \`remote_keyword_status\` showing v1.21.0 and 43 tools after deployment.

## RDAP reliability (1.22.2)

Domain registration verification is now attempted first at the **authoritative TLD registry**: direct Verisign for .com and .net, and HTTPS services from the official IANA `https://data.iana.org/rdap/dns.json` bootstrap for other supported TLDs. `rdap.org` remains a last-resort public redirector, not the sole source. The IANA bootstrap is cached in-process for 24 hours; registry lookups retain the existing SSRF/redirect/body-size restrictions. Failure messages contain sanitized classes (e.g. rate_limited/network_error/not_found), never credentials or raw HTTP bodies. Domains with no usable registration event remain **unknown** and cannot pass the SEO corpus gate. This cannot manufacture registration dates for registries without publicly accessible RDAP (including some country-code TLDs); do not relax the gate to compensate.

Collection remains bounded to 8 checked domains per request, with no repeated background ranking verification.
