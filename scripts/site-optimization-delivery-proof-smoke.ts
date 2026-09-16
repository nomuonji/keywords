import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';

const dbPath = `/tmp/keywords-site-optimization-proof-${process.pid}.sqlite`;
for (const path of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
  try { rmSync(path, { force: true }); } catch {}
}
process.env.KEYWORDS_DB_PATH = dbPath;

try {
  const { getDatabase } = await import('../packages/db/src/index.js');
  const { operationCommands } = await import('../packages/commands/src/operation.js');
  const { assertSiteOptimizationDeliveryProof } = await import('../packages/commands/src/site-optimization-delivery-proof.js');
  const { sqlite } = getDatabase();
  const t = new Date().toISOString();

  sqlite.prepare(`INSERT INTO projects(id,name,domain,mode,environment,created_at,updated_at) VALUES(?,?,?,?,?,?,?)`)
    .run('project-proof', 'Proof Project', 'proof.example.com', 'existing_site', 'test', t, t);
  sqlite.prepare(`INSERT INTO pages(id,project_id,title,slug,kind,status,plan_mode,url,source,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
    .run('page-proof', 'project-proof', 'Proof Page', 'proof', 'article', 'approved', 'existing_page_improvement', 'https://proof.example.com/proof', 'workspace', t, t);

  const operation = await operationCommands.start({ actor: 'human', actorId: 'fixture' }, {
    requestText: 'Validate one existing-page optimization delivery.',
    requestKey: `proof-${process.pid}`,
    projectIds: ['project-proof'],
    constraints: { operatorKind: 'investigate_query_drop' },
    budget: { maxActions: 8, maxExternalRequests: 0, maxCandidateWrites: 1 }
  });
  assert.equal(operation.reused, false);
  const operationId = operation.operation.id;
  const commit = 'b'.repeat(40);

  assert.throws(() => assertSiteOptimizationDeliveryProof({
    projectId: 'project-proof', pageId: 'page-proof', afterCommit: commit
  }), /No artifact/);

  const validation = {
    status: 'passed',
    delivery: { status: 'pushed', commit },
    publication: { status: 'published', publishedAt: t, checks: [{ url: 'https://proof.example.com/proof', http_status: 200 }] }
  };
  sqlite.prepare(`INSERT INTO operation_artifacts(
    id,operation_id,project_id,page_id,article_id,artifact_path,content_sha256,source_ids_json,
    validator_version,validator_status,validator_result_json,build_status,before_hash,after_hash,manifest_json,
    revision_count,validation_attempts,no_progress_count,generated_at,verified_at,updated_at
  ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    'artifact-proof', operationId, 'project-proof', 'page-proof', 'article-proof', 'content/proof.mdx', 'c'.repeat(64), '[]',
    'article-validator-v1', 'passed', JSON.stringify(validation), 'passed', 'a'.repeat(64), 'c'.repeat(64), '{}',
    1, 1, 0, t, t, t
  );

  assert.throws(() => assertSiteOptimizationDeliveryProof({
    projectId: 'project-proof', pageId: 'page-proof', afterCommit: 'd'.repeat(40)
  }), /does not match/);

  const proof = assertSiteOptimizationDeliveryProof({
    projectId: 'project-proof', pageId: 'page-proof', afterCommit: commit
  });
  assert.equal(proof.operationId, operationId);
  assert.equal(proof.artifactId, 'artifact-proof');
  assert.equal(proof.commit, commit);
  assert.equal(proof.publicationStatus, 'published');

  sqlite.prepare('UPDATE operation_artifacts SET validator_result_json=? WHERE id=?')
    .run(JSON.stringify({ ...validation, publication: { status: 'not_published' } }), 'artifact-proof');
  assert.throws(() => assertSiteOptimizationDeliveryProof({
    projectId: 'project-proof', pageId: 'page-proof', afterCommit: commit
  }), /live publication verification/);

  console.log('site optimization delivery proof smoke passed: active operation + passed build + pushed commit + live publication are all required');
} finally {
  for (const path of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    try { rmSync(path, { force: true }); } catch {}
  }
}
