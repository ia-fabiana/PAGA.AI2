
import React, { useMemo, useState } from 'react';
import { Bill, Supplier, BillStatus, ChartOfAccount } from './types';
import { TrendingUp, CreditCard, Clock, AlertCircle, Calendar, Filter, Target, Zap } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, PieChart, Pie } from 'recharts';
import { theme } from './theme';

interface DashboardProps {
  bills: Bill[];
  suppliers: Supplier[];
  accounts: ChartOfAccount[];
  onEditBill: (bill: Bill) => void;
  onStatusChange: (id: string, status: BillStatus) => void;
}

export const Dashboard: React.FC<DashboardProps> = ({ bills, suppliers, accounts, onEditBill, onStatusChange }) => {
  const now = new Date();
  const firstDay = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];
  const currentYear = now.getFullYear();

  const [startDate, setStartDate] = useState(firstDay);
  const [endDate, setEndDate] = useState(lastDay);
  const [detailType, setDetailType] = useState<'pending' | 'paid' | 'overdue' | null>(null);

  const filteredBills = useMemo(() => {
    return bills.filter(bill => {
      const billDate = new Date(bill.dueDate);
      const start = startDate ? new Date(startDate) : null;
      const end = endDate ? new Date(endDate) : null;
      
      if (start) start.setHours(0, 0, 0, 0);
      if (end) end.setHours(23, 59, 59, 999);
      
      const isAfterStart = !start || billDate >= start;
      const isBeforeEnd = !end || billDate <= end;
      
      return isAfterStart && isBeforeEnd;
    });
  }, [bills, startDate, endDate]);

  const toDate = (dateStr: string) => new Date(`${dateStr}T12:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const isPaid = (bill: Bill) => bill.status === BillStatus.PAID || Boolean(bill.paidDate);
  const isOverdue = (bill: Bill) => !isPaid(bill) && toDate(bill.dueDate) < today;

  const totalPending = filteredBills.filter(b => b.status === BillStatus.PENDING).reduce((sum, b) => sum + b.amount, 0);
  const totalPaid = filteredBills.filter(b => isPaid(b)).reduce((sum, b) => sum + b.amount, 0);
  const totalOverdue = filteredBills.filter(b => isOverdue(b)).reduce((sum, b) => sum + b.amount, 0);

  // Cálculo de Fixas vs Variáveis
  const typeStats = useMemo(() => {
    let fixed = 0;
    let variable = 0;

    filteredBills.forEach(bill => {
      const account = accounts.find(a => a.id === bill.accountId);
      if (account?.type === 'VARIABLE') {
        variable += bill.amount;
      } else {
        fixed += bill.amount; // Default a FIXED como na sua planilha
      }
    });

    return { fixed, variable };
  }, [filteredBills, accounts]);

  const stats = [
    { label: 'Total Pendente', value: totalPending, icon: Clock, color: '#3B82F6', bg: '#DBEAFE', type: 'pending' as const },
    { label: 'Total Pago', value: totalPaid, icon: CreditCard, color: '#10B981', bg: '#D1FAE5', type: 'paid' as const },
    { label: 'Total Atrasado', value: totalOverdue, icon: AlertCircle, color: '#EF4444', bg: '#FEE2E2', type: 'overdue' as const },
  ];

  const chartData = useMemo(() => {
    const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
    const data = months.map(m => ({ name: m, real: 0, estimated: 0 }));

    const getMonthIndexSafe = (dateStr: string) => {
      const [yearStr, monthStr] = dateStr.split('-');
      const year = Number(yearStr);
      const month = Number(monthStr);
      if (!year || !month) return null;
      return { year, monthIndex: month - 1 };
    };

    const toNumber = (value: unknown) => {
      if (typeof value === 'number') return value;
      const parsed = Number(String(value).replace(',', '.'));
      return Number.isFinite(parsed) ? parsed : 0;
    };

    bills.forEach(bill => {
      const amount = toNumber(bill.amount);
      const dueParts = getMonthIndexSafe(bill.dueDate);
      if (dueParts && dueParts.year === currentYear) {
        data[dueParts.monthIndex].estimated += amount;
      }

      if (bill.status === BillStatus.PAID || bill.paidDate) {
        const paidRef = bill.paidDate || bill.dueDate;
        const paidParts = getMonthIndexSafe(paidRef);
        if (paidParts && paidParts.year === currentYear) {
          const paidAmount = bill.paidAmount !== undefined ? toNumber(bill.paidAmount) : amount;
          data[paidParts.monthIndex].real += paidAmount;
        }
      }
    });

    return data;
  }, [bills, currentYear]);

  const resetToCurrentMonth = () => {
    setStartDate(firstDay);
    setEndDate(lastDay);
  };

  const currencyFormatter = (value: number) => 
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);

  const detailBills = detailType
    ? detailType === 'paid'
      ? filteredBills.filter(b => isPaid(b))
      : detailType === 'overdue'
      ? filteredBills.filter(b => isOverdue(b))
      : filteredBills.filter(b => b.status === BillStatus.PENDING)
    : [] as Bill[];

  const detailTitle = detailType === 'paid'
    ? 'Total Pago'
    : detailType === 'overdue'
    ? 'Total Atrasado'
    : 'Total Pendente';

  return (
    <div className="space-y-8 animate-in fade-in duration-500" style={{ backgroundColor: theme.colors.neutral.bgMain, minHeight: '100vh', padding: '2rem' }}>
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-4xl font-black" style={{ color: theme.colors.neutral.black }}>Visão Geral Financeira</h1>
          <p className="text-slate-500 font-bold text-sm uppercase">Controle de Despesas Fixas e Variáveis por período.</p>
        </div>
        
        <div className="bg-white p-3 rounded-[20px] border border-slate-100 shadow-[0_10px_15px_-3px_rgba(0,0,0,0.04)] flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Filter size={16} className="text-slate-400" />
            <span className="text-xs font-bold text-slate-400 uppercase">Período:</span>
          </div>
          <div className="flex items-center gap-2">
            <input 
              type="date" 
              className="bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs outline-none transition-all duration-200" 
              value={startDate} 
              onChange={(e) => setStartDate(e.target.value)} 
            />
            <span className="text-slate-400 text-xs">até</span>
            <input 
              type="date" 
              className="bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs outline-none transition-all duration-200" 
              value={endDate} 
              onChange={(e) => setEndDate(e.target.value)} 
            />
          </div>
          <button 
            onClick={resetToCurrentMonth}
            className="text-xs font-bold px-3 py-2 rounded-xl transition-all duration-300 uppercase"
            style={{ 
              backgroundColor: theme.colors.primary.purpleLight, 
              color: theme.colors.primary.purple 
            }}
            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = theme.colors.primary.purple}
            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = theme.colors.primary.purpleLight}
          >
            Este Mês
          </button>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {stats.map((stat, i) => (
          <button
            key={i}
            type="button"
            onClick={() => setDetailType(stat.type)}
            className="bg-white p-6 rounded-[20px] border border-slate-100 shadow-[0_10px_15px_-3px_rgba(0,0,0,0.04)] transition-all duration-200 hover:shadow-[0_20px_25px_-5px_rgba(0,0,0,0.08)] hover:-translate-y-1 text-left"
          >
            <div className="flex items-center justify-between mb-4">
              <div style={{ backgroundColor: stat.bg }} className="p-3 rounded-xl">
                <stat.icon style={{ color: stat.color }} size={24} />
              </div>
              <TrendingUp className="text-slate-300" size={20} />
            </div>
            <p className="text-sm text-slate-500 font-medium">{stat.label}</p>
            <h3 className="text-3xl font-black" style={{ color: theme.colors.neutral.black }}>
              {currencyFormatter(stat.value)}
            </h3>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-[20px] border border-slate-100 shadow-[0_10px_15px_-3px_rgba(0,0,0,0.04)] flex items-center gap-6 hover:-translate-y-1 transition-all duration-200">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center shadow-lg" style={{ backgroundColor: theme.colors.primary.purple, color: 'white' }}>
            <Target size={32} />
          </div>
          <div>
            <p className="text-xs font-black text-slate-400 uppercase tracking-widest">Despesas Fixas</p>
            <h4 className="text-3xl font-black" style={{ color: theme.colors.primary.purple }}>{currencyFormatter(typeStats.fixed)}</h4>
            <p className="text-xs text-slate-400 font-bold">Baseado na sua planilha de Despesas Fixas</p>
          </div>
        </div>
        <div className="bg-white p-6 rounded-[20px] border border-slate-100 shadow-[0_10px_15px_-3px_rgba(0,0,0,0.04)] flex items-center gap-6 hover:-translate-y-1 transition-all duration-200">
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

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 bg-white p-6 rounded-[20px] border border-slate-100 shadow-[0_10px_15px_-3px_rgba(0,0,0,0.04)]">
          <h3 className="text-lg font-semibold mb-6 flex items-center gap-2" style={{ color: theme.colors.neutral.black }}>
            <Calendar style={{ color: theme.colors.primary.purple }} size={20} />
            Evolução Mensal (Ano)
          </h3>
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} barCategoryGap="20%" barGap={6}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fill: '#94a3b8', fontSize: 12}} />
                <YAxis hide />
                <Tooltip 
                  cursor={{fill: '#f8fafc'}}
                  contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)' }}
                  formatter={(value: number) => currencyFormatter(value)}
                />
                <Bar dataKey="estimated" name="Estimado" radius={[6, 6, 0, 0]} fill="#D1D5DB" maxBarSize={18} />
                <Bar dataKey="real" name="Real" radius={[6, 6, 0, 0]} fill="#7C3AED" maxBarSize={18} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white p-6 rounded-[20px] border border-slate-100 shadow-[0_10px_15px_-3px_rgba(0,0,0,0.04)]">
          <h3 className="text-lg font-semibold mb-4" style={{ color: theme.colors.neutral.black }}>Contas do Período</h3>
          <div className="space-y-4 max-h-[300px] overflow-y-auto pr-2">
            {filteredBills
              .filter(b => b.status !== BillStatus.PAID)
              .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())
              .map(bill => {
                const supplier = suppliers.find(s => s.id === bill.supplierId);
                const account = accounts.find(a => a.id === bill.accountId);
                return (
                  <div key={bill.id} className="flex items-center justify-between p-3 rounded-xl border border-slate-100 hover:bg-slate-50 hover:shadow-sm transition-all">
                    <div className="flex-1 min-w-0 mr-2">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <p className="font-medium truncate text-sm" style={{ color: theme.colors.neutral.black }}>{bill.description}</p>
                        <span 
                          className="text-xs font-black uppercase px-1.5 py-0.5 rounded"
                          style={{ 
                            backgroundColor: account?.type === 'VARIABLE' ? '#DBEAFE' : '#EDE9FE',
                            color: account?.type === 'VARIABLE' ? theme.colors.accent.blue : theme.colors.primary.purple
                          }}
                        >
                          {account?.type === 'VARIABLE' ? 'V' : 'F'}
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 truncate font-bold uppercase tracking-tight">{supplier?.name || 'Fornecedor'}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="font-bold text-sm" style={{ color: theme.colors.neutral.black }}>
                        {currencyFormatter(bill.amount)}
                      </p>
                      <p className={`text-xs font-black uppercase tracking-wider ${
                        new Date(bill.dueDate) < new Date() ? 'text-rose-600' : 'text-slate-400'
                      }`}>
                        {new Date(bill.dueDate).toLocaleDateString('pt-BR')}
                      </p>
                    </div>
                  </div>
                );
              })}
            {filteredBills.filter(b => b.status !== BillStatus.PAID).length === 0 && (
              <div className="text-center py-12">
                <div className="text-slate-200 flex justify-center mb-2"><CreditCard size={32} /></div>
                <p className="text-slate-400 text-sm font-bold uppercase">Nenhuma conta pendente</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {detailType && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-[20px] shadow-[0_20px_25px_-5px_rgba(0,0,0,0.1)] w-full max-w-5xl max-h-[85vh] overflow-hidden flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100" style={{ backgroundColor: theme.colors.neutral.bgMain }}>
              <div>
                <h3 className="text-lg font-black" style={{ color: theme.colors.neutral.black }}>{detailTitle}</h3>
                <p className="text-xs text-slate-500 font-bold uppercase tracking-wider">Detalhamento do Período</p>
              </div>
              <button
                type="button"
                onClick={() => setDetailType(null)}
                className="px-4 py-2 border border-slate-200 rounded-lg font-bold text-slate-600 hover:bg-slate-50 transition-colors"
              >
                Fechar
              </button>
            </div>

            <div className="overflow-auto">
              <table className="w-full text-left border-collapse min-w-[900px]">
                <thead>
                  <tr className="border-b border-slate-100" style={{ backgroundColor: theme.colors.neutral.bgMain }}>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Fornecedor</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Descrição</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Plano</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Vencimento</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Pagamento</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Valor</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Juros</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {detailBills.map(bill => {
                    const supplier = suppliers.find(s => s.id === bill.supplierId);
                    const account = accounts.find(a => a.id === bill.accountId);
                    return (
                      <tr key={bill.id} className="hover:bg-slate-50 transition-colors">
                        <td className="px-4 py-3 text-sm" style={{ color: theme.colors.neutral.black }}>
                          {(supplier?.name || 'Fornecedor').toUpperCase()}
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-600">{bill.description}</td>
                        <td className="px-4 py-3 text-xs text-slate-600 font-semibold">
                          {account?.name || 'N/A'}
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-600">
                          {new Date(bill.dueDate).toLocaleDateString('pt-BR')}
                        </td>
                        <td className="px-4 py-3 text-sm text-slate-600">
                          {bill.paidDate ? new Date(bill.paidDate).toLocaleDateString('pt-BR') : '—'}
                        </td>
                        <td className="px-4 py-3 text-sm font-semibold" style={{ color: theme.colors.neutral.black }}>
                          {currencyFormatter(bill.amount)}
                        </td>
                        <td className="px-4 py-3 text-sm font-semibold">
                          {bill.interestAmount !== undefined && bill.interestAmount !== 0
                            ? `${bill.interestAmount > 0 ? '+' : ''}${currencyFormatter(bill.interestAmount)}`
                            : '—'}
                        </td>
                      </tr>
                    );
                  })}
                  {detailBills.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-4 py-10 text-center text-slate-400 font-medium">
                        Nenhuma conta encontrada no período.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
