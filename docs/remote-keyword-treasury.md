# Remote keyword treasury

`/mcp` is a deliberately small, Vercel-hosted Streamable HTTP MCP endpoint.
It is not the local Keywords MCP and must never expose SQLite, Blog delivery,
work sessions, or filesystem operations.

## Tools exposed remotely

- `remote_keyword_status` — configuration check without secrets
- `keyword_demand_research` — calls the configured keyword-volume proxy
- `serp_research` / `serp_analyze` — SERP evidence and transparent screening
- `keyword_treasury_save` — writes evidence-backed candidates to Firestore
- `keyword_treasury_list` — reads the shared candidate stock
- `site_structure_list` — lists shared site concepts, with `nextPageToken`
- `site_structure_get` — reads a concept, revision and original linked keywords
- `site_structure_save` — creates/edits a concept and its page hierarchy

## Site concepts and page structures

The **サイト構想** tab (`?view=structures`) reads the same Firestore data as
the remote MCP. Like the keyword treasury, this is a public, read-only browser
view; writes require the existing MCP bearer/OAuth authentication. Do not store
secrets or private client information in these shared concepts.

Firestore uses collections rather than SQL tables. `siteStructures/{id}` stores
the concept and its complete page graph in one document. It is created on the
first save; no separate database migration or manual Firebase console setup is
needed. There is no SQLite copy or separate agent state. Persistence primitives
and types belong to `packages/db`, validation/mutations to `packages/commands`,
and HTTP/MCP adapters call the same commands. This is a remote-first planning
extension, like the existing treasury, rather than the local SEO execution loop.

| Field | Meaning |
| --- | --- |
| `id`, `title` | Stable concept ID and display name |
| `concept`, `audience`, `monetization`, `notes` | Site brief |
| `status` | `draft`, `active` (under consideration), or `archived` |
| `nodes[]` | Stable page `id`, `parentId` (null for roots), `title`, relative `path`, `kind` (`home/category/article/landing`), `purpose`, `keywordIds`, `notes` |
| `links[]` | Internal links: node IDs `from`, `to`, and anchor/purpose `label` |
| `revision`, `createdAt`, `updatedAt` | Conflict protection and timestamps |

Use `keyword_treasury_list` after research to obtain keyword IDs. Link these
IDs to pages; do not manufacture measured demand. The detail endpoint resolves
the original keyword records, so demand is not copied into stale plan fields.
Unmeasured page ideas can be saved with an empty `keywordIds` array.

Create with a client-chosen stable ID, `expectedRevision: 0`, and a title:

```json
{
  "id": "new-site-concept",
  "expectedRevision": 0,
  "title": "新しいサイト構想",
  "concept": "調査済みキーワードをもとに検討するサイト",
  "nodes": [
    { "id": "home", "parentId": null, "title": "トップ", "path": "/", "kind": "home", "keywordIds": [] }
  ]
}
```

To edit, call `site_structure_get`, then pass its revision as `expectedRevision`.
Omitted fields stay unchanged; provided `nodes` and `links` replace their whole
arrays. Preserve unchanged entries when editing a single page. Use empty arrays
to clear them and `status: archived` to retire a concept. Parent cycles, duplicate
IDs/paths, dangling internal links, and unknown treasury IDs are rejected.
Concurrent updates are rejected via Firestore `updateTime` preconditions; re-read
and reconcile instead of blindly retrying. Each successful save atomically writes
one `runs` audit record in Firestore. No publication or page approval occurs.

Each concept supports up to 200 pages, 500 internal links and 500 unique treasury
references, with a 600 KB JSON size cap. Listing is paginated newest-first; the UI
offers **さらに読み込む** and searches loaded concepts. After adding these tools,
refresh the MCP tool list in the agent client if it caches the old six tools.

The write tool is intentionally separate from research, so the model can show
its evidence and ChatGPT can ask for a write confirmation before persistence.

## Vercel environment

Set these as encrypted Production and Preview environment variables. Do not put
them in Git or a Vite-prefixed variable.

| Variable | Purpose |
| --- | --- |
| `KEYWORDS_REMOTE_MCP_TOKEN` | Long random bearer token used by the MCP client |
| `FIREBASE_PROJECT_ID` | The existing Firebase / Google Cloud project ID |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Service-account JSON with Firestore access |
| `GOOGLE_ADS_KEYWORD_VOLUME_API_URL` | Existing authenticated keyword-volume proxy URL |
| `KEYWORDS_REMOTE_MCP_ALLOWED_ORIGIN` | Optional browser origin restriction |

Use a dedicated service account with the smallest Firestore role that can read
and write the `keywordTreasury`, `siteStructures`, and `runs` collections. The function exchanges the service
account for short-lived Google access tokens; it does not put Firebase secrets
in the browser, SQLite, or Firestore documents.

After deployment, use `https://<deployment-domain>/mcp` as the MCP endpoint.
The same Firestore collection appears in the local dashboard's **お宝KW** tab
when the local `.env` has the read-capable Firebase settings above.

## ChatGPT connection

In ChatGPT Developer Mode, create a custom MCP app and provide the `/mcp` URL.
Choose **OAuth**: the endpoint advertises OAuth metadata and uses PKCE. When
the authorization window opens, enter the `KEYWORDS_REMOTE_MCP_TOKEN` value as
the access key. The service issues short-lived access tokens and renewable
refresh tokens; the original access key is never sent with normal MCP calls.

Do not choose **No authentication**. It is intentionally rejected. The static
bearer token remains supported for command-line/API MCP clients, but OAuth is
the preferred ChatGPT integration. Scan tools before publishing and keep
`keyword_treasury_save` enabled as a write action so ChatGPT presents its
normal confirmation when appropriate.
