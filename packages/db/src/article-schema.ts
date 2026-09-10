import type Database from 'better-sqlite3';

function ensureColumn(sqlite: Database.Database, table: string, name: string, definition: string) {
  const columns = sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some(column => column.name === name)) sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
}

export function ensureArticleSchema(sqlite: Database.Database) {
  sqlite.exec(`
CREATE TABLE IF NOT EXISTS operation_artifacts (
 id TEXT PRIMARY KEY,
 operation_id TEXT NOT NULL REFERENCES operation_requests(id) ON DELETE CASCADE,
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 page_id TEXT REFERENCES pages(id) ON DELETE SET NULL,
 article_id TEXT NOT NULL,
 artifact_path TEXT NOT NULL,
 content_sha256 TEXT NOT NULL,
 source_ids_json TEXT NOT NULL,
 validator_version TEXT,
 validator_status TEXT NOT NULL DEFAULT 'pending',
 validator_result_hash TEXT,
 validator_result_json TEXT,
 build_command TEXT,
 build_status TEXT NOT NULL DEFAULT 'pending',
 build_result_hash TEXT,
 before_hash TEXT,
 after_hash TEXT NOT NULL,
 manifest_json TEXT NOT NULL,
 revision_key TEXT,
 revision_count INTEGER NOT NULL DEFAULT 0,
 validation_attempts INTEGER NOT NULL DEFAULT 0,
 no_progress_count INTEGER NOT NULL DEFAULT 0,
 generated_at TEXT NOT NULL,
 verified_at TEXT,
 updated_at TEXT NOT NULL,
 deleted_at TEXT,
 deleted_by TEXT,
 UNIQUE(operation_id, project_id, article_id)
);
CREATE INDEX IF NOT EXISTS operation_artifacts_project_status_idx ON operation_artifacts(project_id, validator_status, updated_at DESC);
CREATE INDEX IF NOT EXISTS operation_artifacts_page_idx ON operation_artifacts(project_id, page_id, updated_at DESC);
`);
  ensureColumn(sqlite, 'operation_artifacts', 'deleted_at', 'deleted_at TEXT');
  ensureColumn(sqlite, 'operation_artifacts', 'deleted_by', 'deleted_by TEXT');
  ensureColumn(sqlite, 'operation_projects', 'blocker_class', 'blocker_class TEXT');
  ensureColumn(sqlite, 'operation_projects', 'last_progress_at', 'last_progress_at TEXT');
  ensureColumn(sqlite, 'operation_projects', 'runtime_started_at', 'runtime_started_at TEXT');
  ensureColumn(sqlite, 'operation_projects', 'runtime_consumed_ms', 'runtime_consumed_ms INTEGER NOT NULL DEFAULT 0');
  ensureColumn(sqlite, 'operation_executors', 'failure_class', 'failure_class TEXT');
  ensureColumn(sqlite, 'operation_executors', 'failure_count', 'failure_count INTEGER NOT NULL DEFAULT 0');
  ensureColumn(sqlite, 'operation_executors', 'cooldown_until', 'cooldown_until TEXT');
  ensureColumn(sqlite, 'operation_executors', 'last_error', 'last_error TEXT');
  ensureColumn(sqlite, 'operation_executors', 'last_failure_at', 'last_failure_at TEXT');
  ensureColumn(sqlite, 'autopilot_state', 'tick_lease_owner', 'tick_lease_owner TEXT');
  ensureColumn(sqlite, 'autopilot_state', 'tick_lease_expires_at', 'tick_lease_expires_at TEXT');
  ensureColumn(sqlite, 'autopilot_state', 'last_tick_started_at', 'last_tick_started_at TEXT');
  ensureColumn(sqlite, 'autopilot_state', 'last_tick_finished_at', 'last_tick_finished_at TEXT');
  sqlite.exec(`
CREATE TRIGGER IF NOT EXISTS autonomous_handoff_requires_verified_artifact
BEFORE INSERT ON blog_handoffs
WHEN COALESCE(json_extract(NEW.payload_json, '$.publication_authorized'), 0) = 1
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM operation_artifacts a
    WHERE a.project_id=NEW.project_id AND a.page_id=NEW.page_id
      AND COALESCE(a.deleted_at,'')='' AND a.validator_status='passed' AND a.build_status='passed' AND a.verified_at IS NOT NULL
  ) THEN RAISE(ABORT, 'Autonomous publication requires a verified local article artifact') END;
END;
`);
}
