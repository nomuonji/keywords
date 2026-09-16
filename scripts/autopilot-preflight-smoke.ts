import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';

const dbPath = `/tmp/keywords-autopilot-preflight-${process.pid}.sqlite`;
for (const path of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
  try { rmSync(path, { force: true }); } catch {}
}

process.env.KEYWORDS_DB_PATH = dbPath;
process.env.KEYWORDS_AUTOPILOT_SCHEDULER = '1';
process.env.KEYWORDS_AGENT_COMMAND = 'fixture-agent';
delete process.env.FIREBASE_PROJECT_ID;
delete process.env.GOOGLE_CLOUD_PROJECT;
delete process.env.GCP_PROJECT_ID;
delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
delete process.env.FIREBASE_SERVICE_ACCOUNT;
delete process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
delete process.env.GOOGLE_OAUTH_ACCESS_TOKEN;
delete process.env.GOOGLE_OAUTH_REFRESH_TOKEN;
delete process.env.GOOGLE_ADS_ACCESS_TOKEN;
delete process.env.GOOGLE_ADS_REFRESH_TOKEN;
delete process.env.GOOGLE_ADS_KEYWORD_VOLUME_API_URL;

try {
  const { getDatabase, schema } = await import('../packages/db/src/index.js');
  const { configureAutonomy } = await import('../packages/commands/src/autonomy.js');
  const { autopilotCommands } = await import('../packages/commands/src/autopilot.js');
  const { autopilotContentMutationPreflight } = await import('../packages/commands/src/autopilot-site-preflight.js');
  const { db, sqlite } = getDatabase();
  const now = new Date().toISOString();
  const human = { actor: 'human' as const, actorId: 'autopilot-preflight-human' };
  const system = { actor: 'system' as const, actorId: 'autopilot-preflight-system' };

  await db.insert(schema.projects).values({
    id: 'delivery-blocked', name: 'Delivery blocked', domain: 'blocked.example.com', mode: 'existing_site',
    environment: 'production', language: 'ja', country: 'JP', createdAt: now, updatedAt: now
  });
  await configureAutonomy(human, { projectId: 'delivery-blocked', enabled: true, autoApprove: true, autoPublish: true });
  await db.insert(schema.pages).values({
    id: 'blocked-page', projectId: 'delivery-blocked', title: 'Blocked page', slug: 'blocked-page', kind: 'article',
    status: 'local', planMode: 'existing_page_improvement', url: 'https://blocked.example.com/blocked-page', source: 'blog_local',
    lastSeenAt: now, createdAt: now, updatedAt: now
  });
  sqlite.prepare(`INSERT INTO blog_handoffs(id,project_id,page_id,version_hash,payload_json,status,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?)`).run(
      'handoff-blocked', 'delivery-blocked', 'blocked-page', 'version-1',
      JSON.stringify({ handoff_id: 'handoff-blocked', publication_authorized: true }), 'exported', now, now
    );

  const directPreflight = await autopilotContentMutationPreflight('delivery-blocked');
  assert.equal(directPreflight.applicable, true);
  assert.equal(directPreflight.allowed, false);
  assert.ok(directPreflight.blockers.includes('firebase_project_not_configured'));

  const blockedTick = await autopilotCommands.tick(system, 'delivery-blocked');
  assert.equal(blockedTick.status, 'attention');
  assert.equal(blockedTick.stage, 'preflight_blocked');
  assert.equal(blockedTick.targetType, 'blog_handoff');
  assert.equal(blockedTick.targetId, 'handoff-blocked');
  assert.ok((blockedTick.decision as any).preflight.blockers.includes('firebase_project_not_configured'));
  assert.equal(Number((sqlite.prepare('SELECT COUNT(*) AS n FROM operation_requests WHERE request_key LIKE ?').get('autopilot:delivery-blocked:delivery:%') as any).n), 0);
  const blockedEvent = sqlite.prepare("SELECT payload_json FROM operation_events WHERE project_id=? AND kind='autopilot_content_preflight_blocked' ORDER BY created_at DESC LIMIT 1").get('delivery-blocked') as { payload_json: string } | undefined;
  assert.ok(blockedEvent);
  assert.ok(JSON.parse(blockedEvent.payload_json).blockers.includes('firebase_project_not_configured'));

  await db.insert(schema.projects).values({
    id: 'measurement-continues', name: 'Measurement continues', domain: 'measure.example.com', mode: 'existing_site',
    environment: 'production', language: 'ja', country: 'JP', createdAt: now, updatedAt: now
  });
  await configureAutonomy(human, { projectId: 'measurement-continues', enabled: true, autoApprove: true, autoPublish: true });
  await db.insert(schema.pages).values({
    id: 'measure-page', projectId: 'measurement-continues', title: 'Measure page', slug: 'measure-page', kind: 'article',
    status: 'local', planMode: 'existing_page_improvement', url: 'https://measure.example.com/measure-page', source: 'blog_local',
    lastSeenAt: now, createdAt: now, updatedAt: now
  });
  await db.insert(schema.sources).values({
    id: 'measure-sitemap', projectId: 'measurement-continues', type: 'sitemap', label: 'Fresh sitemap',
    url: 'https://measure.example.com/sitemap.xml', metadataJson: '{}', createdAt: now
  });
  process.env.GOOGLE_SEARCH_CONSOLE_ACCESS_TOKEN = 'fixture-gsc-token';
  process.env.GOOGLE_SEARCH_CONSOLE_SITE_URL = 'sc-domain:measure.example.com';

  const measurementPreflight = await autopilotContentMutationPreflight('measurement-continues');
  assert.equal(measurementPreflight.allowed, false, 'content mutation should still be blocked without the Sites control plane');

  const measurementTick = await autopilotCommands.tick(system, 'measurement-continues');
  assert.equal(measurementTick.status, 'running');
  assert.equal(measurementTick.stage, 'queued_for_agent');
  assert.ok(measurementTick.operationId);
  const operation = sqlite.prepare('SELECT constraints_json,permissions_json FROM operation_requests WHERE id=?').get(measurementTick.operationId) as { constraints_json: string; permissions_json: string };
  const constraints = JSON.parse(operation.constraints_json);
  const permissions = JSON.parse(operation.permissions_json);
  assert.equal(constraints.operatorKind, 'capture_metrics');
  assert.equal(constraints.measurementOnly, true);
  assert.equal(permissions.contentDelivery, false);

  await db.insert(schema.projects).values({
    id: 'new-site-bypass', name: 'New site bypass', mode: 'new_site', environment: 'planning',
    language: 'ja', country: 'JP', createdAt: now, updatedAt: now
  });
  const newSite = await autopilotContentMutationPreflight('new-site-bypass');
  assert.equal(newSite.applicable, false);
  assert.equal(newSite.allowed, true);

  console.log('autopilot preflight smoke passed: existing-site mutation/delivery fail closed while measurement remains schedulable and new-site planning is unaffected');
} finally {
  for (const path of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    try { rmSync(path, { force: true }); } catch {}
  }
}
