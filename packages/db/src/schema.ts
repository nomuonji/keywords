import { integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  domain: text('domain'),
  mode: text('mode').notNull().default('topic_only'),
  topic: text('topic'),
  audience: text('audience'),
  language: text('language').notNull().default('ja'),
  country: text('country').notNull().default('jp'),
  region: text('region'),
  excludedTermsJson: text('excluded_terms_json'),
  discoveryCadenceDays: integer('discovery_cadence_days').notNull().default(14),
  discoveryMaxCandidates: integer('discovery_max_candidates').notNull().default(50),
  discoveryMaxExternalRequests: integer('discovery_max_external_requests').notNull().default(8),
  lastDiscoveryAt: text('last_discovery_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
});

export const topics = sqliteTable('topics', {
  id: text('id').primaryKey(), projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }), title: text('title').notNull(), status: text('status').notNull().default('active'), createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull()
});

export const keywords = sqliteTable('keywords', {
  id: text('id').primaryKey(), projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }), topicId: text('topic_id').references(() => topics.id, { onDelete: 'set null' }), text: text('text').notNull(), normalized: text('normalized').notNull(), source: text('source').notNull().default('manual'), status: text('status').notNull().default('active'), avgMonthly: integer('avg_monthly'), competition: real('competition'), cpcMicros: integer('cpc_micros'), gscClicks: real('gsc_clicks'), gscImpressions: real('gsc_impressions'), gscCtr: real('gsc_ctr'), gscPosition: real('gsc_position'), gscUpdatedAt: text('gsc_updated_at'), createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull()
});

export const clusters = sqliteTable('clusters', {
  id: text('id').primaryKey(), projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }), title: text('title').notNull(), intent: text('intent').notNull().default('mixed'), status: text('status').notNull().default('active'), createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull()
});
export const clusterKeywords = sqliteTable('cluster_keywords', { clusterId: text('cluster_id').notNull().references(() => clusters.id, { onDelete: 'cascade' }), keywordId: text('keyword_id').notNull().references(() => keywords.id, { onDelete: 'cascade' }) }, table => [primaryKey({ columns: [table.clusterId, table.keywordId] })]);

export const pages = sqliteTable('pages', {
  id: text('id').primaryKey(), projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }), clusterId: text('cluster_id').references(() => clusters.id, { onDelete: 'set null' }), title: text('title').notNull(), slug: text('slug').notNull(), kind: text('kind').notNull().default('article'), status: text('status').notNull().default('proposed'), rationale: text('rationale'), evidenceJson: text('evidence_json'), audience: text('audience'), question: text('question'), searchIntent: text('search_intent'), uniqueAngle: text('unique_angle'), unresolvedAssumptionsJson: text('unresolved_assumptions_json'), planMode: text('plan_mode').notNull().default('new_page'), targetPageId: text('target_page_id'), url: text('url'), source: text('source').notNull().default('workspace'), lastSeenAt: text('last_seen_at'), createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull()
});
export const pageKeywords = sqliteTable('page_keywords', { pageId: text('page_id').notNull().references(() => pages.id, { onDelete: 'cascade' }), keywordId: text('keyword_id').notNull().references(() => keywords.id, { onDelete: 'cascade' }), role: text('role').notNull().default('secondary') }, table => [primaryKey({ columns: [table.pageId, table.keywordId] })]);

export const keywordMetricSnapshots = sqliteTable('keyword_metric_snapshots', {
  id: text('id').primaryKey(), projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }), keywordId: text('keyword_id').references(() => keywords.id, { onDelete: 'set null' }), query: text('query').notNull(), siteUrl: text('site_url').notNull(), startDate: text('start_date').notNull(), endDate: text('end_date').notNull(), searchType: text('search_type'), clicks: real('clicks').notNull(), impressions: real('impressions').notNull(), ctr: real('ctr').notNull(), position: real('position').notNull(), observedAt: text('observed_at').notNull()
});
export const pageMetricSnapshots = sqliteTable('page_metric_snapshots', {
  id: text('id').primaryKey(), projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }), pageId: text('page_id').references(() => pages.id, { onDelete: 'set null' }), url: text('url').notNull(), siteUrl: text('site_url').notNull(), startDate: text('start_date').notNull(), endDate: text('end_date').notNull(), searchType: text('search_type'), clicks: real('clicks').notNull(), impressions: real('impressions').notNull(), ctr: real('ctr').notNull(), position: real('position').notNull(), observedAt: text('observed_at').notNull()
});

export const sources = sqliteTable('sources', {
  id: text('id').primaryKey(), projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }), type: text('type').notNull(), label: text('label').notNull(), url: text('url'), metadataJson: text('metadata_json'), createdAt: text('created_at').notNull()
});
export const sourceLinks = sqliteTable('source_links', {
  id: text('id').primaryKey(), projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }), sourceId: text('source_id').notNull().references(() => sources.id, { onDelete: 'cascade' }), targetType: text('target_type').notNull(), targetId: text('target_id').notNull(), kind: text('kind').notNull().default('evidence'), createdAt: text('created_at').notNull()
});

export const insights = sqliteTable('insights', {
  id: text('id').primaryKey(), projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }), type: text('type').notNull(), text: text('text').notNull(), confidence: real('confidence'), status: text('status').notNull().default('open'), sourceId: text('source_id').references(() => sources.id, { onDelete: 'set null' }), createdBy: text('created_by').notNull(), createdAt: text('created_at').notNull()
});

export const tasks = sqliteTable('tasks', {
  id: text('id').primaryKey(), projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }), title: text('title').notNull(), description: text('description'), status: text('status').notNull().default('todo'), priority: integer('priority').notNull().default(50), assigneeType: text('assignee_type').notNull().default('agent'), relatedType: text('related_type'), relatedId: text('related_id'), createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull()
});

export const decisions = sqliteTable('decisions', {
  id: text('id').primaryKey(), projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }), actor: text('actor').notNull(), action: text('action').notNull(), targetType: text('target_type').notNull(), targetId: text('target_id'), verdict: text('verdict').notNull(), reason: text('reason'), metadataJson: text('metadata_json'), createdAt: text('created_at').notNull()
});

export const policyRules = sqliteTable('policy_rules', {
  id: text('id').primaryKey(), projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }), scope: text('scope').notNull().default('general'), rule: text('rule').notNull(), rationale: text('rationale'), status: text('status').notNull().default('candidate'), sourceDecisionIdsJson: text('source_decision_ids_json'), proposedBy: text('proposed_by').notNull(), reviewedBy: text('reviewed_by'), createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull()
});

export const workSessions = sqliteTable('work_sessions', {
  id: text('id').primaryKey(), projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }), actorId: text('actor_id'), objective: text('objective').notNull(), completionCriteriaJson: text('completion_criteria_json').notNull(), baselineJson: text('baseline_json').notNull(), status: text('status').notNull().default('running'), maxActions: integer('max_actions').notNull().default(12), summary: text('summary'), lastNextAction: text('last_next_action'), startedAt: text('started_at').notNull(), updatedAt: text('updated_at').notNull(), completedAt: text('completed_at')
});
export const workCheckpoints = sqliteTable('work_checkpoints', { id: text('id').primaryKey(), sessionId: text('session_id').notNull().references(() => workSessions.id, { onDelete: 'cascade' }), state: text('state').notNull(), summary: text('summary').notNull(), nextAction: text('next_action'), createdAt: text('created_at').notNull() });

export const reviewRequests = sqliteTable('review_requests', {
  id: text('id').primaryKey(), projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }), workSessionId: text('work_session_id').references(() => workSessions.id, { onDelete: 'set null' }), targetType: text('target_type').notNull(), targetId: text('target_id'), title: text('title').notNull(), question: text('question'), optionsJson: text('options_json').notNull(), status: text('status').notNull().default('open'), resolution: text('resolution'), reason: text('reason'), requestedBy: text('requested_by').notNull(), createdAt: text('created_at').notNull(), resolvedAt: text('resolved_at')
});

export const discoveryJobs = sqliteTable('discovery_jobs', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  seedKeywordsJson: text('seed_keywords_json').notNull(),
  targetUrl: text('target_url'),
  goal: text('goal').notNull(),
  language: text('language').notNull(),
  country: text('country').notNull(),
  region: text('region'),
  excludedTermsJson: text('excluded_terms_json'),
  maxCandidates: integer('max_candidates').notNull().default(50),
  candidateWritesUsed: integer('candidate_writes_used').notNull().default(0),
  maxExternalRequests: integer('max_external_requests').notNull().default(8),
  externalRequestsUsed: integer('external_requests_used').notNull().default(0),
  status: text('status').notNull().default('waiting_for_agent'),
  taskId: text('task_id').references(() => tasks.id, { onDelete: 'set null' }),
  workSessionId: text('work_session_id').references(() => workSessions.id, { onDelete: 'set null' }),
  executorId: text('executor_id'),
  heartbeatAt: text('heartbeat_at'),
  leaseExpiresAt: text('lease_expires_at'),
  startedAt: text('started_at'),
  completedAt: text('completed_at'),
  error: text('error'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
});

export const discoveryRequestReservations = sqliteTable('discovery_request_reservations', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  jobId: text('job_id').notNull().references(() => discoveryJobs.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull(),
  requestKey: text('request_key').notNull(),
  status: text('status').notNull().default('reserved'),
  sourceId: text('source_id').references(() => sources.id, { onDelete: 'set null' }),
  error: text('error'),
  reservedAt: text('reserved_at').notNull(),
  settledAt: text('settled_at')
});

export const discoveryCandidates = sqliteTable('discovery_candidates', {
  id: text('id').primaryKey(), projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }), jobId: text('job_id').notNull().references(() => discoveryJobs.id, { onDelete: 'cascade' }), keywordId: text('keyword_id').references(() => keywords.id, { onDelete: 'set null' }), keyword: text('keyword').notNull(), normalized: text('normalized').notNull(), status: text('status').notNull().default('discovered'), demandValue: integer('demand_value'), demandProvider: text('demand_provider'), demandObservedAt: text('demand_observed_at'), adCompetition: real('ad_competition'), searchIntent: text('search_intent'), existingPageOverlapJson: text('existing_page_overlap_json'), serpStatus: text('serp_status').notNull().default('not_researched'), unresolvedQuestionsJson: text('unresolved_questions_json'), evidenceCount: integer('evidence_count').notNull().default(0), language: text('language').notNull(), country: text('country').notNull(), region: text('region'), createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull()
});

export const providerCapabilities = sqliteTable('provider_capabilities', {
  id: text('id').primaryKey(), projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }), provider: text('provider').notNull(), status: text('status').notNull(), lastCheckedAt: text('last_checked_at').notNull(), lastSuccessAt: text('last_success_at'), lastErrorCode: text('last_error_code'), lastErrorMessage: text('last_error_message'), updatedAt: text('updated_at').notNull()
});

export const runs = sqliteTable('runs', {
  id: text('id').primaryKey(), projectId: text('project_id').references(() => projects.id, { onDelete: 'set null' }), workSessionId: text('work_session_id').references(() => workSessions.id, { onDelete: 'set null' }), actor: text('actor').notNull(), actorId: text('actor_id'), command: text('command').notNull(), status: text('status').notNull(), inputJson: text('input_json'), outputJson: text('output_json'), error: text('error'), durationMs: integer('duration_ms'), createdAt: text('created_at').notNull()
});