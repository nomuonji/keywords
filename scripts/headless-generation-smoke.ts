import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'keywords-headless-'));
process.env.KEYWORDS_DB_PATH = join(root, 'test.sqlite');
process.env.KEYWORDS_BLOG_ROOT = join(root, 'blog');
process.env.KEYWORDS_BLOG_ARTICLE_DIR = 'content';
process.env.KEYWORDS_BLOG_BUILD_COMMAND = 'node -e "process.exit(0)"';

const { commands } = await import('@keywords/commands');
const { configureAutonomy } = await import('@keywords/commands/autonomy');
const { operationCommands } = await import('@keywords/commands/operation');
const { executorCommands } = await import('@keywords/commands/executor');
const { headlessCommands } = await import('@keywords/commands/headless');
const { getDatabase } = await import('@keywords/db');
const { sqlite } = getDatabase();
const human = { actor: 'human' as const, actorId: 'headless-smoke-human' };
const agent = { actor: 'agent' as const, actorId: 'headless-smoke-agent' };

const project = await commands.project.create(human, { name: 'Headless article fixture', domain: 'example.com' });
await configureAutonomy(human, { projectId: project.id, enabled: true, autoApprove: true, autoPublish: true });
const source = await commands.source.record(human, {
  projectId: project.id,
  type: 'web',
  label: 'Verified artifact documentation',
  url: 'https://example.com/docs/artifacts',
  metadata: { document: { text: 'A verified article artifact is required before an autonomous content operation may be completed. The article must be validated and the site build must pass.' } }
});
const page = await commands.page.propose(human, { projectId: project.id, title: 'Verified Article Artifact', slug: 'verified-article-artifact' });
const keyword = await commands.keyword.create(human, { projectId: project.id, text: 'verified article artifact', source: 'google_ads', avgMonthly: 100, competition: 0.2 });
sqlite.prepare('INSERT INTO page_keywords(page_id,keyword_id,role) VALUES(?,?,?)').run(page.id, keyword.id, 'primary');
sqlite.prepare("UPDATE pages SET source='workspace',question=?,rationale=? WHERE id=?").run('When can an autonomous content operation be completed?', 'Verified demand and evidence support this article target.', page.id);
const brief = {
  reader_task: 'When can an autonomous content operation be completed?',
  value_source_ids: [source.id], demand_source_ids: [source.id], claim_source_map: [{ claim: 'A verified article artifact is required before an autonomous content operation may be completed.', source_id: source.id }],
  autonomy: {
    source_packet: { official_source_ids: [source.id], first_party_source_ids: [], research_source_ids: [source.id], competitor_gap_source_ids: [], reader_question_source_ids: [] },
    fact_ledger: [{ claim: 'A verified article artifact is required before an autonomous content operation may be completed.', source_id: source.id, checked_at: new Date().toISOString().slice(0,10), confidence: 'high' }]
  }
};
getDatabase().sqlite.prepare('INSERT INTO blog_briefs(page_id,project_id,packet_json,packet_hash,created_at) VALUES(?,?,?,?,?)').run(page.id, project.id, JSON.stringify(brief), 'fixture-packet', new Date().toISOString());

const started = await operationCommands.start(human, {
  requestText: 'Create the verified artifact article', objective: 'Create the verified artifact article', projectIds: [project.id],
  requestKey: 'headless-artifact-fixture', constraints: { source: 'test', requiresArtifact: true, pageId: page.id },
  completionCriteria: ['Persist the real article file.', 'Pass independent validation.', 'Pass the site build.']
});
const operationId = started.operation.id;
await assert.rejects(() => operationCommands.complete(human, { operationId, summary: 'should fail' }), /required article artifacts are verified/i);
assert.equal((await headlessCommands.completionStatus(operationId)).complete, false);

const content = `---\ntitle: Verified Article Artifact\n---\n# Verified Article Artifact\n\nWhen can an autonomous content operation be completed? A verified article artifact is required before an autonomous content operation may be completed. The article must be validated against stored source evidence, and the site build must pass before completion.`;
const artifact = await headlessCommands.writeDraft(human, { operationId, projectId: project.id, pageId: page.id, content, sourceIds: [source.id] });
assert.equal(artifact.validatorStatus, 'pending');
const validated = await headlessCommands.validateDraft(human, { operationId, projectId: project.id });
assert.equal(validated.validatorStatus, 'passed');
assert.equal(validated.buildStatus, 'passed');
const cached = await headlessCommands.validateDraft(human, { operationId, projectId: project.id });
assert.equal(cached.cached, true);
assert.equal((await headlessCommands.completionStatus(operationId)).complete, true);
await operationCommands.complete(human, { operationId, summary: 'verified local article complete' });
assert.equal((await operationCommands.context(human, { operationId }) as any).status, 'completed');

// The database boundary must reject autonomous publication without a verified artifact.
const project2 = await commands.project.create(human, { name: 'No artifact publication fixture', domain: 'example.net' });
const page2 = await commands.page.propose(human, { projectId: project2.id, title: 'No Artifact', slug: 'no-artifact' });
assert.throws(() => getDatabase().sqlite.prepare(`INSERT INTO blog_handoffs(id,project_id,page_id,version_hash,payload_json,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)`).run('blocked-handoff', project2.id, page2.id, 'v1', JSON.stringify({ publication_authorized: true }), 'exported', new Date().toISOString(), new Date().toISOString()), /verified local article artifact/i);

// A common executor failure must cool down the executor and prevent claims instead of blocking a site.
const project3 = await commands.project.create(human, { name: 'Cooldown fixture' });
await configureAutonomy(human, { projectId: project3.id, enabled: true });
await operationCommands.start(human, { requestText: 'Runnable work', projectIds: [project3.id], requestKey: 'cooldown-fixture' });
const registration = await operationCommands.executorRegister(agent, { executorId: agent.actorId });
await headlessCommands.recordExecutorFailure({ executorId: agent.actorId, generation: registration.generation, failureClass: 'provider_rate_limit', message: 'HTTP 429 usage limit' });
const cooledClaim = await executorCommands.claimNext(agent, { executorId: agent.actorId, generation: registration.generation, projectId: project3.id });
assert.equal(cooledClaim.claimed, false);
assert.equal((cooledClaim as any).reason, 'executor_cooldown');

// Only explicitly recoverable article blockers are auto-resumed.
const project4 = await commands.project.create(human, { name: 'Blocker class fixture' });
await configureAutonomy(human, { projectId: project4.id, enabled: true });
const blocked = await operationCommands.start(human, { requestText: 'Site dependency', projectIds: [project4.id], requestKey: 'blocked-site-fixture' });
await operationCommands.checkpoint(human, { operationId: blocked.operation.id, projectId: project4.id, state: 'blocked', blockerClass: 'site_dependency_failed', summary: 'DNS is unavailable.' });
await headlessCommands.resumeEligibleOperations();
const blockedContext = await operationCommands.context(human, { operationId: blocked.operation.id }) as any;
assert.equal(blockedContext.projects[0].status, 'blocked');
assert.equal(blockedContext.projects[0].blockerClass, 'site_dependency_failed');

// Tick lease: concurrent calls for one project cannot both own the scheduler tick.
const project5 = await commands.project.create(human, { name: 'Tick lock fixture' });
const tickResults = await Promise.all([
  headlessCommands.runAutopilotTick({ actor: 'system', actorId: 'tick-a' }, project5.id, { force: true, leaseSeconds: 60 }),
  headlessCommands.runAutopilotTick({ actor: 'system', actorId: 'tick-b' }, project5.id, { force: true, leaseSeconds: 60 })
]);
assert.equal(tickResults.filter((item:any) => item?.skipped && item.reason === 'tick_locked').length, 1);

getDatabase().sqlite.close();
console.log(JSON.stringify({ ok: true, operationId, artifactId: artifact.id, cachedValidation: true, cooldown: true, blockerIsolation: true, tickLease: true }));
