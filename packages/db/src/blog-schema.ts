// Shared SQL persistence. Commands own all writes; adapters never access SQL.
export const blogSchemaSql = `
CREATE TABLE IF NOT EXISTS blog_bindings (
 project_id TEXT PRIMARY KEY REFERENCES projects(id), blog_site_id TEXT NOT NULL UNIQUE,
 origin TEXT NOT NULL UNIQUE, language TEXT NOT NULL, country TEXT NOT NULL,
 snapshot_json TEXT NOT NULL, snapshot_hash TEXT NOT NULL, observed_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS blog_briefs (
 page_id TEXT PRIMARY KEY REFERENCES pages(id), project_id TEXT NOT NULL REFERENCES projects(id),
 packet_json TEXT NOT NULL, packet_hash TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS blog_handoffs (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), page_id TEXT NOT NULL REFERENCES pages(id),
 version_hash TEXT NOT NULL, payload_json TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'exported',
 published_at TEXT, next_observation_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 UNIQUE(project_id, page_id, version_hash)
);
CREATE TABLE IF NOT EXISTS blog_receipts (
 event_id TEXT PRIMARY KEY, handoff_id TEXT NOT NULL REFERENCES blog_handoffs(id),
 payload_hash TEXT NOT NULL, payload_json TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS blog_query_page_captures (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
 context_key TEXT NOT NULL, start_date TEXT NOT NULL, end_date TEXT NOT NULL,
 payload_json TEXT NOT NULL, created_at TEXT NOT NULL,
 UNIQUE(project_id, context_key, start_date, end_date)
);
CREATE TABLE IF NOT EXISTS discovery_observations (
 id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), job_id TEXT NOT NULL REFERENCES discovery_jobs(id),
 source_id TEXT REFERENCES sources(id), parent_id TEXT REFERENCES discovery_observations(id),
 raw_phrase TEXT NOT NULL, normalized TEXT NOT NULL, evidence_kind TEXT NOT NULL,
 depth INTEGER NOT NULL, payload_json TEXT NOT NULL, created_at TEXT NOT NULL,
 UNIQUE(job_id, normalized, evidence_kind, source_id)
);

-- Agent-driven operations stay in the same database as work sessions/tasks so there is no second queue.
CREATE TABLE IF NOT EXISTS operation_requests (
 id TEXT PRIMARY KEY,
 request_key TEXT NOT NULL UNIQUE,
 request_text TEXT NOT NULL,
 objective TEXT NOT NULL,
 constraints_json TEXT NOT NULL,
 permissions_json TEXT NOT NULL,
 budget_json TEXT NOT NULL,
 assumptions_json TEXT NOT NULL,
 conversation_ref TEXT,
 status TEXT NOT NULL DEFAULT 'active',
 created_by TEXT NOT NULL,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 completed_at TEXT
);
CREATE TABLE IF NOT EXISTS operation_projects (
 operation_id TEXT NOT NULL REFERENCES operation_requests(id) ON DELETE CASCADE,
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 work_session_id TEXT REFERENCES work_sessions(id) ON DELETE SET NULL,
 task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
 status TEXT NOT NULL DEFAULT 'queued',
 blocker TEXT,
 updated_at TEXT NOT NULL,
 PRIMARY KEY(operation_id, project_id)
);
CREATE INDEX IF NOT EXISTS operation_projects_project_status_idx ON operation_projects(project_id, status, updated_at DESC);
CREATE TABLE IF NOT EXISTS operation_controls (
 project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
 paused INTEGER NOT NULL DEFAULT 0,
 reason TEXT,
 updated_by TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS operation_delegations (
 id TEXT PRIMARY KEY,
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 capability TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'active',
 limits_json TEXT NOT NULL,
 version_hash TEXT NOT NULL,
 approved_by TEXT NOT NULL,
 approved_at TEXT NOT NULL,
 expires_at TEXT,
 revoked_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS operation_delegations_active_idx ON operation_delegations(project_id, capability) WHERE status='active';
CREATE TABLE IF NOT EXISTS operation_executors (
 id TEXT PRIMARY KEY,
 kind TEXT NOT NULL DEFAULT 'agent',
 status TEXT NOT NULL DEFAULT 'online',
 capabilities_json TEXT NOT NULL,
 current_operation_id TEXT REFERENCES operation_requests(id) ON DELETE SET NULL,
 current_project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
 generation INTEGER NOT NULL DEFAULT 0,
 last_seen_at TEXT NOT NULL,
 lease_expires_at TEXT,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS operation_executors_lease_idx ON operation_executors(status, lease_expires_at);
CREATE TABLE IF NOT EXISTS operation_budget_reservations (
 id TEXT PRIMARY KEY,
 operation_id TEXT NOT NULL REFERENCES operation_requests(id) ON DELETE CASCADE,
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 kind TEXT NOT NULL,
 reservation_key TEXT NOT NULL,
 amount REAL NOT NULL DEFAULT 1,
 status TEXT NOT NULL DEFAULT 'reserved',
 error TEXT,
 reserved_at TEXT NOT NULL,
 settled_at TEXT,
 UNIQUE(operation_id, project_id, reservation_key)
);
CREATE INDEX IF NOT EXISTS operation_budget_reservations_usage_idx ON operation_budget_reservations(operation_id, project_id, kind, status);
CREATE TABLE IF NOT EXISTS operation_events (
 id TEXT PRIMARY KEY,
 operation_id TEXT REFERENCES operation_requests(id) ON DELETE CASCADE,
 project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
 kind TEXT NOT NULL,
 severity TEXT NOT NULL DEFAULT 'info',
 dedupe_key TEXT NOT NULL UNIQUE,
 payload_json TEXT NOT NULL,
 created_at TEXT NOT NULL,
 acknowledged_at TEXT
);
CREATE TABLE IF NOT EXISTS operation_outcomes (
 id TEXT PRIMARY KEY,
 operation_id TEXT REFERENCES operation_requests(id) ON DELETE SET NULL,
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 target_url TEXT,
 handoff_id TEXT REFERENCES blog_handoffs(id) ON DELETE SET NULL,
 hypothesis TEXT,
 implemented_at TEXT,
 published_at TEXT,
 evaluation_due_at TEXT,
 outcome_status TEXT NOT NULL DEFAULT 'pending',
 metrics_json TEXT NOT NULL,
 attribution_notes TEXT,
 next_action TEXT,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS operation_outcomes_project_status_idx ON operation_outcomes(project_id, outcome_status, updated_at DESC);

-- Versioned collector/import contract used by Keywords and other dashboards.
CREATE TABLE IF NOT EXISTS measurement_imports (
 id TEXT PRIMARY KEY,
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 provider TEXT NOT NULL,
 property TEXT NOT NULL,
 target_origin TEXT,
 filters_json TEXT NOT NULL,
 start_date TEXT NOT NULL,
 end_date TEXT NOT NULL,
 timezone TEXT NOT NULL,
 search_type TEXT,
 dimensions_json TEXT NOT NULL,
 status TEXT NOT NULL,
 completeness TEXT NOT NULL,
 source_label TEXT NOT NULL,
 source_version TEXT NOT NULL,
 captured_at TEXT NOT NULL,
 payload_json TEXT NOT NULL,
 created_at TEXT NOT NULL,
 UNIQUE(project_id, provider, source_version)
);
CREATE INDEX IF NOT EXISTS measurement_imports_project_captured_idx ON measurement_imports(project_id, captured_at DESC);

-- Legacy snapshots remain readable. New captures are tied to a versioned measurement_import by observed_at.
DROP INDEX IF EXISTS keyword_metric_snapshots_period_idx;
DROP INDEX IF EXISTS page_metric_snapshots_period_idx;
CREATE UNIQUE INDEX IF NOT EXISTS keyword_metric_snapshots_capture_idx ON keyword_metric_snapshots(project_id, query, site_url, start_date, end_date, COALESCE(search_type,''), observed_at);
CREATE UNIQUE INDEX IF NOT EXISTS page_metric_snapshots_capture_idx ON page_metric_snapshots(project_id, url, site_url, start_date, end_date, COALESCE(search_type,''), observed_at);
`;
