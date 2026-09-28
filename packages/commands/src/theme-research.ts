import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { field, firestore, firestoreDocumentName, FirestoreError, value } from '../../db/src/firestore.js';
import type { ResearchSession, ThemeCandidate, ThemeCandidateStatus, ThemeChallenge } from '../../db/src/remote-keyword-schema.js';

const DEFAULT_SESSION_ID = 'seo-theme-research';
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

export const themeResearchContextShape = {
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
  if (!doc) throw new Error('Theme research session not found. Create or restore seo-theme-research first.');
  return { doc, session: parseDoc<ResearchSession>(doc) };
}
function candidatePath(sessionId: string, candidateId: string) {
  return `researchSessions/${id.parse(sessionId)}/themeCandidates/${id.parse(candidateId)}`;
}
async function readCandidate(sessionId: string, candidateId: string) {
  const doc = await readDocument(`/${candidatePath(sessionId, candidateId)}`);
  return doc ? { doc, candidate: normalizeCandidate(parseDoc<ThemeCandidate>(doc)) } : null;
}
async function listCandidates(sessionId: string): Promise<ThemeCandidate[]> {
  const result = await firestore(`/researchSessions/${id.parse(sessionId)}/themeCandidates?pageSize=100&orderBy=updatedAt%20desc`);
  return (result.documents ?? []).map((doc: any) => normalizeCandidate(parseDoc<ThemeCandidate>(doc)));
}
function compactDigest(previous: string, overflow: ThemeChallenge[]) {
  const additions = overflow.map(item => `- ${item.createdAt}: ${item.conclusion} [${item.statusAfter}]`);
  return [previous, ...additions].filter(Boolean).join('\n').slice(-12000);
}
function requireRevision(session: ResearchSession, expectedRevision: number) {
  if (session.revision !== expectedRevision) throw new Error('Revision conflict: call theme_research_context and reapply your update');
}
function normalizeCandidate(candidate: ThemeCandidate): ThemeCandidate {
  return {
    ...candidate,
    sessionId: candidate.sessionId ?? DEFAULT_SESSION_ID,
    fatalRisks: unique(candidate.fatalRisks ?? []),
    unknowns: unique(candidate.unknowns ?? []),
    observedFacts: Array.isArray(candidate.observedFacts) ? candidate.observedFacts : [],
    alternatives: unique(candidate.alternatives ?? []),
    challengeHistory: Array.isArray(candidate.challengeHistory) ? candidate.challengeHistory : [],
    historyDigest: candidate.historyDigest ?? '',
    currentVerdict: candidate.currentVerdict ?? '',
    whyStillAlive: candidate.whyStillAlive ?? '',
    nextChallenge: candidate.nextChallenge ?? '',
    revision: Number(candidate.revision ?? 0)
  };
}
async function commitCandidate(
  sessionDoc: any,
  session: ResearchSession,
  candidateDoc: any,
  candidate: ThemeCandidate,
  command: string
) {
  const runId = randomUUID();
  const now = nowIso();
  const nextSession: ResearchSession = {
    ...session,
    themeLedgerVersion: 1,
    revision: session.revision + 1,
    updatedAt: now
  };
  const candidateWrite: Record<string, unknown> = {
    update: { name: firestoreDocumentName(candidatePath(session.id, candidate.id)), fields: fields(candidate) },
    currentDocument: candidateDoc ? { updateTime: candidateDoc.updateTime } : { exists: false }
  };
  await firestore(':commit', { method: 'POST', body: JSON.stringify({ writes: [
    {
      update: { name: firestoreDocumentName(`researchSessions/${session.id}`), fields: fields(nextSession) },
      currentDocument: { updateTime: sessionDoc.updateTime }
    },
    candidateWrite,
    {
      update: {
        name: firestoreDocumentName(`runs/${runId}`),
        fields: fields({
          id: runId,
          command,
          targetId: candidate.id,
          actor: 'remote_mcp',
          revision: nextSession.revision,
          candidateRevision: candidate.revision,
          createdAt: now,
          outcome: 'succeeded'
        })
      },
      currentDocument: { exists: false }
    }
  ] }) });
  return { session: nextSession, candidate, runId };
}

export async function themeResearchContext(input: unknown = {}) {
  const args = z.object(themeResearchContextShape).strict().parse(input);
  const { session } = await readSession(args.sessionId ?? DEFAULT_SESSION_ID);
  const all = await listCandidates(session.id);
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
      'This research ledger is qualitative. Do not create or infer a composite score or automatic winner.',
      'Treat search volume, payout, EPC, conversion conditions and SERP observations as evidence, not verdicts.',
      'Each research pass should actively look for disconfirming evidence, add genuinely stronger alternatives when found, and preserve why rejected ideas were rejected.',
      'Do not revive a killed candidate without materially new evidence.'
    ]
  };
}

export async function themeCandidateUpsert(input: unknown) {
  const args = z.object(themeCandidateUpsertShape).strict().parse(input);
  const { doc: sessionDoc, session } = await readSession(args.sessionId ?? DEFAULT_SESSION_ID);
  requireRevision(session, args.expectedRevision);
  const found = await readCandidate(session.id, args.candidateId);
  const now = nowIso();

  if (!found && (!args.title || !args.thesis)) throw new Error('New candidates require title and thesis');
  if (!found && (await listCandidates(session.id)).length >= 100) throw new Error('Theme research ledger supports at most 100 candidates per research session');

  const previous = found?.candidate ?? null;
  const next: ThemeCandidate = normalizeCandidate({
    id: args.candidateId,
    sessionId: session.id,
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
    revision: (previous?.revision ?? 0) + 1,
    createdAt: previous?.createdAt ?? now,
    updatedAt: now
  });

  const saved = await commitCandidate(sessionDoc, session, found?.doc ?? null, next, 'theme_candidate_upsert');
  return { sessionId: saved.session.id, revision: saved.session.revision, candidate: saved.candidate, runId: saved.runId };
}

export async function themeCandidateChallenge(input: unknown) {
  const args = z.object(themeCandidateChallengeShape).strict().parse(input);
  const { doc: sessionDoc, session } = await readSession(args.sessionId ?? DEFAULT_SESSION_ID);
  requireRevision(session, args.expectedRevision);
  const found = await readCandidate(session.id, args.candidateId);
  if (!found) throw new Error('Theme candidate not found');

  const current = found.candidate;
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
    revision: current.revision + 1,
    updatedAt: now
  });

  const saved = await commitCandidate(sessionDoc, session, found.doc, updatedCandidate, 'theme_candidate_challenge');
  return { sessionId: saved.session.id, revision: saved.session.revision, candidate: saved.candidate, challenge, runId: saved.runId };
}
