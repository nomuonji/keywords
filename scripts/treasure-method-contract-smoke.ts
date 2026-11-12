/**
 * Since tsk-v26 the method text lives in the My Portal Exploration Base; this repo
 * keeps only the code it depends on. This smoke keeps the pointer doc honest and
 * the measurement code returning what the method tells agents to read.
 *
 * It fails when:
 *  - docs/treasure-method.md stops naming the Exploration Base, or claims the method
 *    text lives here again (two copies drifted apart before 2026-11-11),
 *  - the run-recording obligation (methodVersion) disappeared,
 *  - the code stopped returning a field agents read.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { analyzeSerp, classifyQueryPurchaseIntent } from '../packages/research/src/index.js';

const doc = readFileSync('docs/treasure-method.md', 'utf8');

const baseMatch = doc.match(/EXPLORATION BASE: my-portal exploration_base `([a-z0-9-]+)`/);
assert.ok(baseMatch, 'the doc must name the My Portal Exploration Base that holds the method (EXPLORATION BASE: my-portal exploration_base `<id>`)');
assert.equal(baseMatch![1], 'treasure-keyword-note', 'the Exploration Base id changed; update the smoke and the base together');
assert.ok(/CANONICAL: My Portal の探索拠点/.test(doc), 'the doc must say the method text lives in the My Portal Exploration Base');
assert.ok(!/CANONICAL: この文書/.test(doc), 'the method text moved to My Portal in tsk-v26; do not make this doc canonical again');
assert.ok(!/\*\*C\d\*\*|\*\*I\d+\*\*/.test(doc), 'criteria and invariants belong to the method text in My Portal, not to this pointer doc');
assert.ok(doc.includes('methodVersion'), 'the doc must keep the run-recording obligation (methodVersion in evidence)');

const analysis = analyzeSerp({
  query: '隧ｦ鬨・雋ｻ逕ｨ 逶ｸ蝣ｴ',
  provider: 'brave',
  fetchedAt: new Date().toISOString(),
  results: [{ position: 1, title: '隧ｦ鬨薙・雋ｻ逕ｨ逶ｸ蝣ｴ', link: 'https://example.jp/', domain: 'example.jp', snippet: '隧ｦ鬨薙・雋ｻ逕ｨ' }]
} as any) as unknown as Record<string, unknown>;

for (const field of ['competitionLevel', 'coreCoverage', 'toolPageCount', 'toolGap', 'answerGap', 'termCoverage', 'purchaseSurfaceShare', 'buyerProximity', 'editorialSlot', 'composition']) {
  assert.ok(field in analysis, `analyzeSerp no longer returns "${field}", which the method tells agents to read`);
}

const shape = classifyQueryPurchaseIntent('隗｣菴・雋ｻ逕ｨ 逶ｸ蝣ｴ');
assert.ok(['transaction', 'comparison', 'evaluation', 'informational', 'neutral'].includes(shape.intent), 'purchase intent must stay one of the documented classes');
assert.ok(shape.purchaseIntentScore >= 0 && shape.purchaseIntentScore <= 100, 'purchaseIntentScore must stay 0-100');

console.log(`treasure method contract smoke ok (pointer to ${baseMatch![1]}, ${Object.keys(analysis).length} analysis fields)`);
