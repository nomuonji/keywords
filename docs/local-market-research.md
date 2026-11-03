# Local market research via stdio MCP

The local stdio server now exposes the market-observation and distribution tools that were previously available only through the remote HTTP MCP. This keeps the first discovery pass usable when the remote Keywords Operator is unavailable.

## Start

Requirements: Node.js 22 and the repository dependencies.

```sh
npm install
npm run mcp
```

The command runs `@keywords/mcp` over stdio. In a local MCP client, configure its server command with `npm run mcp` and set `cwd` to the absolute path of this repository. Do not point the client at the remote `/mcp` URL for this local setup.

## First-pass tools (no SERP or Firestore quota)

- `market_signal_scan`: public Google Trends RSS, server-rendered TikTok Creative Center rows, and Hacker News.
- `distribution_case_discovery`: nine Hatena hotentry RSS categories and Hacker News Show; returns observed source-to-destination links, provider tags and sourced bookmark/upvote/comment counts.
- `market_discovery_run` with `phase: "observe"` and sources `["curated_links", "open_signals"]`: joins the two observation families and preserves partial-source failures.

These tools are read-only. Views, bookmarks, points and comments are not referral visits, purchases, or willingness-to-pay evidence. A page appearing in a feed is not permission to promote there.

## Quota-controlled follow-up

- `market_discovery_run` with `phase: "validate"` uses SERP and may use Google Ads demand. It requires an active shared Operation budget.
- `traffic_route_discovery` and `market_intelligence_research` use SERP/Ads-backed research and require an active shared Operation budget.

The two basic public-observation tools remain available when an operation is paused. They do not create an idea, write to Idea Memory, publish content, or post to social accounts. Store a candidate only after evidence review and the canonical Idea Final Judge gate.

## Known independent outage

The Rakuten category-ranking workflow is separate from these public-signal tools. Its current GitHub Actions run failed because the affiliate API returned HTTP 402. Do not select `commerce_rankings` in `market_discovery_run` until that billing/access failure is resolved. The script intentionally fails rather than overwrite history with empty or fabricated observations.

Google Trends RSS, Hatena RSS and Hacker News public APIs do not require the Rakuten affiliate endpoint. TikTok Creative Center is best-effort and may return no parseable public rows.

## Client configuration example

Use the equivalent fields supported by your MCP client; the working directory must be the checked-out repository:

```json
{
  "mcpServers": {
    "keywords-local": {
      "command": "npm",
      "args": ["run", "mcp"],
      "cwd": "/absolute/path/to/keywords"
    }
  }
}
```
