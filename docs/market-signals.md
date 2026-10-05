# On-demand market signals

`market_signal_scan` is a read-only pre-ideation sensor for current public market/culture signals. It is intentionally **not scheduled** and does not persist or score findings.

## Sources

- **Google Trends** — official public Trending RSS. Signal: current search intent / attention spikes. Fields include trend title, approximate traffic, publish time and related news titles when present.
- **TikTok Creative Center** — official public trend pages. Signal: social attention and content creation. The adapter only reads server-rendered public hashtag rows (rank, hashtag, category, posts, views); it does not emulate TikTok's signed/private internal APIs.
- **Hacker News** — official public Firebase API. Signal: early-adopter attention, new-product expression and technical/problem discussion.

YouTube is intentionally deferred until a `YOUTUBE_API_KEY` is configured. General Meta Ad Library ingestion is deferred because there is no stable unauthenticated official machine API for general commercial ads that fits this MCP contract.

## Usage

Default Japan snapshot:

```text
market_signal_scan
{}
```

Explicit sources:

```json
{
  "sources": ["google_trends", "tiktok_creative_center"],
  "geo": "JP",
  "limit": 10,
  "tiktokPeriodDays": 7
}
```

HN new stories:

```json
{
  "sources": ["hacker_news"],
  "limit": 20,
  "hackerNewsFeed": "new"
}
```

## Reasoning boundary

The tool returns observations, not ideas. An agent should reason in this order:

```text
observed current signals
-> repeated behavior / desire / framing
-> independent corroboration or contradiction
-> adjacent opportunity hypothesis
-> targeted validation
```

Never treat search traffic, TikTok views/posts, or HN score/comments as unit sales or willingness to pay. Never collapse heterogeneous signals into one automatic opportunity score.

Use `marketplace_research`, keyword demand/SERP tools, or later commercial evidence only after a behavioral/desire thesis has been formed from observed evidence.
