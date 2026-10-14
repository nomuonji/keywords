#!/usr/bin/env node
// Evidence-first blind comparison lab. Node 22+, no network or DB writes.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const root = path.resolve(import.meta.dirname, '..');
const corpusDir = path.join(root, 'data/seo-article-lab/cases');
const keyDir = path.join(root, 'data/seo-article-lab/outcomes');
const resultsDir = process.env.SEO_LAB_RESULTS_DIR
  ? path.resolve(process.env.SEO_LAB_RESULTS_DIR)
  : path.join(root, '.seo-article-lab-results');
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const sha = (value) => crypto.createHash('sha256').update(value).digest('hex');
const fail = (message) => { throw new Error(message); };
const readBatches = (dir) => fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort().map(f => readJson(path.join(dir,f)));
const getCases = () => readBatches(corpusDir).flatMap(batch => batch.cases);
const getOutcomes = () => Object.assign({},...readBatches(keyDir).map(batch=>batch.outcomes));
const byId = (id) => getCases().find((c) => c.id === id) ?? fail(`Unknown case ${id}`);
const submissionFile = (id) => path.join(resultsDir, `${id}.json`);
const excerpt = (s, n = 150) => String(s || '').replace(/\s+/g, ' ').slice(0, n);

function validate() {
  const cases = getCases();
  const keys = getOutcomes();
  if (!Array.isArray(cases) || !cases.length) fail('Case corpus is empty');
  const ids = new Set();
  const groups = new Map();
  for (const item of cases) {
    if (!/^[a-z0-9-]{5,100}$/.test(item.id) || ids.has(item.id)) fail(`Duplicate/invalid case ID: ${item.id}`);
    ids.add(item.id);
    if (!['train', 'holdout'].includes(item.split)) fail(`${item.id}: invalid split`);
    if (!item.question || !item.readerJob) fail(`${item.id}: missing user question/job`);
    for (const side of ['A', 'B']) {
      const a = item[side];
      if (!a || !a.title || !a.query || !a.body || a.body.trim().length < 700) fail(`${item.id} ${side}: short/absent source body`);
      if (!a.source?.url?.startsWith('https://') || !a.source.path || !/^[a-f0-9]{40}$/.test(a.source.blobSha)) fail(`${item.id} ${side}: missing frozen source provenance`);
      // A document may appear across training cases, but never cross the holdout boundary.
      const prior = groups.get(a.source.url);
      if (prior && prior !== item.split) fail(`${item.id}: train/holdout source leakage: ${a.source.url}`);
      groups.set(a.source.url, item.split);
    }
    if (!Array.isArray(item.checks) || !item.checks.length) fail(`${item.id}: no reader-facing checks`);
    const label = keys[item.id];
    if (!label || !['A', 'B', 'none'].includes(label.indexedSide) || !label.observedAt) fail(`${item.id}: missing observed outcome`);
    if (!label.A?.state || !label.B?.state || !label.A?.lastCrawl || !label.B?.lastCrawl) fail(`${item.id}: missing complete crawl provenance`);
    if (!['verified_same_revision', 'unverified_revision'].includes(label.comparisonValidity)) fail(`${item.id}: missing temporal comparability qualifier`);
  }
  const orphan = Object.keys(keys).filter(id => !ids.has(id));
  if (orphan.length) fail(`Orphan answer keys: ${orphan.join(', ')}`);
  return {cases: cases.length, train: cases.filter(c=>c.split==='train').length, holdout: cases.filter(c=>c.split==='holdout').length};
}

function prompt(id) {
  const c = byId(id);
  // Key never loaded into the prompt path. The source URL is deliberately withheld here.
  const blocks = [
    `# SEO editorial blind comparison: ${c.id}`,
    `Split: ${c.split}. Outcome labels, URLs, crawl times, and rankings are intentionally withheld.`,
    `Reader task: ${c.readerJob}`,
    `Question: ${c.question}`,
    'Evaluate what each article *actually* answers for its own query. Do not guess Google algorithm internals.',
    'Pick the better evidenced, more useful answer only if the provided text supports a comparison. Equal/insufficient are valid.',
    'Quote verifiable passages from A and B. Identify specific shortcomings, counterevidence and a concrete editorial artifact to improve the weaker option.',
    `Acceptance checks: ${c.checks.join('; ')}`,
  ];
  for (const side of ['A','B']) {
    blocks.push(`\n## Article ${side}\nTarget query: ${c[side].query}\nTitle: ${c[side].title}\n\n${c[side].body}`);
  }
  blocks.push('\n## Submit prediction\nCreate a JSON file following docs/seo-article-learning.md, then run `node scripts/seo-article-lab.mjs submit ' + c.id + ' prediction.json`. Do not inspect the answer keys before submitting.');
  return blocks.join('\n');
}

function submit(id, file) {
  const c = byId(id);
  if (!file) fail('Provide a prediction JSON file');
  const pred = readJson(path.resolve(file));
  if (!['A','B','tie','insufficient'].includes(pred.winner)) fail('winner must be A/B/tie/insufficient');
  if (!['low','medium','high'].includes(pred.confidence)) fail('confidence must be low/medium/high');
  if (!Array.isArray(pred.evidence) || pred.evidence.length < 2) fail('Provide evidence for BOTH sides');
  for (const side of ['A','B']) {
    if (!pred.evidence.some(e => e.side === side && typeof e.quote==='string' && e.quote.length>=12 && c[side].body.includes(e.quote) && typeof e.reason==='string' && e.reason.trim().length>=12)) fail(`Missing verifiable quoted evidence for ${side}`);
  }
  if (typeof pred.counterargument!=='string' || pred.counterargument.trim().length<20) fail('Give a serious counterargument');
  if (typeof pred.proposedArtifact!=='string' || pred.proposedArtifact.trim().length<20) fail('Propose a specific useful artifact');
  if (typeof pred.missingEvidence!=='string' || pred.missingEvidence.trim().length<10) fail('State the evidence limitation');
  fs.mkdirSync(resultsDir, {recursive:true});
  const record = {caseId:id, split:c.split, caseHash:sha(JSON.stringify(c)), prediction:pred, sealedAt:new Date().toISOString()};
  record.seal = sha(JSON.stringify(record));
  fs.writeFileSync(submissionFile(id),JSON.stringify(record,null,2)+'\n',{flag:'wx'}); // immutable until explicitly removed by human
  console.log(JSON.stringify({saved:submissionFile(id),seal:record.seal,split:c.split,canReveal:c.split==='train'},null,2));
}

function readSealed(id) {
  const file = submissionFile(id);
  if (!fs.existsSync(file)) fail(`${id}: prediction not submitted`);
  const s = readJson(file);
  const {seal,...rest}=s;
  if (seal!==sha(JSON.stringify(rest))) fail(`${id}: prediction seal mismatch`);
  if (s.caseHash!==sha(JSON.stringify(byId(id)))) fail(`${id}: case changed since prediction`);
  return s;
}
function reveal(id) {
  const c=byId(id);
  const pred=readSealed(id);
  if (c.split==='holdout') {
    const holdout=getCases().filter(c=>c.split==='holdout');
    if (holdout.length<10 || holdout.some(c=>!fs.existsSync(submissionFile(c.id)))) fail('Holdout labels remain closed until 10+ frozen cases are submitted.');
    for (const item of holdout) readSealed(item.id);
  }
  const out=getOutcomes()[id];
  console.log(JSON.stringify({id,split:c.split,prediction:pred.prediction.winner,observedIndexedSide:out.indexedSide,observedAt:out.observedAt,states:{A:out.A,B:out.B},temporalValidity:out.comparisonValidity,caveat:'Indexing is NOT an editorial-quality ground truth; this is outcome alignment only, not a ranking/indexing skill score.'},null,2));
}
function report() {
  const cases=getCases();
  const counts={train:{ready:0,submitted:0},holdout:{ready:0,submitted:0}};
  for(const c of cases){counts[c.split].ready++;if(fs.existsSync(submissionFile(c.id))){readSealed(c.id);counts[c.split].submitted++}}
  const holdoutLocked=counts.holdout.ready<10||counts.holdout.submitted!==counts.holdout.ready;
  // Do not surface labels in report; keep prediction and outcome analysis separate.
  console.log(JSON.stringify({counts,holdoutLocked,target:{train:30,holdout:10,pilots:3},pilotsStarted:0,limit:'No outcome-derived editorial accuracy is asserted; independent editor labels and mature search observations are required.'},null,2));
}
function help() {
  console.log('Usage: node scripts/seo-article-lab.mjs validate | list | prepare ID | submit ID prediction.json | reveal ID | report');
}
try {
  const [cmd,arg1,arg2]=process.argv.slice(2);
  if (cmd==='validate') console.log(JSON.stringify(validate(),null,2));
  else if (cmd==='list') console.log(JSON.stringify(getCases().map(c=>({id:c.id,split:c.split,question:excerpt(c.question,100)})),null,2));
  else if (cmd==='prepare') console.log(prompt(arg1));
  else if (cmd==='submit') submit(arg1,arg2);
  else if (cmd==='reveal') reveal(arg1);
  else if (cmd==='report') report();
  else help();
} catch(e) {console.error('SEO article lab:',e.message);process.exitCode=1}
