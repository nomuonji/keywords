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
CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, domain TEXT, mode TEXT NOT NULL DEFAULT 'topic_only', topic TEXT, audience TEXT, language TEXT NOT NULL DEFAULT 'ja', country TEXT NOT NULL DEFAULT 'jp', region TEXT, excluded_terms_json TEXT, discovery_cadence_days INTEGER NOT NULL DEFAULT 14, discovery_max_candidates INTEGER NOT NULL DEFAULT 50, discovery_max_external_requests INTEGER NOT NULL DEFAULT 8, last_discovery_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS topics (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, title TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS keywords (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, topic_id TEXT REFERENCES topics(id) ON DELETE SET NULL, text TEXT NOT NULL, normalized TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'manual', status TEXT NOT NULL DEFAULT 'active', avg_monthly INTEGER, competition REAL, cpc_micros INTEGER, gsc_clicks REAL, gsc_impressions REAL, gsc_ctr REAL, gsc_position REAL, gsc_updated_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS keywords_project_normalized_idx ON keywords(project_id, normalized);
CREATE TABLE IF NOT EXISTS clusters (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, title TEXT NOT NULL, intent TEXT NOT NULL DEFAULT 'mixed', status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS cluster_keywords (cluster_id TEXT NOT NULL REFERENCES clusters(id) ON DELETE CASCADE, keyword_id TEXT NOT NULL REFERENCES keywords(id) ON DELETE CASCADE, PRIMARY KEY(cluster_id, keyword_id));
CREATE UNIQUE INDEX IF NOT EXISTS cluster_keyword_single_owner_idx ON cluster_keywords(keyword_id);
CREATE TABLE IF NOT EXISTS pages (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, cluster_id TEXT REFERENCES clusters(id) ON DELETE SET NULL, title TEXT NOT NULL, slug TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'article', status TEXT NOT NULL DEFAULT 'proposed', rationale TEXT, evidence_json TEXT, audience TEXT, question TEXT, search_intent TEXT, unique_angle TEXT, unresolved_assumptions_json TEXT, plan_mode TEXT NOT NULL DEFAULT 'new_page', target_page_id TEXT, url TEXT, source TEXT NOT NULL DEFAULT 'workspace', last_seen_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
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
CREATE TABLE IF NOT EXISTS source_links (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE, target_type TEXT NOT NULL, target_id TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'evidence', created_at TEXT NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS source_links_unique_idx ON source_links(source_id, target_type, target_id, kind);
CREATE INDEX IF NOT EXISTS source_links_target_idx ON source_links(project_id, target_type, target_id, created_at DESC);
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
CREATE TABLE IF NOT EXISTS discovery_jobs (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, seed_keywords_json TEXT NOT NULL, target_url TEXT, goal TEXT NOT NULL, language TEXT NOT NULL, country TEXT NOT NULL, region TEXT, excluded_terms_json TEXT, max_candidates INTEGER NOT NULL DEFAULT 50, candidate_writes_used INTEGER NOT NULL DEFAULT 0, max_external_requests INTEGER NOT NULL DEFAULT 8, external_requests_used INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'waiting_for_agent', task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL, work_session_id TEXT REFERENCES work_sessions(id) ON DELETE SET NULL, executor_id TEXT, heartbeat_at TEXT, lease_expires_at TEXT, started_at TEXT, completed_at TEXT, error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS discovery_jobs_project_status_idx ON discovery_jobs(project_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS discovery_jobs_lease_idx ON discovery_jobs(status, lease_expires_at);
CREATE TABLE IF NOT EXISTS discovery_request_reservations (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, job_id TEXT NOT NULL REFERENCES discovery_jobs(id) ON DELETE CASCADE, provider TEXT NOT NULL, request_key TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'reserved', source_id TEXT REFERENCES sources(id) ON DELETE SET NULL, error TEXT, reserved_at TEXT NOT NULL, settled_at TEXT);
CREATE UNIQUE INDEX IF NOT EXISTS discovery_request_reservations_job_key_idx ON discovery_request_reservations(job_id, request_key);
CREATE INDEX IF NOT EXISTS discovery_request_reservations_job_status_idx ON discovery_request_reservations(job_id, status, reserved_at DESC);
CREATE TABLE IF NOT EXISTS discovery_candidates (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, job_id TEXT NOT NULL REFERENCES discovery_jobs(id) ON DELETE CASCADE, keyword_id TEXT REFERENCES keywords(id) ON DELETE SET NULL, keyword TEXT NOT NULL, normalized TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'discovered', demand_value INTEGER, demand_provider TEXT, demand_observed_at TEXT, ad_competition REAL, search_intent TEXT, existing_page_overlap_json TEXT, serp_status TEXT NOT NULL DEFAULT 'not_researched', unresolved_questions_json TEXT, evidence_count INTEGER NOT NULL DEFAULT 0, language TEXT NOT NULL, country TEXT NOT NULL, region TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS discovery_candidates_job_normalized_idx ON discovery_candidates(job_id, normalized);
CREATE INDEX IF NOT EXISTS discovery_candidates_project_status_idx ON discovery_candidates(project_id, status, updated_at DESC);
CREATE TABLE IF NOT EXISTS provider_capabilities (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, provider TEXT NOT NULL, status TEXT NOT NULL, last_checked_at TEXT NOT NULL, last_success_at TEXT, last_error_code TEXT, last_error_message TEXT, updated_at TEXT NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS provider_capabilities_project_provider_idx ON provider_capabilities(project_id, provider);
CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(id) ON DELETE SET NULL, work_session_id TEXT REFERENCES work_sessions(id) ON DELETE SET NULL, actor TEXT NOT NULL, actor_id TEXT, command TEXT NOT NULL, status TEXT NOT NULL, input_json TEXT, output_json TEXT, error TEXT, duration_ms INTEGER, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS runs_project_created_idx ON runs(project_id, created_at DESC);
`;

function ensureColumn(sqlite: Database.Database, table: string, name: string, definition: string) {
  const columns = sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some(column => column.name === name)) sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
}

function ensureLegacyColumns(sqlite: Database.Database) {
  ensureColumn(sqlite, 'projects', 'mode', "mode TEXT NOT NULL DEFAULT 'topic_only'");
  ensureColumn(sqlite, 'projects', 'topic', 'topic TEXT');
  ensureColumn(sqlite, 'projects', 'audience', 'audience TEXT');
  ensureColumn(sqlite, 'projects', 'language', "language TEXT NOT NULL DEFAULT 'ja'");
  ensureColumn(sqlite, 'projects', 'country', "country TEXT NOT NULL DEFAULT 'jp'");
  ensureColumn(sqlite, 'projects', 'region', 'region TEXT');
  ensureColumn(sqlite, 'projects', 'excluded_terms_json', 'excluded_terms_json TEXT');
  ensureColumn(sqlite, 'projects', 'discovery_cadence_days', 'discovery_cadence_days INTEGER NOT NULL DEFAULT 14');
  ensureColumn(sqlite, 'projects', 'discovery_max_candidates', 'discovery_max_candidates INTEGER NOT NULL DEFAULT 50');
  ensureColumn(sqlite, 'projects', 'discovery_max_external_requests', 'discovery_max_external_requests INTEGER NOT NULL DEFAULT 8');
  ensureColumn(sqlite, 'projects', 'last_discovery_at', 'last_discovery_at TEXT');
  ensureColumn(sqlite, 'keywords', 'gsc_clicks', 'gsc_clicks REAL');
  ensureColumn(sqlite, 'keywords', 'gsc_impressions', 'gsc_impressions REAL');
  ensureColumn(sqlite, 'keywords', 'gsc_ctr', 'gsc_ctr REAL');
  ensureColumn(sqlite, 'keywords', 'gsc_position', 'gsc_position REAL');
  ensureColumn(sqlite, 'keywords', 'gsc_updated_at', 'gsc_updated_at TEXT');
  ensureColumn(sqlite, 'pages', 'rationale', 'rationale TEXT');
  ensureColumn(sqlite, 'pages', 'evidence_json', 'evidence_json TEXT');
  ensureColumn(sqlite, 'pages', 'audience', 'audience TEXT');
  ensureColumn(sqlite, 'pages', 'question', 'question TEXT');
  ensureColumn(sqlite, 'pages', 'search_intent', 'search_intent TEXT');
  ensureColumn(sqlite, 'pages', 'unique_angle', 'unique_angle TEXT');
  ensureColumn(sqlite, 'pages', 'unresolved_assumptions_json', 'unresolved_assumptions_json TEXT');
  ensureColumn(sqlite, 'pages', 'plan_mode', "plan_mode TEXT NOT NULL DEFAULT 'new_page'");
  ensureColumn(sqlite, 'pages', 'target_page_id', 'target_page_id TEXT');
  ensureColumn(sqlite, 'pages', 'url', 'url TEXT');
  ensureColumn(sqlite, 'pages', 'source', "source TEXT NOT NULL DEFAULT 'workspace'");
  ensureColumn(sqlite, 'pages', 'last_seen_at', 'last_seen_at TEXT');
  ensureColumn(sqlite, 'runs', 'work_session_id', 'work_session_id TEXT');
  ensureColumn(sqlite, 'discovery_jobs', 'candidate_writes_used', 'candidate_writes_used INTEGER NOT NULL DEFAULT 0');
  ensureColumn(sqlite, 'discovery_jobs', 'executor_id', 'executor_id TEXT');
  ensureColumn(sqlite, 'discovery_jobs', 'heartbeat_at', 'heartbeat_at TEXT');
  ensureColumn(sqlite, 'discovery_jobs', 'lease_expires_at', 'lease_expires_at TEXT');
}

export function createDatabase(path = process.env.KEYWORDS_DB_PATH ?? DEFAULT_PATH) {
  const absolute = resolve(path);
  mkdirSync(dirname(absolute), { recursive: true });
  const sqlite = new Database(absolute);
  sqlite.exec(bootstrapSql);
  ensureLegacyColumns(sqlite);
  sqlite.exec('CREATE UNIQUE INDEX IF NOT EXISTS pages_project_url_idx ON pages(project_id, url) WHERE url IS NOT NULL;');
  sqlite.exec('CREATE INDEX IF NOT EXISTS runs_work_session_created_idx ON runs(work_session_id, created_at ASC);');
  sqlite.exec('CREATE INDEX IF NOT EXISTS discovery_jobs_lease_idx ON discovery_jobs(status, lease_expires_at);');
  sqlite.exec('CREATE UNIQUE INDEX IF NOT EXISTS discovery_request_reservations_job_key_idx ON discovery_request_reservations(job_id, request_key);');
  const db = drizzle({ client: sqlite, schema });
  return { db, sqlite, path: absolute };
}

export function getDatabase() {
  singleton ??= createDatabase();
  return singleton;
}

export async function backupDatabase(destination: string) {
  const { sqlite, path } = getDatabase();
  const target = resolve(destination);
  mkdirSync(dirname(target), { recursive: true });
  await sqlite.backup(target);
  return { source: path, destination: target, quickCheck: sqlite.pragma('quick_check', { simple: true }) };
}

export function databaseDiagnostics() {
  const { sqlite, path } = getDatabase();
  return {
    path,
    journalMode: sqlite.pragma('journal_mode', { simple: true }),
    foreignKeys: sqlite.pragma('foreign_keys', { simple: true }),
    quickCheck: sqlite.pragma('quick_check', { simple: true })
  };
}

export { schema };
export * from './schema.js';