import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Wallet, TrendingUp, TrendingDown, Settings, Save, Filter, X, PlusCircle, CheckCircle, Upload, Pencil, Trash2 } from 'lucide-react';
import { carregarTransacoesSalvas } from './trinks';
import { Bill, CaixaPequenoConfig, ChartOfAccount } from './types';
import { getBillDisplayPaidDate, getBillDisplayPaidAmount, isBillFullyPaid } from './billPaymentUtils';
import { theme } from './theme';

interface ExpenseEntry {
  date: string;
  description: string;
  amount: number;
  accountId: string;
}

interface CsvRow {
  id: string;
  date: string;
  description: string;
  amount: number;
  accountId: string;
}

interface Props {
  bills: Bill[];
  accounts: ChartOfAccount[];
  config: CaixaPequenoConfig;
  onSaveConfig: (config: CaixaPequenoConfig) => void;
  onCreateExpense: (expense: ExpenseEntry) => Promise<void>;
  onBulkImportExpenses?: (rows: CsvRow[]) => Promise<number>;
  onUpdateExpense?: (id: string, update: { description: string; date: string; amount: number; accountId: string }) => Promise<void>;
  onDeleteExpense?: (id: string) => Promise<void>;
}

function fmt(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function fmtDate(d: string) {
  if (!d) return '—';
  const [y, m, day] = d.split('-');
  return `${day}/${m}/${y}`;
}

interface Movement {
  date: string;
  description: string;
  type: 'entrada' | 'saida';
  amount: number;
  source: 'trinks' | 'bill';
  billId?: string;
  accountId?: string;
}

function parseCsvText(text: string): string[][] {
  const rows: string[][] = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trimEnd();
    if (!line) continue;
    const cols: string[] = [];
    let cur = '';
    let inQ = false;
    for (const ch of line) {
      if (ch === '"') { inQ = !inQ; }
      else if (ch === ',' && !inQ) { cols.push(cur); cur = ''; }
      else { cur += ch; }
    }
    cols.push(cur);
    rows.push(cols.map(c => c.trim().replace(/^"|"$/g, '')));
  }
  return rows;
}

function parseCsvDate(s: string): string | null {
  const m = s.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  const year = m[3].length === 2 ? '20' + m[3] : m[3];
  return `${year}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

function parseBrFloat2(s: string): number {
  if (!s) return 0;
  return parseFloat(s.replace(/\./g, '').replace(',', '.')) || 0;
}

function csvHash(str: string): string {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(31, h) + str.charCodeAt(i) | 0;
  }
  return Math.abs(h).toString(36).padStart(6, '0');
}

function extractCsvRows(text: string, defaultAccountId: string): CsvRow[] {
  const matrix = parseCsvText(text);
  const result: CsvRow[] = [];
  for (const cols of matrix) {
    const dateISO = parseCsvDate(cols[0] ?? '');
    if (!dateISO) continue;
    const amount = parseBrFloat2(cols[2] ?? '');
    if (!amount || amount <= 0) continue;
    const description = (cols[1] ?? '').trim() || 'Lançamento';
    const id = `cxp-hist-${dateISO.replace(/-/g, '')}-${csvHash(dateISO + description + amount)}`;
    result.push({ id, date: dateISO, description, amount, accountId: defaultAccountId });
  }
  return result;
}

export const CaixaPequeno: React.FC<Props> = ({ bills, accounts, config, onSaveConfig, onCreateExpense, onBulkImportExpenses, onUpdateExpense, onDeleteExpense }) => {
  const now = new Date();
  const defaultFrom = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
  const defaultTo = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];

  const [pendingFrom, setPendingFrom] = useState(defaultFrom);
  const [pendingTo, setPendingTo] = useState(defaultTo);
  const [dateFrom, setDateFrom] = useState(defaultFrom);
  const [dateTo, setDateTo] = useState(defaultTo);
  const [trinksData, setTrinksData] = useState<any[]>([]);
  const [trinksLoading, setTrinksLoading] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [draftSaldo, setDraftSaldo] = useState(config.saldoInicial.toFixed(2).replace('.', ','));
  const [draftData, setDraftData] = useState(config.saldoInicialData);

  const today = new Date().toISOString().split('T')[0];
  const [expDate, setExpDate] = useState(today);
  const [expDesc, setExpDesc] = useState('');
  const [expAmount, setExpAmount] = useState('');
  const [expAccountId, setExpAccountId] = useState(accounts[0]?.id || '');
  const [expSaving, setExpSaving] = useState(false);
  const [expSaved, setExpSaved] = useState(false);

  const accountMap = useMemo(() => Object.fromEntries(accounts.map(a => [a.id, a.name])), [accounts]);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDesc, setEditDesc] = useState('');
  const [editDate, setEditDate] = useState('');
  const [editAmount, setEditAmount] = useState('');
  const [editAccountId, setEditAccountId] = useState('');
  const [editSaving, setEditSaving] = useState(false);

  const [showImport, setShowImport] = useState(false);
  const [csvRows, setCsvRows] = useState<CsvRow[]>([]);
  const [csvImportAccountId, setCsvImportAccountId] = useState(accounts[0]?.id || '');
  const [csvImporting, setCsvImporting] = useState(false);
  const [csvDone, setCsvDone] = useState<number | null>(null);
  const [csvError, setCsvError] = useState('');
  const csvInputRef = useRef<HTMLInputElement>(null);

  // Load from saldoInicialData up to dateTo so running balance is always correct
  useEffect(() => {
    setTrinksLoading(true);
    carregarTransacoesSalvas(config.saldoInicialData, dateTo)
      .then(data => setTrinksData(data))
      .finally(() => setTrinksLoading(false));
  }, [dateTo, config.saldoInicialData]);

  const applyFilter = () => { setDateFrom(pendingFrom); setDateTo(pendingTo); };
  const clearFilter = () => {
    setPendingFrom(defaultFrom);
    setPendingTo(defaultTo);
    setDateFrom(defaultFrom);
    setDateTo(defaultTo);
  };

  const movements = useMemo((): Movement[] => {
    const list: Movement[] = [];

    // Entradas: Trinks dinheiro
    for (const t of trinksData) {
      if (!t.date || t.date < dateFrom || t.date > dateTo) continue;
      const fps = (t.formasPagamentos || []) as { nome: string; valor: number }[];
      for (const fp of fps) {
        if (fp.nome === 'Dinheiro' && fp.valor > 0) {
          list.push({
            date: t.date,
            description: `Trinks — ${t.cliente?.nome || 'Cliente'}`,
            type: 'entrada',
            amount: fp.valor,
            source: 'trinks',
          });
        }
      }
    }

    // Saídas: contas pagas com caixa_pequeno
    for (const b of bills) {
      if (b.paymentSource !== 'caixa_pequeno') continue;
      if (!isBillFullyPaid(b)) continue;
      const paidDate = getBillDisplayPaidDate(b);
      if (!paidDate || paidDate < dateFrom || paidDate > dateTo) continue;
      list.push({
        date: paidDate,
        description: b.description,
        type: 'saida',
        amount: getBillDisplayPaidAmount(b) ?? b.amount,
        source: 'bill',
        billId: b.id,
        accountId: b.accountId,
      });
    }

    return list.sort((a, b) => a.date.localeCompare(b.date));
  }, [trinksData, bills, dateFrom, dateTo]);

  // All movements from saldoInicialData onward (trinksData already covers this range)
  const allMovements = useMemo((): Movement[] => {
    const list: Movement[] = [];

    for (const t of trinksData) {
      if (!t.date) continue;
      const fps = (t.formasPagamentos || []) as { nome: string; valor: number }[];
      for (const fp of fps) {
        if (fp.nome === 'Dinheiro' && fp.valor > 0) {
          list.push({ date: t.date, description: '', type: 'entrada', amount: fp.valor, source: 'trinks' });
        }
      }
    }

    for (const b of bills) {
      if (b.paymentSource !== 'caixa_pequeno') continue;
      if (!isBillFullyPaid(b)) continue;
      const paidDate = getBillDisplayPaidDate(b);
      if (!paidDate || paidDate < config.saldoInicialData) continue;
      list.push({ date: paidDate, description: '', type: 'saida', amount: getBillDisplayPaidAmount(b) ?? b.amount, source: 'bill' });
    }

    return list;
  }, [trinksData, bills, config.saldoInicialData]);

  const totalEntradas = movements.filter(m => m.type === 'entrada').reduce((s, m) => s + m.amount, 0);
  const totalSaidas = movements.filter(m => m.type === 'saida').reduce((s, m) => s + m.amount, 0);

  const saldoAtual = config.saldoInicial
    + allMovements.filter(m => m.type === 'entrada').reduce((s, m) => s + m.amount, 0)
    - allMovements.filter(m => m.type === 'saida').reduce((s, m) => s + m.amount, 0);

  // Running balance per period movements
  const movementsWithBalance = useMemo(() => {
    let running = config.saldoInicial
      + allMovements.filter(m => m.date < dateFrom && m.type === 'entrada').reduce((s, m) => s + m.amount, 0)
      - allMovements.filter(m => m.date < dateFrom && m.type === 'saida').reduce((s, m) => s + m.amount, 0);

    return movements.map(m => {
      running += m.type === 'entrada' ? m.amount : -m.amount;
      return { ...m, balance: running };
    });
  }, [movements, allMovements, config.saldoInicial, dateFrom]);

  const startEdit = (m: Movement & { billId?: string }) => {
    if (!m.billId) return;
    setEditingId(m.billId);
    setEditDesc(m.description);
    setEditDate(m.date);
    setEditAmount(m.amount.toFixed(2).replace('.', ','));
    const bill = bills.find(b => b.id === m.billId);
    setEditAccountId(bill?.accountId || '');
  };

  const cancelEdit = () => setEditingId(null);

  const saveEdit = async () => {
    if (!editingId || !onUpdateExpense) return;
    const amount = parseFloat(editAmount.replace(/\./g, '').replace(',', '.'));
    if (!amount || amount <= 0 || !editDesc.trim() || !editDate) return;
    setEditSaving(true);
    try {
      await onUpdateExpense(editingId, { description: editDesc.trim(), date: editDate, amount, accountId: editAccountId });
      setEditingId(null);
    } finally {
      setEditSaving(false);
    }
  };

  const handleDelete = async (billId: string) => {
    if (!onDeleteExpense) return;
    if (!window.confirm('Excluir este lançamento?')) return;
    await onDeleteExpense(billId);
  };

  const handleCsvFile = (file: File) => {
    setCsvDone(null);
    setCsvError('');
    const reader = new FileReader();
    reader.onload = e => {
      const text = (e.target?.result as string) || '';
      const rows = extractCsvRows(text, csvImportAccountId);
      if (rows.length === 0) {
        setCsvError('Nenhuma linha válida encontrada. O CSV deve ter colunas: DATA (DD/MM/AA), DESCRIÇÃO, VALOR.');
        setCsvRows([]);
      } else {
        setCsvRows(rows);
        setCsvError('');
      }
    };
    reader.readAsText(file, 'UTF-8');
  };

  const handleCsvImport = async () => {
    if (!onBulkImportExpenses || csvRows.length === 0) return;
    setCsvImporting(true);
    try {
      const rowsWithAccount = csvRows.map(r => ({ ...r, accountId: csvImportAccountId || r.accountId }));
      const count = await onBulkImportExpenses(rowsWithAccount);
      setCsvDone(count);
      setCsvRows([]);
    } catch (e: any) {
      setCsvError(e?.message || 'Erro ao importar');
    } finally {
      setCsvImporting(false);
    }
  };

  const handleSaveConfig = () => {
    const val = parseFloat(draftSaldo.replace(/\./g, '').replace(',', '.')) || 0;
    onSaveConfig({ saldoInicial: val, saldoInicialData: draftData });
    setShowConfig(false);
  };

  const handleCreateExpense = async () => {
    const amount = parseFloat(expAmount.replace(/\./g, '').replace(',', '.'));
    if (!expDesc.trim() || !amount || amount <= 0 || !expDate) return;
    setExpSaving(true);
    try {
      await onCreateExpense({ date: expDate, description: expDesc.trim(), amount, accountId: expAccountId });
      setExpDesc('');
      setExpAmount('');
      setExpDate(today);
      setExpSaved(true);
      setTimeout(() => setExpSaved(false), 2500);
    } finally {
      setExpSaving(false);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500" style={{ backgroundColor: theme.colors.neutral.bgMain, minHeight: '100vh', padding: '2rem' }}>

      {/* Header */}
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-3 rounded-2xl shadow-lg" style={{ backgroundColor: '#FEF3C7' }}>
            <Wallet size={28} className="text-amber-600" />
          </div>
          <div>
            <h1 className="text-3xl font-black" style={{ color: theme.colors.neutral.black }}>Caixa Pequeno</h1>
            <p className="text-slate-500 text-sm font-medium">Fluxo de caixa em dinheiro · Saldo desde {fmtDate(config.saldoInicialData)}</p>
          </div>
        </div>
        <button
          onClick={() => setShowConfig(v => !v)}
          className="flex items-center gap-2 text-xs font-bold px-4 py-2 rounded-xl uppercase transition-all bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"
        >
          <Settings size={14} />
          Saldo Inicial
        </button>
      </header>

      {/* Config panel */}
      {showConfig && (
        <div className="bg-white rounded-[20px] border border-amber-200 shadow-sm p-5 flex flex-wrap items-end gap-4">
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase mb-1">Data do saldo inicial</p>
            <input
              type="date"
              value={draftData}
              onChange={e => setDraftData(e.target.value)}
              className="border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-amber-400"
            />
          </div>
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase mb-1">Valor (R$)</p>
            <input
              type="text"
              inputMode="decimal"
              value={draftSaldo}
              onChange={e => setDraftSaldo(e.target.value)}
              className="border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-amber-400 w-36"
              placeholder="0,00"
            />
          </div>
          <button
            onClick={handleSaveConfig}
            className="flex items-center gap-2 text-xs font-bold px-4 py-2 rounded-xl uppercase bg-amber-500 text-white hover:bg-amber-600 transition-colors"
          >
            <Save size={14} />
            Salvar
          </button>
        </div>
      )}

      {/* Quick expense form */}
      <div className="bg-white rounded-[20px] border border-slate-100 shadow-[0_10px_15px_-3px_rgba(0,0,0,0.04)] p-5">
        <div className="flex items-center gap-2 mb-4">
          <PlusCircle size={16} className="text-amber-500" />
          <h3 className="text-sm font-black text-slate-700 uppercase tracking-widest">Novo Lançamento de Saída</h3>
          <span className="flex-1" />
          {onBulkImportExpenses && (
            <button
              onClick={() => { setShowImport(v => !v); setCsvRows([]); setCsvDone(null); setCsvError(''); }}
              className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-xl bg-slate-100 text-slate-500 hover:bg-slate-200 uppercase transition-colors"
            >
              <Upload size={12} />
              Importar CSV
            </button>
          )}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <p className="text-[11px] font-bold text-slate-400 uppercase mb-1">Data</p>
            <input
              type="date"
              value={expDate}
              onChange={e => setExpDate(e.target.value)}
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-amber-400"
            />
          </div>
          <div className="lg:col-span-1">
            <p className="text-[11px] font-bold text-slate-400 uppercase mb-1">Descrição</p>
            <input
              type="text"
              value={expDesc}
              onChange={e => setExpDesc(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleCreateExpense()}
              placeholder="Ex: Material de limpeza"
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-amber-400"
            />
          </div>
          <div>
            <p className="text-[11px] font-bold text-slate-400 uppercase mb-1">Valor (R$)</p>
            <input
              type="text"
              inputMode="decimal"
              value={expAmount}
              onChange={e => setExpAmount(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleCreateExpense()}
              placeholder="0,00"
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-amber-400"
            />
          </div>
          <div>
            <p className="text-[11px] font-bold text-slate-400 uppercase mb-1">Centro de Custo</p>
            <select
              value={expAccountId}
              onChange={e => setExpAccountId(e.target.value)}
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-amber-400 bg-white"
            >
              <option value="">— Selecionar —</option>
              {accounts.map(a => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex items-center gap-3 mt-4">
          <button
            onClick={handleCreateExpense}
            disabled={expSaving || !expDesc.trim() || !expAmount}
            className="flex items-center gap-2 text-sm font-bold px-5 py-2 rounded-xl uppercase transition-all bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <PlusCircle size={15} />
            {expSaving ? 'Lançando...' : 'Lançar'}
          </button>
          {expSaved && (
            <div className="flex items-center gap-1.5 text-sm font-bold text-emerald-600">
              <CheckCircle size={15} />
              Lançado com sucesso!
            </div>
          )}
        </div>

        {showImport && (
          <div className="mt-4 pt-4 border-t border-slate-100 space-y-3">
            <p className="text-xs font-bold text-slate-400 uppercase">Importar histórico via CSV</p>
            <p className="text-xs text-slate-400">Exporte sua planilha como CSV com colunas: <strong>DATA (DD/MM/AA)</strong>, <strong>DESCRIÇÃO</strong>, <strong>VALOR</strong>.</p>
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <p className="text-[11px] font-bold text-slate-400 uppercase mb-1">Centro de Custo padrão</p>
                <select
                  value={csvImportAccountId}
                  onChange={e => setCsvImportAccountId(e.target.value)}
                  className="border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-amber-400 bg-white"
                >
                  <option value="">— Nenhum —</option>
                  {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
              <input
                ref={csvInputRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) handleCsvFile(f); e.target.value = ''; }}
              />
              <button
                onClick={() => csvInputRef.current?.click()}
                className="flex items-center gap-1.5 text-xs font-bold px-4 py-2 rounded-xl bg-slate-100 text-slate-600 hover:bg-slate-200 uppercase transition-colors"
              >
                <Upload size={13} />
                Selecionar arquivo
              </button>
            </div>
            {csvError && <p className="text-xs text-red-500 font-medium">{csvError}</p>}
            {csvRows.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-bold text-slate-500">{csvRows.length} lançamento(s) encontrado(s) — pré-visualização:</p>
                <div className="max-h-48 overflow-y-auto border border-slate-100 rounded-xl divide-y divide-slate-50">
                  {csvRows.map(r => (
                    <div key={r.id} className="grid grid-cols-3 px-3 py-2 text-xs text-slate-600">
                      <span>{fmtDate(r.date)}</span>
                      <span className="truncate">{r.description}</span>
                      <span className="text-right font-bold text-red-500">-{fmt(r.amount)}</span>
                    </div>
                  ))}
                </div>
                <button
                  onClick={handleCsvImport}
                  disabled={csvImporting}
                  className="flex items-center gap-2 text-sm font-bold px-5 py-2 rounded-xl uppercase transition-all bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Upload size={14} />
                  {csvImporting ? 'Importando...' : `Importar ${csvRows.length} lançamento(s)`}
                </button>
              </div>
            )}
            {csvDone !== null && (
              <div className="flex items-center gap-1.5 text-sm font-bold text-emerald-600">
                <CheckCircle size={15} />
                {csvDone} lançamento(s) importado(s) com sucesso!
              </div>
            )}
          </div>
        )}
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
        <div className="bg-white p-6 rounded-[20px] border border-slate-100 shadow-[0_10px_15px_-3px_rgba(0,0,0,0.04)]">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 rounded-xl bg-amber-50"><Wallet size={20} className="text-amber-500" /></div>
            <p className="text-sm text-slate-500 font-medium">Saldo Atual</p>
          </div>
          <h3 className={`text-3xl font-black ${saldoAtual >= 0 ? 'text-amber-600' : 'text-red-600'}`}>{fmt(saldoAtual)}</h3>
          <p className="text-xs text-slate-400 mt-1">Desde {fmtDate(config.saldoInicialData)}</p>
        </div>

        <div className="bg-white p-6 rounded-[20px] border border-slate-100 shadow-[0_10px_15px_-3px_rgba(0,0,0,0.04)]">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 rounded-xl bg-emerald-50"><TrendingUp size={20} className="text-emerald-500" /></div>
            <p className="text-sm text-slate-500 font-medium">Entradas (período)</p>
          </div>
          <h3 className="text-3xl font-black text-emerald-600">{fmt(totalEntradas)}</h3>
          <p className="text-xs text-slate-400 mt-1">Dinheiro recebido no Trinks</p>
        </div>

        <div className="bg-white p-6 rounded-[20px] border border-slate-100 shadow-[0_10px_15px_-3px_rgba(0,0,0,0.04)]">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 rounded-xl bg-red-50"><TrendingDown size={20} className="text-red-400" /></div>
            <p className="text-sm text-slate-500 font-medium">Saídas (período)</p>
          </div>
          <h3 className="text-3xl font-black text-red-500">{fmt(totalSaidas)}</h3>
          <p className="text-xs text-slate-400 mt-1">Contas pagas em dinheiro</p>
        </div>
      </div>

      {/* Period filter */}
      <div className="bg-white rounded-[20px] border border-slate-100 shadow-sm p-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Filter size={15} className="text-slate-400" />
          <span className="text-xs font-bold text-slate-400 uppercase">Período:</span>
        </div>
        <input
          type="date"
          value={pendingFrom}
          onChange={e => setPendingFrom(e.target.value)}
          className="border border-slate-200 rounded-xl px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-amber-400"
        />
        <span className="text-slate-400 text-xs">até</span>
        <input
          type="date"
          value={pendingTo}
          onChange={e => setPendingTo(e.target.value)}
          className="border border-slate-200 rounded-xl px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-amber-400"
        />
        <button
          onClick={applyFilter}
          className="text-xs font-bold px-4 py-2 rounded-xl uppercase transition-all bg-amber-500 text-white hover:bg-amber-600"
        >
          Filtrar
        </button>
        <button
          onClick={clearFilter}
          className="flex items-center gap-1.5 text-xs font-bold px-3 py-2 rounded-xl uppercase transition-all bg-slate-100 text-slate-500 hover:bg-slate-200"
        >
          <X size={12} />
          Limpar
        </button>
      </div>

      {/* Movements table */}
      <div className="bg-white rounded-[20px] border border-slate-100 shadow-[0_10px_15px_-3px_rgba(0,0,0,0.04)] overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100">
          <h3 className="text-sm font-black text-slate-700 uppercase tracking-widest">Movimentações</h3>
        </div>

        {trinksLoading ? (
          <div className="py-12 text-center text-slate-400 text-sm animate-pulse">Carregando...</div>
        ) : movementsWithBalance.length === 0 ? (
          <div className="py-12 text-center text-slate-400 text-sm">Nenhuma movimentação no período.</div>
        ) : (
          <div className="divide-y divide-slate-50">
            {/* Saldo inicial — só aparece quando o período filtrado inclui a data de saldo inicial */}
            {config.saldoInicialData >= dateFrom && config.saldoInicialData <= dateTo && (
              <div className="grid grid-cols-12 items-center px-6 py-3 bg-amber-50">
                <div className="col-span-2 text-xs font-semibold text-slate-500">{fmtDate(config.saldoInicialData)}</div>
                <div className="col-span-1">
                  <span className="text-[10px] font-black bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full uppercase">Inicial</span>
                </div>
                <div className="col-span-5 text-sm text-slate-500 pl-2">Saldo inicial</div>
                <div className="col-span-2 text-sm font-bold text-right text-amber-600">{fmt(config.saldoInicial)}</div>
                <div className="col-span-2 text-sm font-black text-right text-amber-700">{fmt(config.saldoInicial)}</div>
              </div>
            )}
            {movementsWithBalance.map((m, i) => {
              const isEditing = editingId === m.billId && m.billId;
              const canEdit = m.source === 'bill' && !!m.billId;
              const accountName = m.accountId ? accountMap[m.accountId] : null;

              if (isEditing) {
                return (
                  <div key={i} className="px-6 py-3 bg-amber-50 border-l-2 border-amber-400 space-y-2">
                    <div className="flex flex-wrap gap-2">
                      <input
                        type="date"
                        value={editDate}
                        onChange={e => setEditDate(e.target.value)}
                        className="border border-slate-200 rounded-lg px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-amber-400"
                      />
                      <input
                        type="text"
                        value={editDesc}
                        onChange={e => setEditDesc(e.target.value)}
                        className="flex-1 min-w-32 border border-slate-200 rounded-lg px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-amber-400"
                        placeholder="Descrição"
                      />
                      <input
                        type="text"
                        value={editAmount}
                        onChange={e => setEditAmount(e.target.value)}
                        className="w-24 border border-slate-200 rounded-lg px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-amber-400"
                        placeholder="0,00"
                      />
                      <select
                        value={editAccountId}
                        onChange={e => setEditAccountId(e.target.value)}
                        className="border border-slate-200 rounded-lg px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-amber-400 bg-white"
                      >
                        <option value="">— Centro de custo —</option>
                        {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                      </select>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={saveEdit}
                        disabled={editSaving}
                        className="flex items-center gap-1 text-xs font-bold px-3 py-1 rounded-lg bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50"
                      >
                        <Save size={11} />{editSaving ? 'Salvando...' : 'Salvar'}
                      </button>
                      <button
                        onClick={cancelEdit}
                        className="flex items-center gap-1 text-xs font-bold px-3 py-1 rounded-lg bg-slate-100 text-slate-500 hover:bg-slate-200"
                      >
                        <X size={11} />Cancelar
                      </button>
                    </div>
                  </div>
                );
              }

              return (
                <div key={i} className="group flex items-center gap-3 px-6 py-3 hover:bg-slate-50 transition-colors">
                  <div className="w-20 text-xs font-semibold text-slate-500 shrink-0">{fmtDate(m.date)}</div>
                  <div className="shrink-0">
                    {m.type === 'entrada'
                      ? <span className="text-[10px] font-black bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full uppercase">Entrada</span>
                      : <span className="text-[10px] font-black bg-red-100 text-red-600 px-2 py-0.5 rounded-full uppercase">Saída</span>
                    }
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-slate-700 truncate">{m.description}</p>
                    {accountName && (
                      <p className="text-[11px] text-slate-400 truncate">{accountName}</p>
                    )}
                  </div>
                  <div className={`w-28 text-sm font-bold text-right shrink-0 ${m.type === 'entrada' ? 'text-emerald-600' : 'text-red-500'}`}>
                    {m.type === 'entrada' ? '+' : '-'}{fmt(m.amount)}
                  </div>
                  <div className="w-28 text-sm font-black text-right shrink-0" style={{ color: m.balance >= 0 ? '#B45309' : '#DC2626' }}>
                    {fmt(m.balance)}
                  </div>
                  {canEdit && (
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                      <button
                        onClick={() => startEdit(m)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors"
                        title="Editar"
                      >
                        <Pencil size={13} />
                      </button>
                      <button
                        onClick={() => handleDelete(m.billId!)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                        title="Excluir"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  )}
                  {!canEdit && <div className="w-14 shrink-0" />}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
