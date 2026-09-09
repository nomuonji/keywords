import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.KEYWORDS_DB_PATH = join(mkdtempSync(join(tmpdir(), 'keywords-autopilot-')), 'test.sqlite');

const { getDatabase, schema } = await import('@keywords/db');
const { commands } = await import('@keywords/commands');
const { planningCommands } = await import('@keywords/commands/planning');
const { configureAutonomy, evaluateAutonomyGate, applyAutonomyDecision, createAutonomousHandoff, autonomyPublicationUsage } = await import('@keywords/commands/autonomy');
const { db, sqlite } = getDatabase();
const now = new Date().toISOString();
const today = now.slice(0, 10);
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const projectId = 'project-autopilot-smoke';
const human = { actor: 'human' as const, actorId: 'autopilot-smoke-human' };

await db.insert(schema.projects).values({ id: projectId, name: 'Autopilot smoke', domain: 'example.com', mode: 'existing_site', language: 'ja', country: 'JP', createdAt: now, updatedAt: now });
const source = await commands.source.record(human, { projectId, type: 'web', label: 'Official product documentation', url: 'https://docs.example.com/product', metadata: { fixture: true } });
const keyword = await commands.keyword.create(human, { projectId, text: 'autopilot evidence guide', source: 'fixture', avgMonthly: 100 });
const plan = await planningCommands.pagePlan(human, { projectId, title: 'Autopilot Evidence Guide', slug: 'autopilot-evidence-guide', planMode: 'new_page', primaryKeywordId: keyword.id, sourceIds: [source.id], audience: 'Operators', question: 'How should autonomous SEO publishing be gated?', searchIntent: 'implementation', uniqueAngle: 'Deterministic evidence gate' });
const pageId = plan.page.id;

const snapshot = {
  schema_version: 1, kind: 'blog_site_context', observed_at: now, blog_site_id: 'blog-autopilot-smoke', canonical_origin: 'https://example.com', language: 'ja', country: 'JP', mapping_sha256: 'a'.repeat(64), route_evidence: [],
  eligibility: { remediation_status: 'clear', clearance_gate: 'listed_for_scoped_clearance', new_content_allowed: true, reason: 'fixture', quality_status: 'healthy', index_health: 'healthy' },
  sources: [], pages: [], coverage: { source_count: 0, local_build_page_count: 0, unmapped_build_pages: 0, sources_absent_from_build: 0, duplicate_expected_urls: [], complete_site_coverage: true }, warnings: []
};
sqlite.prepare('INSERT INTO blog_bindings(project_id,blog_site_id,origin,language,country,snapshot_json,snapshot_hash,observed_at) VALUES(?,?,?,?,?,?,?,?)').run(projectId, snapshot.blog_site_id, snapshot.canonical_origin, snapshot.language, snapshot.country, JSON.stringify(snapshot), hash(snapshot), now);

const brief = {
  reader_task: 'Decide how to gate autonomous SEO publishing.', direct_answer: 'Use a separate deterministic evidence gate.', unique_value: 'A tested gate contract rather than generic AI prose.', editorial_owner: 'autopilot', maintenance_owner: 'autopilot', review_due_at: '2027-01-01',
  value_source_ids: [source.id], demand_source_ids: [source.id], demand_status: 'search_surface_observed',
  serp_comparison: [{ source_id: source.id, missing_answer: 'No deterministic gate', our_answer: 'Evidence and publication score gate' }],
  claim_source_map: [{ claim: 'The gate uses independently stored evidence.', source_id: source.id, locator: 'fixture' }], existing_coverage: 'No current page.', internal_links: [], unresolved_questions: [],
  research: { skills_used: ['niche-keyword-finder'], score_rationale: 'Fixture with strong evidence.', demand: 70, serp_opportunity: 70, site_fit: 90, business_value: 70, freshness: 90, effort: 30 },
  autonomy: {
    page_type: 'troubleshooting', evidence_score: 70, commodity_risk: 2,
    information_gain: ['Separates the writing agent from the publication authority.', 'Persists claim-level evidence before publication.'],
    source_packet: { official_source_ids: [source.id], first_party_source_ids: [], research_source_ids: [source.id], competitor_gap_source_ids: [], reader_question_source_ids: [] },
    fact_ledger: [{ claim: 'A deterministic quality gate is required for this fixture.', source_id: source.id, checked_at: today, confidence: 'high' }],
    publication_gate: { source_quality: 18, evidence: 18, originality: 18, intent_match: 14, accuracy: 14, editorial_quality: 8 }
  }
};
sqlite.prepare('INSERT INTO blog_briefs(page_id,project_id,packet_json,packet_hash,created_at) VALUES(?,?,?,?,?)').run(pageId, projectId, JSON.stringify(brief), hash(brief), now);

const before = evaluateAutonomyGate(projectId, pageId);
assert.equal(before.decision, 'reject', 'disabled autopilot must reject autonomous publication');
await configureAutonomy(human, { projectId, enabled: true, autoApprove: true, autoPublish: true, maxDailyNewArticles: 2, maxDailyUpdates: 4 });
const gate = evaluateAutonomyGate(projectId, pageId);
assert.equal(gate.decision, 'publish');
assert.equal(gate.score, 90);
assert.equal(gate.factCount, 1);
assert.equal(gate.informationGain, 2);

const decision = applyAutonomyDecision(projectId, pageId, gate);
assert.equal(decision.verdict, 'approved');
assert.equal((sqlite.prepare('SELECT status FROM pages WHERE id=?').get(pageId) as { status: string }).status, 'approved');
const handoff = createAutonomousHandoff(projectId, pageId);
assert.equal(handoff.reused, false);
assert.equal((handoff.payload as any).publication_authorized, true);
assert.equal((handoff.payload as any).authorization.mode, 'deterministic_autonomy_gate');
const repeated = createAutonomousHandoff(projectId, pageId);
assert.equal(repeated.reused, true);
assert.equal(autonomyPublicationUsage(projectId).newArticles, 1);

const badKeyword = await commands.keyword.create(human, { projectId, text: 'generic ai article', source: 'fixture', avgMonthly: 1000 });
const badPlan = await planningCommands.pagePlan(human, { projectId, title: 'Generic AI Article', slug: 'generic-ai-article', planMode: 'new_page', primaryKeywordId: badKeyword.id, sourceIds: [source.id] });
const badBrief = { ...brief, reader_task: 'Read generic information.', unique_value: 'Generic summary.', autonomy: { ...brief.autonomy, evidence_score: 20, commodity_risk: 5, information_gain: ['Reworded existing information'], publication_gate: { source_quality: 8, evidence: 5, originality: 3, intent_match: 10, accuracy: 10, editorial_quality: 5 } } };
sqlite.prepare('INSERT INTO blog_briefs(page_id,project_id,packet_json,packet_hash,created_at) VALUES(?,?,?,?,?)').run(badPlan.page.id, projectId, JSON.stringify(badBrief), hash(badBrief), now);
const badGate = evaluateAutonomyGate(projectId, badPlan.page.id);
assert.equal(badGate.decision, 'reject');
applyAutonomyDecision(projectId, badPlan.page.id, badGate);
assert.equal((sqlite.prepare('SELECT status FROM pages WHERE id=?').get(badPlan.page.id) as { status: string }).status, 'archived');

sqlite.close();
console.log(JSON.stringify({ ok: true, pageId, handoffId: (handoff.payload as any).handoff_id, gateScore: gate.score, rejectedPageId: badPlan.page.id }));
