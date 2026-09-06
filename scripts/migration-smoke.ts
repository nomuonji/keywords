import { rmSync } from 'node:fs';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';

const dbPath = process.env.KEYWORDS_DB_PATH ?? '/tmp/keywords-migration-smoke.sqlite';
rmSync(dbPath, { force: true });

const legacy = new Database(dbPath);
legacy.exec(`
  PRAGMA foreign_keys = ON;
  CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, domain TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
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
const columns = migrated.sqlite.prepare('PRAGMA table_info(runs)').all() as Array<{ name: string }>;
const indexes = migrated.sqlite.prepare('PRAGMA index_list(runs)').all() as Array<{ name: string }>;

assert.ok(columns.some(column => column.name === 'work_session_id'));
assert.ok(indexes.some(index => index.name === 'runs_work_session_created_idx'));
assert.ok(migrated.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='work_sessions'").get());
assert.ok(migrated.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='work_checkpoints'").get());

migrated.sqlite.close();
console.log(JSON.stringify({ ok: true, migratedColumn: 'work_session_id', migratedIndex: 'runs_work_session_created_idx' }));
