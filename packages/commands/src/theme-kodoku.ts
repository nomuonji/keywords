import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { field, firestore, firestoreDocumentName, FirestoreError, value } from '../../db/src/firestore.js';
import type { ResearchSession, ThemeCandidate, ThemeCandidateStatus, ThemeChallenge } from '../../db/src/remote-keyword-schema.js';

const DEFAULT_SESSION_ID = 'seo-theme-kodoku';
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
const shortText = z.string().trim().min(1).max(4000);
const textList = z.array(z.string().trim().min(1).max(2000)).max(100);
const status = z.enum(['surviving', 'challenged', 'killed', 'parked', 'pilot_ready']);
const observedFact = z.object({
  label: z.string().trim().min(1).max(300),
  value: z.string().trim().min(1).max(1000),
  source: z.string().max(1000).optional(),
  observedAt: z.string().max(100).optional()
}).strict();

export const themeKodokuContextShape = {
  sessionId: id.optional(),
  includeKilled: z.boolean().default(true)
};

export const themeCandidateUpsertShape = {
  sessionId: id.optional(),
  expectedRevision: z.number().int().min(1),
  candidateId: id,
  title: z.string().trim().min(1).max(200).optional(),
  thesis: shortText.optional(),
  status: status.optional(),
  currentVerdict: z.string().max(4000).optional(),
  whyStillAlive: z.string().max(4000).optional(),
  fatalRisks: textList.optional(),
  unknowns: textList.optional(),
  observedFacts: z.array(observedFact).max(100).optional(),
  alternatives: z.array(id).max(100).optional(),
  nextChallenge: z.string().max(4000).optional()
};

export const themeCandidateChallengeShape = {
  sessionId: id.optional(),
  expectedRevision: z.number().int().min(1),
  candidateId: id,
  attack: shortText,
  evidence: textList.optional(),
  defense: z.string().max(4000).default(''),
  conclusion: shortText,
  statusAfter: status,
  nextChallenge: z.string().max(4000).default(''),
  currentVerdict: z.string().max(4000).optional(),
  whyStillAlive: z.string().max(4000).optional(),
  addFatalRisks: textList.optional(),
  addUnknowns: textList.optional(),
  resolveUnknowns: textList.optional(),
  addObservedFacts: z.array(observedFact).max(100).optional(),
  addAlternatives: z.array(id).max(100).optional()
};

function fields(data: object) {
  return Object.fromEntries(Object.entries(data).filter(([, item]) => item !== undefined).map(([key, item]) => [key, field(item)]));
}
function parseDoc<T>(doc: any): T {
  return { id: String(doc.name ?? '').split('/').pop() ?? '', ...Object.fromEntries(Object.entries(doc.fields ?? {}).map(([key, item]) => [key, value(item)])) } as T;
}
function unique<T>(items: T[]) { return [...new Set(items)]; }
function nowIso() { return new Date().toISOString(); }
async function readDocument(path: string) {
  try { return await firestore(path); }
  catch (error) { if (error instanceof FirestoreError && error.status === 404) return null; throw error; }
}
async function readSession(sessionId: string) {
  const doc = await readDocument(`/researchSessions/${id.parse(sessionId)}`);
  if (!doc) throw new Error('Theme crucible research session not found. Create or restore seo-theme-kodoku first.');
  return { doc, session: parseDoc<ResearchSession>(doc) };
}
function candidates(session: ResearchSession): ThemeCandidate[] {
  return Array.isArray(session.themeCandidates) ? session.themeCandidates : [];
}
function compactDigest(previous: string, overflow: ThemeChallenge[]) {
  const additions = overflow.map(item => `- ${item.createdAt}: ${item.conclusion} [${item.statusAfter}]`);
  return [previous, ...additions].filter(Boolean).join('\n').slice(-12000);
}
async function commitSession(session: ResearchSession, previousDoc: any, command: string, targetId?: string) {
  const runId = randomUUID();
  const now = nowIso();
  await firestore(':commit', { method: 'POST', body: JSON.stringify({ writes: [
    {
      update: { name: firestoreDocumentName(`researchSessions/${session.id}`), fields: fields(session) },
      currentDocument: { updateTime: previousDoc.updateTime }
    },
    {
      update: {
        name: firestoreDocumentName(`runs/${runId}`),
        fields: fields({
          id: runId,
          command,
          targetId: targetId ?? session.id,
          actor: 'remote_mcp',
          revision: session.revision,
          createdAt: now,
          outcome: 'succeeded'
        })
      },
      currentDocument: { exists: false }
    }
  ] }) });
  return { ...session, runId };
}
function requireRevision(session: ResearchSession, expectedRevision: number) {
  if (session.revision !== expectedRevision) throw new Error('Revision conflict: call theme_kodoku_context and reapply your update');
}
function normalizeCandidate(candidate: ThemeCandidate): ThemeCandidate {
  return {
    ...candidate,
    fatalRisks: unique(candidate.fatalRisks ?? []),
    unknowns: unique(candidate.unknowns ?? []),
    observedFacts: Array.isArray(candidate.observedFacts) ? candidate.observedFacts : [],
    alternatives: unique(candidate.alternatives ?? []),
    challengeHistory: Array.isArray(candidate.challengeHistory) ? candidate.challengeHistory : [],
    historyDigest: candidate.historyDigest ?? '',
    currentVerdict: candidate.currentVerdict ?? '',
    whyStillAlive: candidate.whyStillAlive ?? '',
    nextChallenge: candidate.nextChallenge ?? ''
  };
}

export async function themeKodokuContext(input: unknown = {}) {
  const args = z.object(themeKodokuContextShape).strict().parse(input);
  const { session } = await readSession(args.sessionId ?? DEFAULT_SESSION_ID);
  const all = candidates(session).map(normalizeCandidate);
  const visible = args.includeKilled ? all : all.filter(item => item.status !== 'killed');
  const groups = Object.fromEntries(
    (['pilot_ready', 'surviving', 'challenged', 'parked', 'killed'] as ThemeCandidateStatus[])
      .map(key => [key, visible.filter(item => item.status === key)])
  );
  return {
    sessionId: session.id,
    title: session.title,
    objective: session.objective,
    revision: session.revision,
    principles: session.hypotheses,
    legacyFindings: session.findings,
    nextActions: session.nextActions,
    notes: session.notes,
    themeLedgerVersion: session.themeLedgerVersion ?? 0,
    candidates: visible,
    groups,
    guidance: [
      'This ledger is qualitative. Do not create or infer a composite score or automatic winner.',
      'Treat search volume, payout, EPC, conversion conditions and SERP observations as evidence, not verdicts.',
      'Each round should try to falsify survivors, introduce a genuinely stronger alternative when found, and preserve why killed ideas died.',
      'Do not resurrect a killed candidate without materially new evidence.'
    ]
  };
}

export async function themeCandidateUpsert(input: unknown) {
  const args = z.object(themeCandidateUpsertShape).strict().parse(input);
  const { doc, session } = await readSession(args.sessionId ?? DEFAULT_SESSION_ID);
  requireRevision(session, args.expectedRevision);
  const list = candidates(session).map(normalizeCandidate);
  const index = list.findIndex(item => item.id === args.candidateId);
  const now = nowIso();

  if (index < 0 && (!args.title || !args.thesis)) throw new Error('New candidates require title and thesis');

  const previous = index >= 0 ? list[index] : null;
  const next: ThemeCandidate = normalizeCandidate({
    id: args.candidateId,
    title: args.title ?? previous?.title ?? args.candidateId,
    thesis: args.thesis ?? previous?.thesis ?? '',
    status: (args.status ?? previous?.status ?? 'surviving') as ThemeCandidateStatus,
    currentVerdict: args.currentVerdict ?? previous?.currentVerdict ?? '',
    whyStillAlive: args.whyStillAlive ?? previous?.whyStillAlive ?? '',
    fatalRisks: args.fatalRisks ?? previous?.fatalRisks ?? [],
    unknowns: args.unknowns ?? previous?.unknowns ?? [],
    observedFacts: args.observedFacts ?? previous?.observedFacts ?? [],
    alternatives: args.alternatives ?? previous?.alternatives ?? [],
    nextChallenge: args.nextChallenge ?? previous?.nextChallenge ?? '',
    challengeHistory: previous?.challengeHistory ?? [],
    historyDigest: previous?.historyDigest ?? '',
    createdAt: previous?.createdAt ?? now,
    updatedAt: now
  });
  if (index >= 0) list[index] = next; else {
    if (list.length >= 100) throw new Error('Theme crucible supports at most 100 live ledger entries');
    list.push(next);
  }

  const updated: ResearchSession = {
    ...session,
    themeLedgerVersion: 1,
    themeCandidates: list,
    revision: session.revision + 1,
    updatedAt: now
  };
  const saved = await commitSession(updated, doc, 'theme_candidate_upsert', args.candidateId);
  return { sessionId: saved.id, revision: saved.revision, candidate: next, runId: saved.runId };
}

export async function themeCandidateChallenge(input: unknown) {
  const args = z.object(themeCandidateChallengeShape).strict().parse(input);
  const { doc, session } = await readSession(args.sessionId ?? DEFAULT_SESSION_ID);
  requireRevision(session, args.expectedRevision);
  const list = candidates(session).map(normalizeCandidate);
  const index = list.findIndex(item => item.id === args.candidateId);
  if (index < 0) throw new Error('Theme candidate not found');
  const current = list[index];
  const now = nowIso();

  const resolved = new Set(args.resolveUnknowns ?? []);
  const challenge: ThemeChallenge = {
    id: `challenge-${Date.now().toString(36)}-${randomUUID().slice(0, 6)}`,
    createdAt: now,
    attack: args.attack,
    evidence: unique(args.evidence ?? []),
    defense: args.defense,
    conclusion: args.conclusion,
    statusAfter: args.statusAfter,
    nextChallenge: args.nextChallenge
  };
  const history = [...current.challengeHistory, challenge];
  const overflow = history.length > 12 ? history.slice(0, history.length - 12) : [];
  const keptHistory = history.slice(-12);
  const updatedCandidate: ThemeCandidate = normalizeCandidate({
    ...current,
    status: args.statusAfter,
    currentVerdict: args.currentVerdict ?? args.conclusion,
    whyStillAlive: args.whyStillAlive ?? current.whyStillAlive,
    fatalRisks: unique([...current.fatalRisks, ...(args.addFatalRisks ?? [])]),
    unknowns: unique([...current.unknowns.filter(item => !resolved.has(item)), ...(args.addUnknowns ?? [])]),
    observedFacts: [...current.observedFacts, ...(args.addObservedFacts ?? [])].slice(-100),
    alternatives: unique([...current.alternatives, ...(args.addAlternatives ?? [])]),
    nextChallenge: args.nextChallenge,
    challengeHistory: keptHistory,
    historyDigest: compactDigest(current.historyDigest, overflow),
    updatedAt: now
  });
  list[index] = updatedCandidate;

  const updated: ResearchSession = {
    ...session,
    themeLedgerVersion: 1,
    themeCandidates: list,
    revision: session.revision + 1,
    updatedAt: now
  };
  const saved = await commitSession(updated, doc, 'theme_candidate_challenge', args.candidateId);
  return { sessionId: saved.id, revision: saved.revision, candidate: updatedCandidate, challenge, runId: saved.runId };
}
