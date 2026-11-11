// 台帳の整合性チェック（探索法錬成システムの第3層＝批判層の入口）
//
// 3つの台帳と docs/treasure-method.md が食い違ったら落ちる。
//   docs/method/versions.json  方法論バージョン
//   docs/method/criteria.json  合格条件
//   docs/method/patterns.json  勝ちパターン
//
// 使い方: npx tsx scripts/treasure-registry-smoke.ts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// Ledgers saved by Windows editors may start with a BOM, which JSON.parse rejects.
const read = (p: string) => JSON.parse(readFileSync(join(root, p), 'utf8').replace(/^\uFEFF/, ''));
const doc = readFileSync(join(root, 'docs/treasure-method.md'), 'utf8');

const versions = read('docs/method/versions.json').versions as any[];
const criteria = read('docs/method/criteria.json').criteria as any[];
const patterns = read('docs/method/patterns.json').patterns as any[];

let checks = 0;
function ok(cond: boolean, label: string) {
  assert.ok(cond, label);
  checks++;
}

// ---- 方法論バージョン ----
ok(versions.length > 0, 'versions: 空でない');
const seen = new Set<string>();
for (const v of versions) {
  ok(typeof v.version === 'string' && /^tsk-v\d+$/.test(v.version), `versions: 形式 ${v.version}`);
  ok(!seen.has(v.version), `versions: 重複なし ${v.version}`);
  seen.add(v.version);
  ok(typeof v.rationale === 'string' && v.rationale.length >= 20, `versions: rationale ${v.version}`);
  ok(Array.isArray(v.criteriaAdded) && Array.isArray(v.invariantsAdded), `versions: 追加項目が配列 ${v.version}`);
  // doc の changelog に1行あること
  ok(doc.includes(`| ${v.version} |`), `versions: doc の changelog に行がある ${v.version}`);
}
const docVersion = /METHOD VERSION: (tsk-v\d+)/.exec(doc)?.[1];
ok(docVersion === versions[versions.length - 1].version, `versions: doc の最新 = 台帳の最新 (${docVersion})`);

// ---- 合格条件 ----
const ids = criteria.map((c) => c.id);
ok(ids.join(',') === 'C1,C2,C3,C4,C5,C6', `criteria: C1-C6 が揃う (${ids.join(',')})`);
for (const c of criteria) {
  ok(criteria.filter((x) => x.id === c.id).length === 1, `criteria: id 一意 ${c.id}`);
  for (const field of ['name', 'threshold', 'method', 'counterexample', 'addedIn']) {
    ok(typeof c[field] === 'string' && c[field].length > 0, `criteria: ${c.id} に ${field}`);
  }
  ok(doc.includes(`**${c.id}**`), `criteria: doc に ${c.id} がある`);
  ok(versions.some((v) => v.version === c.addedIn), `criteria: ${c.id} の addedIn が台帳にある`);
  ok(versions.some((v) => (v.criteriaAdded || []).includes(c.id)), `criteria: ${c.id} が versions の criteriaAdded にある`);
}

// ---- 勝ちパターン ----
const pids = new Set<string>();
for (const p of patterns) {
  ok(/^[PH]\d+$/.test(p.id), `patterns: id 形式 ${p.id}`);
  ok(!pids.has(p.id), `patterns: id 一意 ${p.id}`);
  pids.add(p.id);
  ok(['verified', 'candidate', 'rejected'].includes(p.status), `patterns: status ${p.id}`);
  ok(typeof p.mechanism === 'string' && p.mechanism.length > 10, `patterns: mechanism ${p.id}`);
  if (p.status === 'verified') {
    ok(Array.isArray(p.evidence) && p.evidence.length >= 1, `patterns: verified は evidence 必須 ${p.id}`);
    for (const e of p.evidence) {
      ok(typeof e.ref === 'string' && e.ref.length > 3, `patterns: evidence.ref ${p.id}`);
      ok(typeof e.source === 'string' && e.source.length > 2, `patterns: evidence.source ${p.id}`);
      ok(/^\d{4}-\d{2}-\d{2}$/.test(e.date), `patterns: evidence.date ${p.id}`);
    }
    ok(typeof p.verifiedAt === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p.verifiedAt), `patterns: verifiedAt ${p.id}`);
    ok(Array.isArray(p.limitation) || typeof p.limitation === 'string', `patterns: limitation ${p.id}`);
  }
  if (p.status === 'rejected') {
    ok(typeof p.reason === 'string' && p.reason.length >= 10, `patterns: rejected は reason 必須 ${p.id}`);
    ok(typeof p.rejectedAt === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p.rejectedAt), `patterns: rejectedAt ${p.id}`);
  }
}
// 検証済みパターンは docs の不変条件か本文に現れること（台帳と説明の乖離を防ぐ）
for (const p of patterns.filter((x) => x.status === 'verified')) {
  const inDoc = doc.includes(p.id) || doc.includes(p.name);
  ok(inDoc, `patterns: verified ${p.id} が docs に現れる`);
}

// ---- 不変条件と台帳の相互参照 ----
const invariants = [...doc.matchAll(/^\| \*\*(I\d+)\*\* \|/gm)].map((m) => m[1]);
ok(invariants.length >= 13, `doc: 不変条件13件以上 (${invariants.length})`);
for (const v of versions) {
  for (const i of v.invariantsAdded || []) {
    ok(invariants.includes(i), `versions: 追加した不変条件が doc にある ${v.version} ${i}`);
  }
}

console.log(
  `treasure registry smoke ok (${checks} checks, ${versions.length} versions, ${criteria.length} criteria, ${patterns.length} patterns)`
);
