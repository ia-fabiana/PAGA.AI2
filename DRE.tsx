
import React, { useMemo, useState } from 'react';
import { Bill, Revenue, ChartOfAccount, DreCategory } from '../types';
import { TrendingUp, Edit3, Check, FileDown, AlertCircle } from 'lucide-react';
import { jsPDF } from 'jspdf';
import 'jspdf-autotable';

interface DREProps {
  bills: Bill[];
  revenues: Revenue[];
  accounts: ChartOfAccount[];
  setRevenues: (r: Revenue[]) => void;
}

export const DRE: React.FC<DREProps> = ({ bills, revenues, accounts, setRevenues }) => {
  const [editingMonth, setEditingMonth] = useState<number | null>(null);
  const [editValue, setEditValue] = useState<string>('');
  const currentYear = 2025;

  const months = ['JANEIRO', 'FEVEREIRO', 'MARÇO', 'ABRIL', 'MAIO', 'JUNHO', 'JULHO', 'AGOSTO', 'SETEMBRO', 'OUTUBRO', 'NOVEMBRO', 'DEZEMBRO'];

  const dreData = useMemo(() => {
    return months.map((_, index) => {
      const monthRevenue = revenues.find(r => r.month === index && r.year === currentYear)?.amount || 0;
      const monthBills = bills.filter(b => {
        const d = new Date(b.dueDate);
        return d.getMonth() === index && d.getFullYear() === currentYear;
      });

      const getSum = (cat: DreCategory) => monthBills
        .filter(b => accounts.find(a => a.id === b.accountId)?.category === cat)
        .reduce((sum, b) => sum + b.amount, 0);

      const products = getSum('PRODUCT_COST');
      const commissions = getSum('COMMISSION');
      const fixedSalary = getSum('FIXED_SALARY');
      const fixedExpenses = getSum('FIXED_EXPENSES');
      const variableExpenses = getSum('VARIABLE_EXPENSES');
      const proLabore = getSum('PRO_LABORE');

      const grossProfit = monthRevenue - products;
      const totalExpenses = commissions + fixedSalary + fixedExpenses + variableExpenses + proLabore;
      const netProfit = grossProfit - totalExpenses;

      return {
        revenue: monthRevenue,
        products,
        grossProfit,
        commissions,
        fixedSalary,
        fixedExpenses,
        variableExpenses,
        proLabore,
        netProfit
      };
    });
  }, [bills, revenues, accounts, currentYear]);

  const saveRevenue = () => {
    if (editingMonth === null) return;
    const val = parseFloat(editValue) || 0;
    const exists = revenues.find(r => r.month === editingMonth && r.year === currentYear);
    if (exists) {
      setRevenues(revenues.map(r => (r.month === editingMonth && r.year === currentYear) ? { ...r, amount: val } : r));
    } else {
      setRevenues([...revenues, { month: editingMonth, year: currentYear, amount: val }]);
    }
    setEditingMonth(null);
  };

  const fmt = (v: number) => v === 0 ? '-' : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

  return (
    <div className="space-y-8 animate-in fade-in duration-700">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-black text-slate-800 tracking-tight uppercase">DRE COMERCIAL {currentYear}</h1>
          <p className="text-slate-500 font-bold uppercase text-[10px] tracking-widest mt-1">Resumo Consolidado das Telas de Gestão</p>
        </div>
      </div>

      <div className="bg-white rounded-[2rem] border border-slate-200 shadow-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[1500px]">
            <thead>
              <tr className="bg-[#1e293b] text-white">
                <th className="px-6 py-4 text-[11px] font-black uppercase sticky left-0 z-30 bg-[#1e293b] border-r border-slate-700">DESCRIÇÃO POR TELA</th>
                {months.map(m => (
                  <th key={m} className="px-4 py-4 text-center text-[10px] font-black uppercase border-r border-slate-700">{m}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {/* RECEITA */}
              <tr className="bg-blue-900 text-white font-black">
                <td className="px-6 py-4 text-xs sticky left-0 z-20 bg-blue-900 uppercase">RECEITA BRUTA (FATURAMENTO)</td>
                {dreData.map((d, i) => (
                  <td key={i} className="px-4 py-4 text-center text-[11px] bg-yellow-400 text-blue-900 cursor-pointer hover:bg-yellow-300 transition-colors" onClick={() => { setEditingMonth(i); setEditValue(d.revenue.toString()); }}>
                    {editingMonth === i ? (
                       <div className="flex gap-1 justify-center"><input autoFocus className="w-20 text-blue-900 px-1" value={editValue} onChange={e => setEditValue(e.target.value)} /><button onClick={(e) => {e.stopPropagation(); saveRevenue();}} className="bg-blue-900 text-white p-1"><Check size={12}/></button></div>
                    ) : fmt(d.revenue)}
                  </td>
                ))}
              </tr>

              {/* CUSTO DE PRODUTO */}
              <tr className="bg-slate-50 group">
                <td className="px-6 py-4 text-xs font-bold text-rose-600 sticky left-0 z-10 bg-slate-50 uppercase">(-) ABA: PRODUTOS</td>
                {dreData.map((d, i) => <td key={i} className="px-4 py-4 text-center text-[10px]">{fmt(d.products)}</td>)}
              </tr>

              {/* LUCRO BRUTO */}
              <tr className="bg-indigo-100 font-black">
                <td className="px-6 py-4 text-xs sticky left-0 z-10 bg-indigo-100 uppercase">(=) LUCRO BRUTO</td>
                {dreData.map((d, i) => <td key={i} className="px-4 py-4 text-center text-[11px] text-indigo-900">{fmt(d.grossProfit)}</td>)}
              </tr>

              {/* COMISSÕES */}
              <tr className="group">
                <td className="px-6 py-4 text-xs font-bold text-slate-600 sticky left-0 z-10 bg-white uppercase">(-) ABA: COMISSÕES</td>
                {dreData.map((d, i) => <td key={i} className="px-4 py-4 text-center text-[10px]">{fmt(d.commissions)}</td>)}
              </tr>

              {/* SALÁRIO FIXO */}
              <tr className="group">
                <td className="px-6 py-4 text-xs font-bold text-slate-600 sticky left-0 z-10 bg-white uppercase">(-) ABA: SALÁRIO FIXO</td>
                {dreData.map((d, i) => <td key={i} className="px-4 py-4 text-center text-[10px]">{fmt(d.fixedSalary)}</td>)}
              </tr>

              {/* DESP FIXAS */}
              <tr className="group">
                <td className="px-6 py-4 text-xs font-bold text-slate-600 sticky left-0 z-10 bg-white uppercase">(-) ABA: DESP. FIXAS</td>
                {dreData.map((d, i) => <td key={i} className="px-4 py-4 text-center text-[10px]">{fmt(d.fixedExpenses)}</td>)}
              </tr>

              {/* DESP VARIAVEIS */}
              <tr className="group">
                <td className="px-6 py-4 text-xs font-bold text-slate-600 sticky left-0 z-10 bg-white uppercase">(-) ABA: DESP. VARIÁVEIS</td>
                {dreData.map((d, i) => <td key={i} className="px-4 py-4 text-center text-[10px]">{fmt(d.variableExpenses)}</td>)}
              </tr>

              {/* PRO LABORE */}
              <tr className="group">
                <td className="px-6 py-4 text-xs font-bold text-slate-600 sticky left-0 z-10 bg-white uppercase">(-) ABA: PRO-LABORE</td>
                {dreData.map((d, i) => <td key={i} className="px-4 py-4 text-center text-[10px]">{fmt(d.proLabore)}</td>)}
              </tr>

              {/* RESULTADO LÍQUIDO */}
              <tr className="bg-slate-900 text-white font-black border-t-4 border-white">
                <td className="px-6 py-6 text-sm sticky left-0 z-20 bg-slate-900 uppercase">(=) LUCRO OU PREJUÍZO LÍQUIDO</td>
                {dreData.map((d, i) => (
                  <td key={i} className={`px-4 py-6 text-center text-xs ${d.netProfit >= 0 ? 'bg-emerald-600' : 'bg-rose-600'}`}>
                    {fmt(d.netProfit)}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <div className="bg-white p-8 rounded-[2rem] border-2 border-slate-100 shadow-lg">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-2">Ponto de Equilíbrio</p>
          <h4 className="text-3xl font-black text-indigo-600">
             {fmt(dreData.reduce((acc, d) => acc + d.fixedExpenses + d.fixedSalary + d.proLabore, 0) / 12)}
          </h4>
          <p className="text-[9px] text-slate-400 font-bold uppercase mt-2">Média mensal de custos fixos essenciais</p>
        </div>
        <div className="bg-white p-8 rounded-[2rem] border-2 border-slate-100 shadow-lg">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-2">Margem de Contribuição</p>
          <h4 className="text-3xl font-black text-emerald-600">
             {((dreData.reduce((acc, d) => acc + d.grossProfit, 0) / dreData.reduce((acc, d) => acc + d.revenue, 0)) * 100 || 0).toFixed(1)}%
          </h4>
          <p className="text-[9px] text-slate-400 font-bold uppercase mt-2">Eficiência após custos de produtos</p>
        </div>
      </div>
    </div>
  );
};
