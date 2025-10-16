import admin from 'firebase-admin';
import { nowIso } from '@keywords/core';
import type {
  GroupDoc,
  JobDoc,
  JobSummary,
  KeywordDoc,
  LinkDoc,
  NodeDoc,
  ProjectDoc,
  ProjectSettings,
  ThemeDoc
} from '@keywords/core';
import type {
  GroupDocWithId,
  KeywordDocWithId,
  PipelineCounters,
  ProjectContext,
  SchedulerOptions,
  ThemeDocWithId
} from './types';

let firebaseApp: admin.app.App | undefined;

export function initFirestore(): FirebaseFirestore.Firestore {
  if (!firebaseApp) {
    firebaseApp = admin.apps.length
      ? admin.app()
      : admin.initializeApp({
          credential: admin.credential.applicationDefault()
        });
  }
  return admin.firestore();
}

export async function loadProjectContext(
  firestore: FirebaseFirestore.Firestore,
  options: SchedulerOptions
): Promise<ProjectContext> {
  const projectSnap = await firestore.doc(`projects/${options.projectId}`).get();
  if (!projectSnap.exists) {
    throw new Error(`Project ${options.projectId} not found`);
  }
  const project = projectSnap.data() as ProjectDoc;
  const settings = project.settings as ProjectSettings;

  const themesQuery = firestore.collection(`projects/${options.projectId}/themes`);
  const themesSnapshot = await themesQuery.get();
  const themes: ThemeDocWithId[] = themesSnapshot.docs.map((doc) => ({
    id: doc.id,
    ...(doc.data() as ThemeDoc)
  }));

  return {
    projectId: options.projectId,
    project,
    settings,
    themes
  };
}

export interface PipelineLock {
  release: () => Promise<void>;
  ref: FirebaseFirestore.DocumentReference;
}

export async function acquireLock(
  firestore: FirebaseFirestore.Firestore,
  projectId: string
): Promise<PipelineLock> {
  const lockRef = firestore.doc(`projects/${projectId}/locks/pipeline`);
  const lockSnap = await lockRef.get();
  if (lockSnap.exists) {
    const data = lockSnap.data();
    throw new Error(`Project ${projectId} already locked (${data?.jobId ?? 'unknown'})`);
  }
  await lockRef.set({
    jobId: null,
    lockedAt: nowIso()
  });
  return {
    ref: lockRef,
    release: async () => {
      await lockRef.delete();
    }
  };
}

export async function createJob(
  firestore: FirebaseFirestore.Firestore,
  projectId: string,
  payload: JobDoc['payload'],
  type: JobDoc['type']
): Promise<FirebaseFirestore.DocumentReference<JobDoc>> {
  const jobsRef = firestore.collection(`projects/${projectId}/jobs`) as FirebaseFirestore.CollectionReference<JobDoc>;
  const jobRef = jobsRef.doc();
  const initialSummary: JobSummary = {
    nodesProcessed: 0,
    newKeywords: 0,
    groupsCreated: 0,
    groupsUpdated: 0,
    outlinesCreated: 0,
    linksUpdated: 0,
    errors: []
  };
  const now = nowIso();
  await jobRef.set({
    type,
    status: 'running',
    payload,
    summary: initialSummary,
    startedAt: now,
    finishedAt: now
  });
  return jobRef;
}

export async function updateJobSummary(
  jobRef: FirebaseFirestore.DocumentReference<JobDoc>,
  counters: PipelineCounters,
  status: JobDoc['status'],
  errors: JobDoc['summary']['errors']
): Promise<void> {
  await jobRef.update({
    'summary.nodesProcessed': counters.nodesProcessed,
    'summary.newKeywords': counters.newKeywords,
    'summary.groupsCreated': counters.groupsCreated,
    'summary.groupsUpdated': counters.groupsUpdated,
    'summary.outlinesCreated': counters.outlinesCreated,
    'summary.linksUpdated': counters.linksUpdated,
    'summary.errors': errors,
    status,
    finishedAt: nowIso()
  });
}

export async function getAutoThemes(
  firestore: FirebaseFirestore.Firestore,
  projectId: string,
  themeIds?: string[]
): Promise<ThemeDocWithId[]> {
  const all = await firestore
    .collection(`projects/${projectId}/themes`)
    .where('autoUpdate', '==', true)
    .get();
  const themes = all.docs
    .map((doc) => ({ id: doc.id, ...(doc.data() as ThemeDoc) }))
    .filter((theme) => (themeIds ? themeIds.includes(theme.id) : true));
  return themes;
}

export async function getEligibleNodes(
  firestore: FirebaseFirestore.Firestore,
  projectId: string,
  themeId: string,
  settings: ProjectSettings
): Promise<Array<{ id: string; node: NodeDoc }>> {
  const collection = firestore.collection(
    `projects/${projectId}/themes/${themeId}/nodes`
  ) as FirebaseFirestore.CollectionReference<NodeDoc>;
  const snapshot = await collection
    .where('status', 'in', ['ready', 'ideas-pending'])
    .orderBy('updatedAt', 'asc')
    .limit(settings.pipeline.limits.nodesPerRun)
    .get();
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - settings.pipeline.staleDays);
  const result: Array<{ id: string; node: NodeDoc }> = [];
  snapshot.forEach((doc) => {
    const data = doc.data();
    if (!data.lastIdeasAt) {
      result.push({ id: doc.id, node: data });
      return;
    }
    if (new Date(data.lastIdeasAt) <= cutoff) {
      result.push({ id: doc.id, node: data });
    }
  });
  return result;
}

export async function saveKeywords(
  firestore: FirebaseFirestore.Firestore,
  projectId: string,
  themeId: string,
  keywords: Array<{ keyword: string; metrics: KeywordDoc['metrics']; dedupeHash: string; sourceNodeId: string }>
): Promise<KeywordDocWithId[]> {
  const collection = firestore.collection(
    `projects/${projectId}/themes/${themeId}/keywords`
  ) as FirebaseFirestore.CollectionReference<KeywordDoc>;
  const batch = firestore.batch();
  const written: KeywordDocWithId[] = [];
  for (const kw of keywords) {
    const docRef = collection.doc();
    const keywordDoc: KeywordDoc = {
      text: kw.keyword,
      dedupeHash: kw.dedupeHash,
      locale: 'ja',
      sourceNodeId: kw.sourceNodeId,
      metrics: kw.metrics,
      score: 0,
      groupId: undefined,
      status: 'new',
      versions: [
        {
          metrics: kw.metrics,
          score: 0,
          at: nowIso()
        }
      ],
      updatedAt: nowIso()
    };
    batch.set(docRef, keywordDoc, { merge: true });
    written.push({ id: docRef.id, ...keywordDoc });
  }
  await batch.commit();
  return written;
}

export async function fetchKeywordHashes(
  firestore: FirebaseFirestore.Firestore,
  projectId: string,
  themeId: string
): Promise<Set<string>> {
  const collection = firestore.collection(
    `projects/${projectId}/themes/${themeId}/keywords`
  ) as FirebaseFirestore.CollectionReference<KeywordDoc>;
  const snapshot = await collection.select('dedupeHash').get();
  const hashes = new Set<string>();
  snapshot.forEach((doc) => {
    const data = doc.data();
    if (data.dedupeHash) {
      hashes.add(data.dedupeHash);
    }
  });
  return hashes;
}

export async function updateNodeIdeasAt(
  firestore: FirebaseFirestore.Firestore,
  projectId: string,
  themeId: string,
  nodeId: string
): Promise<void> {
  const ref = firestore.doc(`projects/${projectId}/themes/${themeId}/nodes/${nodeId}`);
  await ref.update({
    lastIdeasAt: nowIso(),
    updatedAt: nowIso(),
    status: 'ideas-done'
  } as Partial<NodeDoc>);
}

export async function loadKeywordsForClustering(
  firestore: FirebaseFirestore.Firestore,
  projectId: string,
  themeId: string
): Promise<KeywordDocWithId[]> {
  const collection = firestore.collection(
    `projects/${projectId}/themes/${themeId}/keywords`
  ) as FirebaseFirestore.CollectionReference<KeywordDoc>;
  const snapshot = await collection.where('status', 'in', ['new', 'scored']).get();
  return snapshot.docs.map((doc) => ({
    id: doc.id,
    ...(doc.data() as KeywordDoc)
  }));
}

export async function upsertGroup(
  firestore: FirebaseFirestore.Firestore,
  projectId: string,
  themeId: string,
  group: GroupDoc,
  groupId?: string
): Promise<GroupDocWithId> {
  const groupsCollection = firestore.collection(
    `projects/${projectId}/themes/${themeId}/groups`
  ) as FirebaseFirestore.CollectionReference<GroupDoc>;
  const ref = groupId ? groupsCollection.doc(groupId) : groupsCollection.doc();
  const data = {
    ...group,
    updatedAt: nowIso()
  };
  await ref.set(data, { merge: true });
  return { id: ref.id, ...data };
}

export async function updateKeywordsAfterGrouping(
  firestore: FirebaseFirestore.Firestore,
  projectId: string,
  themeId: string,
  updates: Array<{ id: string; groupId: string; status: KeywordDoc['status']; score: number; metrics: KeywordDoc['metrics']; versions: KeywordDoc['versions'] }>
): Promise<void> {
  const collection = firestore.collection(
    `projects/${projectId}/themes/${themeId}/keywords`
  ) as FirebaseFirestore.CollectionReference<KeywordDoc>;
  const batch = firestore.batch();
  for (const update of updates) {
    const ref = collection.doc(update.id);
    batch.update(ref, {
      groupId: update.groupId,
      status: update.status,
      score: update.score,
      metrics: update.metrics,
      versions: update.versions,
      updatedAt: nowIso()
    });
  }
  await batch.commit();
}

export async function loadGroupsNeedingOutline(
  firestore: FirebaseFirestore.Firestore,
  projectId: string,
  themeId: string,
  limit: number
): Promise<GroupDocWithId[]> {
  const collection = firestore.collection(
    `projects/${projectId}/themes/${themeId}/groups`
  ) as FirebaseFirestore.CollectionReference<GroupDoc>;
  const snapshot = await collection
    .orderBy('priorityScore', 'desc')
    .limit(limit * 2)
    .get();
  return snapshot.docs
    .map((doc) => ({ id: doc.id, ...(doc.data() as GroupDoc) }))
    .filter((group) => !group.summary);
}

export async function saveGroupSummary(
  firestore: FirebaseFirestore.Firestore,
  projectId: string,
  themeId: string,
  groupId: string,
  summary: GroupDoc['summary']
): Promise<void> {
  const ref = firestore.doc(`projects/${projectId}/themes/${themeId}/groups/${groupId}`);
  await ref.update({
    summary,
    updatedAt: nowIso()
  });
}

export async function loadGroupsForLinking(
  firestore: FirebaseFirestore.Firestore,
  projectId: string,
  themeId: string
): Promise<GroupDocWithId[]> {
  const collection = firestore.collection(
    `projects/${projectId}/themes/${themeId}/groups`
  ) as FirebaseFirestore.CollectionReference<GroupDoc>;
  const snapshot = await collection.get();
  return snapshot.docs.map((doc) => ({
    id: doc.id,
    ...(doc.data() as GroupDoc)
  }));
}

export async function upsertLinks(
  firestore: FirebaseFirestore.Firestore,
  projectId: string,
  themeId: string,
  links: LinkDoc[]
): Promise<void> {
  const collection = firestore.collection(
    `projects/${projectId}/themes/${themeId}/links`
  ) as FirebaseFirestore.CollectionReference<LinkDoc>;
  const batch = firestore.batch();
  for (const link of links) {
    const key = `${link.fromGroupId}__${link.toGroupId}`;
    const ref = collection.doc(key);
    batch.set(ref, { ...link, updatedAt: nowIso() }, { merge: true });
  }
  await batch.commit();
}
