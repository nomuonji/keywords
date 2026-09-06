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
CREATE TABLE IF NOT EXISTS keywords (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, topic_id TEXT REFERENCES topics(id) ON DELETE SET NULL, text TEXT NOT NULL, normalized TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'manual', status TEXT NOT NULL DEFAULT 'active', avg_monthly INTEGER, competition REAL, cpc_micros INTEGER, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS keywords_project_normalized_idx ON keywords(project_id, normalized);
CREATE TABLE IF NOT EXISTS clusters (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, title TEXT NOT NULL, intent TEXT NOT NULL DEFAULT 'mixed', status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS cluster_keywords (cluster_id TEXT NOT NULL REFERENCES clusters(id) ON DELETE CASCADE, keyword_id TEXT NOT NULL REFERENCES keywords(id) ON DELETE CASCADE, PRIMARY KEY(cluster_id, keyword_id));
CREATE UNIQUE INDEX IF NOT EXISTS cluster_keyword_single_owner_idx ON cluster_keywords(keyword_id);
CREATE TABLE IF NOT EXISTS pages (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, cluster_id TEXT REFERENCES clusters(id) ON DELETE SET NULL, title TEXT NOT NULL, slug TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'article', status TEXT NOT NULL DEFAULT 'proposed', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS pages_project_slug_idx ON pages(project_id, slug);
CREATE TABLE IF NOT EXISTS sources (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, type TEXT NOT NULL, label TEXT NOT NULL, url TEXT, metadata_json TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS insights (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, type TEXT NOT NULL, text TEXT NOT NULL, confidence REAL, status TEXT NOT NULL DEFAULT 'open', source_id TEXT REFERENCES sources(id) ON DELETE SET NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, title TEXT NOT NULL, description TEXT, status TEXT NOT NULL DEFAULT 'todo', priority INTEGER NOT NULL DEFAULT 50, assignee_type TEXT NOT NULL DEFAULT 'agent', related_type TEXT, related_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS decisions (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, actor TEXT NOT NULL, action TEXT NOT NULL, target_type TEXT NOT NULL, target_id TEXT, verdict TEXT NOT NULL, reason TEXT, metadata_json TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(id) ON DELETE SET NULL, actor TEXT NOT NULL, actor_id TEXT, command TEXT NOT NULL, status TEXT NOT NULL, input_json TEXT, output_json TEXT, error TEXT, duration_ms INTEGER, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS runs_project_created_idx ON runs(project_id, created_at DESC);
`;

export function createDatabase(path = process.env.KEYWORDS_DB_PATH ?? DEFAULT_PATH) {
  const absolute = resolve(path);
  mkdirSync(dirname(absolute), { recursive: true });
  const sqlite = new Database(absolute);
  sqlite.exec(bootstrapSql);
  const db = drizzle(sqlite, { schema });
  return { db, sqlite, path: absolute };
}

export function getDatabase() {
  singleton ??= createDatabase();
  return singleton;
}

export { schema };
export * from './schema.js';
