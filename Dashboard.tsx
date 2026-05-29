
import React, { useMemo, useState, useEffect } from 'react';
import { Bill, Supplier, BillStatus, ChartOfAccount } from './types';
import { TrendingUp, TrendingDown, CreditCard, Clock, AlertCircle, Calendar, Filter, Target, Zap, ArrowUpCircle, ArrowDownCircle, Minus } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { theme } from './theme';
import { getBillDisplayPaidAmount, getBillDisplayPaidDate, isBillFullyPaid } from './billPaymentUtils';
import { carregarTransacoesSalvas, TrinksTransacaoSalva, mapFormaPagamento, COLUNA_LABELS } from './trinks';
import { TrinksUpload } from './TrinksUpload';

interface DashboardProps {
  bills: Bill[];
  suppliers: Supplier[];
  accounts: ChartOfAccount[];
  onEditBill: (bill: Bill) => void;
  onStatusChange: (id: string, status: BillStatus) => void;
  onNavigateToBill?: (id: string) => void;
}

const COLUNAS_CAIXA = ['din', 'rede', 'pagSeg', 'inter', 'frog'] as const;
type ColunaCaixa = typeof COLUNAS_CAIXA[number];

const COLUNA_COLORS: Record<ColunaCaixa, string> = {
  din:    '#10B981',
  rede:   '#3B82F6',
  pagSeg: '#8B5CF6',
  inter:  '#F59E0B',
  frog:   '#EC4899',
};

export const Dashboard: React.FC<DashboardProps> = ({ bills, suppliers, accounts, onEditBill, onStatusChange, onNavigateToBill }) => {
  const now = new Date();
  const firstDay = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];
  const currentYear = now.getFullYear();

  const [startDate, setStartDate] = useState(firstDay);
  const [endDate, setEndDate] = useState(lastDay);
  const [pendingStart, setPendingStart] = useState(firstDay);
  const [pendingEnd, setPendingEnd] = useState(lastDay);
  const [detailType, setDetailType] = useState<'pending' | 'paid' | 'overdue' | 'receita' | null>(null);
  const [trinksData, setTrinksData] = useState<TrinksTransacaoSalva[]>([]);
  const [trinksLoading, setTrinksLoading] = useState(false);
  const [trinksError, setTrinksError] = useState<string | null>(null);

  const loadTrinks = () => {
    setTrinksLoading(true);
    setTrinksError(null);
    carregarTransacoesSalvas(`${currentYear}-01-01`, `${currentYear}-12-31`)
      .then(data => { setTrinksData(data); console.log('[Dashboard] trinksData loaded:', data.length); })
      .catch(err => { console.error('[Dashboard] trinks load error:', err); setTrinksError(String(err?.message || err)); })
      .finally(() => setTrinksLoading(false));
  };

  useEffect(() => { loadTrinks(); }, [currentYear]);

  const parseLocalDate = (value?: string, endOfDay = false) => {
    if (!value) return null;
    const [yearStr, monthStr, dayStr] = value.split('-');
    const year = Number(yearStr), month = Number(monthStr), day = Number(dayStr);
    if (!year || !month || !day) return null;
    return endOfDay
      ? new Date(year, month - 1, day, 23, 59, 59, 999)
      : new Date(year, month - 1, day, 0, 0, 0, 0);
  };

  const isDateWithinRange = (dateStr?: string) => {
    const referenceDate = parseLocalDate(dateStr);
    if (!referenceDate) return false;
    const start = startDate ? parseLocalDate(startDate) : null;
    const end = endDate ? parseLocalDate(endDate, true) : null;
    return (!start || referenceDate >= start) && (!end || referenceDate <= end);
  };

  const filteredBills = useMemo(() => {
    return bills.filter(bill => {
      const billDate = new Date(bill.dueDate);
      const start = startDate ? new Date(startDate) : null;
      const end = endDate ? new Date(endDate) : null;
      if (start) start.setHours(0, 0, 0, 0);
      if (end) end.setHours(23, 59, 59, 999);
      return (!start || billDate >= start) && (!end || billDate <= end);
    });
  }, [bills, startDate, endDate]);

  const toDate = (dateStr: string) => new Date(`${dateStr}T12:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const isPaid = (bill: Bill) => isBillFullyPaid(bill);
  const isOverdue = (bill: Bill) => !isPaid(bill) && toDate(bill.dueDate) < today;
  const paidBillsInPeriod = bills.filter(bill => isPaid(bill) && isDateWithinRange(getBillDisplayPaidDate(bill)));

  const totalPending = filteredBills.filter(b => !isPaid(b) && !isOverdue(b)).reduce((sum, b) => sum + b.amount, 0);
  const totalPaid = paidBillsInPeriod.reduce((sum, bill) => sum + (getBillDisplayPaidAmount(bill) || 0), 0);
  const totalOverdue = filteredBills.filter(b => isOverdue(b)).reduce((sum, b) => sum + b.amount, 0);

  const typeStats = useMemo(() => {
    let fixed = 0, variable = 0;
    filteredBills.forEach(bill => {
      const account = accounts.find(a => a.id === bill.accountId);
      if (account?.type === 'VARIABLE') variable += bill.amount;
      else fixed += bill.amount;
    });
    return { fixed, variable };
  }, [filteredBills, accounts]);

  // ── Trinks period totals ────────────────────────────────────────────────────
  const trinksPeriod = useMemo(() => {
    const totals: Record<ColunaCaixa | 'total', number> = { din: 0, rede: 0, pagSeg: 0, inter: 0, frog: 0, total: 0 };
    trinksData
      .filter(t => t.date >= startDate && t.date <= endDate)
      .forEach(t => {
        (t.formasPagamentos || []).forEach(fp => {
          const col = mapFormaPagamento(fp.nome);
          if (col !== 'ignorado') {
            totals[col as ColunaCaixa] += fp.valor;
            totals.total += fp.valor;
          }
        });
      });
    return totals;
  }, [trinksData, startDate, endDate]);

  const resultado = trinksPeriod.total - totalPaid;
  const margemPct = trinksPeriod.total > 0 ? (resultado / trinksPeriod.total) * 100 : null;

  // ── Monthly chart (Receita Trinks × Despesas Pagas) ─────────────────────────
  const chartData = useMemo(() => {
    const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
    const data = months.map(m => ({ name: m, receita: 0, despesas: 0 }));

    const toNumber = (v: unknown) => {
      if (typeof v === 'number') return v;
      const p = Number(String(v).replace(',', '.'));
      return Number.isFinite(p) ? p : 0;
    };

    trinksData.forEach(t => {
      const monthIdx = parseInt(t.date.split('-')[1]) - 1;
      if (monthIdx >= 0 && monthIdx < 12) data[monthIdx].receita += t.totalPagar ?? 0;
    });

    bills.forEach(bill => {
      if (bill.status === BillStatus.PAID || bill.paidDate) {
        const ref = bill.paidDate || bill.dueDate;
        const [yearStr, monthStr] = ref.split('-');
        if (Number(yearStr) === currentYear) {
          const idx = Number(monthStr) - 1;
          const paidAmount = bill.paidAmount !== undefined ? toNumber(bill.paidAmount) : toNumber(bill.amount);
          data[idx].despesas += paidAmount;
        }
      }
    });

    return data;
  }, [trinksData, bills, currentYear]);

  const applyFilter = () => { setStartDate(pendingStart); setEndDate(pendingEnd); };

  const MONTHS_SHORT = ['JAN','FEV','MAR','ABR','MAI','JUN','JUL','AGO','SET','OUT','NOV','DEZ'];
  const selectMonth = (monthIndex: number) => {
    const first = new Date(currentYear, monthIndex, 1).toISOString().split('T')[0];
    const last = new Date(currentYear, monthIndex + 1, 0).toISOString().split('T')[0];
    setPendingStart(first); setPendingEnd(last);
    setStartDate(first); setEndDate(last);
  };
  const isActiveMonth = (monthIndex: number) => {
    const first = new Date(currentYear, monthIndex, 1).toISOString().split('T')[0];
    const last = new Date(currentYear, monthIndex + 1, 0).toISOString().split('T')[0];
    return startDate === first && endDate === last;
  };

  const parseTrinksTime = (dataHora: string): string => {
    if (!dataHora) return '—';
    // ISO format: "2026-05-15T10:14:00" or "2026-05-15 10:14"
    if (/^\d{4}-\d{2}-\d{2}/.test(dataHora)) {
      const d = new Date(dataHora);
      return isNaN(d.getTime()) ? '—' : d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    }
    // CSV format: "15/05/2026 10:14"
    const m = dataHora.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})/);
    if (m) return `${m[4]}:${m[5]}`;
    return '—';
  };
  const resetToCurrentMonth = () => { setPendingStart(firstDay); setPendingEnd(lastDay); setStartDate(firstDay); setEndDate(lastDay); };
  const currencyFormatter = (value: number) =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);

  const detailBills = detailType
    ? detailType === 'paid' ? paidBillsInPeriod
      : detailType === 'overdue' ? filteredBills.filter(b => isOverdue(b))
      : filteredBills.filter(b => b.status === BillStatus.PENDING)
    : [] as Bill[];

  const detailTitle = detailType === 'paid' ? 'Total Pago'
    : detailType === 'overdue' ? 'Total Atrasado'
    : detailType === 'receita' ? 'Receita Trinks'
    : 'Total Pendente';

  const detailTrinksTransacoes = useMemo(() =>
    trinksData
      .filter(t => t.date >= startDate && t.date <= endDate)
      .sort((a, b) => b.dataHora.localeCompare(a.dataHora)),
    [trinksData, startDate, endDate],
  );

  return (
    <div className="space-y-8 animate-in fade-in duration-500" style={{ backgroundColor: theme.colors.neutral.bgMain, minHeight: '100vh', padding: '2rem' }}>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-4xl font-black" style={{ color: theme.colors.neutral.black }}>Visão Financeira</h1>
          <p className="text-slate-500 font-bold text-sm uppercase">Receita Trinks · Despesas · Resultado Líquido</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <TrinksUpload onComplete={() => loadTrinks()} />
          <div className="bg-white p-3 rounded-[20px] border border-slate-100 shadow-[0_10px_15px_-3px_rgba(0,0,0,0.04)] flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <Filter size={16} className="text-slate-400" />
                <span className="text-xs font-bold text-slate-400 uppercase">Período:</span>
              </div>
              <input type="date" className="bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs outline-none" value={pendingStart} onChange={e => setPendingStart(e.target.value)} />
              <span className="text-slate-400 text-xs">até</span>
              <input type="date" className="bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs outline-none" value={pendingEnd} onChange={e => setPendingEnd(e.target.value)} />
              <button onClick={applyFilter} className="text-xs font-bold px-4 py-2 rounded-xl uppercase transition-all bg-indigo-600 text-white hover:bg-indigo-700">
                Filtrar
              </button>
              <button onClick={resetToCurrentMonth} className="text-xs font-bold px-3 py-2 rounded-xl uppercase transition-all" style={{ backgroundColor: theme.colors.primary.purpleLight, color: theme.colors.primary.purple }}>
                Este Mês
              </button>
            </div>
            <div className="flex flex-wrap gap-1">
              {MONTHS_SHORT.map((m, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => selectMonth(i)}
                  className="text-[10px] font-bold px-2 py-1 rounded-lg uppercase transition-all"
                  style={isActiveMonth(i)
                    ? { backgroundColor: theme.colors.primary.purple, color: '#fff' }
                    : { backgroundColor: theme.colors.primary.purpleLight, color: theme.colors.primary.purple }}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>
        </div>
      </header>

      {/* ── 4 KPI cards ────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">

        {/* Receita */}
        <button type="button" onClick={() => setDetailType('receita')}
          className="bg-white p-6 rounded-[20px] border border-slate-100 shadow-[0_10px_15px_-3px_rgba(0,0,0,0.04)] text-left hover:shadow-lg hover:-translate-y-1 transition-all">
          <div className="flex items-center justify-between mb-4">
            <div className="p-3 rounded-xl bg-emerald-50"><ArrowUpCircle className="text-emerald-500" size={24} /></div>
            {trinksLoading ? <span className="text-xs text-slate-400 animate-pulse">Carregando...</span> : <TrendingUp className="text-slate-300" size={20} />}
          </div>
          <p className="text-sm text-slate-500 font-medium">Receita (Trinks)</p>
          {trinksError
            ? <p className="text-xs text-red-500 break-all mt-1">{trinksError}</p>
            : <h3 className="text-3xl font-black text-emerald-600">{currencyFormatter(trinksPeriod.total)}</h3>
          }
          <p className="text-xs text-slate-400 mt-1 font-medium">Clique para ver detalhes</p>
        </button>

        {/* Despesas Pagas */}
        <button type="button" onClick={() => setDetailType('paid')}
          className="bg-white p-6 rounded-[20px] border border-slate-100 shadow-[0_10px_15px_-3px_rgba(0,0,0,0.04)] text-left hover:shadow-lg hover:-translate-y-1 transition-all">
          <div className="flex items-center justify-between mb-4">
            <div className="p-3 rounded-xl bg-red-50"><ArrowDownCircle className="text-red-400" size={24} /></div>
            <TrendingDown className="text-slate-300" size={20} />
          </div>
          <p className="text-sm text-slate-500 font-medium">Despesas Pagas</p>
          <h3 className="text-3xl font-black text-red-500">{currencyFormatter(totalPaid)}</h3>
          <p className="text-xs text-slate-400 mt-1 font-medium">Contas pagas no período</p>
        </button>

        {/* Resultado */}
        <div className={`bg-white p-6 rounded-[20px] border shadow-[0_10px_15px_-3px_rgba(0,0,0,0.04)] ${resultado >= 0 ? 'border-emerald-100' : 'border-red-100'}`}>
          <div className="flex items-center justify-between mb-4">
            <div className={`p-3 rounded-xl ${resultado >= 0 ? 'bg-indigo-50' : 'bg-orange-50'}`}>
              <Minus className={resultado >= 0 ? 'text-indigo-500' : 'text-orange-500'} size={24} />
            </div>
            {margemPct !== null && (
              <span className={`text-xs font-bold px-2 py-1 rounded-full ${resultado >= 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
                {margemPct.toFixed(1)}%
              </span>
            )}
          </div>
          <p className="text-sm text-slate-500 font-medium">Resultado Líquido</p>
          <h3 className={`text-3xl font-black ${resultado >= 0 ? 'text-indigo-600' : 'text-red-600'}`}>
            {resultado >= 0 ? '+' : ''}{currencyFormatter(resultado)}
          </h3>
          <p className="text-xs text-slate-400 mt-1 font-medium">Receita − Despesas pagas</p>
        </div>

        {/* Pendente */}
        <button type="button" onClick={() => setDetailType('pending')}
          className="bg-white p-6 rounded-[20px] border border-slate-100 shadow-[0_10px_15px_-3px_rgba(0,0,0,0.04)] text-left hover:shadow-lg hover:-translate-y-1 transition-all">
          <div className="flex items-center justify-between mb-4">
            <div className="p-3 rounded-xl bg-amber-50"><Clock className="text-amber-500" size={24} /></div>
            {totalOverdue > 0 && (
              <span className="text-xs font-bold px-2 py-1 rounded-full bg-red-100 text-red-600">
                Em atraso: {currencyFormatter(totalOverdue)}
              </span>
            )}
          </div>
          <p className="text-sm text-slate-500 font-medium">Pendente a Pagar</p>
          <h3 className="text-3xl font-black text-amber-600">{currencyFormatter(totalPending)}</h3>
          <p className="text-xs text-slate-400 mt-1 font-medium">Clique para ver detalhes</p>
        </button>
      </div>

      {/* ── Payment method breakdown (Trinks) ──────────────────────────────── */}
      {trinksPeriod.total > 0 && (
        <div className="bg-white p-5 rounded-[20px] border border-slate-100 shadow-[0_10px_15px_-3px_rgba(0,0,0,0.04)]">
          <p className="text-xs font-black text-slate-400 uppercase tracking-widest mb-4">Receita por Forma de Pagamento (Trinks)</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {COLUNAS_CAIXA.map(col => {
              const val = trinksPeriod[col];
              const pct = trinksPeriod.total > 0 ? (val / trinksPeriod.total) * 100 : 0;
              return (
                <div key={col} className="flex flex-col gap-1">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-500">{COLUNA_LABELS[col]}</span>
                    <span className="text-xs text-slate-400">{pct.toFixed(1)}%</span>
                  </div>
                  <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: COLUNA_COLORS[col] }} />
                  </div>
                  <span className="text-sm font-bold" style={{ color: COLUNA_COLORS[col] }}>
                    {currencyFormatter(val)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Despesas fixas vs variáveis ────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-[20px] border border-slate-100 shadow-[0_10px_15px_-3px_rgba(0,0,0,0.04)] flex items-center gap-6 hover:-translate-y-1 transition-all">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center shadow-lg" style={{ backgroundColor: theme.colors.primary.purple, color: 'white' }}>
            <Target size={32} />
          </div>
          <div>
            <p className="text-xs font-black text-slate-400 uppercase tracking-widest">Despesas Fixas</p>
            <h4 className="text-3xl font-black" style={{ color: theme.colors.primary.purple }}>{currencyFormatter(typeStats.fixed)}</h4>
            <p className="text-xs text-slate-400 font-bold">Baseado na sua planilha de Despesas Fixas</p>
          </div>
        </div>
        <div className="bg-white p-6 rounded-[20px] border border-slate-100 shadow-[0_10px_15px_-3px_rgba(0,0,0,0.04)] flex items-center gap-6 hover:-translate-y-1 transition-all">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center shadow-lg" style={{ backgroundColor: theme.colors.accent.blue, color: 'white' }}>
            <Zap size={32} />
          </div>
          <div>
            <p className="text-xs font-black text-slate-400 uppercase tracking-widest">Despesas Variáveis</p>
            <h4 className="text-3xl font-black" style={{ color: theme.colors.accent.blue }}>{currencyFormatter(typeStats.variable)}</h4>
            <p className="text-xs text-slate-400 font-bold">Gastos pontuais e extras do período</p>
          </div>
        </div>
      </div>

      {/* ── Chart + bills list ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 bg-white p-6 rounded-[20px] border border-slate-100 shadow-[0_10px_15px_-3px_rgba(0,0,0,0.04)]">
          <h3 className="text-lg font-semibold mb-1 flex items-center gap-2" style={{ color: theme.colors.neutral.black }}>
            <Calendar style={{ color: theme.colors.primary.purple }} size={20} />
            Receita × Despesas — {currentYear}
          </h3>
          <p className="text-xs text-slate-400 mb-6">Receita = transações Trinks sincronizadas · Despesas = contas pagas</p>
          <div className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} barCategoryGap="20%" barGap={4}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#94a3b8', fontSize: 12 }} />
                <YAxis hide />
                <Tooltip
                  cursor={{ fill: '#f8fafc' }}
                  contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)' }}
                  formatter={(value: number) => currencyFormatter(value)}
                />
                <Legend formatter={v => v === 'receita' ? 'Receita (Trinks)' : 'Despesas (Pagas)'} />
                <Bar dataKey="receita" name="receita" radius={[6, 6, 0, 0]} fill="#10B981" maxBarSize={16} />
                <Bar dataKey="despesas" name="despesas" radius={[6, 6, 0, 0]} fill="#EF4444" maxBarSize={16} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white p-6 rounded-[20px] border border-slate-100 shadow-[0_10px_15px_-3px_rgba(0,0,0,0.04)]">
          <h3 className="text-lg font-semibold mb-4" style={{ color: theme.colors.neutral.black }}>Contas do Período</h3>
          <div className="space-y-4 max-h-[300px] overflow-y-auto pr-2">
            {(() => {
              const periodNotPaid = filteredBills.filter(b => !isPaid(b));
              const periodIds = new Set(periodNotPaid.map(b => b.id));
              const overdueOutside = bills.filter(b => isOverdue(b) && !periodIds.has(b.id));
              const allContas = [...overdueOutside, ...periodNotPaid]
                .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());
              if (allContas.length === 0) return (
                <div className="text-center py-12">
                  <div className="text-slate-200 flex justify-center mb-2"><CreditCard size={32} /></div>
                  <p className="text-slate-400 text-sm font-bold uppercase">Nenhuma conta pendente</p>
                </div>
              );
              return allContas.map(bill => {
                const supplier = suppliers.find(s => s.id === bill.supplierId);
                const account = accounts.find(a => a.id === bill.accountId);
                const overdue = isOverdue(bill);
                return (
                  <div
                    key={bill.id}
                    onClick={() => onNavigateToBill?.(bill.id)}
                    className={`flex items-center justify-between p-3 rounded-xl border transition-all ${overdue ? 'border-rose-200 bg-rose-50 hover:bg-rose-100' : 'border-slate-100 hover:bg-slate-50'} ${onNavigateToBill ? 'cursor-pointer hover:shadow-md hover:-translate-y-0.5' : 'hover:shadow-sm'}`}
                  >
                    <div className="flex-1 min-w-0 mr-2">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <p className="font-medium truncate text-sm" style={{ color: theme.colors.neutral.black }}>{bill.description}</p>
                        <span className="text-xs font-black uppercase px-1.5 py-0.5 rounded" style={{ backgroundColor: account?.type === 'VARIABLE' ? '#DBEAFE' : '#EDE9FE', color: account?.type === 'VARIABLE' ? theme.colors.accent.blue : theme.colors.primary.purple }}>
                          {account?.type === 'VARIABLE' ? 'V' : 'F'}
                        </span>
                        {overdue && (
                          <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded-full bg-rose-600 text-white">Atrasada</span>
                        )}
                      </div>
                      <p className="text-xs text-slate-400 truncate font-bold uppercase tracking-tight">{supplier?.name || 'Fornecedor'}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="font-bold text-sm" style={{ color: theme.colors.neutral.black }}>{currencyFormatter(bill.amount)}</p>
                      <p className={`text-xs font-black uppercase tracking-wider ${overdue ? 'text-rose-600' : 'text-slate-400'}`}>
                        {new Date(bill.dueDate).toLocaleDateString('pt-BR')}
                      </p>
                    </div>
                  </div>
                );
              });
            })()}
          </div>
        </div>
      </div>

      {/* ── Detail modal ───────────────────────────────────────────────────── */}
      {detailType && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-[20px] shadow-[0_20px_25px_-5px_rgba(0,0,0,0.1)] w-full max-w-5xl max-h-[85vh] overflow-hidden flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100" style={{ backgroundColor: theme.colors.neutral.bgMain }}>
              <div>
                <h3 className="text-lg font-black" style={{ color: theme.colors.neutral.black }}>{detailTitle}</h3>
                <p className="text-xs text-slate-500 font-bold uppercase tracking-wider">
                  {detailType === 'receita'
                    ? `${detailTrinksTransacoes.length} atendimentos · ${currencyFormatter(trinksPeriod.total)}`
                    : 'Detalhamento do Período'}
                </p>
              </div>
              <button type="button" onClick={() => setDetailType(null)} className="px-4 py-2 border border-slate-200 rounded-lg font-bold text-slate-600 hover:bg-slate-50 transition-colors">
                Fechar
              </button>
            </div>

            {detailType === 'receita' ? (
              <div className="overflow-auto">
                <table className="w-full text-left border-collapse min-w-[800px]">
                  <thead>
                    <tr className="border-b border-slate-100" style={{ backgroundColor: theme.colors.neutral.bgMain }}>
                      {['Data / Hora', 'Cliente', 'Serviços', 'Forma de Pagamento', 'Total'].map(h => (
                        <th key={h} className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {detailTrinksTransacoes.map(t => (
                      <tr key={t.id} className="hover:bg-slate-50 transition-colors">
                        <td className="px-4 py-3 text-sm text-slate-600 whitespace-nowrap">
                          {t.date ? `${t.date.split('-').reverse().join('/')}` : '—'}
                          <span className="ml-1 text-xs text-slate-400">{parseTrinksTime(t.dataHora)}</span>
                        </td>
                        <td className="px-4 py-3 text-sm font-medium" style={{ color: theme.colors.neutral.black }}>
                          {t.cliente?.nome || '—'}
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-600 max-w-[240px]">
                          {(t.servicos || []).map(s => s.nome).join(' · ') || '—'}
                        </td>
                        <td className="px-4 py-3 text-xs">
                          <div className="flex flex-col gap-0.5">
                            {(t.formasPagamentos || []).map((fp, i) => (
                              <span key={i} className="inline-flex items-center gap-1">
                                <span className="font-semibold text-slate-700">{fp.nome}</span>
                                <span className="text-slate-400">{currencyFormatter(fp.valor)}</span>
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-sm font-bold text-emerald-600 whitespace-nowrap">
                          {currencyFormatter(t.totalPagar ?? 0)}
                        </td>
                      </tr>
                    ))}
                    {detailTrinksTransacoes.length === 0 && (
                      <tr><td colSpan={5} className="px-4 py-10 text-center text-slate-400 font-medium">Nenhuma transação no período. Sincronize o Trinks.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="overflow-auto">
                <table className="w-full text-left border-collapse min-w-[900px]">
                  <thead>
                    <tr className="border-b border-slate-100" style={{ backgroundColor: theme.colors.neutral.bgMain }}>
                      {['Fornecedor', 'Descrição', 'Plano', 'Vencimento', 'Pagamento', 'Valor', 'Juros'].map(h => (
                        <th key={h} className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {detailBills.map(bill => {
                      const supplier = suppliers.find(s => s.id === bill.supplierId);
                      const account = accounts.find(a => a.id === bill.accountId);
                      return (
                        <tr key={bill.id} className="hover:bg-slate-50 transition-colors">
                          <td className="px-4 py-3 text-sm" style={{ color: theme.colors.neutral.black }}>{(supplier?.name || 'Fornecedor').toUpperCase()}</td>
                          <td className="px-4 py-3 text-sm text-slate-600">{bill.description}</td>
                          <td className="px-4 py-3 text-xs text-slate-600 font-semibold">{account?.name || 'N/A'}</td>
                          <td className="px-4 py-3 text-sm text-slate-600">{new Date(bill.dueDate).toLocaleDateString('pt-BR')}</td>
                          <td className="px-4 py-3 text-sm text-slate-600">{bill.paidDate ? new Date(bill.paidDate).toLocaleDateString('pt-BR') : '—'}</td>
                          <td className="px-4 py-3 text-sm font-semibold" style={{ color: theme.colors.neutral.black }}>{currencyFormatter(bill.amount)}</td>
                          <td className="px-4 py-3 text-sm font-semibold">
                            {bill.interestAmount !== undefined && bill.interestAmount !== 0 ? `${bill.interestAmount > 0 ? '+' : ''}${currencyFormatter(bill.interestAmount)}` : '—'}
                          </td>
                        </tr>
                      );
                    })}
                    {detailBills.length === 0 && (
                      <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-400 font-medium">Nenhuma conta encontrada no período.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
