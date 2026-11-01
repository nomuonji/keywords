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

  check(seed.provenance?.source === 'my-portal', `${at}: provenance.source records where the model was migrated from`);
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
