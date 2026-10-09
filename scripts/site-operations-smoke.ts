import assert from 'node:assert/strict';
import { createHmac, generateKeyPairSync } from 'node:crypto';
import { field } from '../packages/db/src/firestore.js';
import {
  metricSnapshotSave,
  optimizationContext,
  optimizationEventCreate,
  optimizationEventUpdate,
  siteArticleSave,
  siteRegistryGet,
  siteRegistryResolve,
  siteRegistrySave,
  siteDirectionCreate,
  siteDirectionGet,
  siteDirectionList,
  siteDirectionUpdate,
  seoRecoveryStatus,
  seoRecoveryPortfolioUpdate,
  seoRecoverySiteUpdate,
  seoPortfolioPolicyGet, seoPortfolioPolicyUpdate, seoPortfolioAllocationStatus,
  seoTaskClaim,
  seoTaskCreate,
  seoTaskGet,
  seoTaskHeartbeat,
  seoTaskList,
  seoTaskUpdate
} from '../packages/commands/src/remote-site-operations.js';

// Deterministic Firestore double. Never loads .env or touches production data.
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
process.env.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify({ client_email: 'test@example.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }), project_id: 'test' });
process.env.FIREBASE_PROJECT_ID = 'test';
process.env.KEYWORDS_REMOTE_MCP_TOKEN = 'test-only-token';
const root = 'projects/test/databases/(default)/documents/';
const docs = new Map<string, any>();
let sequence = 0;
const originalFetch = globalThis.fetch;
const decodeField = (value: any): any => value?.stringValue ?? value?.integerValue ?? value?.doubleValue ?? value?.booleanValue ?? null;

docs.set(`${root}siteStructures/concept-a`, { name: `${root}siteStructures/concept-a`, fields: { title: field('Concept A'), revision: field(1) }, updateTime: 'seed-1' });

globalThis.fetch = async (input, init) => {
  const url = String(input);
  if (url === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'test-access-token', expires_in: 3600 });
  assert.ok(url.startsWith('https://firestore.googleapis.com/'), `Unexpected network: ${url}`);
  const parsed = new URL(url);
  const path = parsed.pathname.replace('/v1/', '');
  const body = init?.body ? JSON.parse(String(init.body)) : null;

  if (url.endsWith(':commit')) {
    for (const write of body.writes) {
      const previous = docs.get(write.update.name);
      if (write.currentDocument?.exists === false && previous) return Response.json({}, { status: 409 });
      if (write.currentDocument?.updateTime && previous?.updateTime !== write.currentDocument.updateTime) return Response.json({}, { status: 409 });
    }
    for (const write of body.writes) docs.set(write.update.name, { ...write.update, updateTime: `revision-${++sequence}` });
    return Response.json({});
  }

  if (url.endsWith(':runQuery')) {
    const query = body.structuredQuery;
    const collection = query.from[0].collectionId;
    const filter = query.where.fieldFilter;
    const expected = decodeField(filter.value);
    const rows = [...docs.values()]
      .filter(doc => doc.name.startsWith(`${root}${collection}/`) && decodeField(doc.fields?.[filter.field.fieldPath]) === expected)
      .slice(0, Number(query.limit ?? 500))
      .map(document => ({ document }));
    return Response.json(rows);
  }

  if (/\/(sites|articles|metricSnapshots|optimizationEvents|siteDirections|seoTasks|seoRecoveryControls|seoRecoverySites)$/.test(path)) {
    const collection = path.split('/').at(-1)!;
    const all = [...docs.values()].filter(doc => doc.name.startsWith(`${root}${collection}/`));
    return Response.json({ documents: all.slice(0, Number(parsed.searchParams.get('pageSize') ?? 50)) });
  }

  return docs.has(path) ? Response.json(docs.get(path)) : Response.json({}, { status: 404 });
};

try {
  const site = await siteRegistrySave({
    id: 'site-a', expectedRevision: 0, siteConceptId: 'concept-a', localProjectId: 'local-project-a', name: 'Site A', repository: 'nomuonji/site-a',
    productionUrl: 'https://example.com', deploymentProvider: 'vercel', siteShape: 'database', ga4PropertyId: 'properties/123',
    searchConsoleProperty: 'sc-domain:example.com', status: 'active'
  });
  assert.equal(site.revision, 1);
  assert.equal(site.productionUrl, 'https://example.com/');
  assert.equal((await siteRegistryGet({ id: 'site-a' })).siteConceptId, 'concept-a');
  assert.equal((await siteRegistryGet({ id: 'site-a' })).siteShape, 'database');
  assert.equal((await siteRegistryResolve({ localProjectId: 'local-project-a' })).site?.id, 'site-a');
  assert.equal((await siteRegistryResolve({ productionUrl: 'https://EXAMPLE.com:443/?utm_source=smoke#fragment' })).site?.id, 'site-a');
  assert.equal((await siteRegistryResolve({ localProjectId: 'missing-project' })).site, null);
  await assert.rejects(siteRegistrySave({ id: 'site-a', expectedRevision: 0, status: 'paused' }), /Revision conflict/);
  await assert.rejects(siteRegistrySave({ id: 'site-b', expectedRevision: 0, siteConceptId: 'missing', name: 'x', repository: 'nomuonji/x', productionUrl: 'https://x.example' }), /Unknown siteConceptId/);
  await assert.rejects(siteRegistrySave({ id: 'site-b', expectedRevision: 0, localProjectId: 'local-project-a', name: 'x', repository: 'nomuonji/x', productionUrl: 'https://x.example' }), /already linked/);
  await assert.rejects(siteRegistrySave({
    id: 'site-c', expectedRevision: 0, localProjectId: 'local-project-c', name: 'Duplicate Site', repository: 'nomuonji/site-c',
    productionUrl: 'https://example.com/?utm_source=duplicate#fragment'
  }), /productionUrl is already linked/);

  // Record-only planner handoff must persist without GitHub Issues, support
  // deduplication and transition to execution, and keep the versioned contract explicit.
  const readyTask = await seoTaskCreate({
    id: 'seo-ready-a', siteId: 'site-a', targetUrls: ['https://example.com/article-a'],
    repo: 'nomuonji/site-a', taskType: 'revise', title: 'Correct sourced article claim',
    rationale: 'Complete site digest and verified current repo HEAD show a specific outdated claim.',
    evidence: ['Complete 90-day site digest and verified current default-branch article gap.'],
    evaluation: {
      evaluatorId: 'content_incremental_value',
      evaluatorVersion: '1.0.0',
      decision: 'proceed',
      confidence: 'medium_to_high',
      evidenceSourceIds: ['google_scaled_content_policy', 'google_ai_content_guidance'],
      inference: 'The change adds a sourced correction with concrete user value rather than expanding content for volume.'
    },
    dedupeKey: 'site-a:revise:article-a:claim-correction', createdBy: 'site-operations-smoke'
  });
  assert.equal(readyTask.status, 'ready');
  assert.equal(readyTask.issueUrl, null);
  assert.equal(readyTask.issueNumber, null);
  assert.equal(readyTask.evaluation?.evaluatorId, 'content_incremental_value');
  assert.equal(readyTask.evaluation?.evaluatorVersion, '1.0.0');
  assert.deepEqual(readyTask.evaluation?.evidenceSourceIds, ['google_scaled_content_policy', 'google_ai_content_guidance']);
  assert.equal(readyTask.deploymentVerification.status, 'pending');
  assert.equal(readyTask.deploymentVerification.productionUrl, 'https://example.com/article-a');
  assert.equal(readyTask.executionClaim, null);
  assert.equal(readyTask.deliveryHandoff.state, 'none');
  assert.equal(readyTask.history[0].event, 'ready');
  assert.equal((await seoTaskGet({ id: readyTask.id })).status, 'ready');
  assert.equal((await seoTaskList({ siteId: 'site-a', status: 'ready' })).items.length, 1);
  await assert.rejects(seoTaskCreate({
    siteId: 'site-a', targetUrls: ['https://example.com/article-a'], repo: 'nomuonji/site-a',
    taskType: 'revise', title: 'Duplicate wording', rationale: 'Same underlying change.',
    evidence: ['Same existing action.'], dedupeKey: 'site-a:revise:article-a:claim-correction'
  }), /Open SEO task already exists/);
  await assert.rejects(seoTaskCreate({
    siteId: 'site-a', targetUrls: ['https://example.com/article-b'], repo: 'nomuonji/site-a',
    taskType: 'new_article', title: 'Invalid evaluator provenance', rationale: 'Exercise source validation.',
    evidence: ['Target-specific evidence.'],
    evaluation: {
      evaluatorId: 'content_incremental_value',
      evaluatorVersion: '1.0.0',
      decision: 'proceed',
      confidence: 'medium',
      evidenceSourceIds: ['sej_safe_2026'],
      inference: 'This source is intentionally not registered for the evaluator.'
    },
    dedupeKey: 'site-a:new-article:invalid-evaluator'
  }), /not registered/);
  await assert.rejects(seoTaskUpdate({
    id: readyTask.id, expectedRevision: readyTask.revision, status: 'in_progress'
  }), /seo_task_claim/);
  const startedTask = await seoTaskClaim({
    id: readyTask.id,
    expectedRevision: readyTask.revision,
    runId: 'smoke-run-0001',
    actor: 'site-operations-smoke',
    leaseMinutes: 75
  });
  assert.equal(startedTask.status, 'in_progress');
  assert.equal(startedTask.issueUrl, null);
  assert.equal(startedTask.executionClaim?.runId, 'smoke-run-0001');
  assert.ok(Date.parse(startedTask.executionClaim!.expiresAt) > Date.parse(startedTask.executionClaim!.heartbeatAt));
  await assert.rejects(seoTaskClaim({
    id: readyTask.id,
    expectedRevision: startedTask.revision,
    runId: 'smoke-run-0002',
    actor: 'other-run',
    leaseMinutes: 75
  }), /active execution claim/);
  const heartbeatTask = await seoTaskHeartbeat({
    id: readyTask.id,
    expectedRevision: startedTask.revision,
    runId: 'smoke-run-0001',
    leaseMinutes: 75
  });
  assert.equal(heartbeatTask.executionClaim?.runId, 'smoke-run-0001');
  await assert.rejects(seoTaskUpdate({
    id: readyTask.id, expectedRevision: readyTask.revision, status: 'completed'
  }), /Revision conflict/);

  await assert.rejects(seoTaskUpdate({
    id: readyTask.id, expectedRevision: heartbeatTask.revision, status: 'completed', claimRunId: 'smoke-run-0001'
  }), /completed SEO task requires resultCommitSha/);

  const pushPendingTask = await seoTaskUpdate({
    id: readyTask.id,
    expectedRevision: heartbeatTask.revision,
    claimRunId: 'smoke-run-0001',
    executionSummary: 'Local implementation commit prepared; write-ahead checkpoint recorded before remote push.',
    deliveryHandoff: {
      state: 'push_pending',
      branch: 'seo/smoke-delivery',
      headSha: 'c'.repeat(40),
      baseSha: 'b'.repeat(40),
      validationSummary: 'targeted checks passed',
      handedOffAt: null,
      prNumber: null,
      prUrl: null,
      lastError: '',
      updatedAt: '2026-10-01T00:00:00.000Z'
    },
    appendHistory: { actor: 'site-operations-smoke', event: 'delivery_push_pending', detail: 'Write-ahead checkpoint before remote push.' }
  });
  assert.equal(pushPendingTask.status, 'in_progress');
  assert.equal(pushPendingTask.deliveryHandoff.state, 'push_pending');
  assert.equal(pushPendingTask.executionClaim?.runId, 'smoke-run-0001');
  assert.ok(pushPendingTask.executionClaim);
  assert.ok(
    Date.parse(pushPendingTask.executionClaim!.expiresAt) - Date.parse(pushPendingTask.executionClaim!.heartbeatAt) <= 15 * 60_000,
    'push_pending must shorten the execution lease to at most 15 minutes'
  );

  const handedOffTask = await seoTaskUpdate({
    id: readyTask.id,
    expectedRevision: pushPendingTask.revision,
    claimRunId: 'smoke-run-0001',
    executionSummary: 'Remote seo/smoke-delivery HEAD verified at expected commit and handed off.',
    deliveryHandoff: {
      ...pushPendingTask.deliveryHandoff,
      state: 'branch_ready',
      handedOffAt: '2026-10-01T00:01:00.000Z',
      updatedAt: '2026-10-01T00:01:00.000Z'
    },
    appendHistory: { actor: 'site-operations-smoke', event: 'delivery_handoff_ready', detail: 'Exact remote HEAD verified; structured branch handoff recorded.' }
  });
  assert.equal(handedOffTask.status, 'in_progress');
  assert.equal(handedOffTask.deliveryHandoff.state, 'branch_ready');
  assert.equal(handedOffTask.executionClaim, null, 'branch_ready must release Worker lease');

  const prOpenTask = await seoTaskUpdate({
    id: readyTask.id,
    expectedRevision: handedOffTask.revision,
    deliveryHandoff: {
      ...handedOffTask.deliveryHandoff,
      state: 'pr_open',
      prNumber: 123,
      prUrl: 'https://github.com/nomuonji/site-a/pull/123',
      updatedAt: '2026-10-01T00:10:00.000Z'
    },
    appendHistory: { actor: 'seo_delivery_controller', event: 'delivery_pr_opened', detail: 'PR #123 opened; waiting for CI.' }
  });
  assert.equal(prOpenTask.status, 'in_progress');
  assert.equal(prOpenTask.deliveryHandoff.prNumber, 123);
  assert.equal(prOpenTask.executionClaim, null);

  const completedTask = await seoTaskUpdate({
    id: readyTask.id,
    expectedRevision: prOpenTask.revision,
    status: 'completed',
    resultCommitSha: 'd'.repeat(40),
    deliveryHandoff: {
      ...prOpenTask.deliveryHandoff,
      state: 'merged',
      updatedAt: '2026-10-01T00:20:00.000Z'
    },
    executionSummary: 'Central delivery merged PR #123 to main; production verification is intentionally separate.',
    deploymentVerification: {
      status: 'pending',
      productionUrl: 'https://example.com/article-a',
      detail: 'Implementation complete on main; production not checked yet.'
    },
    appendHistory: { actor: 'seo_delivery_controller', event: 'delivery_merged', detail: 'PR #123 merged to main.' }
  });
  assert.equal(completedTask.status, 'completed');
  assert.equal(completedTask.resultCommitSha, 'd'.repeat(40));
  assert.equal(completedTask.deliveryHandoff.state, 'merged');
  assert.equal(completedTask.deploymentVerification.status, 'pending');
  assert.equal(completedTask.executionClaim, null);
  assert.ok(completedTask.completedAt);
  assert.equal((await seoTaskList({ status: 'completed', deploymentVerificationStatus: 'pending' })).items.length, 1);
  const verifiedTask = await seoTaskUpdate({
    id: readyTask.id,
    expectedRevision: completedTask.revision,
    deploymentVerification: {
      status: 'verified',
      checkedAt: '2026-10-01T00:00:00.000Z',
      productionUrl: 'https://example.com/article-a',
      deployedCommitSha: 'd'.repeat(40),
      detail: 'Production route contains the merged change.'
    },
    appendHistory: { actor: 'site-operations-smoke', event: 'production_verified', detail: 'Live route verified.' }
  });
  assert.equal(verifiedTask.status, 'completed');
  assert.equal(verifiedTask.deploymentVerification.status, 'verified');
  assert.equal((await seoTaskList({ status: 'completed', deploymentVerificationStatus: 'verified' })).items.length, 1);

  const openDirection = await siteDirectionCreate({
    id: 'direction-a',
    siteId: 'site-a',
    topic: 'content_scope',
    title: 'Decide whether comparison pages belong in the site',
    observation: 'The proposed comparison family changes the site from a pure database into a broader decision product.',
    evidence: ['Current siteShape is database and no comparison page family exists yet.'],
    uncertainty: 'Search demand and long-term scope are not yet settled.',
    proposedOptions: ['Keep database-only scope', 'Add bounded comparison pages'],
    decisionQuestion: 'Should the site add a bounded comparison page family?',
    constraints: ['Do not create thin filter permutations'],
    dedupeKey: 'site-a:direction:comparison-scope',
    openedBy: 'site-operations-smoke'
  });
  assert.equal(openDirection.status, 'open');
  assert.equal((await siteDirectionGet({ id: 'direction-a' })).siteId, 'site-a');
  assert.equal((await siteDirectionList({ siteId: 'site-a', status: 'open' })).items.length, 1);

  await assert.rejects(seoTaskCreate({
    id: 'seo-direction-too-early',
    siteId: 'site-a',
    targetUrls: ['https://example.com/compare'],
    repo: 'nomuonji/site-a',
    taskType: 'site_expansion',
    title: 'Premature direction implementation',
    rationale: 'Should not be allowed until human decision.',
    evidence: ['Direction is still open.'],
    directionId: openDirection.id,
    dedupeKey: 'site-a:premature-direction'
  }), /must reference a decided site direction/);

  const decidedDirection = await siteDirectionUpdate({
    id: openDirection.id,
    expectedRevision: openDirection.revision,
    status: 'decided',
    decision: 'Add a bounded comparison page family.',
    decisionRationale: 'It improves decision support without changing the canonical database source of truth.',
    constraints: ['Only source-backed comparisons', 'No arbitrary filter permutations'],
    appendHistory: { actor: 'human-smoke', event: 'human_decision', detail: 'Approved bounded comparison family.' }
  });
  assert.equal(decidedDirection.status, 'decided');
  assert.ok(decidedDirection.decidedAt);
  assert.match(decidedDirection.history.map((x:any)=>x.event).join(','), /human_decision/);
  assert.equal((await siteDirectionList({ siteId: 'site-a', status: 'decided' })).items.length, 1);
  await assert.rejects(siteDirectionUpdate({
    id: decidedDirection.id,
    expectedRevision: decidedDirection.revision,
    decision: 'Rewrite the decision in place.'
  }), /immutable/);

  const siteExpansionTask = await seoTaskCreate({
    id: 'seo-expand-site', siteId: 'site-a', targetUrls: ['https://example.com/compare'],
    repo: 'nomuonji/site-a', taskType: 'site_expansion', title: 'Add decision comparison experience',
    rationale: 'Observed user need is better served by a bounded comparison experience than another article.',
    evidence: ['Current repository has no comparison route; task defines one bounded useful experience.'],
    directionId: decidedDirection.id,
    dedupeKey: 'site-a:site-expansion:comparison', createdBy: 'site-operations-smoke'
  });
  const dataExpansionTask = await seoTaskCreate({
    id: 'seo-expand-data', siteId: 'site-a',
    repo: 'nomuonji/site-a', taskType: 'data_expansion', title: 'Promote verified database records',
    rationale: 'Database coverage has a verified gap represented by source-backed candidates.',
    evidence: ['Authoritative-source verification and repository validation are required before public promotion.'],
    dedupeKey: 'site-a:data-expansion:verified-records', createdBy: 'site-operations-smoke'
  });
  const schemaExpansionTask = await seoTaskCreate({
    id: 'seo-expand-schema', siteId: 'site-a',
    repo: 'nomuonji/site-a', taskType: 'schema_expansion', title: 'Represent recurring eligibility requirements',
    rationale: 'A recurring demonstrated user need cannot be represented by the current structured model.',
    evidence: ['Task is bounded to schema, validation and generated output required for the demonstrated field.'],
    dedupeKey: 'site-a:schema-expansion:eligibility', createdBy: 'site-operations-smoke'
  });
  assert.equal(siteExpansionTask.taskType, 'site_expansion');
  assert.equal(siteExpansionTask.directionId, decidedDirection.id);
  assert.equal(dataExpansionTask.taskType, 'data_expansion');
  assert.equal(schemaExpansionTask.taskType, 'schema_expansion');
  assert.equal((await seoTaskList({ siteId: 'site-a', taskType: 'site_expansion' })).items.length, 1);
  assert.equal((await seoTaskList({ siteId: 'site-a', taskType: 'data_expansion' })).items.length, 1);
  assert.equal((await seoTaskList({ siteId: 'site-a', taskType: 'schema_expansion' })).items.length, 1);

  // An already claimed growth task is not retroactively suspended by a
  // moderate SEO incident; only NEW claims and NEW creation are gated.
  const preIncidentGrowth = await seoTaskCreate({
    id: 'seo-inflight-growth',
    siteId: 'site-a',
    targetUrls: ['https://example.com/inflight'],
    repo: 'nomuonji/site-a',
    taskType: 'new_article',
    title: 'Existing in-flight work',
    rationale: 'Accepted before incident governance changed.',
    evidence: ['Pre-incident approved implementation.'],
    dedupeKey: 'site-a:inflight-growth'
  });
  const claimedBeforeIncident = await seoTaskClaim({
    id: preIncidentGrowth.id, expectedRevision: preIncidentGrowth.revision,
    runId: 'pre-incident-claim', actor: 'site-operations-smoke', leaseMinutes: 75
  });

  // Search-visibility recovery permits high-upside SEO investment; other incidents retain containment.
  const recovery = await seoRecoveryPortfolioUpdate({
    expectedRevision: 0,
    mode: 'recovery',
    incidentId: 'spam-recovery-2026-10',
    incidentCategory: 'search_visibility',
    title: 'Cross-site organic visibility and indexation recovery',
    reason: 'Multiple managed sites show broad URL Inspection exclusion and sharp Search visibility deterioration.',
    evidence: [
      'Direct URL Inspection observations across multiple managed sites show broad exclusion.',
      'Google scaled-content policy is a primary risk-control source; causality of a specific update is not asserted.'
    ]
  });
  assert.equal(recovery.mode, 'recovery');
  assert.equal(recovery.incidentCategory, 'search_visibility');
  const activeRecovery = await seoRecoveryStatus({});
  assert.equal(activeRecovery.effectivePolicy.growthFrozenByDefault, false);
  assert.equal(activeRecovery.effectivePolicy.scope, 'policy_permitted_recovery_intake');
  assert.deepEqual(activeRecovery.effectivePolicy.investmentAllocation.buckets.map((b: any) => b.targetPercent), [40,40,20]);
  assert.equal(activeRecovery.effectivePolicy.inFlightPolicy, 'continue_existing_claims_and_delivery_handoffs');
  // Claim refresh for the same already-running task must not be blocked by the
  // recovery intake gate; lease/collision safety remains in effect.
  const refreshedInFlight = await seoTaskClaim({
    id: claimedBeforeIncident.id, expectedRevision: claimedBeforeIncident.revision,
    runId: 'pre-incident-claim', actor: 'site-operations-smoke', leaseMinutes: 75
  });
  const continuedInFlight = await seoTaskUpdate({
    id: refreshedInFlight.id, expectedRevision: refreshedInFlight.revision,
    claimRunId: 'pre-incident-claim',
    executionSummary: 'Implementation continues because it was claimed before the incident.'
  });
  assert.equal(continuedInFlight.status, 'in_progress');

  const confirmed = await seoRecoverySiteUpdate({
    siteId: 'site-a',
    expectedRevision: 0,
    state: 'confirmed',
    strategy: 'consolidate',
    reason: 'Test site is treated as affected for the active recovery incident.',
    evidence: ['Synthetic smoke evidence for broad indexation/visibility decline.'],
    releaseCriteria: ['Fresh recovery observations support explicit clearance.', 'No unresolved technical/indexation blocker remains.']
  });
  assert.equal(confirmed.incidentId, 'spam-recovery-2026-10');

  const visibilityGrowth = await seoTaskCreate({
    id: 'seo-recovery-investment-new', siteId: 'site-a',
    targetUrls: ['https://example.com/new-search-surface'], repo: 'nomuonji/site-a',
    taskType: 'new_article', title: 'Search growth during visibility recovery',
    rationale: 'An independently sourced, useful Search answer with asymmetric upside.',
    evidence: ['Bounded real user answer; not a mass SEO doorway page.'],
    dedupeKey: 'site-a:recovery:invest-new'
  });
  assert.equal(visibilityGrowth.status, 'ready');
  const claimedGrowth = await seoTaskClaim({
    id: siteExpansionTask.id, expectedRevision: siteExpansionTask.revision,
    runId: 'recovery-investment-claim', actor: 'site-operations-smoke', leaseMinutes: 75
  });
  assert.equal(claimedGrowth.status, 'in_progress');

  const recoveryRepair = await seoTaskCreate({
    id: 'seo-recovery-repair',
    siteId: 'site-a',
    targetUrls: ['https://example.com/article-a'],
    repo: 'nomuonji/site-a',
    taskType: 'technical',
    title: 'Verify recovery indexing contract',
    rationale: 'Recovery mode still allows bounded repair work.',
    evidence: ['Repair is bounded and does not add a new Search surface.'],
    dedupeKey: 'site-a:recovery:technical-repair'
  });
  assert.equal(recoveryRepair.status, 'ready');

  const cleared = await seoRecoverySiteUpdate({
    siteId: 'site-a',
    expectedRevision: confirmed.revision,
    state: 'cleared',
    strategy: 'protect',
    reason: 'Smoke test clearance after fresh evidence.',
    evidence: ['Fresh observations satisfy the synthetic release criteria.'],
    releaseCriteria: ['Satisfied in smoke test.']
  });
  assert.equal(cleared.state, 'cleared');

  const clearedGrowth = await seoTaskCreate({
    id: 'seo-recovery-cleared-growth',
    siteId: 'site-a',
    targetUrls: ['https://example.com/cleared-growth'],
    repo: 'nomuonji/site-a',
    taskType: 'site_expansion',
    title: 'Growth allowed after incident-specific clearance',
    rationale: 'The site is explicitly cleared for the active incident.',
    evidence: ['Incident-specific site state is cleared.'],
    dedupeKey: 'site-a:recovery:cleared-growth'
  });
  assert.equal(clearedGrowth.status, 'ready');

  await assert.rejects(
    seoRecoveryPortfolioUpdate({ expectedRevision: recovery.revision, mode: 'normal' }),
    /Returning to normal mode requires fresh resolutionEvidence/
  );
  const normal = await seoRecoveryPortfolioUpdate({
    expectedRevision: recovery.revision, mode: 'normal',
    resolutionEvidence: ['Manually approved normalization after reviewing current portfolio evidence and outstanding tasks.']
  });
  assert.equal(normal.mode, 'normal');
  assert.equal(normal.resolutionEvidence.length, 1);
  assert.equal((await seoRecoveryStatus({})).effectivePolicy.growthFrozenByDefault, false);

  // A subsequent incident can be about technical integrity rather than spam;
  // old site clearances do not authorize new growth in another incident.
  await assert.rejects(seoRecoveryPortfolioUpdate({
    expectedRevision: normal.revision, mode: 'recovery',
    incidentId: 'spam-recovery-2026-10',
    reason: 'Unsafe reuse of an old resolved incident.',
    evidence: ['Old incident would inherit stale site clearance.']
  }), /new, distinct incidentId/);
  const technicalIncident = await seoRecoveryPortfolioUpdate({
    expectedRevision: normal.revision, mode: 'recovery',
    incidentId: 'technical-integrity-incident',
    incidentCategory: 'technical_integrity',
    title: 'Technical search integrity incident',
    reason: 'A representative publishing/indexability technical regression is under review.',
    evidence: ['Synthetic technical integrity regression.']
  });
  assert.equal(technicalIncident.incidentCategory, 'technical_integrity');
  const containment = await seoRecoveryStatus({});
  assert.equal(containment.effectivePolicy.growthFrozenByDefault, true);
  assert.equal(containment.effectivePolicy.blockedTaskTypesUntilSiteClearance.length, 4);
  await assert.rejects(seoTaskCreate({
    id: 'seo-technical-growth-block', siteId: 'site-a',
    targetUrls: ['https://example.com/technical-growth'], repo: 'nomuonji/site-a',
    taskType: 'data_expansion', title: 'Technical incident blocks growth',
    rationale: 'Active technical incident requires containment.',
    evidence: ['Synthetic technical incident.'], dedupeKey: 'site-a:technical-growth'
  }), /SEO recovery mode blocks taskType=data_expansion/);
  await assert.rejects(seoTaskClaim({
    id: clearedGrowth.id, expectedRevision: clearedGrowth.revision,
    runId: 'stale-clearance-blocked', actor: 'site-operations-smoke', leaseMinutes: 75
  }), /SEO recovery mode blocks taskType=site_expansion/);

  const article = await siteArticleSave({
    id: 'article-a', expectedRevision: 0, siteId: 'site-a', localPageId: 'local-page-a', canonicalUrl: 'https://example.com/article-a',
    repo: 'nomuonji/site-a', repoPath: 'content/posts/article-a.mdx', currentCommitSha: 'a'.repeat(40), slug: 'article-a', title: 'Article A',
    primaryKeywordId: 'b'.repeat(32), status: 'published', publishedAt: '2026-08-01T00:00:00.000Z', lastUpdatedAt: '2026-09-01T00:00:00.000Z'
  });
  assert.equal(article.repoPath, 'content/posts/article-a.mdx');
  assert.equal(article.localPageId, 'local-page-a');
  await assert.rejects(siteArticleSave({ id: 'bad-path', expectedRevision: 0, siteId: 'site-a', repo: 'nomuonji/site-a', repoPath: '../secret', slug: 'bad', title: 'bad' }));
  await assert.rejects(siteArticleSave({ id: 'article-b', expectedRevision: 0, siteId: 'site-a', localPageId: 'local-page-a', repo: 'nomuonji/site-a', repoPath: 'content/posts/b.mdx', slug: 'b', title: 'B' }), /already linked/);
  const normalizedArticle = await siteArticleSave({
    id: 'article-a', expectedRevision: article.revision, siteId: 'site-a', canonicalUrl: 'https://EXAMPLE.com:443/article-a/?utm_source=smoke#fragment'
  });
  assert.equal(normalizedArticle.canonicalUrl, 'https://example.com/article-a');
  await assert.rejects(siteArticleSave({
    id: 'article-c', expectedRevision: 0, siteId: 'site-a', canonicalUrl: 'https://example.com/article-a/',
    repo: 'nomuonji/site-a', repoPath: 'content/posts/c.mdx', slug: 'c', title: 'C'
  }), /canonicalUrl is already linked/);

  const repairedTask = await seoTaskUpdate({ id: verifiedTask.id, expectedRevision: verifiedTask.revision, appendHistory: { actor: 'smoke', event: 'registry_reconciled', detail: 'Registry arrived after the task.' } });
  assert.deepEqual(repairedTask.articleIds, ['article-a'], 'legacy URL-only task must attach its later registry entry');
  assert.equal(repairedTask.status, 'completed');
  const urlTask = await seoTaskCreate({ siteId: 'site-a', targetUrls: ['https://example.com/article-a/?utm_source=test'], repo: 'nomuonji/site-a', taskType: 'revise', title: 'Follow-up', rationale: 'Separate intervention.', evidence: ['Observed separate gap.'], dedupeKey: 'site-a:follow-up' });
  assert.deepEqual(urlTask.articleIds, ['article-a'], 'new URL-only task must use canonical identity');
  assert.ok((await seoTaskList({ siteId: 'site-a', articleId: 'article-a' })).items.some(task => task.id === urlTask.id));
  const unrelatedTask = await seoTaskCreate({ siteId: 'site-a', targetUrls: ['https://example.com/article-a'], repo: 'nomuonji/other', taskType: 'technical', title: 'Other repo', rationale: 'No matching registry.', evidence: ['Separate repository.'], dedupeKey: 'site-a:other-repo' });
  assert.deepEqual(unrelatedTask.articleIds, [], 'URL match must not attach a different repository');

  const gscInput = {
    siteId: 'site-a', articleId: 'article-a', provider: 'gsc' as const, periodStart: '2026-09-01', periodEnd: '2026-09-07',
    metrics: { clicks: 12, impressions: 400, ctr: 0.03, averagePosition: 8.4 },
    queries: [{ query: 'example query', clicks: 8, impressions: 200, ctr: 0.04, averagePosition: 7.1 }],
    completeness: 'complete' as const, sourceVersion: 'gsc:2026-09-01:2026-09-07:v1', capturedAt: '2026-09-10T00:00:00.000Z'
  };
  const gsc = await metricSnapshotSave(gscInput);
  assert.equal(gsc.reused, false);
  assert.equal((await metricSnapshotSave(gscInput)).reused, true);
  await metricSnapshotSave({
    siteId: 'site-a', articleId: 'article-a', provider: 'ga4', periodStart: '2026-09-01', periodEnd: '2026-09-07',
    metrics: { sessions: 30, users: 26, engagedSessions: 22, engagementRate: 0.73, keyEvents: 2 },
    sourceVersion: 'ga4:2026-09-01:2026-09-07:v1', capturedAt: '2026-09-10T00:01:00.000Z'
  });

  const active = await optimizationEventCreate({
    id: 'opt-a', siteId: 'site-a', articleId: 'article-a', observation: 'Impressions exist but CTR is low.', diagnosis: 'Snippet does not match query intent.',
    hypothesis: 'A more specific title will improve CTR without changing the page intent.', actionType: 'title_snippet', baselinePeriod: { start: '2026-08-18', end: '2026-08-31' },
    beforeCommit: 'a'.repeat(40), afterCommit: 'c'.repeat(40), phase: 'implemented', notes: 'One change only.'
  });
  assert.equal(active.result, 'pending');
  assert.ok(active.evaluateAfter && Date.parse(active.evaluateAfter) > Date.parse(active.changedAt!));
  const context = await optimizationContext({ siteId: 'site-a', articleId: 'article-a' });
  assert.equal(context.changeAllowed, false);
  assert.equal((context.latestMetrics.gsc as any)?.provider, 'gsc');
  assert.equal((context.latestMetrics.ga4 as any)?.provider, 'ga4');
  await assert.rejects(optimizationEventCreate({
    id: 'opt-b', siteId: 'site-a', articleId: 'article-a', observation: 'Another signal', diagnosis: 'Another diagnosis', hypothesis: 'Another hypothesis',
    actionType: 'content_expand', baselinePeriod: { start: '2026-08-18', end: '2026-08-31' }, phase: 'implemented'
  }), /unevaluated optimization/);
  await assert.rejects(optimizationEventUpdate({ id: 'opt-a', expectedRevision: 1, result: 'improved', evaluationMetrics: { ctrDelta: 0.01 } }), /has not matured/);
  const cancelled = await optimizationEventUpdate({ id: 'opt-a', expectedRevision: 1, phase: 'cancelled', notes: 'Cancelled before evaluation.' });
  assert.equal(cancelled.result, 'inconclusive');

  const oldChangedAt = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const oldEvaluateAfter = new Date(Date.now() - 14 * 86_400_000).toISOString();
  const mature = await optimizationEventCreate({
    id: 'opt-mature', siteId: 'site-a', articleId: 'article-a', observation: 'Position was 11.', diagnosis: 'Coverage gap.',
    hypothesis: 'Adding one missing comparison section will improve ranking.', actionType: 'content_expand', baselinePeriod: { start: '2026-07-01', end: '2026-07-14' },
    changedAt: oldChangedAt, evaluateAfter: oldEvaluateAfter, phase: 'implemented'
  });
  const evaluated = await optimizationEventUpdate({ id: 'opt-mature', expectedRevision: mature.revision, result: 'improved', evaluationMetrics: { positionDelta: -2.4 } });
  assert.equal(evaluated.phase, 'evaluated');

  // A future macro strategy can be changed as DATA, without changing the
  // scheduled SEO Manager, Worker, or generic incident admission implementation.
  const currentMacro = await seoPortfolioPolicyGet({});
  assert.equal(currentMacro.persisted, false);
  assert.equal(currentMacro.policy.revision, 0);
  const revisedDefinition = structuredClone({
    objective: currentMacro.policy.objective,
    allocation: currentMacro.policy.allocation,
    risk: currentMacro.policy.risk,
    constraints: currentMacro.policy.constraints,
    evaluation: currentMacro.policy.evaluation
  });
  revisedDefinition.allocation.buckets[0].targetPercent = 20;
  revisedDefinition.allocation.buckets[1].targetPercent = 60;
  revisedDefinition.constraints.incidentGrowthIntake.technical_integrity = 'allow';
  const changedMacro = await seoPortfolioPolicyUpdate({
    expectedRevision: 0, policy: revisedDefinition,
    decisionReason: 'Smoke: rebalance portfolio and permit a different incident category without changing code',
    updatedBy: 'site-operations-smoke'
  });
  assert.equal(changedMacro.revision, 1);
  assert.equal((await seoPortfolioPolicyGet({})).policy.allocation.buckets[1].targetPercent, 60);
  assert.equal((await seoRecoveryStatus({})).effectivePolicy.growthFrozenByDefault, false);
  await assert.rejects(seoPortfolioPolicyUpdate({
    expectedRevision: 0, policy: revisedDefinition, decisionReason: 'Stale update must fail',
    updatedBy: 'site-operations-smoke'
  }), /revision conflict/);
  const changingScope = await seoTaskCreate({
    id: 'policy-dynamic-technical-task', siteId: 'site-a',
    targetUrls: ['https://example.com/rebalanced'], repo: 'nomuonji/site-a',
    taskType: 'site_expansion', title: 'Strategy changes without a Worker migration',
    rationale: 'Use a new high-upside policy bucket and preserve provenance.',
    evidence: ['Synthetic test of policy-driven admission'], dedupeKey: 'site-a:policy-dynamic-technical-task',
    allocationBucket: 'structural', estimatedEffortUnits: 3
  });
  assert.equal(changingScope.policyRevisionAtCreation, 1);
  assert.equal(changingScope.allocationBucket, 'structural');
  assert.equal((await seoPortfolioAllocationStatus({})).allocation.buckets[1].assignedTasks >= 1, true);
  assert.equal((await seoPortfolioAllocationStatus({})).allocation.buckets[1].estimatedEffortUnits, 3);
  const rebucketed = await seoTaskUpdate({
    id: changingScope.id, expectedRevision: changingScope.revision,
    allocationBucket: 'speculative', estimatedEffortUnits: 2,
    appendHistory: { actor: 'site-operations-smoke', event: 'reallocation',
      detail: 'Generic policy bucket transfer before worker claim' }
  });
  assert.equal(rebucketed.policyRevisionAtCreation, 1, 'origin policy must not change');
  assert.equal(rebucketed.allocationPolicyRevision, 1);
  assert.equal((await seoPortfolioAllocationStatus({})).allocation.buckets[2].estimatedEffortUnits, 2);
  await assert.rejects(seoTaskUpdate({
    id: rebucketed.id, expectedRevision: rebucketed.revision,
    allocationBucket: 'not_an_active_bucket'
  }), /allocationBucket is not in active policy/);
    const { siteArticleCreateMany } = await import('../packages/commands/src/remote-site-operations.js');
  let commitCalls = 0;
  const countingFetch = globalThis.fetch;
  globalThis.fetch = (async (input: any, init?: any) => {
    if (String(input).endsWith(':commit')) commitCalls++;
    return countingFetch(input, init);
  }) as typeof fetch;
  try {
    const batched = await siteArticleCreateMany({
      siteId: 'site-a',
      records: [
        { id: 'article-batch-1', localPageId: 'local-batch-1', canonicalUrl: 'https://example.com/batch-1', repo: 'nomuonji/site-a', repoPath: 'content/b1.mdx', slug: 'batch-1', title: 'Batch 1' },
        { id: 'article-batch-2', localPageId: 'local-batch-2', canonicalUrl: 'https://example.com/batch-2', repo: 'nomuonji/site-a', repoPath: 'content/b2.mdx', slug: 'batch-2', title: 'Batch 2' },
        { id: 'article-batch-3', localPageId: 'local-batch-3', canonicalUrl: 'https://example.com/batch-3', repo: 'nomuonji/site-a', repoPath: 'content/b3.mdx', slug: 'batch-3', title: 'Batch 3' }
      ]
    });
    assert.equal(batched.created.length, 3);
    assert.ok(batched.created.every(article => article.revision === 1 && article.status === 'draft'));
    assert.equal(commitCalls, 1);
    await assert.rejects(siteArticleCreateMany({
      siteId: 'site-a',
      records: [
        { id: 'article-batch-4', localPageId: 'local-batch-4', canonicalUrl: 'https://example.com/batch-4', repo: 'nomuonji/site-a', repoPath: 'content/b4.mdx', slug: 'batch-4', title: 'Batch 4' },
        { id: 'article-batch-5', localPageId: 'local-batch-5', canonicalUrl: 'https://example.com/batch-4', repo: 'nomuonji/site-a', repoPath: 'content/b5.mdx', slug: 'batch-5', title: 'Batch 5' }
      ]
    }), /already linked/);
    await assert.rejects(siteArticleCreateMany({
      siteId: 'site-a',
      records: [{ id: 'article-batch-6', localPageId: 'local-page-a', canonicalUrl: 'https://example.com/batch-6', repo: 'nomuonji/site-a', repoPath: 'content/b6.mdx', slug: 'batch-6', title: 'Batch 6' }]
    }), /already linked/);
    await assert.rejects(siteArticleCreateMany({
      siteId: 'site-a',
      records: [{ id: 'x'.repeat(101), localPageId: 'local-batch-7', canonicalUrl: 'https://example.com/batch-7', repo: 'nomuonji/site-a', repoPath: 'content/b7.mdx', slug: 'batch-7', title: 'Batch 7' }]
    }));
  } finally {
    globalThis.fetch = countingFetch;
  }

  const { default: mcp } = await import('../api/sites-mcp.js');
  assert.equal((await mcp.request('/sites-mcp', { method: 'POST' })).status, 401);
  assert.equal((await mcp.request('/sites-mcp/health')).status, 200);
  const call = async (method: string, params: object, bearer = 'test-only-token') => {
    const response = await mcp.request('/sites-mcp', { method: 'POST', headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
    assert.equal(response.status, 200);
    return (await response.json() as any).result;
  };
  const listing = await call('tools/list', {});
  assert.equal(listing.tools.length, 47);
  assert.ok(listing.tools.some((tool: any) => tool.name === 'seo_agent_context'));
  assert.ok(listing.tools.some((tool: any) => tool.name === 'seo_portfolio_policy_get'));
  assert.ok(listing.tools.some((tool: any) => tool.name === 'seo_portfolio_policy_update'));
  const portfolioTool = listing.tools.find((tool: any) => tool.name === 'seo_portfolio_policy_update');
  assert.ok(portfolioTool?.inputSchema?.properties?.policy?.properties?.objective,
    'MCP must advertise the entire nested macro-policy shape');
  const portfolioSchema = portfolioTool.inputSchema.properties.policy;
  const incidentSchema = portfolioSchema.properties.constraints.properties.incidentGrowthIntake;
  assert.equal(incidentSchema.type, 'object');
  assert.equal(incidentSchema.propertyNames, undefined,
    'ChatGPT tool introspection should not require propertyNames JSON Schema');
  assert.deepEqual(Object.keys(incidentSchema.properties).sort(), [
    'content_quality','measurement_integrity','other','search_visibility','technical_integrity'
  ]);
  assert.equal(Array.isArray(portfolioSchema.properties.evaluation.properties.pilotWindowDays.items), false,
    'Do not emit draft-07 tuple items array in ChatGPT tool schema');
  assert.equal(Array.isArray(portfolioSchema.properties.evaluation.properties.reallocationWindowDays.items), false);

  assert.ok(listing.tools.some((tool: any) => tool.name === 'seo_portfolio_allocation_status'));
  assert.ok(listing.tools.some((tool: any) => tool.name === 'seo_evaluator_list'));
  assert.ok(listing.tools.some((tool: any) => tool.name === 'seo_evaluator_get'));
  assert.ok(listing.tools.some((tool: any) => tool.name === 'site_registry_resolve'));
  assert.ok(listing.tools.some((tool: any) => tool.name === 'cloudflare_worker_set_subdomain'));
  assert.ok(listing.tools.some((tool: any) => tool.name === 'cloudflare_worker_secret_recovery'));
  assert.ok(listing.tools.some((tool: any) => tool.name === 'cloudflare_worker_inherit_secrets'));


  assert.ok(listing.tools.some((tool: any) => tool.name === 'site_direction_get'));
  assert.ok(listing.tools.some((tool: any) => tool.name === 'site_direction_create'));
  assert.ok(listing.tools.some((tool: any) => tool.name === 'site_direction_list'));
  assert.ok(listing.tools.some((tool: any) => tool.name === 'site_direction_update'));
  assert.ok(listing.tools.some((tool: any) => tool.name === 'seo_recovery_status'));
  assert.ok(listing.tools.some((tool: any) => tool.name === 'seo_recovery_portfolio_update'));
  assert.ok(listing.tools.some((tool: any) => tool.name === 'seo_recovery_site_update'));
  assert.ok(listing.tools.some((tool: any) => tool.name === 'cloudflare_pages_site_status'));
  assert.ok(listing.tools.some((tool: any) => tool.name === 'cloudflare_pages_set_preview_branch_exclusions'));
  assert.ok(listing.tools.some((tool: any) => tool.name === 'cloudflare_pages_deployment_logs'));
  assert.ok(listing.tools.some((tool: any) => tool.name === 'optimization_context'));
  assert.ok(listing.tools.some((tool: any) => tool.name === 'optimization_evaluation_context'));
  assert.ok(listing.tools.some((tool: any) => tool.name === 'site_query_opportunities'));
  assert.ok(listing.tools.some((tool: any) => tool.name === 'seo_planning_digest_get'));
  assert.ok(!listing.tools.some((tool: any) => tool.name === 'site_metric_snapshot_save'));
  assert.ok(listing.tools.some((tool: any) => tool.name === 'site_metric_snapshot_list'));
  assert.ok(listing.tools.some((tool: any) => tool.name === 'seo_task_create'));
  assert.ok(listing.tools.some((tool: any) => tool.name === 'seo_task_claim'));
  assert.ok(listing.tools.some((tool: any) => tool.name === 'seo_task_heartbeat'));
  assert.ok(listing.tools.some((tool: any) => tool.name === 'seo_task_update'));
  assert.ok(listing.tools.some((tool: any) => tool.name === 'site_indexation_inventory_save'));
  assert.ok(listing.tools.some((tool: any) => tool.name === 'site_indexation_inspect'));
  assert.ok(listing.tools.some((tool: any) => tool.name === 'site_indexation_list'));
  assert.ok(listing.tools.some((tool: any) => tool.name === 'site_indexation_summary'));
  assert.ok(listing.tools.some((tool: any) => tool.name === 'site_indexation_snapshot_save'));
  const agentPolicy = await call('tools/call', { name: 'seo_agent_context', arguments: { role: 'planner' } });
  assert.equal(agentPolicy.structuredContent.policyVersion, '1.28.0');
  assert.match(agentPolicy.structuredContent.acquisitionReview.requiredDiagnosis, /previous 28d/);
  assert.match(agentPolicy.structuredContent.acquisitionReview.scopeBoundary, /cannot own social/);
  assert.match(agentPolicy.structuredContent.runContract.acquisitionReview.launchGate, /Deployment verification/);
  assert.equal(agentPolicy.structuredContent.role, 'planner');
  assert.equal(agentPolicy.structuredContent.recovery.portfolio.incidentCategory, 'technical_integrity');
  assert.equal(agentPolicy.structuredContent.recovery.effectivePolicy.scope, 'policy_permitted_recovery_intake');
  assert.ok(JSON.stringify(agentPolicy.structuredContent).includes('Never fetch GSC/GA4 directly'));
  assert.match(JSON.stringify(agentPolicy.structuredContent), /site-monitor/);
  assert.match(JSON.stringify(agentPolicy.structuredContent), /CURRENT GitHub default-branch HEAD/);
  assert.equal(agentPolicy.structuredContent.actor.canonicalRole, 'seo_manager');
  assert.equal(agentPolicy.structuredContent.actor.independentPlannerAgent, false);
  assert.equal(agentPolicy.structuredContent.macroPolicy.policy.revision, 1);
  assert.match(agentPolicy.structuredContent.runContract.successCondition, /active policy objective/);
  assert.match(agentPolicy.structuredContent.runContract.manual, /sites-operator-planner-manual.md$/);
  assert.equal(agentPolicy.structuredContent.runContract.defaultLegacyReadyInventoryTarget, 8);
  assert.equal(agentPolicy.structuredContent.macroPolicy.policy.risk.maxNewTasksPerRun, 5);
  assert.equal(agentPolicy.structuredContent.macroPolicy.policy.risk.maxNewTasksPerRepository, 3);
  assert.equal(agentPolicy.structuredContent.runContract.macroPolicy.source, 'seo_portfolio_policy_get');
  assert.deepEqual(agentPolicy.structuredContent.macroPolicy.policy.allocation.buckets.map((b: any) => b.targetPercent), [20,60,20]);
    assert.match(JSON.stringify(agentPolicy.structuredContent.recoveryGovernance), /recovery/i);
  assert.equal(agentPolicy.structuredContent.runContract.directionReview.mode, 'persistent_human_gate');
  assert.match(agentPolicy.structuredContent.runContract.directionReview.majorChangeGate, /No Worker task/);
  assert.match(JSON.stringify(agentPolicy.structuredContent.instructions), /discussion_required/);
  assert.match(JSON.stringify(agentPolicy.structuredContent.instructions), /do not deepen/i);
  assert.match(JSON.stringify(agentPolicy.structuredContent.instructions), /site_direction_create/);
  assert.match(JSON.stringify(agentPolicy.structuredContent.instructions), /directionId/);
  assert.match(JSON.stringify(agentPolicy.structuredContent.instructions), /6 distinct active managed sites/);
  assert.match(JSON.stringify(agentPolicy.structuredContent.instructions), /allocation.buckets/);
  assert.doesNotMatch(agentPolicy.structuredContent.runContract.successCondition, /GitHub create_issue/);
  assert.ok(JSON.stringify(agentPolicy.structuredContent).includes('relevant PRs/commits'));
  assert.match(JSON.stringify(agentPolicy.structuredContent), /cooldown/);
  assert.match(JSON.stringify(agentPolicy.structuredContent), /superseded/);
  assert.equal(agentPolicy.structuredContent.evaluationRegistry.registryVersion, '1.2.0');
  assert.match(agentPolicy.structuredContent.evaluationRegistry.scoring, /No composite SEO score/);
  const evaluatorList = await call('tools/call', { name: 'seo_evaluator_list', arguments: {} });
  assert.equal(evaluatorList.structuredContent.registryVersion, '1.2.0');
  assert.ok(evaluatorList.structuredContent.items.some((item: any) => item.id === 'content_incremental_value' && item.status === 'active'));
  assert.ok(evaluatorList.structuredContent.items.some((item: any) => item.id === 'scaled_content_operation_risk' && item.status === 'active' && item.version === '1.1.0'));
  assert.ok(evaluatorList.structuredContent.items.some((item: any) => item.id === 'database_indexation_quality' && item.status === 'active'));
  const databaseIndexation = await call('tools/call', { name: 'seo_evaluator_get', arguments: { id: 'database_indexation_quality' } });
  assert.equal(databaseIndexation.structuredContent.evaluator.version, '1.0.0');
  assert.equal(databaseIndexation.structuredContent.evaluator.inference.confidence, 'high');
  assert.ok(databaseIndexation.structuredContent.evidence.some((source: any) => source.id === 'google_faceted_navigation_guidance'));
  assert.match(JSON.stringify(databaseIndexation.structuredContent), /indexable URL surface/i);
  const scaledRisk = await call('tools/call', { name: 'seo_evaluator_get', arguments: { id: 'scaled_content_operation_risk' } });
  assert.equal(scaledRisk.structuredContent.evaluator.version, '1.1.0');
  assert.equal(scaledRisk.structuredContent.evaluator.inference.confidence, 'medium_to_high');
  assert.ok(scaledRisk.structuredContent.evidence.some((source: any) => source.id === 'google_scaled_content_policy'));
  assert.match(JSON.stringify(scaledRisk.structuredContent), /does not assert which Google system caused/i);
  const executorPolicy = await call('tools/call', { name: 'seo_agent_context', arguments: { role: 'executor' } });
  assert.match(executorPolicy.structuredContent.runContract.manual, /sites-operator-worker-manual.md$/);
  assert.equal(executorPolicy.structuredContent.actor.canonicalRole, 'seo_worker');
  assert.equal(executorPolicy.structuredContent.executionGate.mode, 'recovery');
  assert.equal(executorPolicy.structuredContent.executionGate.inFlightPolicy, 'continue_existing_claims_and_delivery_handoffs');
  assert.equal('macroPolicy' in executorPolicy.structuredContent, false);
  assert.equal('recoveryGovernance' in executorPolicy.structuredContent, false);
  assert.match(executorPolicy.structuredContent.runContract.deliveryDefault, /\[CF-Pages-Skip\]/);
  assert.match(executorPolicy.structuredContent.runContract.deliveryDefault, /Centralized Keywords GitHub Actions/);
  assert.match(executorPolicy.structuredContent.runContract.deliveryDefault, /deletes the merged seo\/\* branch/);
  assert.match(JSON.stringify(executorPolicy.structuredContent.instructions), /state:push_pending/);
  assert.match(JSON.stringify(executorPolicy.structuredContent.instructions), /BEFORE the remote push/);
  assert.match(JSON.stringify(executorPolicy.structuredContent.instructions), /state=branch_ready/);
  assert.match(JSON.stringify(executorPolicy.structuredContent.instructions), /Do NOT create\/update PRs/);
  assert.match(JSON.stringify(executorPolicy.structuredContent.instructions), /centralized controller may promote push_pending/);
  assert.match(JSON.stringify(executorPolicy.structuredContent.instructions), /ci_failed/);
  assert.match(JSON.stringify(executorPolicy.structuredContent.instructions), /Task status remains in_progress throughout push_pending, branch_ready and pr_open/);
  assert.match(JSON.stringify(executorPolicy.structuredContent.instructions), /ephemeral run/);
  assert.match(JSON.stringify(executorPolicy.structuredContent.instructions), /seo_task_claim/);
  assert.match(JSON.stringify(executorPolicy.structuredContent.instructions), /claimRunId/);
  assert.match(executorPolicy.structuredContent.runContract.claimModel, /not a persistent worker\/session identity/);
  assert.match(JSON.stringify(executorPolicy.structuredContent.instructions), /expectedRevision/);
  const status = await call('tools/call', { name: 'remote_sites_status', arguments: {} });
  assert.equal(status.structuredContent.sourceOfTruth.articleBody, 'git_repository');
  const mapped = await call('tools/call', { name: 'site_registry_resolve', arguments: { localProjectId: 'local-project-a' } });
  assert.equal(mapped.structuredContent.site.id, 'site-a');

  // Verify compatibility with access tokens signed by the existing Keywords OAuth server.
  const body = Buffer.from(JSON.stringify({ kind: 'access', exp: Math.floor(Date.now() / 1000) + 300, clientId: 'smoke' })).toString('base64url');
  const signedAccess = `${body}.${createHmac('sha256', 'test-only-token').update(body).digest('base64url')}`;
  const oauthStatus = await call('tools/call', { name: 'remote_sites_status', arguments: {} }, signedAccess);
  assert.equal(oauthStatus.structuredContent.serverVersion, '0.22.0');
  assert.equal(oauthStatus.structuredContent.evaluationRegistry.version, '1.2.0');

  console.log('site operations smoke passed: evaluator provenance, run leases, structured centralized delivery handoff, controller-owned completion, separate deployment verification, dedupe, normalized site/article identities, optimization cooldown and updated MCP contract');
} finally {
  globalThis.fetch = originalFetch;
}