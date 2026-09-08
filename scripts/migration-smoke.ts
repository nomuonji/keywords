import { rmSync, readdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { basename, dirname } from 'node:path';

const dbPath = process.env.KEYWORDS_DB_PATH ?? '/tmp/keywords-migration-smoke.sqlite';
rmSync(dbPath, { force: true });

const legacy = new Database(dbPath);
legacy.exec(`
  PRAGMA foreign_keys = ON;
  CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, domain TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE TABLE pages (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, cluster_id TEXT, title TEXT NOT NULL, slug TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'article', status TEXT NOT NULL DEFAULT 'proposed', rationale TEXT, evidence_json TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE TABLE runs (
    id TEXT PRIMARY KEY,
    project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
    actor TEXT NOT NULL,
    actor_id TEXT,
    command TEXT NOT NULL,
    status TEXT NOT NULL,
    input_json TEXT,
    output_json TEXT,
    error TEXT,
    duration_ms INTEGER,
    created_at TEXT NOT NULL
  );
`);
legacy.close();

const { createDatabase } = await import('@keywords/db');
const migrated = createDatabase(dbPath);
const backups = readdirSync(dirname(dbPath)).filter(name => name.startsWith(`${basename(dbPath)}.pre-blog-`) && name.endsWith('.sqlite'));
assert.equal(backups.length, 1, 'legacy DB migration must leave one pre-Blog backup');
const runColumns = migrated.sqlite.prepare('PRAGMA table_info(runs)').all() as Array<{ name: string }>;
const runIndexes = migrated.sqlite.prepare('PRAGMA index_list(runs)').all() as Array<{ name: string }>;
const pageColumns = migrated.sqlite.prepare('PRAGMA table_info(pages)').all() as Array<{ name: string }>;

assert.ok(runColumns.some(column => column.name === 'work_session_id'));
assert.ok(runIndexes.some(index => index.name === 'runs_work_session_created_idx'));
for (const name of ['url','source','last_seen_at']) assert.ok(pageColumns.some(column => column.name === name), `missing pages.${name}`);
for (const table of ['work_sessions','work_checkpoints','review_requests','keyword_metric_snapshots','page_metric_snapshots']) {
  assert.ok(migrated.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table), `missing ${table}`);
}
const pageIndexes = migrated.sqlite.prepare('PRAGMA index_list(pages)').all() as Array<{ name: string }>;
assert.ok(pageIndexes.some(index => index.name === 'pages_project_url_idx'));

migrated.sqlite.close();
rmSync(`${dirname(dbPath)}/${backups[0]}`, { force: true });
console.log(JSON.stringify({ ok: true, migratedColumns: ['work_session_id','pages.url','pages.source','pages.last_seen_at'], metricTables: true }));
