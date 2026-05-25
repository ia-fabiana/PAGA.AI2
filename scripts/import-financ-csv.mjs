// Importa CSVs de movimentação financeira do Trinks para o Firestore via endpoint Vercel.
// Uso: node scripts/import-financ-csv.mjs
import { readFileSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import { readFileSync as readEnvFile } from 'fs';

// Lê .env manualmente sem dependência de dotenv
function loadEnv(path) {
  try {
    const lines = readEnvFile(path, 'utf8').split('\n');
    for (const line of lines) {
      const m = line.match(/^([^#=]+)=(.*)$/);
      if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  } catch {}
}
loadEnv('.env');

const VERCEL_URL = 'https://paga-ai-2.vercel.app';
const IMPORT_SECRET = 'paga2026import';
const ESTABLISHMENT_ID = process.env.VITE_TRINKS_ESTABLISHMENT_ID;
const DOWNLOADS = join('C:', 'Users', 'faluc', 'Downloads');

const FILES = [
  'mov financ jan26.csv',
  'mov financ fev26.csv',
  'mov financ mar26.csv',
  'mov financ abr26.csv',
  'mov financ mai26.csv',
];

function parseBrFloat(s) {
  if (!s) return 0;
  return parseFloat(s.replace(/\./g, '').replace(',', '.')) || 0;
}

function parseDate(s) {
  // "06/01/2026" → "2026-01-06"
  const parts = s.trim().split('/');
  if (parts.length !== 3) return null;
  const [d, m, y] = parts;
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

function rowToTransaction(row) {
  if (row.length < 24) return null;

  const tipo = row[2];
  if (tipo !== 'Pagamento') return null;

  const dateAtend = parseDate(row[0]);
  if (!dateAtend) return null;

  const dataPag = row[1].trim(); // "06/01/2026 10:14"
  // Use payment date as `date` so dashboard matches Trinks "Data de Pagamento" reports
  const datePag = parseDate(dataPag.split(' ')[0]) || dateAtend;
  const clientId = row[3].trim();
  const clientName = row[4].trim();
  const total = parseBrFloat(row[23]);

  // skip zero total rows (e.g., package split payments already accounted elsewhere)
  if (total === 0) return null;

  const credito = parseBrFloat(row[16]);
  const debito = parseBrFloat(row[17]);
  const dinheiro = parseBrFloat(row[18]);
  const prePago = parseBrFloat(row[19]);
  const outros = parseBrFloat(row[20]);

  const formasPagamentos = [];
  if (credito > 0) formasPagamentos.push({ nome: 'Crédito', valor: credito, parcelas: 1 });
  if (debito > 0) formasPagamentos.push({ nome: 'Débito', valor: debito, parcelas: 1 });
  if (dinheiro > 0) formasPagamentos.push({ nome: 'Dinheiro', valor: dinheiro, parcelas: 1 });
  if (prePago > 0) formasPagamentos.push({ nome: 'Pré-Pago', valor: prePago, parcelas: 1 });
  if (outros > 0) formasPagamentos.push({ nome: 'Outros', valor: outros, parcelas: 1 });

  const hash = createHash('sha1')
    .update(`${dateAtend}_${dataPag}_${clientId}_${total}`)
    .digest('hex')
    .slice(0, 8);
  const docId = `trinks_${ESTABLISHMENT_ID}_csv_${hash}`;

  return {
    _docId: docId,
    id: 0,
    dataHora: dataPag,
    dataReferencia: `${dateAtend}T00:00:00`,
    descontos: parseBrFloat(row[14]),
    troco: parseBrFloat(row[21]),
    totalPagar: total,
    cliente: { id: parseInt(clientId) || 0, nome: clientName },
    formasPagamentos,
    servicos: [],
    produtos: [],
    pacotes: [],
    date: datePag,
    syncedAt: new Date().toISOString(),
    estabelecimentoId: ESTABLISHMENT_ID,
    importSource: 'csv',
  };
}

function parseCsv(filePath) {
  const content = readFileSync(filePath, 'latin1');
  const lines = content.split('\n');

  const headerIdx = lines.findIndex((l) => l.includes('Data de Atendimento'));
  if (headerIdx === -1) {
    console.warn(`  Cabeçalho não encontrado em ${filePath}`);
    return [];
  }

  const transactions = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const row = line.split(';').map((c) => c.replace(/^"|"$/g, ''));
    const t = rowToTransaction(row);
    if (t) transactions.push(t);
  }
  return transactions;
}

async function postBatch(transactions) {
  const res = await fetch(`${VERCEL_URL}/api/import-trinks-transactions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': IMPORT_SECRET,
    },
    body: JSON.stringify({ transactions }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
  return res.json();
}

async function main() {
  if (!IMPORT_SECRET) {
    console.error('VITE_TRINKS_API_KEY não encontrado no .env');
    process.exit(1);
  }

  let all = [];
  for (const file of FILES) {
    const path = join(DOWNLOADS, file);
    const txns = parseCsv(path);
    console.log(`${file}: ${txns.length} transações`);
    all = all.concat(txns);
  }

  console.log(`\nTotal: ${all.length} transações`);
  console.log('Enviando para Firestore...\n');

  const BATCH = 100;
  let totalSaved = 0;

  for (let i = 0; i < all.length; i += BATCH) {
    const batch = all.slice(i, i + BATCH);
    const result = await postBatch(batch);
    totalSaved += result.saved || 0;
    const pct = Math.round(((i + batch.length) / all.length) * 100);
    process.stdout.write(`  [${pct}%] ${totalSaved} salvas\r`);
  }

  console.log(`\nConcluído: ${totalSaved} transações salvas no Firestore.`);
}

main().catch((err) => {
  console.error('Erro:', err.message);
  process.exit(1);
});
