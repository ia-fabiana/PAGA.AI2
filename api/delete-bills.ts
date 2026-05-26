import type { VercelRequest, VercelResponse } from '@vercel/node';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

function getDb() {
  if (!getApps().length) {
    initializeApp({
      credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID?.trim(),
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL?.trim(),
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n').trim(),
      }),
    });
  }
  return getFirestore();
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const apiKey = req.headers['x-api-key'];
  const expectedSecret = process.env.TRINKS_IMPORT_SECRET?.trim();
  if (!apiKey || !expectedSecret || apiKey !== expectedSecret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const db = getDb();
  const { ids } = req.body as { ids: string[] };

  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'ids array required' });
  }

  const WORKSPACE = 'paga-ai2-shared';
  const BATCH_SIZE = 400;
  let deleted = 0;

  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const batch = db.batch();
    for (const id of ids.slice(i, i + BATCH_SIZE)) {
      const ref = db.collection('workspaces').doc(WORKSPACE).collection('bills').doc(id);
      batch.delete(ref);
      deleted++;
    }
    await batch.commit();
  }

  return res.status(200).json({ deleted });
}
