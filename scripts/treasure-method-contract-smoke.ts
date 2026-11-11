/**
 * The discovery method lives in docs/treasure-method.md; the measurements live
 * in packages/research. This smoke keeps them from drifting apart.
 *
 * It fails when:
 *  - the doc has no version, or the version has no changelog row,
 *  - an invariant ID was removed from the doc,
 *  - the code stopped returning a field the doc tells agents to read,
 *  - the run-recording obligation (methodVersion) disappeared from the doc.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { analyzeSerp, classifyQueryPurchaseIntent } from '../packages/research/src/index.js';

const doc = readFileSync('docs/treasure-method.md', 'utf8');

const versionMatch = doc.match(/METHOD VERSION: (tsk-v\d+)/);
assert.ok(versionMatch, 'docs/treasure-method.md must declare METHOD VERSION: tsk-vN');
const version = versionMatch![1];
assert.ok(new RegExp(`\\| ${version} \\|`).test(doc), `changelog has no row for ${version}; bumping the version without writing why is how the method regresses`);

const INVARIANTS = ['I1', 'I2', 'I3', 'I4', 'I5', 'I6', 'I7', 'I8', 'I9', 'I10', 'I11', 'I12', 'I13'];
for (const invariant of INVARIANTS) {
  assert.ok(doc.includes(`**${invariant}**`), `invariant ${invariant} is missing from the method document`);
}

assert.ok(doc.includes('methodVersion'), 'the doc must keep the run-recording obligation (methodVersion in evidence)');

// This document is the canonical body of the method. The fixed points of the
// exploration (outcome, active version, hypotheses, constraints, runs) live in
// the My Portal Exploration Base named here. Until 2026-11-11 the doc, a Pack
// and a chat skill each named another as canonical, so nobody held the method.
const baseMatch = doc.match(/EXPLORATION BASE: my-portal exploration_base `([a-z0-9-]+)`/);
assert.ok(baseMatch, 'the doc must name the My Portal Exploration Base that tracks this method (EXPLORATION BASE: my-portal exploration_base `<id>`)');
assert.equal(baseMatch![1], 'treasure-keyword-note', 'the Exploration Base id changed; update the smoke and the base together');
assert.ok(/CANONICAL: この文書/.test(doc), 'the doc must state that it is the canonical body of the method');
assert.ok(!/CANONICAL: my-portal intelligence_pack/.test(doc), 'the Pack no longer holds the procedure; do not name it as canonical');

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

console.log(`treasure method contract smoke ok (${version}, ${INVARIANTS.length} invariants, ${Object.keys(analysis).length} analysis fields)`);
