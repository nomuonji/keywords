import { readFileSync } from 'node:fs';
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
let cachedServiceAccount: admin.ServiceAccount | null | undefined;

const DEFAULT_PROJECT_SETTINGS: ProjectSettings = {
  name: 'Project',
  pipeline: {
    staleDays: 14,
    limits: {
      nodesPerRun: 10,
      ideasPerNode: 200,
      groupsOutlinePerRun: 10
    }
  },
  ads: {
    locale: 'ja-JP',
    languageId: 1005,
    locationIds: [2392],
    maxResults: 200,
    minVolume: 10,
    maxCompetition: 0.8
  },
  weights: {
    volume: 0.5,
    competition: 0.3,
    intent: 0.15,
    novelty: 0.05
  },
  links: {
    maxPerGroup: 3
  },
  projectId: ''
};

type ProjectSettingsLike = Partial<ProjectSettings> & {
  thresholds?: {
    minVolume?: number;
    maxCompetition?: number;
  };
};

function normalizePrivateKey(key?: string): string | undefined {
  return key?.includes('\\n') ? key.replace(/\\n/g, '\n') : key;
}

function loadServiceAccountFromEnv(): admin.ServiceAccount | null {
  if (cachedServiceAccount !== undefined) {
    return cachedServiceAccount;
  }

  const readJson = (raw: string, source: string): admin.ServiceAccount => {
    try {
      const parsed = JSON.parse(raw) as admin.ServiceAccount;
      return {
        ...parsed,
        privateKey: normalizePrivateKey(parsed.privateKey)
      };
    } catch (error) {
      throw new Error(`FIREBASE_SERVICE_ACCOUNT_* (${source}) の JSON 解析に失敗しました: ${error}`);
    }
  };

  const json = process.env.FIREBASE_SERVICE_ACCOUNT_JSON ?? process.env.FIREBASE_SERVICE_ACCOUNT;
  if (json) {
    cachedServiceAccount = readJson(json, 'JSON');
    return cachedServiceAccount;
  }

  const base64 = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
  if (base64) {
    const decoded = Buffer.from(base64, 'base64').toString('utf8');
    cachedServiceAccount = readJson(decoded, 'BASE64');
    return cachedServiceAccount;
  }

  const filePath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (filePath) {
    try {
      const contents = readFileSync(filePath, 'utf8');
      cachedServiceAccount = readJson(contents, 'PATH');
      return cachedServiceAccount;
    } catch (error) {
      throw new Error(`FIREBASE_SERVICE_ACCOUNT_PATH (${filePath}) の読み込みに失敗しました: ${error}`);
    }
  }

  cachedServiceAccount = null;
  return null;
}

function resolveProjectId(): string | undefined {
  const serviceAccount = loadServiceAccountFromEnv();
  const projectId =
    process.env.GOOGLE_CLOUD_PROJECT ??
    process.env.GCLOUD_PROJECT ??
    process.env.GCP_PROJECT_ID ??
    serviceAccount?.projectId;
  if (projectId) {
    if (!process.env.GOOGLE_CLOUD_PROJECT) {
      process.env.GOOGLE_CLOUD_PROJECT = projectId;
    }
    if (!process.env.GCLOUD_PROJECT) {
      process.env.GCLOUD_PROJECT = projectId;
    }
  }
  return projectId;
}

function createCredential(): admin.credential.Credential {
  const serviceAccount = loadServiceAccountFromEnv();
  if (serviceAccount) {
    // eslint-disable-next-line no-console
    console.log('Firebase credential: using service account from environment');
    return admin.credential.cert(serviceAccount);
  }
  try {
    // eslint-disable-next-line no-console
    console.log('Firebase credential: falling back to application default');
    return admin.credential.applicationDefault();
  } catch (error) {
    throw new Error(
      `Google Cloud の認証情報を読み込めませんでした。サービスアカウント JSON を FIREBASE_SERVICE_ACCOUNT_JSON / FIREBASE_SERVICE_ACCOUNT_BASE64 / FIREBASE_SERVICE_ACCOUNT_PATH に設定するか、gcloud auth application-default login を実行してください。原因: ${error}`
    );
  }
}

export function initFirestore(): FirebaseFirestore.Firestore {
  if (!firebaseApp) {
    const projectId = resolveProjectId();
    const options: admin.AppOptions = {
      credential: createCredential()
    };
    if (projectId) {
      options.projectId = projectId;
    }
    firebaseApp = admin.apps.length ? admin.app() : admin.initializeApp(options);
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
  const project = projectSnap.data() as ProjectDoc & { settings?: ProjectSettingsLike };
  const settings = normalizeProjectSettings(options.projectId, project.name, project.settings);
  (project as ProjectDoc).settings = settings;

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
  const snapshot = await collection.where('status', 'in', ['ready', 'ideas-pending']).get();
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - settings.pipeline.staleDays);
  const candidates: Array<{ id: string; node: NodeDoc }> = [];
  snapshot.forEach((doc) => {
    const data = doc.data();
    if (!data.lastIdeasAt) {
      candidates.push({ id: doc.id, node: data });
      return;
    }
    if (new Date(data.lastIdeasAt) <= cutoff) {
      candidates.push({ id: doc.id, node: data });
    }
  });
  const sorted = candidates.sort((a, b) => {
    const aTime = new Date(a.node.updatedAt ?? 0).valueOf();
    const bTime = new Date(b.node.updatedAt ?? 0).valueOf();
    return aTime - bTime;
  });
  return sorted.slice(0, settings.pipeline.limits.nodesPerRun);
}

function normalizeProjectSettings(
  projectId: string,
  projectName: string | undefined,
  rawSettings: ProjectSettingsLike | undefined
): ProjectSettings {
  const pipeline = {
    staleDays: rawSettings?.pipeline?.staleDays ?? DEFAULT_PROJECT_SETTINGS.pipeline.staleDays,
    limits: {
      nodesPerRun:
        rawSettings?.pipeline?.limits?.nodesPerRun ??
        DEFAULT_PROJECT_SETTINGS.pipeline.limits.nodesPerRun,
      ideasPerNode:
        rawSettings?.pipeline?.limits?.ideasPerNode ??
        DEFAULT_PROJECT_SETTINGS.pipeline.limits.ideasPerNode,
      groupsOutlinePerRun:
        rawSettings?.pipeline?.limits?.groupsOutlinePerRun ??
        DEFAULT_PROJECT_SETTINGS.pipeline.limits.groupsOutlinePerRun
    }
  };

  const thresholds = rawSettings?.thresholds ?? {};
  const overrideAds = {
    ...(rawSettings?.ads ?? {}),
    ...(thresholds.minVolume !== undefined ? { minVolume: thresholds.minVolume } : {}),
    ...(thresholds.maxCompetition !== undefined ? { maxCompetition: thresholds.maxCompetition } : {})
  };

  const ads = {
    locale: overrideAds.locale ?? DEFAULT_PROJECT_SETTINGS.ads.locale,
    languageId: overrideAds.languageId ?? DEFAULT_PROJECT_SETTINGS.ads.languageId,
    locationIds: overrideAds.locationIds ?? DEFAULT_PROJECT_SETTINGS.ads.locationIds,
    maxResults:
      overrideAds.maxResults ??
      rawSettings?.pipeline?.limits?.ideasPerNode ??
      pipeline.limits.ideasPerNode ??
      DEFAULT_PROJECT_SETTINGS.ads.maxResults,
    minVolume: overrideAds.minVolume ?? DEFAULT_PROJECT_SETTINGS.ads.minVolume,
    maxCompetition: overrideAds.maxCompetition ?? DEFAULT_PROJECT_SETTINGS.ads.maxCompetition
  };

  const weights = {
    volume: rawSettings?.weights?.volume ?? DEFAULT_PROJECT_SETTINGS.weights.volume,
    competition: rawSettings?.weights?.competition ?? DEFAULT_PROJECT_SETTINGS.weights.competition,
    intent: rawSettings?.weights?.intent ?? DEFAULT_PROJECT_SETTINGS.weights.intent,
    novelty: rawSettings?.weights?.novelty ?? DEFAULT_PROJECT_SETTINGS.weights.novelty
  };

  const links = {
    maxPerGroup: rawSettings?.links?.maxPerGroup ?? DEFAULT_PROJECT_SETTINGS.links.maxPerGroup
  };

  return {
    name: rawSettings?.name ?? projectName ?? DEFAULT_PROJECT_SETTINGS.name,
    pipeline,
    ads,
    weights,
    links,
    projectId
  };
}

function pruneUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value
      .map((item) => pruneUndefined(item))
      .filter((item) => item !== undefined) as unknown as T;
  }
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      const cleaned = pruneUndefined(entry);
      if (cleaned !== undefined) {
        result[key] = cleaned;
      }
    }
    return result as T;
  }
  return value;
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
    .filter((group) => {
      const typed = group as GroupDoc & {
        summaryDisabledAt?: string;
        summary?: { disabled?: boolean };
      };
      const hasSummary = !!typed.summary && !typed.summary?.disabled;
      return !hasSummary && !typed.summaryDisabledAt;
    });
}

export async function saveGroupSummary(
  firestore: FirebaseFirestore.Firestore,
  projectId: string,
  themeId: string,
  groupId: string,
  summary: GroupDoc['summary']
): Promise<void> {
  const ref = firestore.doc(`projects/${projectId}/themes/${themeId}/groups/${groupId}`);
  const payload: Record<string, unknown> = {
    updatedAt: nowIso()
  };
  if (summary) {
    payload.summary = pruneUndefined(summary);
    payload.summaryDisabledAt = admin.firestore.FieldValue.delete();
  }
  await ref.update(payload);
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

export async function loadGroupsByIds(
  firestore: FirebaseFirestore.Firestore,
  projectId: string,
  themeId: string,
  groupIds: string[]
): Promise<GroupDocWithId[]> {
  if (!groupIds.length) {
    return [];
  }
  const uniqueIds = [...new Set(groupIds)];
  const collection = firestore.collection(
    `projects/${projectId}/themes/${themeId}/groups`
  ) as FirebaseFirestore.CollectionReference<GroupDoc>;
  const snapshots = await Promise.all(uniqueIds.map((id) => collection.doc(id).get()));
  return snapshots
    .filter((snap) => snap.exists)
    .map((snap) => ({ id: snap.id, ...(snap.data() as GroupDoc) }));
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
