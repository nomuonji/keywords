import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';

const DEFAULT_PATH = './data/keywords.sqlite';
let singleton: ReturnType<typeof createDatabase> | undefined;

const bootstrapSql = `
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, domain TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS topics (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, title TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS keywords (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, topic_id TEXT REFERENCES topics(id) ON DELETE SET NULL, text TEXT NOT NULL, normalized TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'manual', status TEXT NOT NULL DEFAULT 'active', avg_monthly INTEGER, competition REAL, cpc_micros INTEGER, gsc_clicks REAL, gsc_impressions REAL, gsc_ctr REAL, gsc_position REAL, gsc_updated_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS keywords_project_normalized_idx ON keywords(project_id, normalized);
CREATE TABLE IF NOT EXISTS clusters (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, title TEXT NOT NULL, intent TEXT NOT NULL DEFAULT 'mixed', status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS cluster_keywords (cluster_id TEXT NOT NULL REFERENCES clusters(id) ON DELETE CASCADE, keyword_id TEXT NOT NULL REFERENCES keywords(id) ON DELETE CASCADE, PRIMARY KEY(cluster_id, keyword_id));
CREATE UNIQUE INDEX IF NOT EXISTS cluster_keyword_single_owner_idx ON cluster_keywords(keyword_id);
CREATE TABLE IF NOT EXISTS pages (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, cluster_id TEXT REFERENCES clusters(id) ON DELETE SET NULL, title TEXT NOT NULL, slug TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'article', status TEXT NOT NULL DEFAULT 'proposed', rationale TEXT, evidence_json TEXT, url TEXT, source TEXT NOT NULL DEFAULT 'workspace', last_seen_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS pages_project_slug_idx ON pages(project_id, slug);
CREATE TABLE IF NOT EXISTS page_keywords (page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE, keyword_id TEXT NOT NULL REFERENCES keywords(id) ON DELETE CASCADE, role TEXT NOT NULL DEFAULT 'secondary', PRIMARY KEY(page_id, keyword_id));
CREATE INDEX IF NOT EXISTS page_keywords_keyword_idx ON page_keywords(keyword_id);
CREATE TABLE IF NOT EXISTS keyword_metric_snapshots (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, keyword_id TEXT REFERENCES keywords(id) ON DELETE SET NULL, query TEXT NOT NULL, site_url TEXT NOT NULL, start_date TEXT NOT NULL, end_date TEXT NOT NULL, search_type TEXT, clicks REAL NOT NULL, impressions REAL NOT NULL, ctr REAL NOT NULL, position REAL NOT NULL, observed_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS keyword_metric_snapshots_project_query_idx ON keyword_metric_snapshots(project_id, query, end_date DESC);
CREATE UNIQUE INDEX IF NOT EXISTS keyword_metric_snapshots_period_idx ON keyword_metric_snapshots(project_id, query, site_url, start_date, end_date, COALESCE(search_type,''));
CREATE TABLE IF NOT EXISTS page_metric_snapshots (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, page_id TEXT REFERENCES pages(id) ON DELETE SET NULL, url TEXT NOT NULL, site_url TEXT NOT NULL, start_date TEXT NOT NULL, end_date TEXT NOT NULL, search_type TEXT, clicks REAL NOT NULL, impressions REAL NOT NULL, ctr REAL NOT NULL, position REAL NOT NULL, observed_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS page_metric_snapshots_project_url_idx ON page_metric_snapshots(project_id, url, end_date DESC);
CREATE UNIQUE INDEX IF NOT EXISTS page_metric_snapshots_period_idx ON page_metric_snapshots(project_id, url, site_url, start_date, end_date, COALESCE(search_type,''));
CREATE TABLE IF NOT EXISTS sources (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, type TEXT NOT NULL, label TEXT NOT NULL, url TEXT, metadata_json TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS insights (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, type TEXT NOT NULL, text TEXT NOT NULL, confidence REAL, status TEXT NOT NULL DEFAULT 'open', source_id TEXT REFERENCES sources(id) ON DELETE SET NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, title TEXT NOT NULL, description TEXT, status TEXT NOT NULL DEFAULT 'todo', priority INTEGER NOT NULL DEFAULT 50, assignee_type TEXT NOT NULL DEFAULT 'agent', related_type TEXT, related_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS decisions (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, actor TEXT NOT NULL, action TEXT NOT NULL, target_type TEXT NOT NULL, target_id TEXT, verdict TEXT NOT NULL, reason TEXT, metadata_json TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS policy_rules (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, scope TEXT NOT NULL DEFAULT 'general', rule TEXT NOT NULL, rationale TEXT, status TEXT NOT NULL DEFAULT 'candidate', source_decision_ids_json TEXT, proposed_by TEXT NOT NULL, reviewed_by TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS policy_rules_project_status_idx ON policy_rules(project_id, status, updated_at DESC);
CREATE TABLE IF NOT EXISTS work_sessions (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, actor_id TEXT, objective TEXT NOT NULL, completion_criteria_json TEXT NOT NULL, baseline_json TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'running', max_actions INTEGER NOT NULL DEFAULT 12, summary TEXT, last_next_action TEXT, started_at TEXT NOT NULL, updated_at TEXT NOT NULL, completed_at TEXT);
CREATE INDEX IF NOT EXISTS work_sessions_project_status_idx ON work_sessions(project_id, status, updated_at DESC);
CREATE TABLE IF NOT EXISTS work_checkpoints (id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES work_sessions(id) ON DELETE CASCADE, state TEXT NOT NULL, summary TEXT NOT NULL, next_action TEXT, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS work_checkpoints_session_created_idx ON work_checkpoints(session_id, created_at DESC);
CREATE TABLE IF NOT EXISTS review_requests (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, work_session_id TEXT REFERENCES work_sessions(id) ON DELETE SET NULL, target_type TEXT NOT NULL, target_id TEXT, title TEXT NOT NULL, question TEXT, options_json TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', resolution TEXT, reason TEXT, requested_by TEXT NOT NULL, created_at TEXT NOT NULL, resolved_at TEXT);
CREATE INDEX IF NOT EXISTS review_requests_project_status_idx ON review_requests(project_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS review_requests_session_status_idx ON review_requests(work_session_id, status, created_at DESC);
CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(id) ON DELETE SET NULL, work_session_id TEXT REFERENCES work_sessions(id) ON DELETE SET NULL, actor TEXT NOT NULL, actor_id TEXT, command TEXT NOT NULL, status TEXT NOT NULL, input_json TEXT, output_json TEXT, error TEXT, duration_ms INTEGER, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS runs_project_created_idx ON runs(project_id, created_at DESC);
`;

function ensureColumn(sqlite: Database.Database, table: string, name: string, definition: string) {
  const columns = sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some(column => column.name === name)) sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
}

export function createDatabase(path = process.env.KEYWORDS_DB_PATH ?? DEFAULT_PATH) {
  const absolute = resolve(path);
  mkdirSync(dirname(absolute), { recursive: true });
  const sqlite = new Database(absolute);
  sqlite.exec(bootstrapSql);
  ensureColumn(sqlite, 'keywords', 'gsc_clicks', 'gsc_clicks REAL');
  ensureColumn(sqlite, 'keywords', 'gsc_impressions', 'gsc_impressions REAL');
  ensureColumn(sqlite, 'keywords', 'gsc_ctr', 'gsc_ctr REAL');
  ensureColumn(sqlite, 'keywords', 'gsc_position', 'gsc_position REAL');
  ensureColumn(sqlite, 'keywords', 'gsc_updated_at', 'gsc_updated_at TEXT');
  ensureColumn(sqlite, 'pages', 'rationale', 'rationale TEXT');
  ensureColumn(sqlite, 'pages', 'evidence_json', 'evidence_json TEXT');
  ensureColumn(sqlite, 'pages', 'url', 'url TEXT');
  ensureColumn(sqlite, 'pages', 'source', "source TEXT NOT NULL DEFAULT 'workspace'");
  ensureColumn(sqlite, 'pages', 'last_seen_at', 'last_seen_at TEXT');
  ensureColumn(sqlite, 'runs', 'work_session_id', 'work_session_id TEXT');
  sqlite.exec('CREATE UNIQUE INDEX IF NOT EXISTS pages_project_url_idx ON pages(project_id, url) WHERE url IS NOT NULL;');
  sqlite.exec('CREATE INDEX IF NOT EXISTS runs_work_session_created_idx ON runs(work_session_id, created_at ASC);');
  const db = drizzle({ client: sqlite, schema });
  return { db, sqlite, path: absolute };
}

export function getDatabase() {
  singleton ??= createDatabase();
  return singleton;
}

export { schema };
export * from './schema.js';
