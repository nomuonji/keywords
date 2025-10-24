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
import { nowIso } from '@keywords/core';
import { runScheduler, runOutlineGeneration, runLinkGeneration, loadConfig } from '@keywords/scheduler';
import { GeminiClient } from '@keywords/gemini';

const app = express();
app.use(cors({ origin: 'http://localhost:3000' }));
app.use(express.json());

const config = loadConfig();
const geminiClient = new GeminiClient(config.gemini);

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

app.post('/projects/:projectId/themes/:themeId/groups\:delete', async (req, res) => {
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

app.post('/projects/:projectId/themes/:themeId/outlines\:run', async (req, res) => {
  const { projectId, themeId } = req.params;
  const { includeLinks = false, groupIds } = req.body ?? {};
  try {
    const parsedGroupIds = Array.isArray(groupIds)
      ? groupIds.filter((id: unknown): id is string => typeof id === 'string' && id.trim().length > 0)
      : undefined;
    const outlineResult = await runOutlineGeneration({
      projectId,
      themeId,
      groupIds: parsedGroupIds
    });
    let linkResult: Awaited<ReturnType<typeof runLinkGeneration>> | undefined;
    if (includeLinks) {
      const inferredSourceGroupIds =
        parsedGroupIds && parsedGroupIds.length
          ? parsedGroupIds
          : outlineResult.outlinedGroupIds.length
            ? outlineResult.outlinedGroupIds
            : undefined;
      if (inferredSourceGroupIds && inferredSourceGroupIds.length) {
        linkResult = await runLinkGeneration({
          projectId,
          themeId,
          sourceGroupIds: inferredSourceGroupIds
        });
      } else {
        linkResult = await runLinkGeneration({ projectId, themeId });
      }
    }
    res.json({
      status: 'completed',
      projectId,
      themeId,
      outlinesCreated: outlineResult.outlinesCreated,
      outlinedGroupIds: outlineResult.outlinedGroupIds,
      linksCreated: linkResult?.linksCreated ?? 0,
      linkSourceGroupIds: linkResult?.sourceGroupIds ?? []
    });
  } catch (error) {
    console.error(
      '[outlines:run] failed',
      JSON.stringify({ projectId, themeId, groupIds, error: `${error}` })
    );
    res.status(500).json({ error: `${error}` });
  }
});

app.post('/projects/:projectId/themes/:themeId/outlines\:delete', async (req, res) => {
  const { projectId, themeId } = req.params;
  const { groupIds } = req.body ?? {};
  if (!Array.isArray(groupIds) || !groupIds.length) {
    res.status(400).json({ error: 'groupIds array is required' });
    return;
  }
  const validIds = groupIds
    .filter((id: unknown): id is string => typeof id === 'string' && id.trim().length > 0)
    .map((id) => id.trim());
  if (!validIds.length) {
    res.status(400).json({ error: 'No valid groupIds provided' });
    return;
  }
  try {
    const firestore = initFirestore();
    const batch = firestore.batch();
    let cleared = 0;
    for (const groupId of validIds) {
      const ref = firestore.doc(`projects/${projectId}/themes/${themeId}/groups/${groupId}`);
      const snapshot = await ref.get();
      batch.update(ref, {
        summary: {
          disabled: true
        },
        summaryDisabledAt: nowIso(),
        updatedAt: nowIso()
      });
      cleared += 1;
    }
    if (!cleared) {
      res.json({ cleared: 0 });
      return;
    }
    await batch.commit();
    res.json({ cleared });
  } catch (error) {
    console.error(
      '[outlines:delete] failed',
      JSON.stringify({ projectId, themeId, groupIds: validIds, error: `${error}` })
    );
    res.status(500).json({ error: `${error}` });
  }
});

app.post('/projects/:projectId/themes/:themeId/links\:generate', async (req, res) => {
  const { projectId, themeId } = req.params;
  const { sourceGroupIds } = req.body ?? {};
  try {
    const parsedIds = Array.isArray(sourceGroupIds)
      ? sourceGroupIds.filter((id: unknown): id is string => typeof id === 'string' && id.trim().length > 0)
      : undefined;
    const result = await runLinkGeneration({ projectId, themeId, sourceGroupIds: parsedIds });
    res.json({
      status: 'completed',
      projectId,
      themeId,
      linksCreated: result.linksCreated,
      linkSourceGroupIds: result.sourceGroupIds
    });
  } catch (error) {
    res.status(500).json({ error: `${error}` });
  }
});

app.post('/projects/:projectId/suggest-themes', async (req, res) => {
  const { description } = req.body ?? {};
  if (!description) {
    res.status(400).json({ error: 'description is required' });
    return;
  }
  try {
    const suggestions = await geminiClient.suggestThemes({ description });
    res.json({ suggestions });
  } catch (error) {
    res.status(500).json({ error: `${error}` });
  }
});

app.post('/projects/:projectId/themes/:themeId/suggest-nodes', async (req, res) => {
  const { projectId, themeId } = req.params;
  const { theme, existingNodes } = req.body ?? {};
  if (!theme) {
    res.status(400).json({ error: 'theme is required' });
    return;
  }
  try {
    const suggestions = await geminiClient.suggestNodes({ theme, existingNodes: existingNodes ?? [] });
    res.json({ suggestions });
  } catch (error) {
    res.status(500).json({ error: `${error}` });
  }
});

export default app;
