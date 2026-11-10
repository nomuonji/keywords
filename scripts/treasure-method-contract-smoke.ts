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

for (const invariant of ['I1', 'I2', 'I3', 'I4', 'I5', 'I6', 'I7']) {
  assert.ok(doc.includes(`**${invariant}**`), `invariant ${invariant} is missing from the method document`);
}

assert.ok(doc.includes('methodVersion'), 'the doc must keep the run-recording obligation (methodVersion in evidence)');

// The narrative canonical lives in My Portal; this file is the CI mirror. The
// pointer keeps the two from diverging silently: bumping the Pack without
// updating the mirror (or the reverse) leaves a version nobody checked.
const canonicalMatch = doc.match(/CANONICAL: my-portal intelligence_pack `([a-z0-9-]+)` v(\d+)/);
assert.ok(canonicalMatch, 'the doc must name the canonical My Portal Pack and its version (CANONICAL: my-portal intelligence_pack `<id>` vN)');
assert.equal(canonicalMatch![1], 'treasure-keyword-intelligence', 'the canonical Pack id changed; update the smoke and the skill together');

const analysis = analyzeSerp({
  query: '試験 費用 相場',
  provider: 'brave',
  fetchedAt: new Date().toISOString(),
  results: [{ position: 1, title: '試験の費用相場', link: 'https://example.jp/', domain: 'example.jp', snippet: '試験の費用' }]
} as any) as unknown as Record<string, unknown>;

for (const field of ['competitionLevel', 'coreCoverage', 'toolPageCount', 'toolGap', 'answerGap', 'termCoverage', 'purchaseSurfaceShare', 'buyerProximity', 'editorialSlot', 'composition']) {
  assert.ok(field in analysis, `analyzeSerp no longer returns "${field}", which the method tells agents to read`);
}

const shape = classifyQueryPurchaseIntent('解体 費用 相場');
assert.ok(['transaction', 'comparison', 'evaluation', 'informational', 'neutral'].includes(shape.intent), 'purchase intent must stay one of the documented classes');
assert.ok(shape.purchaseIntentScore >= 0 && shape.purchaseIntentScore <= 100, 'purchaseIntentScore must stay 0-100');

console.log(`treasure method contract smoke ok (${version}, 7 invariants, ${Object.keys(analysis).length} analysis fields)`);
