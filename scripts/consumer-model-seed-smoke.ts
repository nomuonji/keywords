/**
 * Consumer-model seed regression.
 *
 * The seed files are the frozen migration record of the market-research premise.
 * This checks shape and the evidence vocabulary only; it does not contact Firestore
 * and does not prove that the imported model is a valid research instrument.
 */
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const DIR = 'consumer-models';
const REQUIRED_LABELS = ['OBSERVED', 'REPORTED', 'INFERRED', 'HYPOTHESIS', 'COUNTEREVIDENCE', 'UNKNOWN'];
const failures: string[] = [];
const check = (ok: unknown, message: string) => { if (!ok) failures.push(message); };
/** Same normalisation as the command: Google Ads echoes queries back with different spacing. */
const searchKey = (keyword: string) => String(keyword).replace(/\s+/g, '').toLowerCase();

const files = (await readdir(DIR)).filter(name => name.endsWith('.json'));
check(files.length > 0, 'no consumer model seed files found');

for (const file of files) {
  const path = join(DIR, file);
  const seed = JSON.parse(await readFile(path, 'utf8'));
  const at = `${file}`;

  check(/^[a-z0-9][a-z0-9-]{1,63}$/.test(seed.id ?? ''), `${at}: id must be a lowercase slug`);
  check(/^[0-9]+(\.[0-9]+){0,2}$/.test(seed.version ?? ''), `${at}: version must look like 1.0`);
  check(['active', 'paused', 'archived'].includes(seed.status), `${at}: status must be active/paused/archived`);
  check(seed.role === 'market_research_premise', `${at}: role must be market_research_premise`);
  check(typeof seed.summary === 'string' && seed.summary.length >= 40, `${at}: summary is too short to state the premise`);
  check(typeof seed.definition?.model === 'string' && seed.definition.model.length > 0, `${at}: definition.model is required`);
  check(typeof seed.definition?.targeting === 'string' && seed.definition.targeting.length > 0, `${at}: definition.targeting is required`);

  check(Array.isArray(seed.variables) && seed.variables.length > 0, `${at}: at least one behaviour variable is required`);
  for (const variable of seed.variables ?? []) {
    check(typeof variable.key === 'string' && variable.key.length > 0, `${at}: variable.key is required`);
    check(typeof variable.label === 'string' && variable.label.length > 0, `${at}: variable ${variable.key} needs a label`);
    check(typeof variable.observable === 'string' && variable.observable.length > 0, `${at}: variable ${variable.key} needs an observable question`);
  }

  check(Array.isArray(seed.researchProcedure) && seed.researchProcedure.length > 0, `${at}: researchProcedure is required`);
  check(Array.isArray(seed.antiPatterns) && seed.antiPatterns.length > 0, `${at}: antiPatterns are required`);

  const labels = seed.evidencePolicy?.labels ?? [];
  for (const label of REQUIRED_LABELS) check(labels.includes(label), `${at}: evidencePolicy.labels is missing ${label}`);
  check((seed.evidencePolicy?.nonEvidence ?? []).length > 0, `${at}: evidencePolicy.nonEvidence is required`);
  check(typeof seed.changeGate?.rule === 'string' && seed.changeGate.rule.length > 0, `${at}: changeGate.rule is required`);
  check(seed.objectives?.reach?.length > 0 && seed.objectives?.conversion?.length > 0, `${at}: Reach and Conversion must stay separate objectives`);

  check(typeof seed.provenance?.source === 'string' && seed.provenance.source.length > 0, `${at}: provenance.source is required`);

  // Search evidence records which search box each query came from. A model whose rows are all
  // "surrounding" describes the people the persona pushes costs onto, not the buyer.
  if (seed.searchEvidence !== undefined) {
    check(Array.isArray(seed.searchEvidence) && seed.searchEvidence.length > 0, `${at}: searchEvidence must be a non-empty array when present`);
    const sides = new Set<string>();
    for (const row of seed.searchEvidence ?? []) {
      check(typeof row.keyword === 'string' && row.keyword.length > 0, `${at}: every searchEvidence row needs a keyword`);
      check(['self', 'surrounding', 'unknown'].includes(row.side), `${at}: ${row.keyword} needs side self/surrounding/unknown`);
      check(typeof row.source === 'string' && row.source.length > 0, `${at}: ${row.keyword} needs a source`);
      check(typeof row.measuredAt === 'string' && row.measuredAt.length > 0, `${at}: ${row.keyword} needs measuredAt`);
      check(row.volume === null || row.volume === undefined || typeof row.volume === 'number', `${at}: ${row.keyword} volume must be a number or null`);
      for (const bid of ['bidLowYen', 'bidHighYen']) check(row[bid] === null || row[bid] === undefined || typeof row[bid] === 'number', `${at}: ${row.keyword} ${bid} must be a number or null`);
      check(row.sideCertainty === undefined || ['clear', 'mixed'].includes(row.sideCertainty), `${at}: ${row.keyword} sideCertainty must be clear/mixed`);
      // A mixed query is typed by both sides; without the reason, its volume gets read as demand later.
      if (row.sideCertainty === 'mixed') check(typeof row.note === 'string' && row.note.length > 0, `${at}: ${row.keyword} is mixed but has no note saying who else types it`);
      sides.add(row.side);
    }
    check(sides.has('self'), `${at}: searchEvidence has no side:"self" row (a model of the surrounding party is not a consumer model)`);
    check(typeof seed.buyer?.pays === 'string' && seed.buyer.pays.length > 0, `${at}: a model with searchEvidence must state buyer.pays`);
    check(typeof seed.buyer?.doesNotPay === 'string' && seed.buyer.doesNotPay.length > 0, `${at}: a model with searchEvidence must state buyer.doesNotPay`);
  }

  const evidenceByKey = new Map<string, any>((seed.searchEvidence ?? []).map((row: any) => [searchKey(row.keyword), row]));

  // Personas are illustrations of the segment, never real people. They exist to make recall
  // concrete, so a persona without example queries only decorates the model.
  if (seed.personas !== undefined) {
    check(Array.isArray(seed.personas) && seed.personas.length > 0, `${at}: personas must be a non-empty array when present`);
    const personaKeys = new Set<string>();
    for (const persona of seed.personas ?? []) {
      check(/^[a-z0-9][a-z0-9-]{1,63}$/.test(persona.key ?? ''), `${at}: persona key must be a lowercase slug`);
      check(!personaKeys.has(persona.key), `${at}: duplicate persona key ${persona.key}`);
      personaKeys.add(persona.key);
      check(typeof persona.name === 'string' && persona.name.length > 0, `${at}: persona ${persona.key} needs a name`);
      check(typeof persona.oneLine === 'string' && persona.oneLine.length > 0, `${at}: persona ${persona.key} needs oneLine`);
      check(persona.isComposite === true, `${at}: persona ${persona.key} must set isComposite:true (personas are illustrations, never real people)`);
      check((persona.searchWords ?? []).length > 0, `${at}: persona ${persona.key} needs example searchWords for recall`);
      // A persona query must be measured, and must be one the persona types. An unmeasured word is
      // the author's imagination; a surrounding word turns the persona back into the victim's complaint.
      for (const word of persona.searchWords ?? []) {
        const row = evidenceByKey.get(searchKey(word));
        check(row, `${at}: persona ${persona.key} searchWord "${word}" is not in searchEvidence (unmeasured)`);
        check(!row || row.side !== 'surrounding', `${at}: persona ${persona.key} searchWord "${word}" is a surrounding-side query`);
      }
      for (const trigger of persona.triggers ?? []) {
        check(trigger.event && trigger.query && trigger.pays, `${at}: persona ${persona.key} trigger needs event, query and pays`);
      }
    }
  }

  // Voices are first-person posts from the persona side. Short verbatim quote plus URL, and a
  // reading of what the post shows. Posts against the model stay in as "contradicts".
  if (seed.voices !== undefined) {
    const personaKeys = new Set((seed.personas ?? []).map((persona: any) => persona.key));
    const urls = new Set<string>();
    for (const voice of seed.voices ?? []) {
      check(/^https?:\/\//.test(voice.url ?? ''), `${at}: voice needs an http(s) url`);
      check(!urls.has(voice.url), `${at}: duplicate voice ${voice.url}`);
      urls.add(voice.url);
      check(typeof voice.quote === 'string' && voice.quote.length > 0 && voice.quote.length <= 125, `${at}: voice ${voice.url} quote must be 1-125 chars`);
      check(typeof voice.platform === 'string' && voice.platform.length > 0, `${at}: voice ${voice.url} needs a platform`);
      check(typeof voice.observedAt === 'string' && voice.observedAt.length > 0, `${at}: voice ${voice.url} needs observedAt`);
      check(['fits', 'partial', 'contradicts'].includes(voice.fit), `${at}: voice ${voice.url} fit must be fits/partial/contradicts`);
      check(typeof voice.reading === 'string' && voice.reading.length > 10, `${at}: voice ${voice.url} needs a reading`);
      for (const key of voice.personaKeys ?? []) check(personaKeys.has(key), `${at}: voice ${voice.url} references unknown persona ${key}`);
    }
  }
  if (seed.provenance?.source === 'my-portal') {
    check((seed.provenance?.droppedItems ?? []).length > 0, `${at}: a migrated model records what was dropped in migration`);
  }
  for (const dropped of seed.provenance?.droppedItems ?? []) {
    check(typeof dropped.item === 'string' && dropped.item.length > 0, `${at}: droppedItems entry needs an item`);
    check(typeof dropped.reason === 'string' && dropped.reason.length > 10, `${at}: droppedItems entry needs a real reason`);
  }
}

if (failures.length) {
  console.error(`consumer model seed smoke FAILED (${failures.length})`);
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}
console.log(`consumer model seed smoke OK (${files.length} seed file(s))`);

// Seed pools: material for model angles. A pool item must never claim to be evidence of demand.
const POOL_DIR = join(DIR, 'seed-pools');
const poolFiles = (await readdir(POOL_DIR)).filter(name => name.endsWith('.json'));
check(poolFiles.length > 0, 'no seed pool files found');
const poolLabels = new Set(['HYPOTHESIS', 'REPORTED', 'OBSERVED', 'UNKNOWN']);
const poolTotals: Record<string, number> = {};
for (const file of poolFiles) {
  const pool = JSON.parse(await readFile(join(POOL_DIR, file), 'utf8'));
  const at = `seed-pools/${file}`;
  check(/^[a-z0-9][a-z0-9-]{1,63}$/.test(pool.poolId ?? ''), `${at}: poolId must be a lowercase slug`);
  check(poolLabels.has(pool.label), `${at}: pool label must be one of ${[...poolLabels].join('/')}`);
  check(Array.isArray(pool.items) && pool.items.length > 0, `${at}: items are required`);
  const seen = new Set<string>();
  for (const item of pool.items ?? []) {
    check(typeof item.text === 'string' && item.text.trim().length > 0, `${at}: every item needs text`);
    check(!seen.has(item.text.trim().toLowerCase()), `${at}: duplicate item text ${item.text}`);
    seen.add(String(item.text).trim().toLowerCase());
    check(!item.label || poolLabels.has(item.label), `${at}: ${item.text} has an unknown label`);
    if (pool.label === 'HYPOTHESIS') check(!item.sourceRef, `${at}: ${item.text} is a hypothesis but cites a source`);
    if (pool.label !== 'HYPOTHESIS') check(typeof item.sourceRef === 'string' && item.sourceRef.length > 0, `${at}: reported item ${item.text} needs a sourceRef`);
  }
  poolTotals[pool.poolId] = (poolTotals[pool.poolId] ?? 0) + pool.items.length;
}

if (failures.length) {
  console.error(`consumer seed pool smoke FAILED (${failures.length})`);
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}
console.log(`consumer seed pool smoke OK (${poolFiles.length} file(s): ${Object.entries(poolTotals).map(([pool, total]) => `${pool}=${total}`).join(', ')})`);
