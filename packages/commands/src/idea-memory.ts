import { createHash } from 'node:crypto';
import { z } from 'zod';
import { field, firestore, firestoreDocumentName, FirestoreError, value } from '../../db/src/firestore.js';

const id = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
const txt = z.string().trim().min(1).max(2000);
const list = z.array(txt).max(30);
// Destination keys are extensible. The seven initial outlets are presentation defaults, not an enum.
const tagsShape = z.array(z.string().trim().min(1).max(60)).max(20);
const destinationKey = z.string().regex(/^[a-z][a-z0-9_-]{1,59}$/);
const destinationsShape = z.array(destinationKey).max(20);
const assetRefShape = z.object({
  id, destination: destinationKey, kind: z.string().trim().min(1).max(80),
  title: z.string().trim().min(1).max(200),
  stage: z.enum(['proposed','draft','handed_off']).default('proposed'),
  owner: z.string().trim().min(1).max(100),
  targetRef: z.string().trim().max(1000).optional(),
  contentRef: z.string().trim().max(1000).optional()
}).strict().refine(v => v.stage !== 'handed_off' || !!v.targetRef,
  'An externally handed-off asset needs a targetRef');
const assetRefsShape = z.array(assetRefShape).max(40);
const unique = <T>(values: T[]) => [...new Set(values)];

const status = z.enum(['unreviewed', 'liked', 'rejected', 'deferred', 'exploring']);
const scope = z.enum(['specific_idea', 'proposal_format', 'research_quality', 'discovery_process', 'whole_batch']);
const polarity = z.enum(['positive', 'negative', 'mixed', 'neutral']);
const ideaShape = z.object({
  id: id.optional(), title: z.string().trim().min(1).max(200), aliases: list.optional(),
  audience: txt, userTask: txt, entities: txt, informationMechanism: txt, interaction: txt,
  dataSources: list.optional(), maintenance: txt.optional(), marketCategory: txt.optional(),
  marketEvidenceRefs: list.optional(), unknowns: list.optional(), reconsiderWhen: txt.optional(),
  tags: tagsShape.optional(), destinations: destinationsShape.optional(),
  presentedAt: z.string().datetime().optional(), sessionId: id.optional(),
  status: z.literal('unreviewed').optional(), legacySourceId: id.optional()
}).strict();
export const ideaMemoryBatchUpsertShape = { ideas: z.array(ideaShape).min(1).max(50), runId: id, idempotencyKey: id.optional() };
export const ideaMemorySearchShape = { candidate: ideaShape, limit: z.number().int().min(1).max(30).default(10), includeRejected: z.boolean().default(true) };
export const ideaMemoryContextShape = { limit: z.number().int().min(1).max(100).default(30), cursor: z.string().max(4000).optional(), status: status.optional() };
export const ideaFeedbackAppendShape = {
  ideaId: id.optional(), runId: id.optional(), scope, polarity, reason: txt, feedback: txt,
  source: z.enum(['direct_user', 'agent_inference', 'market_evidence']), sourceDate: z.string().datetime(),
  statusAfter: status.optional(), reconsiderWhen: txt.optional(), idempotencyKey: id,
  axes: z.object({
    appeal: z.number().int().min(1).max(5).optional(),
    dbValue: z.number().int().min(1).max(5).optional(),
    seo: z.number().int().min(1).max(5).optional(),
    revenue: z.number().int().min(1).max(5).optional(),
    upkeep: z.number().int().min(1).max(5).optional()
  }).strict().optional()
};
export const ideaMemoryPatchShape = {
  ideaId: id, expectedRevision: z.number().int().min(1),
  tags: tagsShape.optional(), destinations: destinationsShape.optional(), assetRefs: assetRefsShape.optional()
};
export const ideaMemoryFeedbackProfileShape = { limit: z.number().int().min(1).max(100).default(50), cursor: z.string().max(4000).optional() };

type IdeaInput = z.infer<typeof ideaShape>;
type Idea = Omit<IdeaInput,'status'> & { id: string; status: z.infer<typeof status>; normalizedTitle: string; searchTokens: string[]; payloadHash: string; createdAt: string; updatedAt: string; presentationHistory: { runId: string; presentedAt: string; sessionId?: string }[];
  revision: number; tags?: string[]; destinations?: string[];
  assetRefs?: z.infer<typeof assetRefShape>[]; assetCount?: number };
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const norm = (s: string) => s.normalize('NFKC').toLowerCase().replace(/[\p{P}\p{S}\s]+/gu, '');
const tokens = (s: string) => { const n = norm(s); return [...new Set(n.length < 3 ? [n] : Array.from({ length: n.length - 1 }, (_, i) => n.slice(i, i + 2)))].filter(Boolean).slice(0, 80); };
const overlap = (a: string, b: string) => { const x = new Set(tokens(a)), y = new Set(tokens(b)); return x.size && y.size ? [...x].filter(v => y.has(v)).length / Math.max(x.size, y.size) : 0; };
const fields = (o: object) => Object.fromEntries(Object.entries(o).filter(([,v]) => v !== undefined).map(([k,v]) => [k,field(v)]));
const parse = <T>(d: any): T => ({ id: String(d.name).split('/').pop(), ...Object.fromEntries(Object.entries(d.fields ?? {}).map(([k,v]) => [k,value(v)])) }) as T;
const path = (ideaId: string) => `ideaMemory/${id.parse(ideaId)}`;
async function read(path: string) { try { return await firestore(`/${path}`); } catch (e) { if (e instanceof FirestoreError && e.status === 404) return null; throw e; } }
function stableId(x: IdeaInput) { return x.id ?? `idea-${hash([x.audience,x.userTask,x.entities,x.informationMechanism,x.interaction].map(norm).join('|')).slice(0,24)}`; }
function searchTokens(x: IdeaInput) { return [...new Set([x.title,...(x.aliases ?? []),x.audience,x.userTask,x.entities,x.informationMechanism,x.interaction].flatMap(v => tokens(v).slice(0,10)))].slice(0,70); }
export function compareIdeas(a: Omit<IdeaInput,'status'>, b: Omit<IdeaInput,'status'>) {
  const title = Math.max(overlap(a.title,b.title), ...(b.aliases ?? []).map(v => overlap(a.title,v)));
  const audience = overlap(a.audience,b.audience), task = overlap(a.userTask,b.userTask);
  const entities = overlap(a.entities,b.entities), structure = overlap(a.informationMechanism,b.informationMechanism);
  const interaction = overlap(a.interaction,b.interaction);
  const reasons = Object.entries({ title,audience,task,entities,structure,interaction }).filter(([,v]) => v >= .55).map(([k]) => k);
  const material = (audience >= .45 && task >= .45 && (entities >= .45 || structure >= .45) && interaction >= .45) || (title >= .9 && task >= .45 && structure >= .45 && interaction >= .45);
  const exact = norm(a.title) === norm(b.title) || (b.aliases ?? []).some(v => norm(a.title) === norm(v));
  return { relation: material ? (exact ? 'exact' : 'near_duplicate') : 'related_not_duplicate', reasons, similarity: Math.round((title+audience+task+entities+structure+interaction)/6*100)/100 };
}

export async function ideaMemoryBatchUpsert(input: unknown) {
  const args = z.object(ideaMemoryBatchUpsertShape).strict().parse(input);
  const now = new Date().toISOString();
  const unique = new Map<string, IdeaInput>();
  for (const idea of args.ideas) { const key = stableId(idea); if (unique.has(key) && JSON.stringify(unique.get(key)) !== JSON.stringify(idea)) throw new Error(`Conflicting ideas share ID ${key}`); unique.set(key,idea); }
  const results: { id: string; outcome: string }[] = []; const writes: any[] = [];
  // At most 50 point reads and one atomic commit. The document precondition rejects concurrent conflicting writes.
  const previous = await Promise.all([...unique.keys()].map(key => read(path(key))));
  let i = 0;
  for (const [key, idea] of unique) {
    const doc = previous[i++]; const old = doc ? parse<Idea>(doc) : null;
    const payloadHash = hash(JSON.stringify(idea));
    const presentation = { runId: args.runId, presentedAt: idea.presentedAt ?? now, sessionId: idea.sessionId };
    const history = old?.presentationHistory ?? [];
    const alreadyPresented = history.some(v => v.runId === args.runId);
    const next: Idea = {
      ...old, ...idea, id: key, aliases: idea.aliases ?? old?.aliases ?? [], normalizedTitle: norm(idea.title), searchTokens: searchTokens(idea),
      status: old?.status ?? idea.status ?? 'unreviewed',
      tags: old?.tags ?? unique(idea.tags ?? []),
      destinations: old?.destinations ?? unique(idea.destinations ?? []),
      assetRefs: old?.assetRefs ?? [], assetCount: old?.assetCount ?? 0,
      payloadHash, createdAt: old?.createdAt ?? now, updatedAt: now,
      presentationHistory: alreadyPresented ? history : [...history.slice(-39), presentation], revision: (old?.revision ?? 0)+1
    };
    if (old && alreadyPresented && old.payloadHash === payloadHash) { results.push({ id:key,outcome:'unchanged' }); continue; }
    writes.push({ update: { name: firestoreDocumentName(path(key)), fields: fields(next) }, currentDocument: doc ? { updateTime: doc.updateTime } : { exists:false } });
    results.push({ id:key,outcome:old ? 'updated' : 'created' });
  }
  if (writes.length) await firestore(':commit', { method:'POST', body:JSON.stringify({ writes }) });
  return { runId:args.runId, idempotencyKey:args.idempotencyKey ?? null, results, writeCount:writes.length, readCount:unique.size };
}

// Update organization without changing the user's verdict or the presentation history.
// Optimistic revision + Firestore preconditions protect concurrent UI/agent writes.
export async function ideaMemoryPatch(input: unknown) {
  const args = z.object(ideaMemoryPatchShape).strict().parse(input);
  if (args.tags === undefined && args.destinations === undefined && args.assetRefs === undefined) {
    throw new Error('Provide tags, destinations or assetRefs');
  }
  const document = await read(path(args.ideaId));
  if (!document) { const error = new Error('Idea not found'); (error as any).status=404; throw error; }
  const old = parse<Idea>(document);
  if (old.revision !== args.expectedRevision) {
    const error = new Error('Idea revision conflict'); (error as any).status=409; throw error;
  }
  const next = {
    ...old,
    ...(args.tags === undefined ? {} : {tags: unique(args.tags)}),
    ...(args.destinations === undefined ? {} : {destinations: unique(args.destinations)}),
    ...(args.assetRefs === undefined ? {} : {assetRefs: args.assetRefs, assetCount: args.assetRefs.length})
  };
  if (JSON.stringify([next.tags ?? [],next.destinations ?? [],next.assetRefs ?? []]) ===
      JSON.stringify([old.tags ?? [],old.destinations ?? [],old.assetRefs ?? []])) {
    return { outcome:'unchanged', idea:old };
  }
  const updated = {...next, revision:old.revision+1, updatedAt:new Date().toISOString()};
  await firestore(':commit',{method:'POST',body:JSON.stringify({writes:[{
    update:{name:firestoreDocumentName(path(args.ideaId)),fields:fields(updated)},
    currentDocument:{updateTime:document.updateTime}
  }]})});
  return {outcome:'updated',idea:updated};
}

function queryTokens(x: IdeaInput) { return [...new Set([x.title,x.userTask,x.entities,x.informationMechanism,x.audience].flatMap(v => tokens(v).slice(0,2)))].slice(0,10); }
export async function ideaMemorySearch(input: unknown) {
  const args = z.object(ideaMemorySearchShape).strict().parse(input);
  const ts = queryTokens(args.candidate); if (!ts.length) return { matches:[], examined:0 };
  const q = { structuredQuery: { from:[{collectionId:'ideaMemory'}], where:{ fieldFilter:{ field:{fieldPath:'searchTokens'},op:'ARRAY_CONTAINS_ANY',value:field(ts) } }, limit:100 } };
  const rows = await firestore(':runQuery',{method:'POST',body:JSON.stringify(q)});
  const ideas = (rows as any[]).filter(v => v.document).map(v => parse<Idea>(v.document));
  const legacyResult = await firestore('/researchSessions/market-idea-feedback/themeCandidates?pageSize=20');
  const legacy = (legacyResult.documents ?? []).map((d:any) => parse<any>(d)).filter((v:any) => v.id.startsWith('prior-idea-'));
  const matches = ideas.filter(v => args.includeRejected || v.status !== 'rejected').map(v => ({ idea:v, ...compareIdeas(args.candidate,v) }));
  for (const item of legacy) {
    if (ideas.some(v => v.id === item.id)) continue;
    const lexical = Math.max(overlap(args.candidate.title,item.title),overlap(args.candidate.entities,item.thesis),overlap(args.candidate.userTask,item.thesis));
    if (lexical >= .35) matches.push({ idea:{...item,originalUserRating:'unreviewed',legacy:true}, relation: norm(args.candidate.title) === norm(item.title) ? 'exact' : 'possible_legacy_match', reasons:['legacy_title_or_thesis'], similarity:lexical } as any);
  }
  matches.sort((a,b) => b.similarity-a.similarity);
  return { matches:matches.slice(0,args.limit), examined:ideas.length+legacy.length, bounded:true };
}

export async function ideaMemoryContext(input: unknown = {}) {
  const args = z.object(ideaMemoryContextShape).strict().parse(input);
  const params = new URLSearchParams({pageSize:String(args.limit),orderBy:'__name__'}); if (args.cursor) params.set('pageToken',args.cursor);
  const result = await firestore(`/ideaMemory?${params}`);
  const ideas = (result.documents ?? []).map((d:any) => parse<Idea>(d));
  // Legacy records remain visible without copying or changing their user-rating semantics.
  const legacy = await Promise.all([read('researchSessions/market-idea-feedback'),firestore('/researchSessions/market-idea-feedback/themeCandidates?pageSize=20')]);
  const source = legacy[0] ? parse<any>(legacy[0]) : null;
  const legacyIdeas = (legacy[1].documents ?? []).map((d:any) => parse<any>(d)).filter((v:any) => !ideas.some((x:Idea) => x.id === v.id || x.legacySourceId === v.id)).map((v:any) => ({ ...v, kind:v.id.startsWith('anti-pattern-') ? 'proposal_pattern' : 'idea', originalUserRating:v.id.startsWith('anti-pattern-') ? 'negative_pattern' : 'unreviewed' }));
  return { ideas:args.status ? ideas.filter((v:Idea) => v.status === args.status) : ideas, nextCursor:result.nextPageToken ?? null, legacyIdeas, legacyFindings:source?.findings ?? [], guidance:'Legacy original rating is a historical snapshot; check feedback_profile for later events. Unreviewed is not liked or rejected. Broad presentation criticism is not a verdict on every idea. Search before proposing.' };
}

export async function ideaFeedbackAppend(input: unknown) {
  const args = z.object(ideaFeedbackAppendShape).strict().parse(input);
  if (args.scope === 'specific_idea' && !args.ideaId) throw new Error('specific_idea requires ideaId');
  if (args.scope !== 'specific_idea' && (args.ideaId || args.statusAfter)) throw new Error('Broad feedback cannot set an individual idea status');
  if (args.source !== 'direct_user' && args.statusAfter) throw new Error('User verdict requires direct_user source');
  const eventId = `feedback-${hash(args.idempotencyKey).slice(0,32)}`;
  const oldEvent = await read(`ideaFeedback/${eventId}`);
  if (oldEvent) {
    const previous = parse<any>(oldEvent);
    if (Object.entries(args).some(([key,v]) => JSON.stringify(previous[key]) !== JSON.stringify(v))) throw new Error('Idempotency key reused for different feedback');
    return { event:previous, outcome:'unchanged' };
  }
  const ideaDoc = args.ideaId ? await read(path(args.ideaId)) : null;
  const legacyDoc = args.ideaId && !ideaDoc ? await read(`researchSessions/market-idea-feedback/themeCandidates/${args.ideaId}`) : null;
  if (args.ideaId && !ideaDoc && !legacyDoc) throw new Error('Idea not found');
  const now = new Date().toISOString();
  const event = { ...args,id:eventId,createdAt:now };
  const writes:any[] = [{ update:{name:firestoreDocumentName(`ideaFeedback/${eventId}`),fields:fields(event)},currentDocument:{exists:false} }];
  if (ideaDoc && args.statusAfter) {
    const idea = parse<Idea>(ideaDoc); const next = { ...idea,status:args.statusAfter,reconsiderWhen:args.reconsiderWhen ?? idea.reconsiderWhen,updatedAt:now,revision:idea.revision+1 };
    writes.push({update:{name:firestoreDocumentName(path(idea.id)),fields:fields(next)},currentDocument:{updateTime:ideaDoc.updateTime}});
  }
  await firestore(':commit',{method:'POST',body:JSON.stringify({writes})});
  return {event,outcome:'created'};
}

export async function ideaMemoryFeedbackProfile(input: unknown = {}) {
  const args = z.object(ideaMemoryFeedbackProfileShape).strict().parse(input);
  const params = new URLSearchParams({pageSize:String(args.limit),orderBy:'createdAt desc'}); if (args.cursor) params.set('pageToken',args.cursor);
  const result = await firestore(`/ideaFeedback?${params}`);
  const events = (result.documents ?? []).map((d:any) => parse<any>(d));
  return { events, counts:events.reduce((a:any,v:any) => { const key=`${v.scope}:${v.polarity}`; a[key]=(a[key] ?? 0)+1; return a; },{}), nextCursor:result.nextPageToken ?? null, scope:'page_only', guidance:'Preserve source and scope. Pattern criticism does not reject specific ideas.' };
}


// Owner-facing Idea Memory inbox. One ordered Firestore page, no N+1 reads.
// Feedback mutations remain exclusively in ideaFeedbackAppend.
export const ideaReviewListShape = {
  limit: z.number().int().min(1).max(100).default(60),
  cursor: z.string().max(4000).optional(),
  summary: z.boolean().default(false)
};
export async function ideaReviewList(input: unknown = {}) {
  const args = z.object(ideaReviewListShape).strict().parse(input);
  const params = new URLSearchParams({ pageSize: String(args.limit), orderBy: 'updatedAt desc' });
  if (args.cursor) params.set('pageToken', args.cursor);
  if (args.summary) {
    // Firestore field mask: overview payload excludes long evidence arrays and history.
    for (const name of ['title', 'status', 'audience', 'userTask', 'entities',
      'informationMechanism', 'marketCategory', 'updatedAt',
      'tags', 'destinations', 'assetCount', 'revision']) {
      params.append('mask.fieldPaths', name);
    }
  }
  const result = await firestore('/ideaMemory?' + params);
  const items = (result.documents ?? []).map((d: any) => parse<Idea>(d));
  return { items, nextCursor: result.nextPageToken ?? null };
}

// Authenticated owner-only point read, used only when the drawer is opened.
export async function ideaReviewDetail(ideaId: string) {
  const document = await read(path(ideaId));
  return document ? parse<Idea>(document) : null;
}
