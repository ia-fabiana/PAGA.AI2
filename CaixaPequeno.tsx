import React, { useState, useEffect, useMemo } from 'react';
import { Wallet, TrendingUp, TrendingDown, Settings, Save, Filter, X, PlusCircle, CheckCircle } from 'lucide-react';
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

interface Props {
  bills: Bill[];
  accounts: ChartOfAccount[];
  config: CaixaPequenoConfig;
  onSaveConfig: (config: CaixaPequenoConfig) => void;
  onCreateExpense: (expense: ExpenseEntry) => Promise<void>;
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
}

export const CaixaPequeno: React.FC<Props> = ({ bills, accounts, config, onSaveConfig, onCreateExpense }) => {
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
            {movementsWithBalance.map((m, i) => (
              <div key={i} className="grid grid-cols-12 items-center px-6 py-3 hover:bg-slate-50 transition-colors">
                <div className="col-span-2 text-xs font-semibold text-slate-500">{fmtDate(m.date)}</div>
                <div className="col-span-1 flex items-center">
                  {m.type === 'entrada'
                    ? <span className="text-[10px] font-black bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full uppercase">Entrada</span>
                    : <span className="text-[10px] font-black bg-red-100 text-red-600 px-2 py-0.5 rounded-full uppercase">Saída</span>
                  }
                </div>
                <div className="col-span-5 text-sm text-slate-700 truncate pl-2">{m.description}</div>
                <div className={`col-span-2 text-sm font-bold text-right ${m.type === 'entrada' ? 'text-emerald-600' : 'text-red-500'}`}>
                  {m.type === 'entrada' ? '+' : '-'}{fmt(m.amount)}
                </div>
                <div className="col-span-2 text-sm font-black text-right" style={{ color: m.balance >= 0 ? '#B45309' : '#DC2626' }}>
                  {fmt(m.balance)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
