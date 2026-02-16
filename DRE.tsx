
import React, { useMemo, useState } from 'react';
import { Bill, Revenue, ChartOfAccount, DreCategory, BillStatus } from './types';
import { TrendingUp, FileDown, AlertCircle, X } from 'lucide-react';
import { jsPDF } from 'jspdf';
import 'jspdf-autotable';

interface DREProps {
  bills: Bill[];
  revenues: Revenue[];
  accounts: ChartOfAccount[];
  setRevenues: React.Dispatch<React.SetStateAction<Revenue[]>>;
}

interface DetailModal {
  month: number;
  category: DreCategory | 'REVENUE' | 'GROSS_PROFIT' | 'NET_PROFIT';
  bills: (Bill & { accountName: string })[];
  revenues: Revenue[];
  total: number;
  isEstimate?: boolean;
}

export const DRE: React.FC<DREProps> = ({ bills, revenues, accounts, setRevenues }) => {
  const [showDetails, setShowDetails] = useState<DetailModal | null>(null);
  const [estimateRevenueInputs, setEstimateRevenueInputs] = useState<Record<number, string>>({});
  const [realRevenueInputs, setRealRevenueInputs] = useState<Record<number, string>>({});
  const currentYear = 2026;

  const months = ['JANEIRO', 'FEVEREIRO', 'MARÇO', 'ABRIL', 'MAIO', 'JUNHO', 'JULHO', 'AGOSTO', 'SETEMBRO', 'OUTUBRO', 'NOVEMBRO', 'DEZEMBRO'];

  const getDateParts = (dateStr: string) => {
    const [yearStr, monthStr, dayStr] = dateStr.split('-');
    const year = Number(yearStr);
    const month = Number(monthStr);
    const day = Number(dayStr);
    if (!year || !month || !day) return null;
    return { year, monthIndex: month - 1, day };
  };

  const getMonthIndex = (dateStr: string) => {
    const parts = getDateParts(dateStr);
    if (parts) return parts.monthIndex;
    return new Date(dateStr).getMonth();
  };

  const getYearValue = (dateStr: string) => {
    const parts = getDateParts(dateStr);
    if (parts) return parts.year;
    return new Date(dateStr).getFullYear();
  };

  const getMonthDetails = (monthIndex: number, category: DreCategory | 'REVENUE' | 'GROSS_PROFIT' | 'NET_PROFIT', isEstimate = false) => {
    const monthBills = bills.filter(b => {
      if (isEstimate) {
        // Todas as despesas provisionadas, independente de status
        if (!b.isEstimate) return false;
      } else if (b.status !== BillStatus.PAID) {
        return false;
      }
      return getMonthIndex(b.dueDate) === monthIndex && getYearValue(b.dueDate) === currentYear;
    });

    const monthRevenues = revenues.filter(r => {
      const matchesMonth = getMonthIndex(r.date) === monthIndex && getYearValue(r.date) === currentYear;
      if (!matchesMonth) return false;
      return isEstimate ? r.isEstimate : !r.isEstimate;
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
          return getMonthIndex(r.date) === index && getYearValue(r.date) === currentYear && !r.isEstimate;
        })
        .reduce((sum, r) => sum + r.amount, 0);

      const monthEstimateRevenue = revenues
        .filter(r => {
          return getMonthIndex(r.date) === index && getYearValue(r.date) === currentYear && r.isEstimate;
        })
        .reduce((sum, r) => sum + r.amount, 0);
        
      const monthBills = bills.filter(b => {
        // Apenas bills pagos
        if (b.status !== BillStatus.PAID) return false;
        return getMonthIndex(b.dueDate) === index && getYearValue(b.dueDate) === currentYear;
      });

      const monthEstimateBills = bills.filter(b => {
        // Todas as despesas provisionadas, independente de status
        if (!b.isEstimate) return false;
        return getMonthIndex(b.dueDate) === index && getYearValue(b.dueDate) === currentYear;
      });

      const getSum = (cat: DreCategory) => monthBills
        .filter(b => accounts.find(a => a.id === b.accountId)?.category === cat)
        .reduce((sum, b) => sum + b.amount, 0);

      const getEstimateSum = (cat: DreCategory) => monthEstimateBills
        .filter(b => accounts.find(a => a.id === b.accountId)?.category === cat)
        .reduce((sum, b) => sum + b.amount, 0);

      const products = getSum('PRODUCT_COST');
      const commissions = getSum('COMMISSION');
      const fixedSalary = getSum('FIXED_SALARY');
      const fixedExpenses = getSum('FIXED_EXPENSES');
      const variableExpenses = getSum('VARIABLE_EXPENSES');
      const proLabore = getSum('PRO_LABORE');

      const estProducts = getEstimateSum('PRODUCT_COST');
      const estCommissions = getEstimateSum('COMMISSION');
      const estFixedSalary = getEstimateSum('FIXED_SALARY');
      const estFixedExpenses = getEstimateSum('FIXED_EXPENSES');
      const estVariableExpenses = getEstimateSum('VARIABLE_EXPENSES');
      const estProLabore = getEstimateSum('PRO_LABORE');

      const grossProfit = monthRevenue - products;
      const totalExpenses = commissions + fixedSalary + fixedExpenses + variableExpenses + proLabore;
      const netProfit = grossProfit - totalExpenses;

      const estGrossProfit = monthEstimateRevenue - estProducts;
      const estTotalExpenses = estCommissions + estFixedSalary + estFixedExpenses + estVariableExpenses + estProLabore;
      const estNetProfit = estGrossProfit - estTotalExpenses;

      return {
        revenue: monthRevenue,
        estRevenue: monthEstimateRevenue,
        products,
        grossProfit,
        commissions,
        fixedSalary,
        fixedExpenses,
        variableExpenses,
        proLabore,
        netProfit,
        estProducts,
        estGrossProfit,
        estCommissions,
        estFixedSalary,
        estFixedExpenses,
        estVariableExpenses,
        estProLabore,
        estNetProfit
      };
    });
  }, [bills, revenues, accounts, currentYear]);

  const getEstimateRevenueForMonth = (monthIndex: number) => {
    return revenues
      .filter(r => r.isEstimate)
      .filter(r => {
        return getMonthIndex(r.date) === monthIndex && getYearValue(r.date) === currentYear;
      })
      .reduce((sum, r) => sum + r.amount, 0);
  };

  const getRealRevenueForMonth = (monthIndex: number) => {
    return revenues
      .filter(r => !r.isEstimate)
      .filter(r => {
        return getMonthIndex(r.date) === monthIndex && getYearValue(r.date) === currentYear;
      })
      .reduce((sum, r) => sum + r.amount, 0);
  };

  const parseCurrencyInput = (value: string) => {
    const normalized = value.replace(/\./g, '').replace(',', '.');
    const parsed = Number(normalized);
    return Number.isNaN(parsed) ? 0 : parsed;
  };

  const formatCurrencyInput = (value: number) => {
    if (!value) return '';
    return value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const buildMonthDateString = (year: number, monthIndex: number) => {
    const month = String(monthIndex + 1).padStart(2, '0');
    return `${year}-${month}-01`;
  };

  const upsertEstimateRevenue = (monthIndex: number, amount: number) => {
    const targetDate = buildMonthDateString(currentYear, monthIndex);
    setRevenues((prev) => {
      const existing = prev.find(r => {
        if (!r.isEstimate) return false;
        return getMonthIndex(r.date) === monthIndex && getYearValue(r.date) === currentYear;
      });

      if (amount <= 0) {
        if (!existing) return prev;
        return prev.filter(r => r.id !== existing.id);
      }

      if (existing) {
        return prev.map(r => r.id === existing.id ? { ...r, amount, date: targetDate, description: r.description || 'Receita Estimada', isEstimate: true } : r);
      }

      const newRevenue: Revenue = {
        id: `est-rev-${currentYear}-${String(monthIndex + 1).padStart(2, '0')}`,
        date: targetDate,
        amount,
        description: 'Receita Estimada',
        isEstimate: true
      };
      return [...prev, newRevenue];
    });
  };

  const upsertRealRevenue = (monthIndex: number, amount: number) => {
    const targetDate = buildMonthDateString(currentYear, monthIndex);
    setRevenues((prev) => {
      const existing = prev.find(r => {
        if (r.isEstimate) return false;
        return getMonthIndex(r.date) === monthIndex && getYearValue(r.date) === currentYear;
      });

      if (amount <= 0) {
        if (!existing) return prev;
        return prev.filter(r => r.id !== existing.id);
      }

      if (existing) {
        return prev.map(r => r.id === existing.id ? { ...r, amount, date: targetDate, description: r.description || 'Receita Manual', isEstimate: false } : r);
      }

      const newRevenue: Revenue = {
        id: `rev-${currentYear}-${String(monthIndex + 1).padStart(2, '0')}`,
        date: targetDate,
        amount,
        description: 'Receita Manual',
        isEstimate: false
      };
      return [...prev, newRevenue];
    });
  };

  const fmt = (v: number) => v === 0 ? '-' : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

  const handleCellClick = (monthIndex: number, category: DreCategory | 'REVENUE' | 'GROSS_PROFIT' | 'NET_PROFIT', value: number, isEstimate = false) => {
    if (value === 0) return;
    const { bills: detailBills, revenues: detailRevenues } = getMonthDetails(monthIndex, category, isEstimate);
    setShowDetails({
      month: monthIndex,
      category,
      bills: detailBills,
      revenues: detailRevenues,
      total: value,
      isEstimate
    });
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-700">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-black text-slate-800 tracking-tight uppercase">DRE COMERCIAL {currentYear}</h1>
          <p className="text-slate-500 font-bold uppercase text-xs tracking-widest mt-1">Resumo Consolidado das Telas de Gestão</p>
        </div>
        <div className="hidden md:flex items-center gap-3">
          <span className="px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest bg-slate-900 text-white">Real</span>
          <span className="px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest bg-amber-200 text-amber-900">Estimado</span>
        </div>
      </div>

      <div className="bg-white rounded-[2rem] border border-slate-200 shadow-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[2200px]">
            <thead>
              <tr className="bg-slate-900 text-white">
                <th
                  rowSpan={2}
                  className="px-6 py-4 text-sm font-black uppercase sticky left-0 z-30 bg-slate-900 border-r border-slate-700/80"
                >
                  DESCRIÇÃO POR TELA
                </th>
                {months.map(m => (
                  <th key={m} colSpan={2} className="px-4 py-3 text-center text-[11px] font-black uppercase tracking-widest border-r border-slate-700/80">
                    {m}
                  </th>
                ))}
              </tr>
              <tr className="bg-slate-800 text-slate-200">
                {months.map(m => (
                  <React.Fragment key={`${m}-sub`}>
                    <th className="px-3 py-2 text-center text-[10px] font-black uppercase border-r border-slate-700/80">Real</th>
                    <th className="px-3 py-2 text-center text-[10px] font-black uppercase border-r border-slate-700/80">Estimado</th>
                  </React.Fragment>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {/* RECEITA */}
              <tr className="bg-emerald-700 text-white font-black">
                <td className="px-6 py-4 text-sm sticky left-0 z-20 bg-emerald-700 uppercase">RECEITA BRUTA (FATURAMENTO)</td>
                {dreData.map((d, i) => (
                  <React.Fragment key={i}>
                    <td className="px-3 py-3 text-center text-sm font-black bg-emerald-500 text-white">
                      <input
                        type="text"
                        inputMode="decimal"
                        value={realRevenueInputs[i] ?? formatCurrencyInput(getRealRevenueForMonth(i))}
                        onChange={(e) => setRealRevenueInputs(prev => ({ ...prev, [i]: e.target.value }))}
                        onBlur={(e) => {
                          const amount = parseCurrencyInput(e.target.value);
                          upsertRealRevenue(i, amount);
                          setRealRevenueInputs(prev => ({ ...prev, [i]: amount > 0 ? formatCurrencyInput(amount) : '' }));
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            (e.target as HTMLInputElement).blur();
                          }
                        }}
                        placeholder="0,00"
                        className="w-24 text-center text-sm font-black text-white bg-transparent border-b border-emerald-300 focus:outline-none focus:border-white"
                      />
                    </td>
                    <td className="px-3 py-3 text-center text-xs font-bold bg-emerald-100 text-emerald-900">
                      <input
                        type="text"
                        inputMode="decimal"
                        value={estimateRevenueInputs[i] ?? formatCurrencyInput(getEstimateRevenueForMonth(i))}
                        onChange={(e) => setEstimateRevenueInputs(prev => ({ ...prev, [i]: e.target.value }))}
                        onBlur={(e) => {
                          const amount = parseCurrencyInput(e.target.value);
                          upsertEstimateRevenue(i, amount);
                          setEstimateRevenueInputs(prev => ({ ...prev, [i]: amount > 0 ? formatCurrencyInput(amount) : '' }));
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            (e.target as HTMLInputElement).blur();
                          }
                        }}
                        placeholder="0,00"
                        className="w-24 text-center text-xs font-black text-emerald-900 bg-transparent border-b border-emerald-300 focus:outline-none focus:border-emerald-600"
                      />
                    </td>
                  </React.Fragment>
                ))}
              </tr>

              {/* CUSTO DE PRODUTO */}
              <tr className="bg-white group">
                <td className="px-6 py-4 text-sm font-bold text-rose-700 sticky left-0 z-10 bg-white uppercase">(-) ABA: PRODUTOS</td>
                {dreData.map((d, i) => (
                  <React.Fragment key={i}>
                    <td className="px-4 py-4 text-center text-sm text-slate-700 cursor-pointer hover:bg-slate-50 transition-colors" onClick={() => handleCellClick(i, 'PRODUCT_COST', d.products)}>{fmt(d.products)}</td>
                    <td className="px-4 py-4 text-center text-sm text-amber-900 bg-amber-50 cursor-pointer hover:bg-amber-100 transition-colors" onClick={() => handleCellClick(i, 'PRODUCT_COST', d.estProducts, true)}>{fmt(d.estProducts)}</td>
                  </React.Fragment>
                ))}
              </tr>

              {/* LUCRO BRUTO */}
              <tr className="bg-indigo-100 font-black">
                <td
                  className="px-6 py-4 text-sm sticky left-0 z-10 bg-indigo-100 uppercase"
                  title="Lucro Bruto = Receita Bruta - Produtos (Real e Estimado)"
                >
                  LUCRO BRUTO
                </td>
                {dreData.map((d, i) => (
                  <React.Fragment key={i}>
                    <td className="px-4 py-4 text-center text-sm text-indigo-900">{fmt(d.grossProfit)}</td>
                    <td className="px-4 py-4 text-center text-sm text-amber-900 bg-amber-100">{fmt(d.estGrossProfit)}</td>
                  </React.Fragment>
                ))}
              </tr>

              {/* COMISSÕES */}
              <tr className="group">
                <td className="px-6 py-4 text-sm font-bold text-slate-600 sticky left-0 z-10 bg-white uppercase">(-) ABA: COMISSÕES</td>
                {dreData.map((d, i) => (
                  <React.Fragment key={i}>
                    <td className="px-4 py-4 text-center text-sm text-slate-700 cursor-pointer hover:bg-slate-50 transition-colors" onClick={() => handleCellClick(i, 'COMMISSION', d.commissions)}>{fmt(d.commissions)}</td>
                    <td className="px-4 py-4 text-center text-sm text-amber-900 bg-amber-50 cursor-pointer hover:bg-amber-100 transition-colors" onClick={() => handleCellClick(i, 'COMMISSION', d.estCommissions, true)}>{fmt(d.estCommissions)}</td>
                  </React.Fragment>
                ))}
              </tr>

              {/* SALÁRIO FIXO */}
              <tr className="group">
                <td className="px-6 py-4 text-sm font-bold text-slate-600 sticky left-0 z-10 bg-white uppercase">(-) ABA: SALÁRIO FIXO</td>
                {dreData.map((d, i) => (
                  <React.Fragment key={i}>
                    <td className="px-4 py-4 text-center text-sm text-slate-700 cursor-pointer hover:bg-slate-50 transition-colors" onClick={() => handleCellClick(i, 'FIXED_SALARY', d.fixedSalary)}>{fmt(d.fixedSalary)}</td>
                    <td className="px-4 py-4 text-center text-sm text-amber-900 bg-amber-50 cursor-pointer hover:bg-amber-100 transition-colors" onClick={() => handleCellClick(i, 'FIXED_SALARY', d.estFixedSalary, true)}>{fmt(d.estFixedSalary)}</td>
                  </React.Fragment>
                ))}
              </tr>

              {/* DESP FIXAS */}
              <tr className="group">
                <td className="px-6 py-4 text-sm font-bold text-slate-600 sticky left-0 z-10 bg-white uppercase">(-) ABA: DESP. FIXAS</td>
                {dreData.map((d, i) => (
                  <React.Fragment key={i}>
                    <td className="px-4 py-4 text-center text-sm text-slate-700 cursor-pointer hover:bg-slate-50 transition-colors" onClick={() => handleCellClick(i, 'FIXED_EXPENSES', d.fixedExpenses)}>{fmt(d.fixedExpenses)}</td>
                    <td className="px-4 py-4 text-center text-sm text-amber-900 bg-amber-50 cursor-pointer hover:bg-amber-100 transition-colors" onClick={() => handleCellClick(i, 'FIXED_EXPENSES', d.estFixedExpenses, true)}>{fmt(d.estFixedExpenses)}</td>
                  </React.Fragment>
                ))}
              </tr>

              {/* DESP VARIAVEIS */}
              <tr className="group">
                <td className="px-6 py-4 text-xs font-bold text-slate-600 sticky left-0 z-10 bg-white uppercase">(-) ABA: DESP. VARIÁVEIS</td>
                {dreData.map((d, i) => (
                  <React.Fragment key={i}>
                    <td className="px-4 py-4 text-center text-xs text-slate-700 cursor-pointer hover:bg-slate-50 transition-colors" onClick={() => handleCellClick(i, 'VARIABLE_EXPENSES', d.variableExpenses)}>{fmt(d.variableExpenses)}</td>
                    <td className="px-4 py-4 text-center text-xs text-amber-900 bg-amber-50 cursor-pointer hover:bg-amber-100 transition-colors" onClick={() => handleCellClick(i, 'VARIABLE_EXPENSES', d.estVariableExpenses, true)}>{fmt(d.estVariableExpenses)}</td>
                  </React.Fragment>
                ))}
              </tr>

              {/* PRO LABORE */}
              <tr className="group">
                <td className="px-6 py-4 text-xs font-bold text-slate-600 sticky left-0 z-10 bg-white uppercase">(-) ABA: PRO-LABORE</td>
                {dreData.map((d, i) => (
                  <React.Fragment key={i}>
                    <td className="px-4 py-4 text-center text-xs text-slate-700 cursor-pointer hover:bg-slate-50 transition-colors" onClick={() => handleCellClick(i, 'PRO_LABORE', d.proLabore)}>{fmt(d.proLabore)}</td>
                    <td className="px-4 py-4 text-center text-xs text-amber-900 bg-amber-50 cursor-pointer hover:bg-amber-100 transition-colors" onClick={() => handleCellClick(i, 'PRO_LABORE', d.estProLabore, true)}>{fmt(d.estProLabore)}</td>
                  </React.Fragment>
                ))}
              </tr>

              {/* RESULTADO LÍQUIDO */}
              <tr className="bg-slate-900 text-white font-black border-t-4 border-white">
                <td className="px-6 py-6 text-sm sticky left-0 z-20 bg-slate-900 uppercase">LUCRO OU PREJUÍZO LÍQUIDO</td>
                {dreData.map((d, i) => (
                  <React.Fragment key={i}>
                    <td className={`px-4 py-6 text-center text-xs ${d.netProfit >= 0 ? 'bg-emerald-600' : 'bg-rose-600'}`}>
                      {fmt(d.netProfit)}
                    </td>
                    <td className={`px-4 py-6 text-center text-xs ${d.estNetProfit >= 0 ? 'bg-amber-200 text-amber-900' : 'bg-rose-200 text-rose-900'}`}>
                      {fmt(d.estNetProfit)}
                    </td>
                  </React.Fragment>
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
                  {showDetails.isEstimate ? ' (Estimado)' : ''}
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
