# Keywords — Agent-native SEO Workspace

`keywords` is being rebuilt as a shared SEO workspace for humans and AI agents. The product is no longer a fixed article-generation pipeline. The same domain commands are exposed to the web UI, CLI, and MCP server, so a human click and an agent tool call mutate the same project state.

## Current scope

- SQL-first storage with SQLite + Drizzle (no Firebase / Firestore)
- Project, topic, keyword, cluster, page, source, insight, task, decision, and run models
- Shared command layer with audit logging
- Hono HTTP API
- CLI for human/operator workflows
- MCP server for AI agents
- React workspace UI: content map, keyword backlog, tasks, decisions, and agent activity
- Publishing integrations are intentionally out of scope for now

## Architecture

```text
Human ── Web UI ─┐
Human ── CLI ────┼──> @keywords/commands ──> @keywords/db ──> SQLite
Agent ── MCP ────┘             │
                               └──> Run / Decision audit trail
```

The command layer is the product boundary. UI components, scripts, and agents must not write SQL directly.

## Repository layout

```text
apps/
  api/       Hono HTTP API
  cli/       operator CLI
  mcp/       MCP server for agents
  web/       React/Vite workspace UI
packages/
  domain/    shared domain types
  db/        Drizzle schema + SQLite bootstrap
  commands/  domain command handlers + audit log
skills/      agent-facing operating knowledge
```

## Run locally

```bash
npm install
cp .env.example .env
npm run db:init
npm run dev
```

- Web: http://localhost:5173
- API: http://localhost:8787

Create a project from the CLI:

```bash
npm run cli -- project create "My SEO Project" --domain example.com
npm run cli -- project list
```

Run the MCP server:

```bash
npm run mcp
```

## Agent model

Agents should follow an observe → decide → command → observe loop. They can read project state freely and make reversible workspace edits. External publishing and destructive operations will later require explicit approval gates.

Human decisions are stored in `decisions` and every command execution is recorded in `runs`. These records are intended to become the feedback source for project-specific skills and policies.
