// Substitui os 5 lançamentos consolidados do Caixa Pequeno (Jan-Mai 2026) por
// lançamentos individuais extraídos da planilha Google Sheets.
// Uso: node scripts/import-caixa-pequeno-detalhado.mjs

const VERCEL_URL = 'https://paga-ai-2.vercel.app';
const IMPORT_SECRET = 'paga2026import';

function simpleHash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(31, h) + str.charCodeAt(i) | 0;
  }
  return Math.abs(h).toString(36).padStart(6, '0');
}

// IDs dos lançamentos consolidados anteriores a remover
const OLD_IDS = [
  `cxp-hist-20260114-${simpleHash('2026-01-14' + 'Codigo de Defesa do Consumidor' + 30)}`,
  `cxp-hist-20260228-${simpleHash('2026-02-28' + 'Saídas Caixa Pequeno - Fevereiro 2026' + 4000)}`,
  `cxp-hist-20260331-${simpleHash('2026-03-31' + 'Saídas Caixa Pequeno - Março 2026' + 6030)}`,
  `cxp-hist-20260430-${simpleHash('2026-04-30' + 'Saídas Caixa Pequeno - Abril 2026' + 32295.85)}`,
  `cxp-hist-20260531-${simpleHash('2026-05-31' + 'Saídas Caixa Pequeno - Maio 2026' + 6350)}`,
];

// Lançamentos individuais extraídos da planilha
const DESPESAS = [
  // Janeiro — total saídas: 30,00
  { date: '2026-01-14', description: 'Codigo de Defesa do Consumidor', amount: 30.00 },

  // Fevereiro — total saídas: 4.000,00
  { date: '2026-02-05', description: 'PAGAMENTO - FÁBIO HENRIQUE', amount: 2250.00 },
  { date: '2026-02-20', description: 'PAGAMENTO - FÁBIO HENRIQUE', amount: 1750.00 },

  // Março — total saídas: 6.030,00
  { date: '2026-03-06', description: 'PAGAMENTO - FÁBIO HENRIQUE', amount: 2150.00 },
  { date: '2026-03-07', description: 'BASE BR', amount: 540.00 },
  { date: '2026-03-08', description: 'PAGAMENTO AUXILIAR FREE GEOVANNA', amount: 50.00 },
  { date: '2026-03-13', description: 'CONSERTO DE GAVETA', amount: 210.00 },
  { date: '2026-03-20', description: 'PAGAMENTO - FÁBIO HENRIQUE', amount: 1750.00 },
  { date: '2026-03-20', description: 'PAGAMENTO JÉSSICA FREIRE', amount: 1000.00 },
  { date: '2026-03-25', description: 'COMPRA CHIP 11 9. 2544-8384', amount: 28.00 },
  { date: '2026-03-25', description: 'VALE DÉBORA', amount: 145.00 },
  { date: '2026-03-25', description: 'FRUTAS NOIVA', amount: 62.00 },
  { date: '2026-03-29', description: 'COMPRA SALDO PRÉ PAGO CHIP 11 9. 2544-8384', amount: 30.00 },
  { date: '2026-03-31', description: 'REFRI ANIVERSÁRIO', amount: 15.00 },
  { date: '2026-03-31', description: 'CHÁS FEIRINHA DR. OETKER', amount: 50.00 },

  // Abril — total saídas: 32.295,85
  { date: '2026-04-01', description: 'ACERTO ESTOQUE FABIANA', amount: 23803.85 },
  { date: '2026-04-02', description: 'CONSERTO AR CONDICIONADO', amount: 630.00 },
  { date: '2026-04-07', description: 'PAGTO FABIO 16/31 DE MARÇO', amount: 1750.00 },
  { date: '2026-04-07', description: 'META FABIO MARÇO', amount: 500.00 },
  { date: '2026-04-07', description: 'PAGTO JÉSSICA', amount: 1500.00 },
  { date: '2026-04-07', description: 'LEMBRANCINHAS DEPÁSCOA', amount: 200.00 },
  { date: '2026-04-07', description: 'VALE EXTRA HIZZIE', amount: 100.00 },
  { date: '2026-04-11', description: 'VALE EXTRA DÉBORA', amount: 95.00 },
  { date: '2026-04-11', description: 'VALE EXTRA DÉBORA', amount: 100.00 },
  { date: '2026-04-11', description: 'VALE EXTRA DÉBORA', amount: 50.00 },
  { date: '2026-04-15', description: 'VALE EXTRA ANDERSON', amount: 50.00 },
  { date: '2026-04-18', description: 'COMISSÃO NOIVAS', amount: 70.50 },
  { date: '2026-04-18', description: 'COMISSÃO NOIVAS', amount: 247.50 },
  { date: '2026-04-18', description: 'COMISSÃO NOIVAS', amount: 449.00 },
  { date: '2026-04-20', description: 'PAGTO FABIO', amount: 1750.00 },
  { date: '2026-04-20', description: 'PAGTO JÉSSICA', amount: 1000.00 },

  // Maio — total saídas: 6.350,00
  { date: '2026-05-05', description: 'PAGTO FABIO', amount: 1750.00 },
  { date: '2026-05-05', description: 'PAGTO JÉSSICA', amount: 1500.00 },
  { date: '2026-05-19', description: 'PAGTO FABIO', amount: 1750.00 },
  { date: '2026-05-19', description: 'PAGTO JÉSSICA', amount: 1000.00 },
  { date: '2026-05-25', description: 'CONSERTO AQUECEDOR LAVATORIO', amount: 300.00 },
  { date: '2026-05-25', description: 'CHÁS FEIRINHA DR. OETKER', amount: 50.00 },
];

async function main() {
  // Passo 1: Remover lançamentos consolidados antigos
  console.log('Removendo lançamentos consolidados antigos...');
  console.log('IDs a remover:', OLD_IDS);
  const delRes = await fetch(`${VERCEL_URL}/api/delete-bills`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': IMPORT_SECRET },
    body: JSON.stringify({ ids: OLD_IDS }),
  });
  if (!delRes.ok) {
    console.error('Erro ao deletar:', await delRes.text());
    process.exit(1);
  }
  const delResult = await delRes.json();
  console.log(`✓ ${delResult.deleted} lançamentos antigos removidos.\n`);

  // Passo 2: Importar lançamentos individuais
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
  console.log(`\n✓ ${result.saved} lançamentos individuais importados com sucesso.`);
}

main().catch(err => {
  console.error('Erro:', err.message);
  process.exit(1);
});
