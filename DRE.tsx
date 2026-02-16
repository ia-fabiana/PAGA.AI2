
import React, { useMemo, useState } from 'react';
import { Bill, Revenue, ChartOfAccount, DreCategory, BillStatus } from './types';
import { TrendingUp, FileDown, AlertCircle, X } from 'lucide-react';
import { jsPDF } from 'jspdf';
import 'jspdf-autotable';

interface DREProps {
  bills: Bill[];
  revenues: Revenue[];
  accounts: ChartOfAccount[];
  setRevenues: (r: Revenue[]) => void;
}

interface DetailModal {
  month: number;
  category: DreCategory | 'REVENUE' | 'GROSS_PROFIT' | 'NET_PROFIT';
  bills: (Bill & { accountName: string })[];
  revenues: Revenue[];
  total: number;
}

export const DRE: React.FC<DREProps> = ({ bills, revenues, accounts, setRevenues }) => {
  const [showDetails, setShowDetails] = useState<DetailModal | null>(null);
  const currentYear = 2026;

  const months = ['JANEIRO', 'FEVEREIRO', 'MARÇO', 'ABRIL', 'MAIO', 'JUNHO', 'JULHO', 'AGOSTO', 'SETEMBRO', 'OUTUBRO', 'NOVEMBRO', 'DEZEMBRO'];

  const getMonthDetails = (monthIndex: number, category: DreCategory | 'REVENUE' | 'GROSS_PROFIT' | 'NET_PROFIT') => {
    const monthBills = bills.filter(b => {
      if (b.status !== BillStatus.PAID) return false;
      const d = new Date(b.dueDate);
      return d.getMonth() === monthIndex && d.getFullYear() === currentYear;
    });

    const monthRevenues = revenues.filter(r => {
      const d = new Date(r.date);
      return d.getMonth() === monthIndex && d.getFullYear() === currentYear;
    });

    let filteredBills: Bill[] = [];
    let filteredRevenues: Revenue[] = [];
    
    if (category === 'REVENUE') {
      filteredRevenues = monthRevenues;
    } else if (category === 'GROSS_PROFIT' || category === 'NET_PROFIT') {
      filteredBills = monthBills;
    } else {
      filteredBills = monthBills.filter(b => accounts.find(a => a.id === b.accountId)?.category === category);
    }

    return {
      bills: filteredBills.map(b => ({
        ...b,
        accountName: accounts.find(a => a.id === b.accountId)?.name || 'Desconhecida'
      })),
      revenues: filteredRevenues
    };
  };

  const dreData = useMemo(() => {
    return months.map((_, index) => {
      // Somar todas as receitas do mês
      const monthRevenue = revenues
        .filter(r => {
          const d = new Date(r.date);
          return d.getMonth() === index && d.getFullYear() === currentYear;
        })
        .reduce((sum, r) => sum + r.amount, 0);
        
      const monthBills = bills.filter(b => {
        // Apenas bills pagos
        if (b.status !== BillStatus.PAID) return false;
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

  const fmt = (v: number) => v === 0 ? '-' : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

  const handleCellClick = (monthIndex: number, category: DreCategory | 'REVENUE' | 'GROSS_PROFIT' | 'NET_PROFIT', value: number) => {
    if (value === 0) return;
    const { bills: detailBills, revenues: detailRevenues } = getMonthDetails(monthIndex, category);
    setShowDetails({
      month: monthIndex,
      category,
      bills: detailBills,
      revenues: detailRevenues,
      total: value
    });
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-700">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-black text-slate-800 tracking-tight uppercase">DRE COMERCIAL {currentYear}</h1>
          <p className="text-slate-500 font-bold uppercase text-xs tracking-widest mt-1">Resumo Consolidado das Telas de Gestão</p>
        </div>
      </div>

      <div className="bg-white rounded-[2rem] border border-slate-200 shadow-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[1500px]">
            <thead>
              <tr className="bg-[#1e293b] text-white">
                <th className="px-6 py-4 text-sm font-black uppercase sticky left-0 z-30 bg-[#1e293b] border-r border-slate-700">DESCRIÇÃO POR TELA</th>
                {months.map(m => (
                  <th key={m} className="px-4 py-4 text-center text-xs font-black uppercase border-r border-slate-700">{m}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {/* RECEITA */}
              <tr className="bg-blue-900 text-white font-black">
                <td className="px-6 py-4 text-sm sticky left-0 z-20 bg-blue-900 uppercase">RECEITA BRUTA (FATURAMENTO)</td>
                {dreData.map((d, i) => (
                  <td key={i} className="px-4 py-4 text-center text-sm font-bold bg-yellow-400 text-blue-900 cursor-pointer hover:bg-yellow-300 transition-colors" onClick={() => handleCellClick(i, 'REVENUE', d.revenue)} title="Clique para ver detalhes das receitas registradas">
                    {fmt(d.revenue)}
                  </td>
                ))}
              </tr>

              {/* CUSTO DE PRODUTO */}
              <tr className="bg-slate-50 group">
                <td className="px-6 py-4 text-sm font-bold text-rose-600 sticky left-0 z-10 bg-slate-50 uppercase">(-) ABA: PRODUTOS</td>
                {dreData.map((d, i) => <td key={i} className="px-4 py-4 text-center text-sm cursor-pointer hover:bg-rose-100 transition-colors" onClick={() => handleCellClick(i, 'PRODUCT_COST', d.products)}>{fmt(d.products)}</td>)}
              </tr>

              {/* LUCRO BRUTO */}
              <tr className="bg-indigo-100 font-black">
                <td className="px-6 py-4 text-sm sticky left-0 z-10 bg-indigo-100 uppercase">(=) LUCRO BRUTO</td>
                {dreData.map((d, i) => <td key={i} className="px-4 py-4 text-center text-sm text-indigo-900 cursor-pointer hover:bg-indigo-200 transition-colors" onClick={() => handleCellClick(i, 'GROSS_PROFIT', d.grossProfit)}>{fmt(d.grossProfit)}</td>)}
              </tr>

              {/* COMISSÕES */}
              <tr className="group">
                <td className="px-6 py-4 text-sm font-bold text-slate-600 sticky left-0 z-10 bg-white uppercase">(-) ABA: COMISSÕES</td>
                {dreData.map((d, i) => <td key={i} className="px-4 py-4 text-center text-sm cursor-pointer hover:bg-slate-100 transition-colors" onClick={() => handleCellClick(i, 'COMMISSION', d.commissions)}>{fmt(d.commissions)}</td>)}
              </tr>

              {/* SALÁRIO FIXO */}
              <tr className="group">
                <td className="px-6 py-4 text-sm font-bold text-slate-600 sticky left-0 z-10 bg-white uppercase">(-) ABA: SALÁRIO FIXO</td>
                {dreData.map((d, i) => <td key={i} className="px-4 py-4 text-center text-sm cursor-pointer hover:bg-slate-100 transition-colors" onClick={() => handleCellClick(i, 'FIXED_SALARY', d.fixedSalary)}>{fmt(d.fixedSalary)}</td>)}
              </tr>

              {/* DESP FIXAS */}
              <tr className="group">
                <td className="px-6 py-4 text-sm font-bold text-slate-600 sticky left-0 z-10 bg-white uppercase">(-) ABA: DESP. FIXAS</td>
                {dreData.map((d, i) => <td key={i} className="px-4 py-4 text-center text-sm cursor-pointer hover:bg-slate-100 transition-colors" onClick={() => handleCellClick(i, 'FIXED_EXPENSES', d.fixedExpenses)}>{fmt(d.fixedExpenses)}</td>)}
              </tr>

              {/* DESP VARIAVEIS */}
              <tr className="group">
                <td className="px-6 py-4 text-xs font-bold text-slate-600 sticky left-0 z-10 bg-white uppercase">(-) ABA: DESP. VARIÁVEIS</td>
                {dreData.map((d, i) => <td key={i} className="px-4 py-4 text-center text-xs cursor-pointer hover:bg-slate-100 transition-colors" onClick={() => handleCellClick(i, 'VARIABLE_EXPENSES', d.variableExpenses)}>{fmt(d.variableExpenses)}</td>)}
              </tr>

              {/* PRO LABORE */}
              <tr className="group">
                <td className="px-6 py-4 text-xs font-bold text-slate-600 sticky left-0 z-10 bg-white uppercase">(-) ABA: PRO-LABORE</td>
                {dreData.map((d, i) => <td key={i} className="px-4 py-4 text-center text-xs cursor-pointer hover:bg-slate-100 transition-colors" onClick={() => handleCellClick(i, 'PRO_LABORE', d.proLabore)}>{fmt(d.proLabore)}</td>)}
              </tr>

              {/* RESULTADO LÍQUIDO */}
              <tr className="bg-slate-900 text-white font-black border-t-4 border-white">
                <td className="px-6 py-6 text-sm sticky left-0 z-20 bg-slate-900 uppercase">(=) LUCRO OU PREJUÍZO LÍQUIDO</td>
                {dreData.map((d, i) => (
                  <td key={i} className={`px-4 py-6 text-center text-xs cursor-pointer hover:opacity-80 transition-opacity ${d.netProfit >= 0 ? 'bg-emerald-600' : 'bg-rose-600'}`} onClick={() => handleCellClick(i, 'NET_PROFIT', d.netProfit)}>
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
          <p className="text-xs font-black text-slate-400 uppercase tracking-[0.2em] mb-2">Ponto de Equilíbrio</p>
          <h4 className="text-3xl font-black text-indigo-600">
             {fmt(dreData.reduce((acc, d) => acc + d.fixedExpenses + d.fixedSalary + d.proLabore, 0) / 12)}
          </h4>
          <p className="text-xs text-slate-400 font-bold uppercase mt-2">Média mensal de custos fixos essenciais</p>
        </div>
        <div className="bg-white p-8 rounded-[2rem] border-2 border-slate-100 shadow-lg">
          <p className="text-xs font-black text-slate-400 uppercase tracking-[0.2em] mb-2">Margem de Contribuição</p>
          <h4 className="text-3xl font-black text-emerald-600">
             {((dreData.reduce((acc, d) => acc + d.grossProfit, 0) / dreData.reduce((acc, d) => acc + d.revenue, 0)) * 100 || 0).toFixed(1)}%
          </h4>
          <p className="text-xs text-slate-400 font-bold uppercase mt-2">Eficiência após custos de produtos</p>
        </div>
      </div>

      {/* Modal de Detalhes */}
      {showDetails && (
        <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[80vh] overflow-hidden flex flex-col animate-in zoom-in">
            <div className="flex items-center justify-between p-6 border-b border-slate-200 bg-slate-50">
              <div>
                <h3 className="text-xl font-black text-slate-800">{months[showDetails.month]}</h3>
                <p className="text-sm text-slate-500 font-bold uppercase tracking-wide mt-1">
                  {showDetails.category === 'REVENUE' ? 'Receita Bruta' :
                   showDetails.category === 'GROSS_PROFIT' ? 'Lucro Bruto' :
                   showDetails.category === 'NET_PROFIT' ? 'Lucro Líquido' :
                   showDetails.category === 'PRODUCT_COST' ? 'Custo de Produtos' :
                   showDetails.category === 'COMMISSION' ? 'Comissões' :
                   showDetails.category === 'FIXED_SALARY' ? 'Salários Fixos' :
                   showDetails.category === 'FIXED_EXPENSES' ? 'Despesas Fixas' :
                   showDetails.category === 'VARIABLE_EXPENSES' ? 'Despesas Variáveis' :
                   showDetails.category === 'PRO_LABORE' ? 'Pro-Labore' : ''}
                </p>
              </div>
              <button onClick={() => setShowDetails(null)} className="p-2 hover:bg-slate-100 rounded-lg text-slate-400">
                <X size={24} />
              </button>
            </div>
            
            <div className="overflow-y-auto flex-1 p-6">
              {showDetails.bills.length === 0 && showDetails.revenues.length === 0 ? (
                <p className="text-center text-slate-400 py-8">Nenhum lançamento nesta categoria para este mês</p>
              ) : (
                <div className="space-y-3">
                  {showDetails.revenues.map((revenue, idx) => (
                    <div key={`rev-${idx}`} className="flex items-center justify-between p-4 bg-emerald-50 rounded-lg border border-emerald-200 hover:bg-emerald-100 transition-colors">
                      <div className="flex-1">
                        <p className="font-bold text-emerald-800 text-sm">{revenue.description || 'Receita de ' + new Date(revenue.date).toLocaleDateString('pt-BR')}</p>
                        <p className="text-xs text-emerald-600 mt-1">{new Date(revenue.date).toLocaleDateString('pt-BR')}</p>
                      </div>
                      <p className="font-black text-emerald-800">{fmt(revenue.amount)}</p>
                    </div>
                  ))}
                  {showDetails.bills.map((bill, idx) => (
                    <div key={`bill-${idx}`} className="flex items-center justify-between p-4 bg-slate-50 rounded-lg border border-slate-200 hover:bg-slate-100 transition-colors">
                      <div className="flex-1">
                        <p className="font-bold text-slate-800 text-sm">{bill.description}</p>
                        <p className="text-xs text-slate-500 mt-1">{bill.accountName}</p>
                      </div>
                      <p className="font-black text-slate-800">{fmt(bill.amount)}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="border-t border-slate-200 bg-slate-50 p-6 flex items-center justify-between">
              <p className="text-sm font-bold text-slate-500 uppercase">TOTAL DESTA CATEGORIA</p>
              <p className="text-2xl font-black text-slate-800">{fmt(showDetails.total)}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
