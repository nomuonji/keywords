import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';

const dbPath = `/tmp/keywords-site-readiness-${process.pid}.sqlite`;
for (const path of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
  try { rmSync(path, { force: true }); } catch {}
}
process.env.KEYWORDS_DB_PATH = dbPath;
process.env.KEYWORDS_AGENT_COMMAND = 'agent --token=must-not-leak';
process.env.KEYWORDS_AUTOPILOT_SCHEDULER = '1';
process.env.KEYWORDS_AUTO_GIT_PUSH = '1';
process.env.KEYWORDS_AUTO_GIT_PUSH_SITES = 'different-site';
delete process.env.FIREBASE_PROJECT_ID;
delete process.env.GOOGLE_CLOUD_PROJECT;
delete process.env.GCP_PROJECT_ID;
delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
delete process.env.FIREBASE_SERVICE_ACCOUNT;
delete process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
delete process.env.GOOGLE_SEARCH_CONSOLE_ACCESS_TOKEN;
delete process.env.GOOGLE_OAUTH_ACCESS_TOKEN;
delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
delete process.env.GOOGLE_SEARCH_CONSOLE_REFRESH_TOKEN;
delete process.env.GOOGLE_OAUTH_REFRESH_TOKEN;
delete process.env.GOOGLE_SEARCH_CONSOLE_SITE_URL;
delete process.env.GOOGLE_ADS_ACCESS_TOKEN;
delete process.env.GOOGLE_ADS_REFRESH_TOKEN;
delete process.env.GOOGLE_ADS_KEYWORD_VOLUME_API_URL;

try {
  const { getDatabase } = await import('../packages/db/src/index.js');
  const { siteOperationsReadiness } = await import('../packages/commands/src/site-operations-readiness.js');
  const { sqlite } = getDatabase();
  const now = new Date().toISOString();
  const stale = new Date(Date.now() - 9 * 86_400_000).toISOString();

  sqlite.prepare('INSERT INTO projects(id,name,domain,mode,environment,created_at,updated_at) VALUES(?,?,?,?,?,?,?)')
    .run('existing-a', 'Existing A', 'example.com', 'existing_site', 'production', now, now);
  sqlite.prepare('INSERT INTO projects(id,name,domain,mode,environment,created_at,updated_at) VALUES(?,?,?,?,?,?,?)')
    .run('new-a', 'New A', null, 'new_site', 'planning', now, now);
  sqlite.prepare(`INSERT INTO blog_bindings(project_id,blog_site_id,origin,language,country,snapshot_json,snapshot_hash,observed_at)
    VALUES(?,?,?,?,?,?,?,?)`).run('existing-a', 'blog-a', 'https://example.com', 'ja', 'JP', '{}', 'fixture-hash', stale);

  const all = await siteOperationsReadiness();
  assert.equal(all.scope, 'existing_sites');
  assert.equal(all.projects.length, 1);
  assert.equal(all.projects[0].project.id, 'existing-a');
  assert.equal(all.summary.total, 1);
  assert.equal(all.summary.closedLoopReady, 0);
  assert.equal(all.policy.noSecretsReturned, true);
  assert.equal(all.policy.globalGscPropertyOptionalWhenProjectOriginCanBeDiscovered, true);

  const project = all.projects[0];
  assert.equal(project.runtime.persistentAgentCommandConfigured, true);
  assert.equal(project.runtime.schedulerEnabled, true);
  assert.equal(project.blog?.fresh, false);
  assert.equal(project.runtime.autoGitPush.enabled, true);
  assert.equal(project.runtime.autoGitPush.allowed, false);
  assert.equal(project.runtime.gscSiteUrlConfigured, false);
  assert.equal(project.runtime.gscScopeResolvable, true);
  assert.equal(project.runtime.gscPropertyDiscoveryAvailable, false);
  assert.equal(project.capabilities.controlPlane.ready, false);
  assert.equal(project.capabilities.measurement.ready, false);
  assert.equal(project.capabilities.articleOptimization.ready, false);
  assert.equal(project.capabilities.queryFeedback.ready, false);
  assert.equal(project.capabilities.autopilotExecution.ready, false);
  assert.ok(project.capabilities.controlPlane.blockers.includes('firebase_project_not_configured'));
  assert.ok(project.capabilities.controlPlane.blockers.includes('firebase_service_account_not_configured'));
  assert.ok(project.capabilities.measurement.blockers.includes('gsc_credentials_not_configured'));
  assert.ok(!project.capabilities.measurement.blockers.includes('gsc_site_url_not_configured'));
  assert.ok(!project.capabilities.measurement.blockers.includes('gsc_property_scope_unresolvable'));
  assert.ok(project.capabilities.articleOptimization.blockers.includes('blog_binding_stale'));
  assert.ok(project.capabilities.articleOptimization.blockers.includes('blog_site_not_allowed_for_git_push'));
  assert.ok(project.capabilities.queryFeedback.blockers.includes('google_ads_not_configured'));
  assert.ok(project.capabilities.autopilotExecution.blockers.includes('autopilot_disabled_for_project'));

  const actions = project.nextActions.map(item => item.code);
  for (const expected of ['configure_firebase_project','refresh_blog_binding','configure_gsc_credentials','allow_blog_site_git_delivery','configure_google_ads','enable_project_autopilot']) {
    assert.ok(actions.includes(expected), `missing next action ${expected}`);
  }
  assert.ok(!actions.includes('configure_gsc_property'));
  assert.ok(!actions.includes('configure_project_origin_or_gsc_property'));

  const serialized = JSON.stringify(all);
  assert.ok(!serialized.includes('must-not-leak'));
  assert.ok(!serialized.includes('agent --token'));

  const one = await siteOperationsReadiness({ projectId: 'existing-a' });
  assert.equal(one.scope, 'project');
  assert.equal(one.projects.length, 1);
  await assert.rejects(siteOperationsReadiness({ projectId: 'missing' }), /Project not found/);

  console.log('site operations readiness smoke passed: bounded existing-site preflight, multi-site GSC scope discovery, capability blockers, next actions, and no secret values');
} finally {
  for (const path of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    try { rmSync(path, { force: true }); } catch {}
  }
}
