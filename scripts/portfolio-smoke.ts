import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const dir = mkdtempSync(join(tmpdir(), 'keywords-portfolio-'));
process.env.KEYWORDS_DB_PATH = join(dir, 'test.sqlite');
process.env.KEYWORDS_ANALYTICS_FILE = join(dir, 'snapshot.json');
const { commands } = await import('@keywords/commands');
const { portfolioCommands } = await import('@keywords/commands/portfolio');
const { databaseDiagnostics } = await import('@keywords/db');
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
fixture.period.previousEnd = end; save(); result = await portfolioCommands.context();
assert.equal(result.comparable, false); assert.equal(result.sites[0].clickChange, null);
fixture.generatedAt = '2001-01-01T00:00:00Z'; save(); result = await portfolioCommands.context(); assert.equal(result.stale, true);
writeFileSync(process.env.KEYWORDS_ANALYTICS_FILE!, '{}'); assert.equal((await portfolioCommands.context()).status, 'unavailable');
process.env.KEYWORDS_ANALYTICS_FILE = join(dir, 'missing.json'); assert.equal((await portfolioCommands.context()).status, 'unavailable');
const originalPath = databaseDiagnostics().path; process.chdir(tmpdir()); assert.equal(databaseDiagnostics().path, originalPath);
console.log(JSON.stringify({ passed: true, checks: ['exact host matching', 'shared tasks', 'zero vs missing', 'upstream error redaction', 'period compatibility', 'staleness', 'invalid/missing file', 'cwd independence'], database: originalPath }));
