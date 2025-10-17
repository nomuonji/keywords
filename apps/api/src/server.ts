import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

const envCandidates = [
  path.resolve(process.cwd(), '.env'),
  path.resolve(__dirname, '../../.env'),
  path.resolve(__dirname, '../../../.env')
];
const loadedEnv = new Set<string>();
for (const candidate of envCandidates) {
  const resolved = path.resolve(candidate);
  if (loadedEnv.has(resolved) || !existsSync(resolved)) {
    continue;
  }
  loadedEnv.add(resolved);
  const result = dotenv.config({ path: resolved, override: false });
  if (!result.error) {
    // eslint-disable-next-line no-console
    console.log(`Loaded environment variables from ${resolved}`);
  }
}

import express from 'express';
import admin from 'firebase-admin';
import cors from 'cors';
import { runScheduler } from '@keywords/scheduler';

const app = express();
app.use(cors({ origin: 'http://localhost:3000' }));
app.use(express.json());

let cachedServiceAccount: admin.ServiceAccount | null | undefined;

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

function initFirestore(): FirebaseFirestore.Firestore {
  if (!admin.apps.length) {
    const projectId = resolveProjectId();
    const options: admin.AppOptions = {
      credential: createCredential()
    };
    if (projectId) {
      options.projectId = projectId;
    }
    admin.initializeApp(options);
  }
  return admin.firestore();
}

app.post('/projects/:projectId/run', async (req, res) => {
  const { projectId } = req.params;
  const { themeIds, manual, stages } = req.body ?? {};
  try {
    await runScheduler({
      projectId,
      themeIds: Array.isArray(themeIds) ? themeIds : undefined,
      manual: manual ?? true,
      stages
    });
    res.json({ status: 'queued', projectId });
  } catch (error) {
    res.status(500).json({ error: `${error}` });
  }
});

app.post('/projects/:projectId/themes/:themeId/nodes', async (req, res) => {
  const { projectId, themeId } = req.params;
  const { title, intent = 'info', depth = 0 } = req.body ?? {};
  if (!title) {
    res.status(400).json({ error: 'title required' });
    return;
  }
  try {
    const firestore = initFirestore();
    const nodes = firestore.collection(
      `projects/${projectId}/themes/${themeId}/nodes`
    ) as FirebaseFirestore.CollectionReference<{
      title: string;
      status: string;
      updatedAt: string;
      depth: number;
      intent: string;
    }>;
    const now = new Date().toISOString();
    const doc = await nodes.add({
      title,
      status: 'ready',
      updatedAt: now,
      depth,
      intent,
      lastIdeasAt: undefined
    } as {
      title: string;
      status: 'ready';
      updatedAt: string;
      depth: number;
      intent: string;
      lastIdeasAt?: string;
    });
    res.status(201).json({ nodeId: doc.id });
  } catch (error) {
    res.status(500).json({ error: `${error}` });
  }
});

app.delete('/projects/:projectId/themes/:themeId/nodes/:nodeId', async (req, res) => {
  const { projectId, themeId, nodeId } = req.params;
  try {
    const firestore = initFirestore();
    await firestore
      .doc(`projects/${projectId}/themes/${themeId}/nodes/${nodeId}`)
      .delete();
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: `${error}` });
  }
});

app.post('/projects/:projectId/themes/:themeId/groups:delete', async (req, res) => {
  const { projectId, themeId } = req.params;
  const { groupIds } = req.body ?? {};
  if (!Array.isArray(groupIds) || !groupIds.length) {
    res.status(400).json({ error: 'groupIds array is required' });
    return;
  }
  try {
    const firestore = initFirestore();
    let deleted = 0;
    for (const groupId of groupIds) {
      if (typeof groupId !== 'string' || !groupId.trim()) {
        continue;
      }
      const batch = firestore.batch();
      const groupRef = firestore.doc(`projects/${projectId}/themes/${themeId}/groups/${groupId}`);
      batch.delete(groupRef);

      const keywordsSnap = await firestore
        .collection(`projects/${projectId}/themes/${themeId}/keywords`)
        .where('groupId', '==', groupId)
        .get();
      keywordsSnap.forEach((docSnap) => {
        batch.delete(docSnap.ref);
      });

      const linksFromSnap = await firestore
        .collection(`projects/${projectId}/themes/${themeId}/links`)
        .where('fromGroupId', '==', groupId)
        .get();
      linksFromSnap.forEach((docSnap) => {
        batch.delete(docSnap.ref);
      });

      const linksToSnap = await firestore
        .collection(`projects/${projectId}/themes/${themeId}/links`)
        .where('toGroupId', '==', groupId)
        .get();
      linksToSnap.forEach((docSnap) => {
        batch.delete(docSnap.ref);
      });

      await batch.commit();
      deleted += 1;
    }
    res.json({ deleted });
  } catch (error) {
    res.status(500).json({ error: `${error}` });
  }
});

app.post('/projects/:projectId/themes/:themeId/outlines:run', async (req, res) => {
  const { projectId, themeId } = req.params;
  const { includeLinks = true } = req.body ?? {};
  try {
    await runScheduler({
      projectId,
      themeIds: [themeId],
      manual: true,
      stages: {
        ideas: false,
        clustering: false,
        scoring: false,
        outline: true,
        links: !!includeLinks
      }
    });
    res.json({ status: 'queued', projectId, themeId, stages: { outline: true, links: !!includeLinks } });
  } catch (error) {
    res.status(500).json({ error: `${error}` });
  }
});

const port = process.env.PORT ?? 3001;

console.log('GCP_PROJECT_ID at app.listen:', process.env.GCP_PROJECT_ID);
app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`API listening on http://localhost:${port}`);
});
