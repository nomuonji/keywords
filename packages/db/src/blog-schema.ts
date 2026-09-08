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
`;
