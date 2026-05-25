// Remove API-synced trinks_transactions docs for Jan-May 2026 that duplicate CSV data.
// Run once: node scripts/cleanup-api-docs-2026.mjs
import { readFileSync } from 'fs';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

function loadEnv(path) {
  try {
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      const m = line.match(/^([^#=]+)=(.*)$/);
      if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  } catch {}
}
loadEnv('.env');

if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_PROJECT_ID?.trim(),
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL?.trim(),
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n').trim(),
    }),
  });
}
const db = getFirestore();

async function main() {
  const snap = await db.collection('trinks_transactions')
    .where('date', '>=', '2026-01-01')
    .where('date', '<=', '2026-05-31')
    .orderBy('date')
    .get();

  const toDelete = snap.docs.filter(d => d.data().importSource !== 'csv');
  console.log(`Encontrados ${snap.size} docs no período, ${toDelete.length} não-CSV para deletar.`);

  if (toDelete.length === 0) { console.log('Nada a deletar.'); return; }

  const BATCH = 500;
  let deleted = 0;
  for (let i = 0; i < toDelete.length; i += BATCH) {
    const batch = db.batch();
    toDelete.slice(i, i + BATCH).forEach(d => batch.delete(d.ref));
    await batch.commit();
    deleted += Math.min(BATCH, toDelete.length - i);
    process.stdout.write(`  ${deleted}/${toDelete.length} deletados\r`);
  }
  console.log(`\nConcluído: ${deleted} docs API deletados.`);
}

main().catch(err => { console.error(err); process.exit(1); });
