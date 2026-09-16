# Remote Keywords Operator

`/mcp` is the Vercel-hosted Streamable HTTP MCP endpoint used for shared keyword research. It is intentionally separate from the local SQLite SEO execution loop: remote research state lives in Firestore and remote credentials remain environment-only.

The operating principle is:

```text
Google Ads API = large, low-cost first-stage screening
SERP API       = small, high-cost second-stage verification
Firestore      = durable research state + SERP cache
```

Do not send every generated phrase to SERP. Generate broadly, screen up to 50 exact keywords at a time with Google Ads, then spend SERP quota only on the strongest survivors.

## MCP tools

The 1.4 remote contract keeps all previous tools and adds resumable research, quota-aware SERP, rich search and incremental site editing.

| Tool | Purpose |
| --- | --- |
| `remote_keyword_status` | Version/deployment/provider/quota configuration without secrets |
| `keyword_demand_research` | Raw Google Ads historical demand, proxy first then direct fallback |
| `keyword_screen_batch` | Google Ads-only batch screening; never calls SERP |
| `keyword_research_pipeline` | Bounded Google Ads → top-N SERP pipeline; `maxSerpChecks` defaults to 5 and maxes at 10 |
| `serp_research` | Cached, quota-aware SERP research; `forceRefresh=false` by default |
| `serp_analyze` | Analyze an already-supplied normalized SERP; no external request |
| `serp_usage_status` | Current monthly API requests, cache hits, limits, reserve and remaining quota |
| `keyword_treasury_save` | Save evidence-backed candidates with structured demand/SERP fields |
| `keyword_treasury_list` | Backward-compatible simple list |
| `keyword_treasury_search` | Filter/sort Treasury, including `shortlisted AND unassigned` |
| `research_session_create` | Start durable research context |
| `research_session_get` | Read a session; no ID means latest active, then latest overall |
| `research_session_list` | List historical research sessions |
| `research_session_update` | Revision-controlled replacement/additive update |
| `site_structure_list` | List site concepts |
| `site_structure_get` | Read full site concept + linked Treasury keyword records |
| `site_structure_save` | Create/full-edit a concept; supplied node/link arrays remain full replacement |
| `site_structure_patch` | Incremental nodes/links/keyword links without resending the full graph |

Tool results include both legacy text JSON and MCP `structuredContent`, so older clients remain compatible while newer clients can consume objects directly.

## Firestore collections

Firestore creates documents lazily; there is no destructive SQL-style migration. Existing documents remain valid.

### `keywordTreasury/{keywordId}`

Keyword IDs remain deterministic hashes of normalized keyword text. Existing legacy fields remain supported. New first-class fields are additive:

```text
keyword
seed
status
notes
source

avgMonthlySearches
averageCpcMicros
competitionIndex
opportunityScore
weakDomainCount
forumCount
stalePageCount
exactTitleCount

demandResearchedAt
serpResearchedAt
country
language

evidence              # supplemental free-form context
createdAt
updatedAt
```

Compatibility rules lazily derive `avgMonthlySearches` from legacy `volume`, numeric `competitionIndex` from legacy numeric `competition`, and structured metrics from matching `evidence` keys when present. A later save merges into the existing document instead of deleting unspecified legacy fields.

`keyword_treasury_search` currently uses a bounded compatibility scan (`KEYWORDS_TREASURY_SEARCH_SCAN_LIMIT`, default 2000, hard max 5000) and filters/sorts in the command layer. This avoids an immediate Firestore composite-index migration and keeps old heterogeneous documents searchable. When the collection grows beyond that range, move hot filters to indexed server-side queries rather than simply raising the scan indefinitely.

### `researchSessions/{id}`

```text
id
title
objective
seedThemes[]
hypotheses[]
researchedKeywordIds[]
shortlistedKeywordIds[]
rejectedKeywordIds[]
findings[]
nextActions[]
siteConceptIds[]
notes
status                 # active | paused | completed | archived
revision
createdAt
updatedAt
```

`research_session_update` supports both full arrays and additive `add*` inputs. This is the durable handoff surface for prompts such as “前回のお宝キーワード探しの続き”. Get-without-ID resumes the latest active session. Every successful create/update writes a Firestore `runs` audit record and updates use optimistic revision control.

### `serpCache/{sha256(cacheKey)}`

The cache key includes normalized query plus country, language, location, provider and result count. Documents store:

```text
cacheKey
query
country
language
location
provider
num
fetchedAt
expiresAt
snapshot
analysis
createdAt
updatedAt
```

Default cache TTL is 30 days. A fresh hit returns the saved snapshot/analysis without calling the SERP provider. `forceRefresh=true` explicitly bypasses the cache, but quota rules still apply.

### `serpUsage/{YYYY-MM}`

```text
month
actualApiRequests
cacheHits
forcedApiRequests
blockedRequests
createdAt
updatedAt
```

Counters are month-scoped and updated with Firestore optimistic preconditions. `actualApiRequests` is reserved before the provider call, intentionally preferring slight over-counting after an upstream failure over accidental quota overspend.

### `siteStructures/{id}`

Existing concept fields and complete `nodes[]` / `links[]` remain compatible. The concept is enriched with DB-driven SEO metadata:

```text
dataModel[]
  entity
  fields[] { name, type, description, required }

sourceStrategy[]
  name
  sourceType            # official_pricing / official_feature / official_faq /
                        # official_docs / regulator / other
  urlPattern
  fields[]
  notes

pageTemplates[]
  id
  titlePattern
  kind                  # comparison / detail / directory / landing / other
  purpose
  dataRequirements[]

refreshPolicy[]
  scope
  ttlDays
  trigger
  notes
```

Nodes keep `keywordIds[]` and add optional per-keyword roles through `keywordRoles` (`primary`, `secondary`, `supporting`, `parent`, `monetization`). Old nodes without roles normalize to an empty role map.

`site_structure_patch` operations are:

```text
addNode
updateNode
removeNode              # cascade optional
addLink
removeLink
linkKeyword             # role-aware
unlinkKeyword
```

The existing `site_structure_save` remains the create/full-edit surface. Both use optimistic revisions and graph validation. Treasury search derives the reverse relation from site node keyword IDs so `linkedToSite=false` provides the required `shortlisted AND unassigned` workflow without duplicating link state in a second collection.

## SERP quota policy

Configuration is environment-driven:

| Variable | Default | Meaning |
| --- | ---: | --- |
| `KEYWORDS_SERP_MONTHLY_LIMIT` | 2000 | Hard monthly provider-request limit |
| `KEYWORDS_SERP_SOFT_LIMIT` | 1500 | Automatic research cutoff |
| `KEYWORDS_SERP_RESERVE` | 500 | Capacity reserved for explicit forced checks |
| `KEYWORDS_SERP_CACHE_TTL_DAYS` | 30 | Fresh-cache lifetime |

The normal cutoff is the smaller of the soft limit and `monthlyLimit - reserve`. At/after that cutoff ordinary automatic SERP calls are rejected before the provider call. An explicit `forceRefresh=true` may use reserve capacity until the hard monthly limit. At the hard limit every external SERP request is blocked.

Cache hits do not consume `actualApiRequests`. `keyword_research_pipeline` always performs Google Ads screening first, sorts passing candidates by a transparent screen score, and attempts SERP only for the first `maxSerpChecks` candidates. It never auto-saves to Treasury or creates a Site Concept; promotion remains a separate explicit step after evidence review.

## Recommended agent loop

```text
research_session_get()                 # resume existing work when appropriate
       ↓
research_session_create()              # only if a new objective is actually needed
       ↓
generate many candidate phrases locally
       ↓
keyword_screen_batch(<=50)             # Google Ads only
       ↓
deduplicate / reject obvious low-value candidates
       ↓
keyword_research_pipeline(maxSerpChecks<=5)
       ↓                               # cached / quota-aware
keyword_treasury_save(final evidence-backed candidates)
       ↓
research_session_update(findings, rejected/shortlisted IDs, nextActions)
       ↓
keyword_treasury_search(linkedToSite=false, status=shortlisted)
       ↓
site_structure_save(create) / site_structure_patch(iterate)
       ↓
research_session_update(siteConceptIds, nextActions/status)
```

The agent should not treat the pipeline screen score or SERP opportunity score as a ranking prediction. They are triage signals used to spend scarce research budget consistently.

## Migration and compatibility

No destructive migration is required. New Firestore collections are created on first write. Existing `keywordTreasury` and `siteStructures` records are read with defaults/legacy-field fallbacks and are enriched only when updated. No existing collection is renamed or deleted, and the original nine MCP tool names remain available.

No Firestore composite indexes are required for this version because rich Treasury filtering is a bounded command-layer compatibility scan and site reverse links are derived from existing site documents. This is deliberate for a safe rollout; revisit indexes when data volume justifies server-side filtered queries.

## Environment and credentials

Set remote credentials only in encrypted Vercel environments. Do not put secrets in Git, Firestore, MCP responses, `runs`, research sessions, or site concepts.

Required/optional variables include:

```text
KEYWORDS_REMOTE_MCP_TOKEN
KEYWORDS_REMOTE_MCP_ALLOWED_ORIGIN
FIREBASE_PROJECT_ID
FIREBASE_SERVICE_ACCOUNT_JSON
GOOGLE_ADS_KEYWORD_VOLUME_API_URL
BRAVE_API_KEY / KEYWORDS_BRAVE_API_KEY
KEYWORDS_SERPER_API_KEY
KEYWORDS_SERP_ENDPOINT
KEYWORDS_SERP_CACHE_TTL_DAYS
KEYWORDS_SERP_MONTHLY_LIMIT
KEYWORDS_SERP_SOFT_LIMIT
KEYWORDS_SERP_RESERVE
KEYWORDS_TREASURY_SEARCH_SCAN_LIMIT
```

Google Ads demand uses the working proxy first and direct Google Ads credentials only as fallback. SERP provider credentials never enter Firestore. `remote_keyword_status` reports readiness/configuration but not secret values.

## ChatGPT connection

Use the production `/mcp` URL with OAuth/PKCE. The endpoint exchanges the configured access key for short-lived access tokens and renewable refresh tokens. Static bearer auth remains available for API/MCP clients.

After a server deployment that changes the tool contract, ChatGPT may cache the previous connector manifest for the current conversation. `remote_keyword_status.tools` is the server-side source of truth; reconnect/refresh the custom connector or start a new session when the client needs to discover newly added tools.
