import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const root=path.resolve(import.meta.dirname,'..');
const cli=path.join(root,'scripts/seo-article-lab.mjs');
const cases=fs.readdirSync(path.join(root,'data/seo-article-lab/cases')).filter(x=>x.endsWith('.json')).flatMap(x=>JSON.parse(fs.readFileSync(path.join(root,'data/seo-article-lab/cases',x),'utf8')).cases);
const train=cases.find(c=>c.split==='train');
const holdout=cases.find(c=>c.split==='holdout');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'seo-article-lab-'));
function run(...args){return spawnSync(process.execPath,[cli,...args],{encoding:'utf8',env:{...process.env,SEO_LAB_RESULTS_DIR:temp}})}
try {
  const valid=run('validate'); assert.equal(valid.status,0,valid.stderr);
  const prompt=run('prepare',train.id);assert.equal(prompt.status,0,prompt.stderr);
  assert(prompt.stdout.includes(train.A.body) && prompt.stdout.includes(train.B.body));
  assert(!prompt.stdout.includes('Crawled - currently not indexed'));
  const pred={winner:'insufficient',confidence:'low',evidence:[{side:'A',quote:train.A.body.slice(0,30),reason:'This excerpt requires primary-source verification.'},{side:'B',quote:train.B.body.slice(0,30),reason:'This excerpt requires independent editorial verification.'}],counterargument:'Either article may be better for its actual reader intent.',proposedArtifact:'Build an official-source decision table validated by a human editor.',missingEvidence:'Reader utility labels from independent reviewers are absent.'};
  const predictionFile=path.join(temp,'prediction.json');fs.writeFileSync(predictionFile,JSON.stringify(pred));
  const submitted=run('submit',train.id,predictionFile);assert.equal(submitted.status,0,submitted.stderr);
  assert.notEqual(run('submit',train.id,predictionFile).status,0,'Duplicate submission was allowed');
  assert.equal(run('reveal',train.id).status,0);
  assert.notEqual(run('reveal',holdout.id).status,0,'Unsealed holdout was revealed');
  const changed={...pred,evidence:[{side:'A',quote:'fabricated source citation',reason:'completely fabricated passage'},{side:'B',quote:train.B.body.slice(0,30),reason:'A valid but insufficient sentence from B.'}]};fs.writeFileSync(predictionFile,JSON.stringify(changed));
  assert.notEqual(run('submit',holdout.id,predictionFile).status,0,'Fabricated quote passed');
  console.log('seo-article-lab smoke: corpus, no-label prompt, immutable submission, citation integrity and holdout seal passed');
} finally {fs.rmSync(temp,{recursive:true,force:true})}
