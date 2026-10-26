/**
 * One-off migration of Sites Operator data from the legacy shared Firebase
 * project ("keywords" target) to the dedicated Sites project ("sites" target).
 *
 * Phases (docs/firestore-project-split.md):
 *   inventory  read-only counts and plan, nothing is written
 *   copy       full copy before cutover; resumable, idempotent overwrite
 *   delta      after cutover: re-sync documents changed or deleted in the
 *              legacy project since the copy started, never overwriting a
 *              document that was written natively in the Sites project
 *   verify     per-collection counts (and optional full field comparison)
 *
 * The legacy project keeps its copy of the data untouched (rollback source).
 * Reads and writes are budgeted so the run can stop before exhausting the
 * free-tier daily quota and resume from its checkpoint on the next run.
 */
import { createHash } from 'node:crypto';
import { FirestoreError, SITES_FIRESTORE_COLLECTIONS, SITES_MIGRATION_STATE_PATH, firestoreDocumentNameFor, firestoreForTarget, projectIdFor, type FirestoreTarget } from '../../db/src/firestore.js';

export type Transport = (target: FirestoreTarget, path: string, init?: RequestInit) => Promise<any>;
export type MigrationUnit = { parent: string; collectionId: string };
export type MigrationMode = 'inventory' | 'copy' | 'delta' | 'verify';
export type MigrationOptions = {
  mode: MigrationMode;
  maxSourceReads?: number;
  maxTargetWrites?: number;
  restart?: boolean;
  deep?: boolean;
  transport?: Transport;
  now?: () => Date;
  log?: (line: string) => void;
};

const META_PATH = SITES_MIGRATION_STATE_PATH;
const STATE_VERSION = 1;
const BIG_DOCUMENT_COLLECTIONS = new Set(['indexationBundle', 'seoPlanningDigests', 'indexationSnapshots']);
const MAX_COMMIT_WRITES = 100;
const MAX_COMMIT_BYTES = 8 * 1024 * 1024;
const SITES_OWNED = new Set<string>(SITES_FIRESTORE_COLLECTIONS);

type StoredState = {
  version: number;
  sourceProjectId: string;
  targetProjectId: string;
  copy?: { startedAt: string; finishedAt?: string; unitIndex: number; pageToken?: string; plan: MigrationUnit[]; documentsWritten: number };
  delta?: { startedAt: string; finishedAt?: string; unitIndex: number; plan: MigrationUnit[]; created: number; updated: number; deleted: number; conflicts: string[] };
  history: Array<{ at: string; mode: MigrationMode; outcome: string; detail?: string }>;
};

export type MigrationReport = {
  mode: MigrationMode;
  outcome: 'completed' | 'paused_budget' | 'paused_quota' | 'refused';
  sourceProjectId: string;
  targetProjectId: string;
  sourceReads: number;
  targetReads: number;
  targetWrites: number;
  units?: Array<{ path: string; source?: number; target?: number; status?: string }>;
  skipped: string[];
  warnings: string[];
  conflicts: string[];
  created?: number;
  updated?: number;
  deleted?: number;
  copied?: number;
  message: string;
};

class BudgetExhausted extends Error {}

export const unitPath = (unit: MigrationUnit) => unit.parent ? `${unit.parent}/${unit.collectionId}` : unit.collectionId;
const relativeName = (name: string) => name.slice(name.indexOf('/documents/') + '/documents/'.length);

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value as object).sort().map(key => `${JSON.stringify(key)}:${canonical((value as any)[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
export const fieldsDigest = (fields: unknown) => createHash('sha256').update(canonical(fields ?? {})).digest('hex');

/** Reference values that point at Sites data in the legacy project must point at the Sites project after the move. */
function retargetReferences(input: any, sourceProject: string, targetProject: string): any {
  if (Array.isArray(input)) return input.map(item => retargetReferences(item, sourceProject, targetProject));
  if (!input || typeof input !== 'object') return input;
  if (typeof input.referenceValue === 'string') {
    const prefix = `projects/${sourceProject}/databases/(default)/documents/`;
    const ref: string = input.referenceValue;
    if (ref.startsWith(prefix) && SITES_OWNED.has(ref.slice(prefix.length).split('/')[0])) return { referenceValue: `projects/${targetProject}/databases/(default)/documents/${ref.slice(prefix.length)}` };
    return input;
  }
  return Object.fromEntries(Object.entries(input).map(([key, item]) => [key, retargetReferences(item, sourceProject, targetProject)]));
}

class Session {
  sourceReads = 0; targetReads = 0; targetWrites = 0;
  warnings: string[] = []; skipped: string[] = [];
  readonly sourceProject: string; readonly targetProject: string;
  private pending: any[] = []; private pendingBytes = 0;
  constructor(readonly transport: Transport, readonly maxSourceReads: number, readonly maxTargetWrites: number, readonly log: (line: string) => void) {
    this.sourceProject = projectIdFor('keywords');
    this.targetProject = projectIdFor('sites');
    if (this.sourceProject === this.targetProject) throw new Error(`Source and target Firebase projects are the same (${this.sourceProject}); configure SITES_FIREBASE_SERVICE_ACCOUNT_JSON for the new Sites project`);
  }
  private chargeSource(reads: number) {
    this.sourceReads += Math.max(1, reads);
    if (this.sourceReads > this.maxSourceReads) throw new BudgetExhausted(`source read budget ${this.maxSourceReads} reached`);
  }
  async source(path: string, init?: RequestInit, estimate = 1) {
    if (this.sourceReads + estimate > this.maxSourceReads) throw new BudgetExhausted(`source read budget ${this.maxSourceReads} reached`);
    const result = await this.transport('keywords', path, init);
    return result;
  }
  async listPage(target: FirestoreTarget, unit: MigrationUnit, pageToken?: string, options: { showMissing?: boolean; pageSize?: number } = {}) {
    const params = new URLSearchParams({ pageSize: String(options.pageSize ?? (BIG_DOCUMENT_COLLECTIONS.has(unit.collectionId) ? 10 : 300)) });
    if (pageToken) params.set('pageToken', pageToken);
    if (options.showMissing) params.set('showMissing', 'true');
    const path = `/${unitPath(unit)}?${params}`;
    if (target === 'keywords') {
      const result = await this.source(path);
      this.chargeSource((result.documents ?? []).length);
      return { documents: (result.documents ?? []) as any[], nextPageToken: result.nextPageToken as string | undefined };
    }
    const result = await this.transport('sites', path);
    this.targetReads += Math.max(1, (result.documents ?? []).length);
    return { documents: (result.documents ?? []) as any[], nextPageToken: result.nextPageToken as string | undefined };
  }
  async listAll(target: FirestoreTarget, unit: MigrationUnit) {
    const all: any[] = []; let token: string | undefined;
    do { const page = await this.listPage(target, unit, token); all.push(...page.documents); token = page.nextPageToken; } while (token);
    return all;
  }
  async getSource(path: string) {
    try { const doc = await this.source(`/${path}`); this.chargeSource(1); return doc; }
    catch (error) { if (error instanceof FirestoreError && error.status === 404) { this.chargeSource(1); return null; } throw error; }
  }
  async collectionIds(target: FirestoreTarget, documentPath: string) {
    const ids: string[] = []; let token: string | undefined;
    do {
      const init = { method: 'POST', body: JSON.stringify({ pageSize: 100, ...(token ? { pageToken: token } : {}) }) };
      const result = target === 'keywords' ? await this.source(`/${documentPath}:listCollectionIds`, init) : await this.transport('sites', `/${documentPath}:listCollectionIds`, init);
      if (target === 'keywords') this.chargeSource(1); else this.targetReads++;
      ids.push(...(result.collectionIds ?? []));
      token = result.nextPageToken;
    } while (token);
    return ids;
  }
  async count(target: FirestoreTarget, unit: MigrationUnit) {
    const parent = unit.parent ? `/${unit.parent}` : '';
    const init = { method: 'POST', body: JSON.stringify({ structuredAggregationQuery: { structuredQuery: { from: [{ collectionId: unit.collectionId }] }, aggregations: [{ alias: 'n', count: {} }] } }) };
    const rows = target === 'keywords' ? await this.source(`${parent}:runAggregationQuery`, init) : await this.transport('sites', `${parent}:runAggregationQuery`, init);
    const result = (Array.isArray(rows) ? rows : [rows]).find((row: any) => row?.result)?.result;
    const n = Number(result?.aggregateFields?.n?.integerValue ?? 0);
    const reads = Math.max(1, Math.ceil(n / 1000));
    if (target === 'keywords') this.chargeSource(reads); else this.targetReads += reads;
    return n;
  }
  async batchGetTarget(paths: string[]) {
    const found = new Map<string, any>();
    for (let i = 0; i < paths.length; i += 100) {
      const chunk = paths.slice(i, i + 100);
      const rows = await this.transport('sites', ':batchGet', { method: 'POST', body: JSON.stringify({ documents: chunk.map(path => firestoreDocumentNameFor('sites', path)) }) });
      this.targetReads += chunk.length;
      for (const row of Array.isArray(rows) ? rows : []) if (row.found) found.set(relativeName(row.found.name), row.found);
    }
    return found;
  }
  toTargetFields(fields: any) { return retargetReferences(fields ?? {}, this.sourceProject, this.targetProject); }
  async write(write: any) {
    const bytes = Buffer.byteLength(JSON.stringify(write));
    if (this.pending.length && (this.pending.length >= MAX_COMMIT_WRITES || this.pendingBytes + bytes > MAX_COMMIT_BYTES)) await this.flush();
    if (this.targetWrites + this.pending.length + 1 > this.maxTargetWrites) { await this.flush(); throw new BudgetExhausted(`target write budget ${this.maxTargetWrites} reached`); }
    this.pending.push(write); this.pendingBytes += bytes;
  }
  async flush() {
    if (!this.pending.length) return;
    const writes = this.pending; this.pending = []; this.pendingBytes = 0;
    await this.transport('sites', ':commit', { method: 'POST', body: JSON.stringify({ writes }) });
    this.targetWrites += writes.length;
  }
  discard() { this.pending = []; this.pendingBytes = 0; }
}

async function loadState(session: Session): Promise<{ state: StoredState; updateTime?: string }> {
  try {
    const doc = await session.transport('sites', `/${META_PATH}`);
    session.targetReads++;
    const state = JSON.parse(doc.fields?.state?.stringValue ?? '{}') as StoredState;
    if (state.version !== STATE_VERSION) throw new Error(`Unsupported migration state version ${state.version}`);
    if (state.sourceProjectId !== session.sourceProject || state.targetProjectId !== session.targetProject) throw new Error(`Migration state belongs to ${state.sourceProjectId} -> ${state.targetProjectId}, not ${session.sourceProject} -> ${session.targetProject}`);
    return { state, updateTime: doc.updateTime };
  } catch (error) {
    if (error instanceof FirestoreError && error.status === 404) { session.targetReads++; return { state: { version: STATE_VERSION, sourceProjectId: session.sourceProject, targetProjectId: session.targetProject, history: [] } }; }
    throw error;
  }
}

async function saveState(session: Session, state: StoredState) {
  state.history = state.history.slice(-50);
  await session.transport('sites', ':commit', { method: 'POST', body: JSON.stringify({ writes: [{ update: { name: firestoreDocumentNameFor('sites', META_PATH), fields: { state: { stringValue: JSON.stringify(state) }, updatedAt: { stringValue: new Date().toISOString() } } } }] }) });
  session.targetWrites++;
}

/** Units to move, discovered from the legacy project. Every sites/{id} subcollection is included except legacy indexationUrls rows already folded into an indexation bundle. */
export async function buildPlan(session: Session): Promise<MigrationUnit[]> {
  const units: MigrationUnit[] = SITES_FIRESTORE_COLLECTIONS.map(collectionId => ({ parent: '', collectionId }));
  const siteNames: string[] = []; let token: string | undefined;
  do {
    // showMissing finds sites/{id} parents that only exist through subcollections.
    const page = await session.listPage('keywords', { parent: '', collectionId: 'sites' }, token, { showMissing: true, pageSize: 300 });
    siteNames.push(...page.documents.map(doc => relativeName(doc.name)));
    token = page.nextPageToken;
  } while (token);
  for (const sitePath of siteNames) {
    for (const collectionId of (await session.collectionIds('keywords', sitePath)).sort()) {
      if (collectionId === 'indexationUrls' && await session.getSource(`${sitePath}/indexationBundle/current`)) {
        session.skipped.push(`${sitePath}/indexationUrls (already migrated into indexationBundle; legacy rows stay in the old project for rollback)`);
        continue;
      }
      units.push({ parent: sitePath, collectionId });
    }
  }
  // Code only nests under sites/{id}; sample other collections to surface anything unexpected.
  for (const collectionId of SITES_FIRESTORE_COLLECTIONS.filter(id => id !== 'sites')) {
    const page = await session.listPage('keywords', { parent: '', collectionId }, undefined, { pageSize: 3 });
    for (const doc of page.documents) {
      const nested = await session.collectionIds('keywords', relativeName(doc.name));
      if (nested.length) session.warnings.push(`${relativeName(doc.name)} has subcollections (${nested.join(', ')}) that the application does not use; they were not copied`);
    }
  }
  return units;
}

function report(session: Session, mode: MigrationMode, outcome: MigrationReport['outcome'], message: string, extra: Partial<MigrationReport> = {}): MigrationReport {
  return { mode, outcome, sourceProjectId: session.sourceProject, targetProjectId: session.targetProject, sourceReads: session.sourceReads, targetReads: session.targetReads, targetWrites: session.targetWrites, skipped: session.skipped, warnings: session.warnings, conflicts: [], message, ...extra };
}

function pauseOutcome(error: unknown): MigrationReport['outcome'] | null {
  if (error instanceof BudgetExhausted) return 'paused_budget';
  if (error instanceof FirestoreError && error.status === 429) return 'paused_quota';
  return null;
}

async function inventory(session: Session): Promise<MigrationReport> {
  const plan = await buildPlan(session);
  const units: NonNullable<MigrationReport['units']> = [];
  let total = 0;
  for (const unit of plan) {
    const source = await session.count('keywords', unit);
    const target = await session.count('sites', unit);
    total += source;
    units.push({ path: unitPath(unit), source, target });
  }
  return report(session, 'inventory', 'completed', `${plan.length} collections, ${total} documents to copy (about ${total} source reads and ${total} target writes for copy, the same again in source reads for delta)`, { units });
}

async function copy(session: Session, options: MigrationOptions, now: () => Date): Promise<MigrationReport> {
  const { state } = await loadState(session);
  // Recording copy.finishedAt is what switches live traffic to the Sites
  // project (when SITES_FIRESTORE_TARGET=sites), so a finished copy is never
  // redone: it would overwrite live Sites data. Use delta instead.
  if (state.copy?.finishedAt) return report(session, 'copy', 'refused', `Copy already finished at ${state.copy.finishedAt} and the Sites project may be live. Run delta to bring over later legacy changes.`);
  if (!state.copy || options.restart) {
    const plan = await buildPlan(session);
    state.copy = { startedAt: now().toISOString(), unitIndex: 0, plan, documentsWritten: 0 };
    delete state.delta;
    await saveState(session, state);
  }
  const progress = state.copy;
  try {
    while (progress.unitIndex < progress.plan.length) {
      const unit = progress.plan[progress.unitIndex];
      const page = await session.listPage('keywords', unit, progress.pageToken);
      for (const doc of page.documents) {
        await session.write({ update: { name: firestoreDocumentNameFor('sites', relativeName(doc.name)), fields: session.toTargetFields(doc.fields) } });
      }
      await session.flush();
      progress.documentsWritten += page.documents.length;
      if (page.nextPageToken) progress.pageToken = page.nextPageToken; else { progress.unitIndex++; delete progress.pageToken; }
      await saveState(session, state);
      session.log(`copy ${unitPath(unit)}: +${page.documents.length} (total ${progress.documentsWritten})`);
    }
  } catch (error) {
    const outcome = pauseOutcome(error);
    if (!outcome) throw error;
    session.discard();
    state.history.push({ at: now().toISOString(), mode: 'copy', outcome, detail: (error as Error).message });
    await saveState(session, state).catch(() => undefined);
    return report(session, 'copy', outcome, `Copy paused at ${progress.unitIndex}/${progress.plan.length} collections (${progress.documentsWritten} documents). Run copy again to resume: ${(error as Error).message}`, { copied: progress.documentsWritten });
  }
  progress.finishedAt = now().toISOString();
  state.history.push({ at: progress.finishedAt, mode: 'copy', outcome: 'completed', detail: `${progress.documentsWritten} documents` });
  await saveState(session, state);
  return report(session, 'copy', 'completed', `Copied ${progress.documentsWritten} documents in ${progress.plan.length} collections. With SITES_FIRESTORE_TARGET=sites, Sites traffic now switches to the Sites project within about a minute; run delta next.`, { copied: progress.documentsWritten });
}

async function delta(session: Session, options: MigrationOptions, now: () => Date): Promise<MigrationReport> {
  const { state } = await loadState(session);
  if (!state.copy?.finishedAt) return report(session, 'delta', 'refused', 'No finished copy is recorded in the Sites project; run copy first.');
  // Nothing writes to the Sites project before cutover except this tool, so a
  // target document updated after the copy finished and differing from the
  // source was written by the live Sites Operator and must not be overwritten.
  const copyStartedAt = Date.parse(state.copy.startedAt);
  const cutoverAt = Date.parse(state.copy.finishedAt);
  if (!state.delta || state.delta.finishedAt || options.restart) {
    state.delta = { startedAt: now().toISOString(), unitIndex: 0, plan: await buildPlan(session), created: 0, updated: 0, deleted: 0, conflicts: [] };
    await saveState(session, state);
  }
  const progress = state.delta;
  const plan = progress.plan;
  try {
    while (progress.unitIndex < plan.length) {
      const unit = plan[progress.unitIndex];
      const sourceNames = new Set<string>();
      let token: string | undefined;
      do {
        const page = await session.listPage('keywords', unit, token);
        token = page.nextPageToken;
        const candidates = page.documents.filter(doc => { sourceNames.add(relativeName(doc.name)); return options.deep || Date.parse(doc.updateTime) > copyStartedAt; });
        if (!candidates.length) continue;
        const targets = await session.batchGetTarget(candidates.map(doc => relativeName(doc.name)));
        for (const doc of candidates) {
          const path = relativeName(doc.name);
          const fields = session.toTargetFields(doc.fields);
          const existing = targets.get(path);
          if (!existing) { await session.write({ update: { name: firestoreDocumentNameFor('sites', path), fields }, currentDocument: { exists: false } }); progress.created++; continue; }
          if (fieldsDigest(existing.fields) === fieldsDigest(fields)) continue;
          if (Date.parse(existing.updateTime) > cutoverAt) { progress.conflicts.push(`${path}: changed in both projects after the copy; kept the Sites project version`); continue; }
          await session.write({ update: { name: firestoreDocumentNameFor('sites', path), fields }, currentDocument: { updateTime: existing.updateTime } });
          progress.updated++;
        }
      } while (token);
      // Documents deleted from the legacy project after they were copied.
      for (const doc of await session.listAll('sites', unit)) {
        const path = relativeName(doc.name);
        if (sourceNames.has(path) || Date.parse(doc.updateTime) > cutoverAt) continue;
        await session.write({ delete: firestoreDocumentNameFor('sites', path), currentDocument: { updateTime: doc.updateTime } });
        progress.deleted++;
      }
      await session.flush();
      progress.unitIndex++;
      await saveState(session, state);
      session.log(`delta ${unitPath(unit)} done (created ${progress.created}, updated ${progress.updated}, deleted ${progress.deleted}, conflicts ${progress.conflicts.length})`);
    }
  } catch (error) {
    const outcome = pauseOutcome(error);
    if (!outcome) throw error;
    session.discard();
    state.history.push({ at: now().toISOString(), mode: 'delta', outcome, detail: (error as Error).message });
    await saveState(session, state).catch(() => undefined);
    return report(session, 'delta', outcome, `Delta paused at ${progress.unitIndex}/${plan.length} collections; run delta again to resume: ${(error as Error).message}`, { conflicts: progress.conflicts, created: progress.created, updated: progress.updated, deleted: progress.deleted });
  }
  progress.finishedAt = now().toISOString();
  state.history.push({ at: progress.finishedAt, mode: 'delta', outcome: 'completed', detail: `created ${progress.created}, updated ${progress.updated}, deleted ${progress.deleted}, conflicts ${progress.conflicts.length}` });
  await saveState(session, state);
  return report(session, 'delta', 'completed', `Delta finished: created ${progress.created}, updated ${progress.updated}, deleted ${progress.deleted}, conflicts ${progress.conflicts.length}.`, { conflicts: progress.conflicts, created: progress.created, updated: progress.updated, deleted: progress.deleted });
}

async function verify(session: Session, options: MigrationOptions): Promise<MigrationReport> {
  const plan = await buildPlan(session);
  const units: NonNullable<MigrationReport['units']> = [];
  const mismatches: string[] = [];
  for (const unit of plan) {
    if (!options.deep) {
      const source = await session.count('keywords', unit);
      const target = await session.count('sites', unit);
      const status = source === target ? 'match' : 'count_mismatch';
      if (status !== 'match') mismatches.push(`${unitPath(unit)}: source ${source}, target ${target}`);
      units.push({ path: unitPath(unit), source, target, status });
      continue;
    }
    const source = new Map((await session.listAll('keywords', unit)).map(doc => [relativeName(doc.name), fieldsDigest(session.toTargetFields(doc.fields))]));
    const target = new Map((await session.listAll('sites', unit)).map(doc => [relativeName(doc.name), fieldsDigest(doc.fields)]));
    let differing = 0;
    for (const [path, digest] of source) if (target.get(path) !== digest) { differing++; if (mismatches.length < 200) mismatches.push(`${path}: ${target.has(path) ? 'fields differ' : 'missing in Sites project'}`); }
    for (const path of target.keys()) if (!source.has(path)) { differing++; if (mismatches.length < 200) mismatches.push(`${path}: only in Sites project`); }
    units.push({ path: unitPath(unit), source: source.size, target: target.size, status: differing ? `${differing}_differ` : 'match' });
  }
  return report(session, 'verify', 'completed', mismatches.length ? `${mismatches.length} differences (expected after cutover only for documents the live Sites Operator has written since).` : 'All collections match.', { units, conflicts: mismatches });
}

export async function runSitesFirestoreMigration(options: MigrationOptions): Promise<MigrationReport> {
  const now = options.now ?? (() => new Date());
  const session = new Session(options.transport ?? firestoreForTarget, options.maxSourceReads ?? 30_000, options.maxTargetWrites ?? 18_000, options.log ?? (() => undefined));
  try {
    if (options.mode === 'inventory') return await inventory(session);
    if (options.mode === 'copy') return await copy(session, options, now);
    if (options.mode === 'delta') return await delta(session, options, now);
    return await verify(session, options);
  } catch (error) {
    const outcome = pauseOutcome(error);
    if (!outcome) throw error;
    return report(session, options.mode, outcome, `Stopped before finishing: ${(error as Error).message}. Nothing partial was written outside the recorded checkpoint; run again to continue.`);
  }
}
