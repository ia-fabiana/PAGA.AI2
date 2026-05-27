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
    let totalPagar = 0, totalCash = 0, csvCount = 0, apiCount = 0;
    const IGNORADO = new Set(['Crédito de Cliente','Vale-Presente','Descontar do Profissional','Pré-Pago']);
    snap.forEach(d => {
      const data = d.data() as Record<string, unknown>;
      totalPagar += (data.totalPagar as number) || 0;
      const fps = (data.formasPagamentos as Array<{nome:string;valor:number}>) || [];
      for (const fp of fps) if (!IGNORADO.has(fp.nome)) totalCash += fp.valor;
      if ((data.importSource as string) === 'csv') csvCount++; else apiCount++;
    });
    return res.status(200).json({ count: snap.size, csvCount, apiCount, totalPagar: +totalPagar.toFixed(2), totalCash: +totalCash.toFixed(2), from, to });
  }

  if (req.method === 'DELETE') {
    const db = getDb();
    const from = (req.query.date_from as string) || '2026-01-01';
    const to = (req.query.date_to as string) || '2026-05-31';
    const snap = await db.collection('trinks_transactions')
      .where('date', '>=', from)
      .where('date', '<=', to)
      .orderBy('date', 'asc')
      .get();
    const includeCSV = req.query.include_csv === 'true';
    const toDelete = includeCSV ? snap.docs : snap.docs.filter(d => d.data().importSource !== 'csv');
    let deleted = 0;
    const BATCH = 500;
    for (let i = 0; i < toDelete.length; i += BATCH) {
      const batch = db.batch();
      toDelete.slice(i, i + BATCH).forEach(d => batch.delete(d.ref));
      await batch.commit();
      deleted += Math.min(BATCH, toDelete.length - i);
    }
    console.log(`[cleanup] deleted ${deleted} docs (includeCSV=${includeCSV}) between ${from} and ${to}`);
    return res.status(200).json({ deleted, total: snap.size, from, to });
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
    await db.collection('trinks_transactions').doc(docId).set(data);
    saved++;
  }

  console.log(`[import-trinks-transactions] saved ${saved} transactions`);
  return res.status(200).json({ received: true, saved });
}
