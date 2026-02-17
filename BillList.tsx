
import React, { useState, useMemo } from 'react';
import { Bill, Supplier, BillStatus, UserRole, ChartOfAccount } from './types';
import { Search, Plus, FileDown, Edit2, Trash2, Repeat, Calendar, ListTree, User, AlertCircle } from 'lucide-react';
import { jsPDF } from 'jspdf';
import 'jspdf-autotable';

interface BillListProps {
  bills: Bill[];
  suppliers: Supplier[];
  accounts: ChartOfAccount[];
  onEdit: (bill: Bill) => void;
  onDelete: (id: string) => void;
  onStatusChange: (id: string, status: BillStatus) => void;
  onOpenForm: () => void;
  onToggleEstimate: (id: string) => void;
  userRole: UserRole;
  companyName?: string;
}

export const BillList: React.FC<BillListProps> = ({ bills, suppliers, accounts, onEdit, onDelete, onStatusChange, onOpenForm, onToggleEstimate, userRole, companyName = 'PAGA.AI' }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('OPEN');
  const [supplierFilter, setSupplierFilter] = useState('ALL');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [showPdfPreview, setShowPdfPreview] = useState(false);
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState('');
  const [romaneioWeekFilter, setRomaneioWeekFilter] = useState(''); // Sábado da semana para filtrar romaneio

  // Funções auxiliares para parsing de datas (sem timezone issues)
  const formatDatePtBR = (dateStr: string): string => {
    const [year, month, day] = dateStr.split('-');
    return `${day}/${month}/${year}`;
  };

  const getDateParts = (dateStr: string) => {
    const [yearStr, monthStr, dayStr] = dateStr.split('-');
    const year = Number(yearStr);
    const month = Number(monthStr);
    const day = Number(dayStr);
    if (!year || !month || !day) return null;
    return { year, month, day };
  };

  // Funções auxiliares para semanas (sábado a sexta)
  const getLastSaturday = (date: Date): Date => {
    const d = new Date(date);
    const day = d.getDay();
    const diff = day === 6 ? 0 : (day === 0 ? 1 : day + 1); // Se sábado, diff=0, senão vai para sábado anterior
    const lastSat = new Date(d.setDate(d.getDate() - diff));
    return lastSat;
  };

  const getWeekSaturday = (dateStr: string): string | null => {
    const date = new Date(dateStr);
    const sat = getLastSaturday(date);
    return sat.toISOString().split('T')[0]; // Retorna YYYY-MM-DD
  };

  const getAvailableWeeks = (): Array<{ satDate: string; label: string }> => {
    const weeks: Array<{ satDate: string; label: string }> = [];
    const today = new Date();
    const currentSat = getLastSaturday(today);
    
    for (let i = -2; i <= 4; i++) {
      const weekSat = new Date(currentSat);
      weekSat.setDate(weekSat.getDate() + i * 7);
      const satStr = weekSat.toISOString().split('T')[0];
      const friStr = new Date(weekSat.getTime() + 6 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const label = `${weekSat.toLocaleDateString('pt-BR', { month: 'short', day: 'numeric' })} - ${new Date(weekSat.getTime() + 6 * 24 * 60 * 60 * 1000).toLocaleDateString('pt-BR', { month: 'short', day: 'numeric' })}`;
      weeks.push({ satDate: satStr, label });
    }
    return weeks;
  };

  const filteredBills = useMemo(() => {
    return bills.filter(bill => {
      const supplier = suppliers.find(s => s.id === bill.supplierId);
      const account = accounts.find(a => a.id === bill.accountId);
      
      const matchesSearch = 
        bill.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
        supplier?.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        account?.name.toLowerCase().includes(searchTerm.toLowerCase());
      
      const matchesStatus =
        statusFilter === 'ALL' ||
        (statusFilter === 'OPEN' && bill.status !== BillStatus.PAID) ||
        bill.status === statusFilter;
      const matchesSupplier = supplierFilter === 'ALL' || bill.supplierId === supplierFilter;
      
      const billDate = new Date(bill.dueDate);
      const matchesDate = 
        (!startDate || billDate >= new Date(startDate)) &&
        (!endDate || billDate <= new Date(endDate));

      return matchesSearch && matchesStatus && matchesSupplier && matchesDate;
    }).sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());
  }, [bills, suppliers, accounts, searchTerm, statusFilter, supplierFilter, startDate, endDate]);

  const canEdit = userRole !== UserRole.VIEWER;
  const canDelete = userRole !== UserRole.VIEWER; // Qualquer usuário logado pode excluir, exceto VIEWER
  const canMarkPaid = userRole === UserRole.ADMIN;

  const buildPdfDoc = () => {
    const doc = new jsPDF();
    
    // Cabeçalho com nome da empresa
    doc.setFontSize(16);
    doc.setTextColor(30, 41, 59);
    doc.text(companyName, 14, 15);
    
    // Subtítulo com data
    const title = `Relatório de Contas a Pagar - ${new Date().toLocaleDateString()}`;
    doc.setFontSize(11);
    doc.setTextColor(100, 116, 139);
    doc.text(title, 14, 22);

    const formatDateForPdf = (dateStr: string) => {
      if (!dateStr) return '';
      return formatDatePtBR(dateStr);
    };
    const periodLabel = startDate || endDate
      ? `Período do filtro: ${formatDateForPdf(startDate) || 'Início'} até ${formatDateForPdf(endDate) || 'Hoje'}`
      : 'Período do filtro: Todos os lançamentos';
    doc.setFontSize(10);
    doc.setTextColor(120, 140, 160);
    doc.text(periodLabel, 14, 28);
    
    const tableData = filteredBills.map(b => {
      const s = suppliers.find(sup => sup.id === b.supplierId);
      const acc = accounts.find(a => a.id === b.accountId);
      const typeLabel = acc?.type === 'VARIABLE' ? '(V)' : '(F)';
      const desc = b.currentInstallment ? `${b.description} (${b.currentInstallment}/${b.totalInstallments})` : b.description;
      return [
        s?.name || 'N/A', 
        `${desc} ${typeLabel}`, 
        acc?.name || 'N/A',
        new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(b.amount), 
        formatDatePtBR(b.dueDate), 
        b.status
      ];
    });
    
    (doc as any).autoTable({ 
      startY: 34,
      columnStyles: {
        0: { cellWidth: 50 },
        1: { cellWidth: 30 },
        2: { cellWidth: 35 },
        3: { cellWidth: 25, halign: 'right' },
        4: { cellWidth: 25, halign: 'center' },
        5: { cellWidth: 25, halign: 'center' }
      },
      head: [['Fornecedor', 'Descrição', 'Plano de Contas', 'Valor', 'Vencimento', 'Status']], 
      body: tableData, 
      theme: 'grid', 
      headStyles: { fillStyle: '#4f46e5', textColor: '#ffffff', fontStyle: 'bold' },
      bodyStyles: { textColor: '#000000' },
      columnStyles: {
        3: { halign: 'right', cellWidth: 28 }
      }
    });
    
    const total = filteredBills.reduce((acc, curr) => acc + curr.amount, 0);
    const finalY = (doc as any).lastAutoTable.finalY + 10;
    doc.setFontSize(12);
    doc.setTextColor(30, 41, 59);
    doc.setFont(undefined, 'bold');
    doc.text(`Total do Período: ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(total)}`, 14, finalY);
    return doc;
  };

  const exportPDF = () => {
    const doc = buildPdfDoc();
    doc.save(`${companyName}-relatorio-contas-${new Date().getTime()}.pdf`);
  };

  const previewPDF = () => {
    const doc = buildPdfDoc();
    const dataUri = doc.output('datauristring');
    setPdfPreviewUrl(dataUri);
    setShowPdfPreview(true);
  };

  const handlePaidDateChange = (billId: string, paidDate: string) => {
    const bill = bills.find(b => b.id === billId);
    if (!bill) return;
    
    if (paidDate) {
      // Quando data de pagamento é preenchida, marca como PAID
      onStatusChange(billId, BillStatus.PAID);
      // Atualizar com a data de pagamento e manter paidAmount se já existir
      onEdit({ ...bill, paidDate, status: BillStatus.PAID });
    } else {
      // Quando data de pagamento é limpa, volta ao status PENDING e remove paidAmount
      onStatusChange(billId, BillStatus.PENDING);
      onEdit({ ...bill, paidDate: undefined, paidAmount: undefined, status: BillStatus.PENDING });
    }
  };

  const handlePaidAmountChange = (billId: string, paidAmount: number) => {
    const bill = bills.find(b => b.id === billId);
    if (!bill) return;
    
    // Calcula automaticamente os juros/multas (diferença entre valor pago e valor da conta)
    const interestAmount = paidAmount ? paidAmount - bill.amount : undefined;
    
    onEdit({ ...bill, paidAmount: paidAmount || undefined, interestAmount });
  };

  const handleRomaneioWeekChange = (billId: string, weekSatDate: string | null) => {
    const bill = bills.find(b => b.id === billId);
    if (!bill) return;
    
    onEdit({ ...bill, romaneioWeek: weekSatDate || undefined });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-4xl font-black text-slate-800">Contas a Pagar</h1>
          <p className="text-slate-600 font-semibold text-sm">Lista padrão mostra apenas contas pendentes e atrasadas.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={previewPDF} className="flex items-center gap-2 px-4 py-2 border border-slate-200 rounded-xl bg-white text-slate-700 hover:bg-slate-50 transition-colors font-medium text-sm shadow-sm">
            <FileDown size={18} /> Visualizar PDF
          </button>
          <button onClick={exportPDF} className="flex items-center gap-2 px-4 py-2 border border-slate-200 rounded-xl bg-white text-slate-700 hover:bg-slate-50 transition-colors font-medium text-sm shadow-sm">
            <FileDown size={18} /> Exportar PDF
          </button>
          {canEdit && (
            <button onClick={onOpenForm} className="flex items-center gap-2 px-4 py-2 bg-indigo-600 rounded-xl text-white hover:bg-indigo-700 transition-colors font-medium text-sm shadow-md">
              <Plus size={18} /> Nova Conta
            </button>
          )}
        </div>
      </div>

      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-4">
        <div className="relative md:col-span-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input 
            type="text" 
            placeholder="Buscar..." 
            className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none text-sm" 
            value={searchTerm} 
            onChange={(e) => setSearchTerm(e.target.value)} 
          />
        </div>

        <div className="relative">
          <select 
            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 focus:ring-2 focus:ring-indigo-500 outline-none text-sm appearance-none" 
            value={statusFilter} 
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="OPEN">A Pagar (Pendentes + Atrasadas)</option>
            <option value="ALL">Todos Status</option>
            <option value={BillStatus.PENDING}>Pendente</option>
            <option value={BillStatus.PAID}>Pago</option>
            <option value={BillStatus.OVERDUE}>Atrasado</option>
          </select>
        </div>

        <div className="relative">
          <select 
            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 focus:ring-2 focus:ring-indigo-500 outline-none text-sm appearance-none" 
            value={supplierFilter} 
            onChange={(e) => setSupplierFilter(e.target.value)}
          >
            <option value="ALL">Todos Fornecedores</option>
            {suppliers.map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <Calendar size={16} className="text-slate-400 shrink-0" />
          <input 
            type="date" 
            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-2 py-2 text-xs focus:ring-2 focus:ring-indigo-500 outline-none" 
            value={startDate} 
            onChange={(e) => setStartDate(e.target.value)} 
          />
        </div>
        <div className="flex items-center gap-2">
          <input 
            type="date" 
            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-2 py-2 text-xs focus:ring-2 focus:ring-indigo-500 outline-none" 
            value={endDate} 
            onChange={(e) => setEndDate(e.target.value)} 
          />
        </div>

        <div className="relative">
          <select 
            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 focus:ring-2 focus:ring-indigo-500 outline-none text-sm appearance-none font-bold text-indigo-700" 
            value={romaneioWeekFilter} 
            onChange={(e) => setRomaneioWeekFilter(e.target.value)}
          >
            <option value="">📋 Todas as Semanas</option>
            {getAvailableWeeks().map(w => (
              <option key={w.satDate} value={w.satDate}>📅 Semana {w.label}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[1000px]">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-6 py-4 text-sm font-semibold text-slate-500 uppercase tracking-wider">Fornecedor / Descrição</th>
                <th className="px-6 py-4 text-sm font-semibold text-slate-500 uppercase tracking-wider text-center">Tipo</th>
                <th className="px-6 py-4 text-sm font-semibold text-slate-500 uppercase tracking-wider">Plano de Contas</th>
                <th className="px-6 py-4 text-sm font-semibold text-slate-500 uppercase tracking-wider">Vencimento</th>
                <th className="px-6 py-4 text-sm font-semibold text-slate-500 uppercase tracking-wider">Data de Pagamento</th>
                <th className="px-6 py-4 text-sm font-semibold text-slate-500 uppercase tracking-wider">Valor Pago</th>                <th className="px-6 py-4 text-sm font-semibold text-slate-500 uppercase tracking-wider">Juros</th>                <th className="px-6 py-4 text-sm font-semibold text-slate-500 uppercase tracking-wider">Juros</th>
                <th className="px-6 py-4 text-sm font-semibold text-slate-500 uppercase tracking-wider">Romaneio</th>
                <th className="px-6 py-4 text-sm font-semibold text-slate-500 uppercase tracking-wider">Valor</th>
                <th className="px-6 py-4 text-sm font-semibold text-slate-500 uppercase tracking-wider text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredBills.map(bill => {
                const supplier = suppliers.find(s => s.id === bill.supplierId);
                const account = accounts.find(a => a.id === bill.accountId);
                return (
                  <tr key={bill.id} className="hover:bg-slate-50 transition-colors group">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        {bill.recurrenceType !== 'none' && <div className="bg-indigo-100 p-1.5 rounded-lg text-indigo-600"><Repeat size={14} /></div>}
                        {bill.isEstimate && <div className="bg-amber-100 px-2 py-1 rounded text-amber-700 text-xs font-bold uppercase tracking-tight">Estimativa</div>}
                        <div>
                          <p className="font-semibold text-slate-800 text-sm">
                            {supplier?.name || 'Fornecedor Desconhecido'}
                          </p>
                          <p className="text-sm text-slate-500 flex items-center gap-1">
                            {bill.description}
                            {bill.currentInstallment && <span className="ml-2 text-xs font-bold text-slate-400">({bill.currentInstallment}/{bill.totalInstallments})</span>}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-center">
                      <span className={`px-2 py-0.5 rounded text-xs font-black uppercase ${account?.type === 'VARIABLE' ? 'bg-orange-100 text-orange-600' : 'bg-indigo-100 text-indigo-600'}`} title={account?.type === 'VARIABLE' ? 'Despesa Variável' : 'Despesa Fixa'}>
                        {account?.type === 'VARIABLE' ? 'V' : 'F'}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2 text-xs text-indigo-700 bg-indigo-50 px-3 py-1 rounded-full w-fit font-bold uppercase tracking-tighter">
                        <ListTree size={12} />
                        {account?.name || 'N/A'}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-sm text-slate-600 flex items-center gap-2">
                        {formatDatePtBR(bill.dueDate)}
                        {new Date(bill.dueDate) < new Date() && bill.status !== BillStatus.PAID && (
                          <span className="text-xs bg-rose-100 text-rose-600 px-1.5 py-0.5 rounded font-bold uppercase">Atrasada</span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      {canEdit ? (
                        <input
                          type="date"
                          value={bill.paidDate || ''}
                          onChange={(e) => handlePaidDateChange(bill.id, e.target.value)}
                          className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none bg-white hover:border-slate-300 transition-colors"
                          title="Preencha para marcar como pago"
                        />
                      ) : (
                        <span className="text-sm text-slate-600">
                          {bill.paidDate ? formatDatePtBR(bill.paidDate) : '—'}
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      {canEdit ? (
                        <input
                          type="number"
                          step="0.01"
                          value={bill.paidAmount || ''}
                          onChange={(e) => handlePaidAmountChange(bill.id, parseFloat(e.target.value))}
                          className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none bg-white hover:border-slate-300 transition-colors"
                          placeholder={new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(bill.amount)}
                          title="Valor efetivamente pago (com juros/multas ou descontos)"
                        />
                      ) : (
                        <span className="text-sm text-slate-600 font-bold">
                          {bill.paidAmount ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(bill.paidAmount) : '—'}
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      {bill.interestAmount !== undefined && bill.interestAmount !== 0 ? (
                        <span className={`text-sm font-bold ${bill.interestAmount > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                          {bill.interestAmount > 0 ? '+' : ''}{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(bill.interestAmount)}
                        </span>
                      ) : (
                        <span className="text-sm text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      {canEdit ? (
                        <select
                          value={bill.romaneioWeek || ''}
                          onChange={(e) => handleRomaneioWeekChange(bill.id, e.target.value || null)}
                          className="w-full px-2 py-1 text-xs border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none bg-white hover:border-slate-300 transition-colors font-semibold"
                        >
                          <option value="">—</option>
                          {getAvailableWeeks().map(w => (
                            <option key={w.satDate} value={w.satDate}>{w.label}</option>
                          ))}
                        </select>
                      ) : (
                        <span className="text-xs text-slate-600 font-semibold">
                          {bill.romaneioWeek ? getAvailableWeeks().find(w => w.satDate === bill.romaneioWeek)?.label || '—' : '—'}
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <span className="font-semibold text-slate-800 text-sm">
                        {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(bill.amount)}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        {canEdit && (
                          <button 
                            onClick={() => onToggleEstimate(bill.id)} 
                            className={`p-2 rounded-lg transition-colors ${bill.isEstimate ? 'text-amber-600 hover:bg-amber-50' : 'text-slate-400 hover:bg-slate-50'}`}
                            title={bill.isEstimate ? 'Marcar como valor real' : 'Marcar como estimativa'}
                          >
                            <AlertCircle size={18} />
                          </button>
                        )}
                        {canEdit && (
                          <button onClick={() => onEdit(bill)} className="p-2 text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors" title="Editar">
                            <Edit2 size={18} />
                          </button>
                        )}
                        {canDelete && (
                          <button onClick={() => onDelete(bill.id)} className="p-2 text-rose-600 hover:bg-rose-50 rounded-lg transition-colors" title="Excluir">
                            <Trash2 size={18} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {filteredBills.length === 0 && (
            <div className="p-20 text-center bg-slate-50/50">
              <p className="text-slate-400 font-medium">Nenhuma conta encontrada com os filtros aplicados.</p>
            </div>
          )}
        </div>
      </div>

      {showPdfPreview && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl h-[85vh] overflow-hidden flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 bg-slate-50">
              <div>
                <h3 className="text-lg font-black text-slate-800">Pré-visualização do Relatório</h3>
                <p className="text-xs text-slate-500 font-bold uppercase tracking-wider">Contas a Pagar</p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={exportPDF} className="px-4 py-2 bg-indigo-600 text-white rounded-lg font-bold hover:bg-indigo-700 transition-colors">
                  Exportar PDF
                </button>
                <button onClick={() => setShowPdfPreview(false)} className="px-4 py-2 border border-slate-200 rounded-lg font-bold text-slate-600 hover:bg-slate-50">
                  Fechar
                </button>
              </div>
            </div>
            <div className="flex-1 bg-slate-100">
              <iframe title="PDF Preview" src={pdfPreviewUrl} className="w-full h-full" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
