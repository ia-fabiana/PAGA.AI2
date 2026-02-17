
import React, { useState, useMemo } from 'react';
import { Bill, Supplier, BillStatus, UserRole, ChartOfAccount } from './types';
import { Search, Plus, FileDown, Edit2, Trash2, Repeat, Calendar, ListTree, User, AlertCircle } from 'lucide-react';
import { jsPDF } from 'jspdf';
import 'jspdf-autotable';
import { theme } from './theme';

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
  const [sortBy, setSortBy] = useState<'dueDate' | 'paidDate' | 'amount' | 'supplier'>('dueDate'); // Ordenação

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


  // Helper functions to detect overdue status dynamically
  const toDate = (dateStr: string) => new Date(`${dateStr}T12:00:00`);
  const isPaid = (bill: Bill) => bill.status === BillStatus.PAID || Boolean(bill.paidDate);
  const isOverdue = (bill: Bill) => {
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    return !isPaid(bill) && toDate(bill.dueDate) < today;
  };

  const filteredBills = useMemo(() => {
    const filtered = bills.filter(bill => {
      const supplier = suppliers.find(s => s.id === bill.supplierId);
      const account = accounts.find(a => a.id === bill.accountId);
      
      const matchesSearch = 
        bill.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
        supplier?.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        account?.name.toLowerCase().includes(searchTerm.toLowerCase());
      
      const matchesStatus =
        statusFilter === 'ALL' ||
        (statusFilter === 'OPEN' && bill.status !== BillStatus.PAID) ||
        (statusFilter === 'OPEN_NOT_OVERDUE' && bill.status === BillStatus.PENDING && !isOverdue(bill)) ||
        (statusFilter === BillStatus.OVERDUE && isOverdue(bill)) ||
        bill.status === statusFilter;
      const matchesSupplier = supplierFilter === 'ALL' || bill.supplierId === supplierFilter;
      
      const billDate = new Date(bill.dueDate);
      const matchesDate = 
        (!startDate || billDate >= new Date(startDate)) &&
        (!endDate || billDate <= new Date(endDate));

      return matchesSearch && matchesStatus && matchesSupplier && matchesDate;
    });

    // Aplicar ordenação conforme selecionado
    return filtered.sort((a, b) => {
      switch (sortBy) {
        case 'dueDate':
          return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
        case 'paidDate':
          const aPaidDate = a.paidDate ? new Date(a.paidDate).getTime() : Infinity;
          const bPaidDate = b.paidDate ? new Date(b.paidDate).getTime() : Infinity;
          return aPaidDate - bPaidDate;
        case 'amount':
          return b.amount - a.amount; // Maior valor primeiro
        case 'supplier': {
          const aSupplier = suppliers.find(s => s.id === a.supplierId)?.name || '';
          const bSupplier = suppliers.find(s => s.id === b.supplierId)?.name || '';
          return aSupplier.localeCompare(bSupplier);
        }
        default:
          return 0;
      }
    });
  }, [bills, suppliers, accounts, searchTerm, statusFilter, supplierFilter, startDate, endDate, sortBy]);

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


  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-4xl font-black" style={{ color: theme.colors.neutral.black }}>Contas a Pagar</h1>
          <p className="text-slate-600 font-semibold text-sm">Lista padrão mostra apenas contas pendentes e atrasadas.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={previewPDF} className="flex items-center gap-2 px-4 py-2 border border-slate-200 rounded-xl bg-white text-slate-700 hover:bg-slate-50 hover:shadow-md transition-all font-medium text-sm shadow-sm">
            <FileDown size={18} /> Visualizar PDF
          </button>
          <button onClick={exportPDF} className="flex items-center gap-2 px-4 py-2 border border-slate-200 rounded-xl bg-white text-slate-700 hover:bg-slate-50 hover:shadow-md transition-all font-medium text-sm shadow-sm">
            <FileDown size={18} /> Exportar PDF
          </button>
          {canEdit && (
            <button onClick={onOpenForm} className="flex items-center gap-2 px-4 py-2 rounded-xl text-white hover:shadow-lg hover:-translate-y-0.5 transition-all font-medium text-sm shadow-md" style={{ backgroundColor: theme.colors.primary.purple }}>
              <Plus size={18} /> Nova Conta
            </button>
          )}
        </div>
      </div>

      <div className="bg-white p-4 rounded-[20px] border border-slate-100 shadow-[0_10px_15px_-3px_rgba(0,0,0,0.04)] grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-4">
        <div className="relative md:col-span-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input 
            type="text" 
            placeholder="Buscar..." 
            className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl outline-none text-sm transition-all" 
            value={searchTerm} 
            onChange={(e) => setSearchTerm(e.target.value)} 
          />
        </div>

        <div className="relative">
          <select 
            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 outline-none text-sm appearance-none" 
            value={statusFilter} 
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="OPEN_NOT_OVERDUE">A Pagar (Somente não vencidas)</option>
            <option value="OPEN">A Pagar (Pendentes + Atrasadas)</option>
            <option value={BillStatus.PENDING}>Pendente</option>
            <option value={BillStatus.OVERDUE}>Atrasado</option>
            <option value={BillStatus.PAID}>Pago</option>
            <option value="ALL">Todos os Status</option>
          </select>
        </div>

        <div className="relative">
          <select 
            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 outline-none text-sm appearance-none" 
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
            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-2 py-2 text-xs outline-none" 
            value={startDate} 
            onChange={(e) => setStartDate(e.target.value)} 
          />
        </div>
        <div className="flex items-center gap-2">
          <input 
            type="date" 
            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-2 py-2 text-xs outline-none" 
            value={endDate} 
            onChange={(e) => setEndDate(e.target.value)} 
          />
        </div>

        <div className="relative">
          <select 
            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 outline-none text-sm appearance-none" 
            value={sortBy} 
            onChange={(e) => setSortBy(e.target.value as 'dueDate' | 'paidDate' | 'amount' | 'supplier')}
          >
            <option value="dueDate">📅 Ordenar por Vencimento</option>
            <option value="paidDate">💳 Ordenar por Data de Pagamento</option>
            <option value="amount">💰 Ordenar por Valor</option>
            <option value="supplier">🏢 Ordenar por Fornecedor</option>
          </select>
        </div>

      </div>

      <div className="bg-white rounded-[20px] border border-slate-100 shadow-[0_10px_15px_-3px_rgba(0,0,0,0.04)] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[1000px]">
            <thead>
              <tr className="border-b border-slate-100" style={{ backgroundColor: theme.colors.neutral.bgMain }}>
                <th className="px-6 py-4 text-sm font-semibold text-slate-500 uppercase tracking-wider">Fornecedor / Descrição</th>
                <th className="px-6 py-4 text-sm font-semibold text-slate-500 uppercase tracking-wider text-center">Tipo</th>
                <th className="px-6 py-4 text-sm font-semibold text-slate-500 uppercase tracking-wider">Plano de Contas</th>
                <th className="px-6 py-4 text-sm font-semibold text-slate-500 uppercase tracking-wider">Vencimento</th>
                <th className="px-6 py-4 text-sm font-semibold text-slate-500 uppercase tracking-wider">Data de Pagamento</th>
                <th className="px-6 py-4 text-sm font-semibold text-slate-500 uppercase tracking-wider">Valor Pago</th>
                <th className="px-6 py-4 text-sm font-semibold text-slate-500 uppercase tracking-wider">Juros</th>
                <th className="px-6 py-4 text-sm font-semibold text-slate-500 uppercase tracking-wider">Valor</th>
                <th className="px-6 py-4 text-sm font-semibold text-slate-500 uppercase tracking-wider text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredBills.map(bill => {
                const supplier = suppliers.find(s => s.id === bill.supplierId);
                const account = accounts.find(a => a.id === bill.accountId);
                return (
                  <tr key={bill.id} className="hover:bg-slate-50 transition-all group">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        {bill.recurrenceType !== 'none' && <div className="p-1.5 rounded-lg" style={{ backgroundColor: '#EDE9FE', color: theme.colors.primary.purple }}><Repeat size={14} /></div>}
                        {bill.isEstimate && <div className="bg-amber-100 px-2 py-1 rounded text-amber-700 text-xs font-bold uppercase tracking-tight">Estimativa</div>}
                        <div>
                          <p className="font-semibold text-sm" style={{ color: theme.colors.neutral.black }}>
                            {(supplier?.name || 'Fornecedor Desconhecido').toUpperCase()}
                          </p>
                          <p className="text-sm text-slate-500 flex items-center gap-1">
                            {bill.description}
                            {bill.currentInstallment && <span className="ml-2 text-xs font-bold text-slate-400">({bill.currentInstallment}/{bill.totalInstallments})</span>}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-center">
                      <span 
                        className="px-2 py-0.5 rounded text-xs font-black uppercase" 
                        style={{ 
                          backgroundColor: account?.type === 'VARIABLE' ? '#DBEAFE' : '#EDE9FE',
                          color: account?.type === 'VARIABLE' ? theme.colors.accent.blue : theme.colors.primary.purple
                        }}
                        title={account?.type === 'VARIABLE' ? 'Despesa Variável' : 'Despesa Fixa'}
                      >
                        {account?.type === 'VARIABLE' ? 'V' : 'F'}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2 text-xs px-3 py-1 rounded-full w-fit font-bold uppercase tracking-tighter" style={{ backgroundColor: '#EDE9FE', color: theme.colors.primary.purple }}>
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
                      <span className="font-semibold text-sm" style={{ color: theme.colors.neutral.black }}>
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
                          <button onClick={() => onEdit(bill)} className="p-2 hover:bg-purple-50 rounded-lg transition-colors" style={{ color: theme.colors.primary.purple }} title="Editar">
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
          <div className="bg-white rounded-[20px] shadow-[0_20px_25px_-5px_rgba(0,0,0,0.1)] w-full max-w-5xl h-[85vh] overflow-hidden flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100" style={{ backgroundColor: theme.colors.neutral.bgMain }}>
              <div>
                <h3 className="text-lg font-black" style={{ color: theme.colors.neutral.black }}>Pré-visualização do Relatório</h3>
                <p className="text-xs text-slate-500 font-bold uppercase tracking-wider">Contas a Pagar</p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={exportPDF} className="px-4 py-2 text-white rounded-lg font-bold hover:shadow-lg transition-all" style={{ backgroundColor: theme.colors.primary.purple }}>
                  Exportar PDF
                </button>
                <button onClick={() => setShowPdfPreview(false)} className="px-4 py-2 border border-slate-200 rounded-lg font-bold text-slate-600 hover:bg-slate-50 transition-colors">
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
