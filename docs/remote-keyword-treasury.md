# Remote keyword treasury

`/mcp` is a deliberately small, Vercel-hosted Streamable HTTP MCP endpoint.
It is not the local Keywords MCP and must never expose SQLite, Blog delivery,
work sessions, or filesystem operations.

## Tools exposed remotely

- `remote_keyword_status` — configuration check without secrets
- `keyword_demand_research` — calls the configured keyword-volume proxy
- `keyword_treasury_save` — writes evidence-backed candidates to Firestore
- `keyword_treasury_list` — reads the shared candidate stock

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
and write the `keywordTreasury` collection. The function exchanges the service
account for short-lived Google access tokens; it does not put Firebase secrets
in the browser, SQLite, or Firestore documents.

After deployment, use `https://<deployment-domain>/mcp` as the MCP endpoint.
The same Firestore collection appears in the local dashboard's **お宝KW** tab
when the local `.env` has the read-capable Firebase settings above.

## ChatGPT connection

In ChatGPT Developer Mode, create a custom MCP app, provide the `/mcp` URL,
choose bearer/API-token authentication if the UI offers it, and supply
`KEYWORDS_REMOTE_MCP_TOKEN`. Scan the tools before publishing. Keep
`keyword_treasury_save` enabled as a write action so ChatGPT presents its
normal confirmation when appropriate.

If the workspace only permits OAuth-based custom apps, put an OAuth gateway in
front of this endpoint and have it forward the validated identity as the bearer
credential; do not make the endpoint public just to bypass that policy.
