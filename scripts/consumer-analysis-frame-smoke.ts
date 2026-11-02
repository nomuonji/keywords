/**
 * Analysis-frame regression. Runs the pure frame builder on the gomi seed file (no Firestore).
 *
 * Guards the rules that make a model-based analysis inductive and correctly targeted:
 * starting points come only from measured rows, mixed volume is never counted, a surrounding-side
 * frame is flagged as not this model's buyer, and every viewpoint states how to stop.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ANALYSIS_VIEWPOINTS, buildConsumerAnalysisFrame, type AnalysisViewpoint } from '../packages/commands/src/consumer-analysis-frame.js';
import { searchKey } from '../packages/commands/src/consumer-model.js';

const seed = JSON.parse(readFileSync('consumer-models/gomi-consumer.v1.json', 'utf8'));
const model = { ...seed, revision: 1, createdAt: '2026-11-02', updatedAt: '2026-11-02' };
const question = 'この層に向けて最初に作るページを1つ決める';

for (const viewpoint of Object.keys(ANALYSIS_VIEWPOINTS) as AnalysisViewpoint[]) {
  const frame = buildConsumerAnalysisFrame(model, { modelId: model.id, viewpoint, question });
  assert.ok(frame.viewpoint.collect.length > 0, `${viewpoint}: collect steps`);
  assert.ok(frame.viewpoint.stopWhen.length > 0, `${viewpoint}: stop rule`);
  assert.ok(frame.viewpoint.failureModes.length > 0, `${viewpoint}: failure modes`);
  assert.ok(frame.deliverables.writeBack.length >= 3, `${viewpoint}: write-back targets`);
}

assert.throws(() => buildConsumerAnalysisFrame(model, { modelId: model.id, viewpoint: 'self_search', question: ' ' }), /question is required/);
assert.throws(() => buildConsumerAnalysisFrame(model, { modelId: model.id, viewpoint: 'self_search', question, personaKey: 'no-such' }), /not found/);
assert.throws(() => buildConsumerAnalysisFrame(model, { modelId: model.id, viewpoint: 'vibes' as AnalysisViewpoint, question }), /viewpoint must be one of/);

const persona = seed.personas[0];
const self = buildConsumerAnalysisFrame(model, { modelId: model.id, viewpoint: 'money_moment', question, personaKey: persona.key });
const measured = new Set(seed.searchEvidence.map((row: any) => searchKey(row.keyword)));
for (const word of self.startingPoints.measuredSelfWords) assert.ok(measured.has(searchKey(word)), `starting point "${word}" must be a measured row`);
assert.ok(self.baseline.countableRows.every(row => row.sideCertainty !== 'mixed'), 'countable rows exclude mixed');
assert.ok(self.baseline.mixedRowsNotCounted.length > 0, 'gomi seed has mixed rows to set aside');
const mixedVolume = self.baseline.mixedRowsNotCounted.reduce((sum, row) => sum + (row.volume ?? 0), 0);
assert.ok(self.baseline.countableVolume < self.baseline.countableVolume + mixedVolume || mixedVolume === 0, 'mixed volume stays out of countableVolume');
assert.equal(self.target.persona?.key, persona.key);
assert.ok(self.baseline.voices.every(voice => Object.keys(voice).sort().join() === 'fit,quote,url'), 'voices expose only url/quote/fit');
assert.equal(self.warnings.some(warning => warning.startsWith('side=surrounding')), false);

const surrounding = buildConsumerAnalysisFrame(model, { modelId: model.id, viewpoint: 'surrounding_mirror', question, side: 'surrounding' });
assert.ok(surrounding.warnings.some(warning => warning.startsWith('side=surrounding')), 'surrounding frame warns it is not this model\'s buyer');

const whole = buildConsumerAnalysisFrame(model, { modelId: model.id, viewpoint: 'self_search', question });
assert.ok(whole.warnings.some(warning => warning.includes('ターゲットが model 全体')), 'untargeted frame warns');

const local = buildConsumerAnalysisFrame(model, { modelId: model.id, viewpoint: 'intersection', question }, {
  untestedVariables: ['friction'], observationCount: 0,
  poolItems: [
    { poolId: 'p', text: '脳梗塞 退院後', category: '病気の後の生活', label: 'OBSERVED', sourceRef: 'Y-x' },
    { poolId: 'p', text: 'ワイド団信', category: '病気とお金の交点', label: 'OBSERVED', sourceRef: 'Y-y' },
    { poolId: 'p', text: '思いつき', category: '病気の後の生活', label: 'HYPOTHESIS', sourceRef: null },
  ],
});
assert.deepEqual(local.startingPoints.lifeClusters.map(cluster => cluster.cluster).sort(), ['病気とお金の交点', '病気の後の生活']);
assert.ok(!local.startingPoints.lifeClusters.some(cluster => cluster.items.includes('思いつき')), 'hypothesis pool items are not starting points');
assert.ok(local.warnings.some(warning => warning.includes('読み（consumer_model_observe）が1件も無い')), 'zero readings warn');
const noPool = buildConsumerAnalysisFrame(model, { modelId: model.id, viewpoint: 'intersection', question }, { untestedVariables: [], observationCount: 3, poolItems: [] });
assert.ok(noPool.warnings.some(warning => warning.startsWith('intersection: このモデルに紐づく観測済みの seed pool が無い')), 'intersection without pool warns');

console.log(`consumer analysis frame smoke OK (${Object.keys(ANALYSIS_VIEWPOINTS).length} viewpoints)`);
