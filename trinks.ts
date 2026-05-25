import { db } from './firebase';
import { collection, doc, setDoc, getDocs, query, where, orderBy } from 'firebase/firestore';

const ESTABLISHMENT_ID = import.meta.env.VITE_TRINKS_ESTABLISHMENT_ID as string;

// ─── Trinks API types ────────────────────────────────────────────────────────

export interface TrinksFormaPagamento {
  nome: string;
  valor: number;
  parcelas: number;
}

export interface TrinksServico {
  id: number;
  nome: string;
  descricao: string;
  categoria: string;
  duracaoEmMinutos: number;
  preco: number;
  idProfissionalQueRealizouServico: number | null;
}

export interface TrinksProduto {
  id: number;
  nome: string;
  quantidade: number;
  valorUnitario: number;
  IdProfissionalQueRealizouAVenda: number | null;
}

export interface TrinksTransacao {
  id: number;
  dataHora: string;
  dataReferencia: string;
  descontos: number | null;
  troco: number | null;
  totalPagar: number | null;
  cliente: { id: number; nome: string } | null;
  formasPagamentos: TrinksFormaPagamento[];
  servicos: TrinksServico[];
  produtos: TrinksProduto[];
  pacotes: Array<{ id: number; nome: string; quantidade: number; valorUnitario: number }>;
}

// Stored in Firestore, enriched with computed fields
export interface TrinksTransacaoSalva extends TrinksTransacao {
  date: string;          // YYYY-MM-DD extraído de dataReferencia
  syncedAt: string;      // ISO timestamp da sincronização
  estabelecimentoId: string;
}

// ─── Payment method mapping (Trinks → cashbox column) ───────────────────────

export type CashBoxColuna = 'din' | 'rede' | 'pagSeg' | 'inter' | 'frog' | 'ignorado';

export const TRINKS_MAPEAMENTO: Record<string, CashBoxColuna> = {
  'Dinheiro':                    'din',
  'PIX':                         'inter',
  'Maestro/Redeshop':            'rede',
  'Elo Débito':                  'rede',
  'Visa Electron':               'rede',
  'Mastercard Crédito - Pag':    'pagSeg',
  'Visa Crédito - Pag':          'pagSeg',
  'Amex Crédito - Pag':          'pagSeg',
  'Elo Crédito - Pag':           'pagSeg',
  'Diners Crédito - Pag':        'pagSeg',
  'Mercado Pago':                'frog',
  'Crédito de Cliente':          'ignorado',
  'Vale-Presente':               'ignorado',
  'Descontar do Profissional':   'ignorado',
  // Nomes do CSV de movimentação financeira (colunas agregadas)
  'Crédito':                     'pagSeg',
  'Débito':                      'rede',
  'Pré-Pago':                    'ignorado',
  'Outros':                      'frog',
};

export const COLUNA_LABELS: Record<CashBoxColuna, string> = {
  din:      'DIN',
  rede:     'REDE',
  pagSeg:   'PAG SEG',
  inter:    'INTER',
  frog:     'FROG',
  ignorado: 'Outros',
};

// Maps an unknown Trinks payment name to a cashbox column.
// Unknown names default to 'frog' so they are visible (not silently dropped).
export function mapFormaPagamento(nome: string): CashBoxColuna {
  return TRINKS_MAPEAMENTO[nome] ?? 'frog';
}

// ─── API helpers ─────────────────────────────────────────────────────────────

async function fetchPage(endpoint: string, params: Record<string, string>): Promise<Response> {
  const url = new URL('/api/trinks-proxy', window.location.origin);
  url.searchParams.set('_path', endpoint);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Trinks API ${res.status}: ${endpoint}`);
  return res;
}

// ─── API consumption ─────────────────────────────────────────────────────────

export interface ConsumoApi {
  totalRequisicoes?: number;
  limiteRequisicoes?: number;
  requisicoesMes?: number;
  limite?: number;
  total?: number;
  usado?: number;
  disponivel?: number;
  percentualUsado?: number;
  mes?: string;
  [key: string]: unknown;
}

/** Returns API consumption for the current month from GET /v1/consumo. */
export async function buscarConsumoApi(): Promise<ConsumoApi> {
  const res = await fetchPage('/v1/consumo', {});
  return res.json();
}

// ─── Public API functions ─────────────────────────────────────────────────────

/** Fetches all Trinks transactions for a date range, handling pagination. */
export async function buscarTransacoesTrinks(
  dataInicio: string,
  dataFim: string,
  onProgress?: (fetched: number, total: number) => void,
): Promise<TrinksTransacao[]> {
  const PAGE_SIZE = 500;
  const all: TrinksTransacao[] = [];
  let page = 1;
  let totalPages = 1;

  do {
    const res = await fetchPage('/v1/transacoes', {
      dataInicio: `${dataInicio}T00:00:00`,
      dataFim: `${dataFim}T23:59:59`,
      pageSize: String(PAGE_SIZE),
      page: String(page),
    });
    const json = await res.json();
    totalPages = json.totalPages ?? 1;
    all.push(...(json.data ?? []));
    onProgress?.(all.length, json.totalRecords ?? all.length);
    page++;
  } while (page <= totalPages);

  return all;
}

/** Persists Trinks transactions into Firestore (idempotent). */
export async function persistirTransacoes(transacoes: TrinksTransacao[]): Promise<number> {
  let saved = 0;
  for (const t of transacoes) {
    const date = t.dataReferencia.split('T')[0];
    const docId = `trinks_${ESTABLISHMENT_ID}_${t.id}`;
    const salva: TrinksTransacaoSalva = {
      ...t,
      date,
      syncedAt: new Date().toISOString(),
      estabelecimentoId: ESTABLISHMENT_ID,
    };
    await setDoc(doc(db, 'trinks_transactions', docId), salva, { merge: false });
    saved++;
  }
  return saved;
}

/** Sync: fetch from Trinks API + save to Firestore. Returns count of saved records. */
export async function sincronizarTrinks(
  dataInicio: string,
  dataFim: string,
  onProgress?: (fetched: number, total: number) => void,
): Promise<number> {
  const transacoes = await buscarTransacoesTrinks(dataInicio, dataFim, onProgress);
  return persistirTransacoes(transacoes);
}

/** Load persisted transactions from Firestore for a date range. */
export async function carregarTransacoesSalvas(
  dataInicio: string,
  dataFim: string,
): Promise<TrinksTransacaoSalva[]> {
  const q = query(
    collection(db, 'trinks_transactions'),
    where('date', '>=', dataInicio),
    where('date', '<=', dataFim),
    orderBy('date', 'asc'),
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => d.data() as TrinksTransacaoSalva);
}

// ─── Aggregation ──────────────────────────────────────────────────────────────

export interface TotaisDiaTrinks {
  date: string;
  din: number;
  rede: number;
  pagSeg: number;
  inter: number;
  frog: number;
  ignorado: number;
  total: number;
  transacoes: number;
  detalhes: Record<string, number>; // nome forma → total
}

/** Aggregate persisted transactions into per-day cashbox-column totals. */
export function agregarPorDia(transacoes: TrinksTransacaoSalva[]): TotaisDiaTrinks[] {
  const byDate: Record<string, TotaisDiaTrinks> = {};

  for (const t of transacoes) {
    if (!byDate[t.date]) {
      byDate[t.date] = {
        date: t.date,
        din: 0, rede: 0, pagSeg: 0, inter: 0, frog: 0, ignorado: 0,
        total: 0,
        transacoes: 0,
        detalhes: {},
      };
    }
    const dia = byDate[t.date];
    dia.transacoes++;

    for (const fp of (t.formasPagamentos || [])) {
      const col = mapFormaPagamento(fp.nome);
      dia[col] += fp.valor;
      dia.detalhes[fp.nome] = (dia.detalhes[fp.nome] ?? 0) + fp.valor;
    }
    dia.total += t.totalPagar ?? 0;
  }

  return Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));
}
