"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.initFirestore = initFirestore;
exports.loadProjectContext = loadProjectContext;
exports.acquireLock = acquireLock;
exports.createJob = createJob;
exports.updateJobSummary = updateJobSummary;
exports.getAutoThemes = getAutoThemes;
exports.getEligibleNodes = getEligibleNodes;
exports.saveKeywords = saveKeywords;
exports.fetchKeywordHashes = fetchKeywordHashes;
exports.updateNodeIdeasAt = updateNodeIdeasAt;
exports.loadKeywordsForClustering = loadKeywordsForClustering;
exports.upsertGroup = upsertGroup;
exports.updateKeywordsAfterGrouping = updateKeywordsAfterGrouping;
exports.loadGroupsNeedingOutline = loadGroupsNeedingOutline;
exports.saveGroupSummary = saveGroupSummary;
exports.loadGroupsForLinking = loadGroupsForLinking;
exports.loadGroupsByIds = loadGroupsByIds;
exports.upsertLinks = upsertLinks;
const node_fs_1 = require("node:fs");
const firebase_admin_1 = __importDefault(require("firebase-admin"));
const core_1 = require("@keywords/core");
let firebaseApp;
let cachedServiceAccount;
const DEFAULT_PROJECT_SETTINGS = {
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
function normalizePrivateKey(key) {
    return key?.includes('\\n') ? key.replace(/\\n/g, '\n') : key;
}
function loadServiceAccountFromEnv() {
    if (cachedServiceAccount !== undefined) {
        return cachedServiceAccount;
    }
    const readJson = (raw, source) => {
        try {
            const parsed = JSON.parse(raw);
            return {
                ...parsed,
                privateKey: normalizePrivateKey(parsed.privateKey)
            };
        }
        catch (error) {
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
            const contents = (0, node_fs_1.readFileSync)(filePath, 'utf8');
            cachedServiceAccount = readJson(contents, 'PATH');
            return cachedServiceAccount;
        }
        catch (error) {
            throw new Error(`FIREBASE_SERVICE_ACCOUNT_PATH (${filePath}) の読み込みに失敗しました: ${error}`);
        }
    }
    cachedServiceAccount = null;
    return null;
}
function resolveProjectId() {
    const serviceAccount = loadServiceAccountFromEnv();
    const projectId = process.env.GOOGLE_CLOUD_PROJECT ??
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
function createCredential() {
    const serviceAccount = loadServiceAccountFromEnv();
    if (serviceAccount) {
        // eslint-disable-next-line no-console
        console.log('Firebase credential: using service account from environment');
        return firebase_admin_1.default.credential.cert(serviceAccount);
    }
    try {
        // eslint-disable-next-line no-console
        console.log('Firebase credential: falling back to application default');
        return firebase_admin_1.default.credential.applicationDefault();
    }
    catch (error) {
        throw new Error(`Google Cloud の認証情報を読み込めませんでした。サービスアカウント JSON を FIREBASE_SERVICE_ACCOUNT_JSON / FIREBASE_SERVICE_ACCOUNT_BASE64 / FIREBASE_SERVICE_ACCOUNT_PATH に設定するか、gcloud auth application-default login を実行してください。原因: ${error}`);
    }
}
function initFirestore() {
    if (!firebaseApp) {
        const projectId = resolveProjectId();
        const options = {
            credential: createCredential()
        };
        if (projectId) {
            options.projectId = projectId;
        }
        firebaseApp = firebase_admin_1.default.apps.length ? firebase_admin_1.default.app() : firebase_admin_1.default.initializeApp(options);
    }
    return firebase_admin_1.default.firestore();
}
async function loadProjectContext(firestore, options) {
    const projectSnap = await firestore.doc(`projects/${options.projectId}`).get();
    if (!projectSnap.exists) {
        throw new Error(`Project ${options.projectId} not found`);
    }
    const project = projectSnap.data();
    const settings = normalizeProjectSettings(options.projectId, project.name, project.settings);
    project.settings = settings;
    const themesQuery = firestore.collection(`projects/${options.projectId}/themes`);
    const themesSnapshot = await themesQuery.get();
    const themes = themesSnapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data()
    }));
    return {
        projectId: options.projectId,
        project,
        settings,
        themes
    };
}
async function acquireLock(firestore, projectId) {
    const lockRef = firestore.doc(`projects/${projectId}/locks/pipeline`);
    const lockSnap = await lockRef.get();
    if (lockSnap.exists) {
        const data = lockSnap.data();
        throw new Error(`Project ${projectId} already locked (${data?.jobId ?? 'unknown'})`);
    }
    await lockRef.set({
        jobId: null,
        lockedAt: (0, core_1.nowIso)()
    });
    return {
        ref: lockRef,
        release: async () => {
            await lockRef.delete();
        }
    };
}
async function createJob(firestore, projectId, payload, type) {
    const jobsRef = firestore.collection(`projects/${projectId}/jobs`);
    const jobRef = jobsRef.doc();
    const initialSummary = {
        nodesProcessed: 0,
        newKeywords: 0,
        groupsCreated: 0,
        groupsUpdated: 0,
        outlinesCreated: 0,
        linksUpdated: 0,
        errors: []
    };
    const now = (0, core_1.nowIso)();
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
async function updateJobSummary(jobRef, counters, status, errors) {
    await jobRef.update({
        'summary.nodesProcessed': counters.nodesProcessed,
        'summary.newKeywords': counters.newKeywords,
        'summary.groupsCreated': counters.groupsCreated,
        'summary.groupsUpdated': counters.groupsUpdated,
        'summary.outlinesCreated': counters.outlinesCreated,
        'summary.linksUpdated': counters.linksUpdated,
        'summary.errors': errors,
        status,
        finishedAt: (0, core_1.nowIso)()
    });
}
async function getAutoThemes(firestore, projectId, themeIds) {
    const all = await firestore
        .collection(`projects/${projectId}/themes`)
        .where('autoUpdate', '==', true)
        .get();
    const themes = all.docs
        .map((doc) => ({ id: doc.id, ...doc.data() }))
        .filter((theme) => (themeIds ? themeIds.includes(theme.id) : true));
    return themes;
}
async function getEligibleNodes(firestore, projectId, themeId, settings) {
    const collection = firestore.collection(`projects/${projectId}/themes/${themeId}/nodes`);
    const snapshot = await collection.where('status', 'in', ['ready', 'ideas-pending']).get();
    const cutoff = new Date();
    cutoff.setUTCDate(cutoff.getUTCDate() - settings.pipeline.staleDays);
    const candidates = [];
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
function normalizeProjectSettings(projectId, projectName, rawSettings) {
    const pipeline = {
        staleDays: rawSettings?.pipeline?.staleDays ?? DEFAULT_PROJECT_SETTINGS.pipeline.staleDays,
        limits: {
            nodesPerRun: rawSettings?.pipeline?.limits?.nodesPerRun ??
                DEFAULT_PROJECT_SETTINGS.pipeline.limits.nodesPerRun,
            ideasPerNode: rawSettings?.pipeline?.limits?.ideasPerNode ??
                DEFAULT_PROJECT_SETTINGS.pipeline.limits.ideasPerNode,
            groupsOutlinePerRun: rawSettings?.pipeline?.limits?.groupsOutlinePerRun ??
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
        maxResults: overrideAds.maxResults ??
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
function pruneUndefined(value) {
    if (Array.isArray(value)) {
        return value
            .map((item) => pruneUndefined(item))
            .filter((item) => item !== undefined);
    }
    if (value && typeof value === 'object') {
        const result = {};
        for (const [key, entry] of Object.entries(value)) {
            const cleaned = pruneUndefined(entry);
            if (cleaned !== undefined) {
                result[key] = cleaned;
            }
        }
        return result;
    }
    return value;
}
async function saveKeywords(firestore, projectId, themeId, keywords) {
    const collection = firestore.collection(`projects/${projectId}/themes/${themeId}/keywords`);
    const batch = firestore.batch();
    const written = [];
    for (const kw of keywords) {
        const docRef = collection.doc();
        const keywordDoc = {
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
                    at: (0, core_1.nowIso)()
                }
            ],
            updatedAt: (0, core_1.nowIso)()
        };
        batch.set(docRef, keywordDoc, { merge: true });
        written.push({ id: docRef.id, ...keywordDoc });
    }
    await batch.commit();
    return written;
}
async function fetchKeywordHashes(firestore, projectId, themeId) {
    const collection = firestore.collection(`projects/${projectId}/themes/${themeId}/keywords`);
    const snapshot = await collection.select('dedupeHash').get();
    const hashes = new Set();
    snapshot.forEach((doc) => {
        const data = doc.data();
        if (data.dedupeHash) {
            hashes.add(data.dedupeHash);
        }
    });
    return hashes;
}
async function updateNodeIdeasAt(firestore, projectId, themeId, nodeId) {
    const ref = firestore.doc(`projects/${projectId}/themes/${themeId}/nodes/${nodeId}`);
    await ref.update({
        lastIdeasAt: (0, core_1.nowIso)(),
        updatedAt: (0, core_1.nowIso)(),
        status: 'ideas-done'
    });
}
async function loadKeywordsForClustering(firestore, projectId, themeId) {
    const collection = firestore.collection(`projects/${projectId}/themes/${themeId}/keywords`);
    const snapshot = await collection.where('status', 'in', ['new', 'scored']).get();
    return snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data()
    }));
}
async function upsertGroup(firestore, projectId, themeId, group, groupId) {
    const groupsCollection = firestore.collection(`projects/${projectId}/themes/${themeId}/groups`);
    const ref = groupId ? groupsCollection.doc(groupId) : groupsCollection.doc();
    const data = {
        ...group,
        updatedAt: (0, core_1.nowIso)()
    };
    await ref.set(data, { merge: true });
    return { id: ref.id, ...data };
}
async function updateKeywordsAfterGrouping(firestore, projectId, themeId, updates) {
    const collection = firestore.collection(`projects/${projectId}/themes/${themeId}/keywords`);
    const batch = firestore.batch();
    for (const update of updates) {
        const ref = collection.doc(update.id);
        batch.update(ref, {
            groupId: update.groupId,
            status: update.status,
            score: update.score,
            metrics: update.metrics,
            versions: update.versions,
            updatedAt: (0, core_1.nowIso)()
        });
    }
    await batch.commit();
}
async function loadGroupsNeedingOutline(firestore, projectId, themeId, limit) {
    const collection = firestore.collection(`projects/${projectId}/themes/${themeId}/groups`);
    const snapshot = await collection
        .orderBy('priorityScore', 'desc')
        .limit(limit * 2)
        .get();
    return snapshot.docs
        .map((doc) => ({ id: doc.id, ...doc.data() }))
        .filter((group) => {
        const typed = group;
        const hasSummary = !!typed.summary && !typed.summary?.disabled;
        return !hasSummary && !typed.summaryDisabledAt;
    });
}
async function saveGroupSummary(firestore, projectId, themeId, groupId, summary) {
    const ref = firestore.doc(`projects/${projectId}/themes/${themeId}/groups/${groupId}`);
    const payload = {
        updatedAt: (0, core_1.nowIso)()
    };
    if (summary) {
        payload.summary = pruneUndefined(summary);
        payload.summaryDisabledAt = firebase_admin_1.default.firestore.FieldValue.delete();
    }
    await ref.update(payload);
}
async function loadGroupsForLinking(firestore, projectId, themeId) {
    const collection = firestore.collection(`projects/${projectId}/themes/${themeId}/groups`);
    const snapshot = await collection.get();
    return snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data()
    }));
}
async function loadGroupsByIds(firestore, projectId, themeId, groupIds) {
    if (!groupIds.length) {
        return [];
    }
    const uniqueIds = [...new Set(groupIds)];
    const collection = firestore.collection(`projects/${projectId}/themes/${themeId}/groups`);
    const snapshots = await Promise.all(uniqueIds.map((id) => collection.doc(id).get()));
    return snapshots
        .filter((snap) => snap.exists)
        .map((snap) => ({ id: snap.id, ...snap.data() }));
}
async function upsertLinks(firestore, projectId, themeId, links) {
    const collection = firestore.collection(`projects/${projectId}/themes/${themeId}/links`);
    const batch = firestore.batch();
    for (const link of links) {
        const key = `${link.fromGroupId}__${link.toGroupId}`;
        const ref = collection.doc(key);
        batch.set(ref, { ...link, updatedAt: (0, core_1.nowIso)() }, { merge: true });
    }
    await batch.commit();
}
