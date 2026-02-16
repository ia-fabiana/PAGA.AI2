
import React, { useMemo, useState } from 'react';
import { Bill, Supplier, BillStatus, ChartOfAccount } from '../types';
import { TrendingUp, CreditCard, Clock, AlertCircle, Calendar, Filter, Target, Zap } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, PieChart, Pie } from 'recharts';

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

  const [startDate, setStartDate] = useState(firstDay);
  const [endDate, setEndDate] = useState(lastDay);

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

  const totalPending = filteredBills.filter(b => b.status === BillStatus.PENDING).reduce((sum, b) => sum + b.amount, 0);
  const totalPaid = filteredBills.filter(b => b.status === BillStatus.PAID).reduce((sum, b) => sum + b.amount, 0);
  const totalOverdue = filteredBills.filter(b => b.status === BillStatus.OVERDUE).reduce((sum, b) => sum + b.amount, 0);

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
    { label: 'Total Pendente', value: totalPending, icon: Clock, color: 'text-blue-600', bg: 'bg-blue-50' },
    { label: 'Total Pago', value: totalPaid, icon: CreditCard, color: 'text-emerald-600', bg: 'bg-emerald-50' },
    { label: 'Total Atrasado', value: totalOverdue, icon: AlertCircle, color: 'text-rose-600', bg: 'bg-rose-50' },
  ];

  const chartData = useMemo(() => {
    const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
    const data = months.map(m => ({ name: m, total: 0 }));
    
    filteredBills.forEach(bill => {
      const monthIndex = new Date(bill.dueDate).getMonth();
      data[monthIndex].total += bill.amount;
    });
    
    return data;
  }, [filteredBills]);

  const resetToCurrentMonth = () => {
    setStartDate(firstDay);
    setEndDate(lastDay);
  };

  const currencyFormatter = (value: number) => 
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Visão Geral Financeira</h1>
          <p className="text-slate-500">Controle de Despesas Fixas e Variáveis por período.</p>
        </div>
        
        <div className="bg-white p-3 rounded-2xl border border-slate-200 shadow-sm flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Filter size={16} className="text-slate-400" />
            <span className="text-xs font-bold text-slate-400 uppercase">Período:</span>
          </div>
          <div className="flex items-center gap-2">
            <input 
              type="date" 
              className="bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 text-xs focus:ring-2 focus:ring-indigo-500 outline-none" 
              value={startDate} 
              onChange={(e) => setStartDate(e.target.value)} 
            />
            <span className="text-slate-400 text-xs">até</span>
            <input 
              type="date" 
              className="bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 text-xs focus:ring-2 focus:ring-indigo-500 outline-none" 
              value={endDate} 
              onChange={(e) => setEndDate(e.target.value)} 
            />
          </div>
          <button 
            onClick={resetToCurrentMonth}
            className="text-[10px] font-bold text-indigo-600 bg-indigo-50 px-2 py-1 rounded hover:bg-indigo-100 transition-colors uppercase"
          >
            Este Mês
          </button>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {stats.map((stat, i) => (
          <div key={i} className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm transition-hover hover:shadow-md">
            <div className="flex items-center justify-between mb-4">
              <div className={`${stat.bg} p-3 rounded-xl`}>
                <stat.icon className={stat.color} size={24} />
              </div>
              <TrendingUp className="text-slate-300" size={20} />
            </div>
            <p className="text-sm text-slate-500 font-medium">{stat.label}</p>
            <h3 className="text-2xl font-bold text-slate-800">
              {currencyFormatter(stat.value)}
            </h3>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-3xl border border-indigo-100 shadow-sm flex items-center gap-6">
          <div className="w-16 h-16 bg-indigo-600 text-white rounded-2xl flex items-center justify-center shadow-lg shadow-indigo-100">
            <Target size={32} />
          </div>
          <div>
            <p className="text-xs font-black text-slate-400 uppercase tracking-widest">Despesas Fixas</p>
            <h4 className="text-2xl font-black text-indigo-600">{currencyFormatter(typeStats.fixed)}</h4>
            <p className="text-[10px] text-slate-400 font-bold">Baseado na sua planilha de Despesas Fixas</p>
          </div>
        </div>
        <div className="bg-white p-6 rounded-3xl border border-orange-100 shadow-sm flex items-center gap-6">
          <div className="w-16 h-16 bg-orange-500 text-white rounded-2xl flex items-center justify-center shadow-lg shadow-orange-100">
            <Zap size={32} />
          </div>
          <div>
            <p className="text-xs font-black text-slate-400 uppercase tracking-widest">Despesas Variáveis</p>
            <h4 className="text-2xl font-black text-orange-600">{currencyFormatter(typeStats.variable)}</h4>
            <p className="text-[10px] text-slate-400 font-bold">Gastos pontuais e extras do período</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <h3 className="text-lg font-semibold mb-6 flex items-center gap-2">
            <Calendar className="text-blue-600" size={20} />
            Evolução Mensal (Filtrado)
          </h3>
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fill: '#94a3b8', fontSize: 12}} />
                <YAxis hide />
                <Tooltip 
                  cursor={{fill: '#f8fafc'}}
                  contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)' }}
                  formatter={(value: number) => currencyFormatter(value)}
                />
                <Bar dataKey="total" radius={[6, 6, 0, 0]}>
                  {chartData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={index === new Date().getMonth() ? '#2563eb' : '#cbd5e1'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <h3 className="text-lg font-semibold mb-4">Contas do Período</h3>
          <div className="space-y-4 max-h-[300px] overflow-y-auto pr-2">
            {filteredBills
              .filter(b => b.status !== BillStatus.PAID)
              .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())
              .map(bill => {
                const supplier = suppliers.find(s => s.id === bill.supplierId);
                const account = accounts.find(a => a.id === bill.accountId);
                return (
                  <div key={bill.id} className="flex items-center justify-between p-3 rounded-xl border border-slate-100 hover:bg-slate-50 transition-colors">
                    <div className="flex-1 min-w-0 mr-2">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <p className="font-medium text-slate-800 truncate text-sm">{bill.description}</p>
                        <span className={`text-[8px] font-black uppercase px-1 rounded ${account?.type === 'VARIABLE' ? 'bg-orange-100 text-orange-600' : 'bg-indigo-100 text-indigo-600'}`}>
                          {account?.type === 'VARIABLE' ? 'V' : 'F'}
                        </span>
                      </div>
                      <p className="text-[10px] text-slate-400 truncate font-bold uppercase tracking-tight">{supplier?.name || 'Fornecedor'}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="font-bold text-slate-800 text-sm">
                        {currencyFormatter(bill.amount)}
                      </p>
                      <p className={`text-[9px] font-black uppercase tracking-wider ${
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
                <p className="text-slate-400 text-xs font-bold uppercase">Nenhuma conta pendente</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
