import express from 'express';
import admin from 'firebase-admin';
import cors from 'cors';
import { runScheduler } from '@keywords/scheduler';

const app = express();
app.use(cors({ origin: 'http://localhost:3000' }));
app.use(express.json());

function initFirestore(): FirebaseFirestore.Firestore {
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.applicationDefault()
    });
  }
  return admin.firestore();
}

app.post('/projects/:projectId/run', async (req, res) => {
  const { projectId } = req.params;
  const { themeIds, manual } = req.body ?? {};
  try {
    await runScheduler({
      projectId,
      themeIds: Array.isArray(themeIds) ? themeIds : undefined,
      manual: manual ?? true
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

const port = process.env.PORT ?? 3001;

app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`API listening on http://localhost:${port}`);
});
