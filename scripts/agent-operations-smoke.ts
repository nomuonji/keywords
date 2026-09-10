import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dbPath = join(mkdtempSync(join(tmpdir(), 'keywords-agent-operations-')), 'test.sqlite');
process.env.KEYWORDS_DB_PATH = dbPath;

const { getDatabase, schema } = await import('@keywords/db');
const { operationCommands } = await import('@keywords/commands/operation');
const { operationDiscoveryCommands } = await import('@keywords/commands/operation-discovery');
const { reviewCommands } = await import('@keywords/commands/review');
const { reserveOperationBudget, settleOperationBudget } = await import('@keywords/commands/guard');
const { compatiblePairs, resolveMeasurementScope } = await import('@keywords/commands/measurement');
const { db, sqlite } = getDatabase();

const t = new Date().toISOString();
const projectId = 'project-agent-operations';
await db.insert(schema.projects).values({ id: projectId, name: 'Agent operations smoke', domain: 'a.example.com', mode: 'existing_site', createdAt: t, updatedAt: t });
await db.insert(schema.projects).values({ id: 'project-other-host', name: 'Other host', domain: 'b.example.com', mode: 'existing_site', createdAt: t, updatedAt: t });

const human = { actor: 'human' as const, actorId: 'smoke-human' };
const agent = { actor: 'agent' as const, actorId: 'smoke-agent' };

await assert.rejects(() => operationCommands.start(agent, { requestText: 'Improve one existing page', projectIds: [projectId], requestKey: 'smoke-operation' }), /not delegated/);
await operationCommands.delegationGrant(human, { projectId, capability: 'operation.start' });
await operationCommands.delegationGrant(human, { projectId, capability: 'discovery.start' });

const started = await operationCommands.start(agent, { requestText: 'Improve one existing page', projectIds: [projectId], requestKey: 'smoke-operation', conversationRef: 'smoke-conversation', budget: { maxActions: 8, maxExternalRequests: 2, maxCandidateWrites: 3, maxProjects: 1 } });
assert.equal(started.reused, false);
const operationId = started.operation.id as string;
const child = started.children[0];
assert.ok(child.workSessionId);
const repeated = await operationCommands.start(agent, { requestText: 'Improve one existing page', projectIds: [projectId], requestKey: 'smoke-operation', conversationRef: 'smoke-conversation' });
assert.equal(repeated.reused, true); assert.equal(repeated.operation.id, operationId);
assert.equal((sqlite.prepare('SELECT COUNT(*) AS n FROM operation_requests').get() as { n: number }).n, 1);
assert.equal((sqlite.prepare("SELECT COUNT(*) AS n FROM tasks WHERE related_type='operation' AND related_id=?").get(operationId) as { n: number }).n, 1);

const agentWork = { ...agent, projectId, workSessionId: child.workSessionId! };
const r1 = reserveOperationBudget(agentWork, projectId, 'external_request', 'smoke:1', 1);
const r2 = reserveOperationBudget(agentWork, projectId, 'external_request', 'smoke:2', 1);
assert.ok(r1?.id && r2?.id); settleOperationBudget(r1?.id, 'succeeded'); settleOperationBudget(r2?.id, 'failed', new Error('fixture failure'));
await assert.rejects(async () => reserveOperationBudget(agentWork, projectId, 'external_request', 'smoke:3', 1), /budget exhausted/);

// A missing HTTP work-session header must not bypass an open human review.
await operationCommands.checkpoint(agentWork, { operationId, projectId, state: 'awaiting_review', summary: 'Need a human decision', nextAction: 'review' });
const reviewId = 'review-agent-operations';
sqlite.prepare(`INSERT INTO review_requests(id,project_id,work_session_id,target_type,target_id,title,question,options_json,status,resolution,reason,requested_by,created_at,resolved_at)
  VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(reviewId, projectId, child.workSessionId, 'operation', operationId, 'Smoke review', 'Continue?', JSON.stringify(['continue','stop']), 'open', null, null, 'smoke-agent', t, null);
await operationCommands.resume(agent, { operationId, projectId });
assert.equal((sqlite.prepare('SELECT status FROM work_sessions WHERE id=?').get(child.workSessionId) as { status: string }).status, 'awaiting_review');
await assert.rejects(() => operationDiscoveryCommands.startAndClaim(agent, { operationId, projectId, seedKeywords: ['agent seo'], goal: 'smoke discovery' }), /review|awaiting_review/);
await reviewCommands.resolve(human, { projectId, reviewId, resolution: 'continue', reason: 'fixture resolved' });
assert.equal((sqlite.prepare('SELECT status FROM work_sessions WHERE id=?').get(child.workSessionId) as { status: string }).status, 'running');
assert.equal((sqlite.prepare('SELECT blocker_class FROM operation_projects WHERE operation_id=? AND project_id=?').get(operationId, projectId) as { blocker_class: string | null }).blocker_class, null);

await operationCommands.setPause(human, { projectId, paused: true, reason: 'smoke pause' });
await assert.rejects(() => operationDiscoveryCommands.startAndClaim(agentWork, { operationId, projectId, seedKeywords: ['agent seo'], goal: 'smoke discovery' }), /paused/);
await operationCommands.setPause(human, { projectId, paused: false });

const demandEnvKeys = ['GOOGLE_ADS_ACCESS_TOKEN','GOOGLE_OAUTH_ACCESS_TOKEN','GOOGLE_ADS_DEVELOPER_TOKEN','ADS_DEVELOPER_TOKEN','GOOGLE_ADS_CUSTOMER_ID','ADS_CUSTOMER_ID','GOOGLE_ADS_REFRESH_TOKEN','ADS_REFRESH_TOKEN','GOOGLE_ADS_CLIENT_ID','ADS_CLIENT_ID','GOOGLE_ADS_CLIENT_SECRET','ADS_CLIENT_SECRET','GOOGLE_ADS_KEYWORD_VOLUME_API_URL','KEYWORD_VOLUME_API_URL'];
const savedDemandEnv = new Map(demandEnvKeys.map(key => [key, process.env[key]]));
for (const key of demandEnvKeys) delete process.env[key];
await assert.rejects(() => operationDiscoveryCommands.startAndClaim(agentWork, { operationId, projectId, seedKeywords: ['agent seo'], goal: 'volume-gated discovery', demandPolicy: 'required' }), /Search-volume discovery requires/);
for (const [key, value] of savedDemandEnv) if (value === undefined) delete process.env[key]; else process.env[key] = value;
const discovery = await operationDiscoveryCommands.startAndClaim(agentWork, { operationId, projectId, seedKeywords: ['agent seo'], goal: 'smoke discovery', demandPolicy: 'surface_only', maxCandidates: 3, maxExternalRequests: 2 });
assert.equal(discovery.status, 'running'); assert.equal(discovery.workSessionId, child.workSessionId);
const discoveryAgain = await operationDiscoveryCommands.startAndClaim(agentWork, { operationId, projectId, seedKeywords: ['agent seo'], goal: 'smoke discovery', demandPolicy: 'surface_only', maxCandidates: 3, maxExternalRequests: 2 });
assert.equal(discoveryAgain.jobId, discovery.jobId);

const candidateId = 'candidate-agent-operations';
sqlite.prepare(`INSERT INTO discovery_candidates(id,project_id,job_id,keyword_id,keyword,normalized,status,demand_value,demand_provider,demand_observed_at,ad_competition,search_intent,existing_page_overlap_json,serp_status,unresolved_questions_json,evidence_count,language,country,region,created_at,updated_at)
  VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(candidateId, projectId, discovery.jobId, null, 'agent seo example', 'agent seo example', 'discovered', null, null, null, null, null, '[]', 'not_researched', '[]', 0, 'ja', 'jp', null, t, t);
await assert.rejects(() => operationCommands.triageCandidates(agentWork, { operationId, projectId, jobId: discovery.jobId, candidateIds: [candidateId], status: 'hold', reason: 'needs more evidence' }), /not delegated/);
await operationCommands.delegationGrant(human, { projectId, capability: 'candidate.triage', limits: { allowedStatuses: ['hold', 'rejected'], maxBatch: 10 } });
const triaged = await operationCommands.triageCandidates(agentWork, { operationId, projectId, jobId: discovery.jobId, candidateIds: [candidateId], status: 'hold', reason: 'needs more evidence' });
assert.equal(triaged.changed, 1);

const registered = await operationCommands.executorRegister(agent, { executorId: 'smoke-executor', capabilities: ['operation'] });
const restarted = await operationCommands.executorRegister(agent, { executorId: 'smoke-executor', capabilities: ['operation'] });
assert.equal(restarted.generation, registered.generation + 1);
await assert.rejects(() => operationCommands.executorHeartbeat(agent, { executorId: 'smoke-executor', generation: registered.generation }), /generation changed/);

const scopeA = resolveMeasurementScope({ projectId, property: 'sc-domain:example.com' });
const scopeB = resolveMeasurementScope({ projectId: 'project-other-host', property: 'sc-domain:example.com' });
assert.equal(scopeA.targetOrigin, 'https://a.example.com'); assert.equal(scopeB.targetOrigin, 'https://b.example.com'); assert.notDeepEqual(scopeA.filters, scopeB.filters);
const pairs = compatiblePairs([
  { identity: 'agent seo', startDate: '2026-08-01', endDate: '2026-08-07', scopeKey: 'host-a', completeness: 'complete' },
  { identity: 'agent seo', startDate: '2026-08-08', endDate: '2026-08-14', scopeKey: 'host-a', completeness: 'complete' },
  { identity: 'agent seo', startDate: '2026-08-15', endDate: '2026-08-21', scopeKey: 'host-b', completeness: 'complete' },
  { identity: 'agent seo', startDate: '2026-08-22', endDate: '2026-08-28', scopeKey: 'host-a', completeness: 'partial' }
]);
assert.equal(pairs.length, 1); assert.equal(pairs[0].latest.startDate, '2026-08-08');

await operationCommands.complete(agentWork, { operationId, summary: 'Acceptance smoke completed without publication.' });
assert.equal((await operationCommands.context(human, { operationId })).status, 'completed');
const cancellation = await operationCommands.start(human, { requestText: 'Cancel stale operation', projectIds: [projectId], requestKey: 'cancel-operation-smoke' });
const cancellationId = cancellation.operation.id as string;
const cancellationChild = cancellation.children[0];
const cancellationExecutor = await operationCommands.executorRegister(agent, { executorId: 'cancel-executor', capabilities: ['operation'] });
await operationCommands.executorClaim(agent, { executorId: 'cancel-executor', generation: cancellationExecutor.generation, operationId: cancellationId, projectId });
await operationCommands.cancel(human, { operationId: cancellationId, reason: 'stale operation fixture' });
assert.equal((await operationCommands.context(human, { operationId: cancellationId })).status, 'cancelled');
assert.equal((sqlite.prepare('SELECT status FROM work_sessions WHERE id=?').get(cancellationChild.workSessionId) as { status: string }).status, 'cancelled');
assert.equal((sqlite.prepare('SELECT status FROM tasks WHERE id=?').get(cancellationChild.taskId) as { status: string }).status, 'done');
assert.equal((sqlite.prepare('SELECT current_operation_id FROM operation_executors WHERE id=?').get('cancel-executor') as { current_operation_id: string | null }).current_operation_id, null);
assert.ok((sqlite.prepare("SELECT COUNT(*) AS n FROM runs WHERE command='operation.cancel' AND status='succeeded'").get() as { n: number }).n >= 1);
sqlite.close();
console.log(JSON.stringify({ ok: true, operationId, cancellationId, discoveryJobId: discovery.jobId, scopedHosts: [scopeA.targetOrigin, scopeB.targetOrigin] }));
