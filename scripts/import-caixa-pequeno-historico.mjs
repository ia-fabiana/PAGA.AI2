// Importa saídas históricas do Caixa Pequeno (Jan-Mai 2026) para o Firestore.
// Dados extraídos de: https://docs.google.com/spreadsheets/d/1qIVJ329AAC6VnCSspuvQt7xwZ6Fjd3z-Hjirq6cA7d4
// Uso: node scripts/import-caixa-pequeno-historico.mjs

const VERCEL_URL = 'https://paga-ai-2.vercel.app';
const IMPORT_SECRET = 'paga2026import';

// Janeiro: 1 transação com data real da planilha (aba de detalhe gid=0).
// Fev–Mai: totais mensais da aba de resumo (gid=1726890208) — sem detalhe individual.
const DESPESAS = [
  { date: '2026-01-14', description: 'Codigo de Defesa do Consumidor', amount: 30.00 },
  { date: '2026-02-28', description: 'Saídas Caixa Pequeno - Fevereiro 2026', amount: 4000.00 },
  { date: '2026-03-31', description: 'Saídas Caixa Pequeno - Março 2026', amount: 6030.00 },
  { date: '2026-04-30', description: 'Saídas Caixa Pequeno - Abril 2026', amount: 32295.85 },
  { date: '2026-05-31', description: 'Saídas Caixa Pequeno - Maio 2026', amount: 6350.00 },
];

function simpleHash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(31, h) + str.charCodeAt(i) | 0;
  }
  return Math.abs(h).toString(36).padStart(6, '0');
}

async function main() {
  const bills = DESPESAS.map(d => ({
    id: `cxp-hist-${d.date.replace(/-/g, '')}-${simpleHash(d.date + d.description + d.amount)}`,
    supplierId: '',
    description: d.description,
    amount: d.amount,
    dueDate: d.date,
    paidDate: d.date,
    paidAmount: d.amount,
    status: 'paid',
    paymentSource: 'caixa_pequeno',
    accountId: '',
    recurrenceType: 'none',
    launchedBy: 'import-historico',
    isEstimate: false,
  }));

  console.log('Lançamentos a importar:');
  for (const b of bills) {
    console.log(`  ${b.paidDate}  ${b.description.padEnd(45)}  R$ ${b.amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`);
  }
  console.log('');

  const res = await fetch(`${VERCEL_URL}/api/import-bills`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': IMPORT_SECRET },
    body: JSON.stringify({ bills }),
  });

  if (!res.ok) {
    console.error('Erro:', await res.text());
    process.exit(1);
  }

  const result = await res.json();
  console.log(`✓ ${result.saved} lançamentos importados com sucesso.`);
}

main().catch(err => {
  console.error('Erro:', err.message);
  process.exit(1);
});
