import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const dir = mkdtempSync(join(tmpdir(), 'keywords-portfolio-'));
process.env.KEYWORDS_DB_PATH = join(dir, 'test.sqlite');
process.env.KEYWORDS_ANALYTICS_FILE = join(dir, 'snapshot.json');
const { commands } = await import('@keywords/commands');
const { portfolioCommands } = await import('@keywords/commands/portfolio');
const { databaseDiagnostics, getDatabase } = await import('@keywords/db');
const human = { actor: 'human' as const };
const project = await commands.project.create(human, { name: 'Portfolio fixture', domain: 'fixture.example' });
await commands.project.create(human, { name: 'Other subdomain', domain: 'other.fixture.example' });
await commands.task.create(human, { projectId: project.id, title: 'Existing work' });
const end = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10);
const day = (offset: number) => new Date(Date.parse(end) - offset * 86400000).toISOString().slice(0, 10);
const fixture = { generatedAt: new Date().toISOString(), period: { start: day(27), end, previousStart: day(55), previousEnd: day(28) }, sites: [
  { name: 'fixture', host: 'fixture.example', gsc: { current: { total: { clicks: 5, impressions: 100 } }, previous: { total: { clicks: 20 } } }, ga4: { current: { total: { sessions: 0 } }, previous: { total: { sessions: 40 } } } },
  { name: 'missing', host: 'missing.example', error: 'Secret upstream error should not escape', gsc: { current: { total: { clicks: 999 } } } }
] };
const save = () => writeFileSync(process.env.KEYWORDS_ANALYTICS_FILE!, JSON.stringify(fixture));
save();
let result = await portfolioCommands.context();
assert.equal(result.sites[0].projects.length, 1); assert.equal(result.sites[0].projects[0].id, project.id);
assert.equal(result.sites[0].clickChange, -75); assert.equal(result.sites[0].sessionChange, -100);
assert.equal(result.sites[0].openTasks, 1); assert.equal(result.sites[1].clickChange, null);
assert.ok(!JSON.stringify(result).includes('Secret upstream'));

// The human UI must be able to browse large article sets without loading every record.
const keyword = await commands.keyword.create(human, { projectId: project.id, text: 'scalable article index', source: 'fixture', avgMonthly: 320 });
const page = await commands.page.propose(human, { projectId: project.id, title: 'Scalable Article Index', slug: 'scalable-article-index' });
const { sqlite } = getDatabase();
const t = new Date().toISOString();
sqlite.prepare('INSERT INTO page_keywords(page_id,keyword_id,role) VALUES(?,?,?)').run(page.id, keyword.id, 'primary');
sqlite.prepare('INSERT INTO discovery_jobs(id,project_id,seed_keywords_json,goal,language,country,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run('portfolio-job', project.id, JSON.stringify(['scalable']), 'find scalable content', 'en', 'us', 'completed', t, t);
sqlite.prepare('INSERT INTO discovery_candidates(id,project_id,job_id,keyword_id,keyword,normalized,status,demand_value,language,country,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run('portfolio-candidate', project.id, 'portfolio-job', keyword.id, keyword.text, keyword.text, 'shortlisted', 320, 'en', 'us', t, t);
sqlite.prepare('INSERT INTO decisions(id,project_id,actor,action,target_type,target_id,verdict,reason,metadata_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run('portfolio-decision', project.id, 'agent', 'operation.candidate_triage', 'discovery_candidate', 'portfolio-candidate', 'shortlisted', 'Strong demand with no overlapping article.', '{}', t);
sqlite.prepare(`INSERT INTO operation_artifacts(id,operation_id,project_id,page_id,article_id,artifact_path,content_sha256,source_ids_json,validator_version,validator_status,build_status,manifest_json,generated_at,verified_at,updated_at)
  VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run('portfolio-artifact', 'portfolio-operation', project.id, page.id, page.id, 'content/scalable-article-index.md', 'a'.repeat(64), JSON.stringify(['source-1']), 'fixture', 'passed', 'passed', '{}', t, t, t);
const index = await portfolioCommands.articleIndex({ query: 'scalable article', projectId: project.id, status: 'complete', limit: 1, offset: 0 });
assert.equal(index.total, 1); assert.equal(index.limit, 1); assert.equal(index.items.length, 1);
assert.equal(index.items[0].keyword?.text, 'scalable article index');
assert.equal(index.items[0].keyword?.selectionReason, 'Strong demand with no overlapping article.');
assert.equal(index.items[0].projectName, 'Portfolio fixture');

fixture.period.previousEnd = end; save(); result = await portfolioCommands.context();
assert.equal(result.comparable, false); assert.equal(result.sites[0].clickChange, null);
fixture.generatedAt = '2001-01-01T00:00:00Z'; save(); result = await portfolioCommands.context(); assert.equal(result.stale, true);
writeFileSync(process.env.KEYWORDS_ANALYTICS_FILE!, '{}'); assert.equal((await portfolioCommands.context()).status, 'unavailable');
process.env.KEYWORDS_ANALYTICS_FILE = join(dir, 'missing.json'); assert.equal((await portfolioCommands.context()).status, 'unavailable');
const originalPath = databaseDiagnostics().path; process.chdir(tmpdir()); assert.equal(databaseDiagnostics().path, originalPath);
console.log(JSON.stringify({ passed: true, checks: ['exact host matching', 'shared tasks', 'zero vs missing', 'upstream error redaction', 'article pagination/search', 'keyword selection reason', 'period compatibility', 'staleness', 'invalid/missing file', 'cwd independence'], database: originalPath }));
