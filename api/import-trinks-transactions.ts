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

  if (req.method === 'GET') {
    const db = getDb();
    const from = (req.query.date_from as string) || '2026-01-01';
    const to = (req.query.date_to as string) || '2026-12-31';
    const snap = await db.collection('trinks_transactions')
      .where('date', '>=', from)
      .where('date', '<=', to)
      .orderBy('date', 'asc')
      .get();
    return res.status(200).json({ count: snap.size, from, to });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = req.body as { transactions?: unknown[] };
  if (!Array.isArray(body?.transactions)) {
    return res.status(400).json({ error: 'transactions must be an array' });
  }

  const db = getDb();
  let saved = 0;

  for (const t of body.transactions as Array<Record<string, unknown>>) {
    const docId = t._docId as string;
    if (!docId) continue;
    const { _docId, ...data } = t;
    await db.collection('trinks_transactions').doc(docId).set(data, { merge: true });
    saved++;
  }

  console.log(`[import-trinks-transactions] saved ${saved} transactions`);
  return res.status(200).json({ received: true, saved });
}
