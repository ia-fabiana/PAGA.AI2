import React, { useState, useMemo } from 'react';
import { Bill, Supplier, BillStatus, UserRole, ChartOfAccount } from './types';
import { Search, Plus, FileDown, Edit2, Trash2, Repeat, Calendar, ListTree, User, AlertCircle, Upload, CheckCircle, X } from 'lucide-react';
import { jsPDF } from 'jspdf';
import 'jspdf-autotable';
import { theme } from './theme';
import { parseUniversalBankExtract, matchDebitWithBills } from './cnabParser';

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
  
  // Estados para conciliação bancária
  const [showReconcileModal, setShowReconcileModal] = useState(false);
  const [reconcileMatches, setReconcileMatches] = useState<Record<string, { matched: boolean; bankAmount?: number; bankDate?: string; confidence?: number }>>({});
  const [unmatchedTransactions, setUnmatchedTransactions] = useState<Array<{ date: string; amount: number; description: string }>>([]);
  const [isReconciling, setIsReconciling] = useState(false);

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
        b.launchedBy ? b.launchedBy.split('@')[0] : 'N/A',
        new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(b.amount), 
        formatDatePtBR(b.dueDate), 
        b.status
      ];
    });
    
    (doc as any).autoTable({ 
      startY: 34,
      columnStyles: {
        0: { cellWidth: 45 },
        1: { cellWidth: 30 },
        2: { cellWidth: 30 },
        3: { cellWidth: 25 },
        4: { cellWidth: 25, halign: 'right' },
        5: { cellWidth: 25, halign: 'center' },
        6: { cellWidth: 20, halign: 'center' }
      },
      head: [['Fornecedor', 'Descrição', 'Centro de Custo', 'Lançado Por', 'Valor', 'Vencimento', 'Status']], 
      body: tableData, 
      theme: 'grid', 
      headStyles: { fillStyle: '#4f46e5', textColor: '#ffffff', fontStyle: 'bold' },
      bodyStyles: { textColor: '#000000' },
      columnStyles: {
        4: { halign: 'right', cellWidth: 28 }
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

  const handleReconcileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsReconciling(true);
    try {
      const isPdf = file.name.toLowerCase().endsWith('.pdf');
      const fileContent = isPdf ? await file.arrayBuffer() : await file.text();
      const reconciliation = await parseUniversalBankExtract(fileContent, file.name, 'user');
      
      // Filtra apenas bills pagas
      const paidBills = bills.filter(b => b.status === BillStatus.PAID);
      
      console.log('🔍 RECONCILIAÇÃO - Total de bills:', bills.length);
      console.log('🔍 RECONCILIAÇÃO - Bills PAGAS:', paidBills.length);
      console.log('🔍 RECONCILIAÇÃO - Bills PAGAS (amostra):', paidBills.slice(0, 5).map(b => ({
        id: b.id.substring(0, 8),
        description: b.description,
        amount: b.amount,
        dueDate: b.dueDate,
        paidDate: b.paidDate,
        paidAmount: b.paidAmount
      })));
      
      const debits = reconciliation.transactions.filter(t => t.type === 'DEBIT');
      console.log('🔍 RECONCILIAÇÃO - Total de débitos no extrato:', debits.length);
      console.log('🔍 RECONCILIAÇÃO - Débitos (amostra):', debits.slice(0, 5).map(d => ({
        date: d.date,
        amount: d.amount,
        description: d.description.substring(0, 40)
      })));
      
      // Faz matching de cada débito com as bills
      const matches: Record<string, { matched: boolean; bankAmount?: number; bankDate?: string; confidence?: number }> = {};
      const unmatched: Array<{ date: string; amount: number; description: string }> = [];
      let totalMatchAttempts = 0;
      let totalMatchesFound = 0;
      
      debits.forEach(debit => {
        totalMatchAttempts++;
        const billMatches = matchDebitWithBills(debit, paidBills);
        
        if (billMatches.length > 0) {
          totalMatchesFound++;
          const best = billMatches[0];
          console.log(`✅ MATCH encontrado para débito ${debit.date} R$${debit.amount} - Bill: ${best.billId.substring(0, 8)} (score: ${best.score})`);
          matches[best.billId] = {
            matched: true,
            bankAmount: debit.amount,
            bankDate: debit.date,
            confidence: best.score
          };
        } else {
          console.log(`❌ SEM MATCH para débito ${debit.date} R$${debit.amount} - ${debit.description.substring(0, 30)}`);
          unmatched.push({
            date: debit.date,
            amount: debit.amount,
            description: debit.description
          });
        }
      });
      
      console.log('🔍 RECONCILIAÇÃO - Resumo final:');
      console.log(`   - Tentativas de match: ${totalMatchAttempts}`);
      console.log(`   - Matches encontrados: ${totalMatchesFound}`);
      console.log(`   - Não reconciliadas: ${unmatched.length}`);
      console.log(`   - Taxa de sucesso: ${((totalMatchesFound / totalMatchAttempts) * 100).toFixed(1)}%`);
      
      setReconcileMatches(matches);
      setUnmatchedTransactions(unmatched);
      setShowReconcileModal(true);
    } catch (error) {
      console.error('Erro ao processar extrato:', error);
      alert('Erro ao processar extrato bancário');
    } finally {
      setIsReconciling(false);
    }
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
            <>
              <label className="flex items-center gap-2 px-4 py-2 border-2 border-indigo-200 rounded-xl bg-indigo-50 text-indigo-700 hover:bg-indigo-100 hover:shadow-md transition-all font-medium text-sm shadow-sm cursor-pointer">
                <Upload size={18} /> {isReconciling ? 'Processando...' : 'Conciliar Extrato'}
                <input
                  type="file"
                  accept=".ret,.txt,.pdf"
                  onChange={handleReconcileUpload}
                  disabled={isReconciling}
                  className="hidden"
                />
              </label>
              <button onClick={onOpenForm} className="flex items-center gap-2 px-4 py-2 rounded-xl text-white hover:shadow-lg hover:-translate-y-0.5 transition-all font-medium text-sm shadow-md" style={{ backgroundColor: theme.colors.primary.purple }}>
                <Plus size={18} /> Nova Conta
              </button>
            </>
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
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-100" style={{ backgroundColor: theme.colors.neutral.bgMain }}>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Fornecedor</th>
                <th className="px-3 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider text-center">T</th>
                <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">C. Custo</th>
                <th className="px-3 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1"><User size={12} /> Por</th>
                <th className="px-3 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Venc.</th>
                <th className="px-3 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Pag.</th>
                <th className="px-3 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Vlr Pago</th>
                <th className="px-3 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Juros</th>
                <th className="px-3 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Valor</th>
                <th className="px-3 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredBills.map(bill => {
                const supplier = suppliers.find(s => s.id === bill.supplierId);
                const account = accounts.find(a => a.id === bill.accountId);
                const reconcileInfo = reconcileMatches[bill.id];
                
                return (
                  <tr key={bill.id} className="hover:bg-slate-50 transition-all group">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {reconcileInfo?.matched && (
                          <div 
                            className="p-1 rounded-lg bg-green-100" 
                            title={`Confirmado no extrato: R$ ${reconcileInfo.bankAmount?.toFixed(2)} em ${reconcileInfo.bankDate} (${reconcileInfo.confidence}% confiança)`}
                          >
                            <CheckCircle size={12} className="text-green-600" />
                          </div>
                        )}
                        {bill.recurrenceType !== 'none' && <div className="p-1 rounded-lg" style={{ backgroundColor: '#EDE9FE', color: theme.colors.primary.purple }}><Repeat size={12} /></div>}
                        {bill.isEstimate && <div className="bg-amber-100 px-1.5 py-0.5 rounded text-amber-700 text-[10px] font-bold uppercase tracking-tight">EST</div>}
                        <div className="min-w-0">
                          <p className="font-semibold text-xs truncate" style={{ color: theme.colors.neutral.black }}>
                            {(supplier?.name || 'Fornecedor Desconhecido').toUpperCase()}
                          </p>
                          <p className="text-xs text-slate-500 truncate">
                            {bill.description}
                            {bill.currentInstallment && <span className="ml-1 text-[10px] font-bold text-slate-400">({bill.currentInstallment}/{bill.totalInstallments})</span>}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-center">
                      <span 
                        className="px-1.5 py-0.5 rounded text-[10px] font-black uppercase" 
                        style={{ 
                          backgroundColor: account?.type === 'VARIABLE' ? '#DBEAFE' : '#EDE9FE',
                          color: account?.type === 'VARIABLE' ? theme.colors.accent.blue : theme.colors.primary.purple
                        }}
                        title={account?.type === 'VARIABLE' ? 'Despesa Variável' : 'Despesa Fixa'}
                      >
                        {account?.type === 'VARIABLE' ? 'V' : 'F'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5 text-[10px] px-2 py-0.5 rounded-full w-fit font-bold uppercase tracking-tighter" style={{ backgroundColor: '#EDE9FE', color: theme.colors.primary.purple }}>
                        <ListTree size={10} />
                        <span className="truncate max-w-[100px]">{account?.name || 'N/A'}</span>
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <div className="text-xs text-slate-600 flex items-center gap-1">
                        <User size={12} className="text-slate-400" />
                        <span className="font-medium truncate max-w-[80px]">{bill.launchedBy ? bill.launchedBy.split('@')[0] : 'N/A'}</span>
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <div className="text-xs text-slate-600 flex items-center gap-1">
                        <span className="whitespace-nowrap">{formatDatePtBR(bill.dueDate)}</span>
                        {new Date(bill.dueDate) < new Date() && bill.status !== BillStatus.PAID && (
                          <span className="text-[9px] bg-rose-100 text-rose-600 px-1 py-0.5 rounded font-bold uppercase">!</span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      {canEdit ? (
                        <input
                          type="date"
                          value={bill.paidDate || ''}
                          onChange={(e) => handlePaidDateChange(bill.id, e.target.value)}
                          className="w-[110px] px-2 py-1 text-xs border border-slate-200 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none bg-white hover:border-slate-300 transition-colors"
                          title="Preencha para marcar como pago"
                        />
                      ) : (
                        <span className="text-xs text-slate-600 whitespace-nowrap">
                          {bill.paidDate ? formatDatePtBR(bill.paidDate) : '—'}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3">{canEdit ? (
                        <input
                          type="number"
                          step="0.01"
                          value={bill.paidAmount || ''}
                          onChange={(e) => handlePaidAmountChange(bill.id, parseFloat(e.target.value))}
                          className="w-[90px] px-2 py-1 text-xs border border-slate-200 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none bg-white hover:border-slate-300 transition-colors"
                          placeholder={new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(bill.amount)}
                          title="Valor efetivamente pago (com juros/multas ou descontos)"
                        />
                      ) : (
                        <span className="text-xs text-slate-600 font-bold whitespace-nowrap">
                          {bill.paidAmount ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(bill.paidAmount) : '—'}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      {bill.interestAmount !== undefined && bill.interestAmount !== 0 ? (
                        <span className={`text-xs font-bold whitespace-nowrap ${bill.interestAmount > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                          {bill.interestAmount > 0 ? '+' : ''}{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(bill.interestAmount)}
                        </span>
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <span className="font-semibold text-xs whitespace-nowrap" style={{ color: theme.colors.neutral.black }}>
                        {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(bill.amount)}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-right">
                      <div className="flex items-center justify-end gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        {canEdit && (
                          <button 
                            onClick={() => onToggleEstimate(bill.id)} 
                            className={`p-1.5 rounded-lg transition-colors ${bill.isEstimate ? 'text-amber-600 hover:bg-amber-50' : 'text-slate-400 hover:bg-slate-50'}`}
                            title={bill.isEstimate ? 'Marcar como valor real' : 'Marcar como estimativa'}
                          >
                            <AlertCircle size={14} />
                          </button>
                        )}
                        {canEdit && (
                          <button onClick={() => onEdit(bill)} className="p-1.5 hover:bg-purple-50 rounded-lg transition-colors" style={{ color: theme.colors.primary.purple }} title="Editar">
                            <Edit2 size={14} />
                          </button>
                        )}
                        {canDelete && (
                          <button onClick={() => onDelete(bill.id)} className="p-1.5 text-rose-600 hover:bg-rose-50 rounded-lg transition-colors" title="Excluir">
                            <Trash2 size={14} />
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

      {/* Modal de resumo de conciliação bancária */}
      {showReconcileModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-6">
          <div className="bg-white rounded-2xl max-w-6xl w-full max-h-[90vh] overflow-hidden flex flex-col shadow-2xl">
            <div className="p-6 border-b border-slate-200 flex items-center justify-between bg-gradient-to-r from-green-50 to-emerald-50">
              <div>
                <h2 className="text-2xl font-black text-slate-800">✅ Conciliação Bancária</h2>
                <div className="flex gap-6 mt-2">
                  <p className="text-sm text-slate-600">
                    <span className="font-bold text-green-700">{Object.values(reconcileMatches).filter(m => m.matched).length}</span> encontradas
                  </p>
                  <p className="text-sm text-slate-600">
                    <span className="font-bold text-amber-700">{unmatchedTransactions.length}</span> sem cadastro
                  </p>
                  <p className="text-sm text-slate-600">
                    <span className="font-bold text-slate-700">{Object.values(reconcileMatches).length + unmatchedTransactions.length}</span> total no extrato
                  </p>
                </div>
              </div>
              <button 
                onClick={() => setShowReconcileModal(false)}
                className="p-2 hover:bg-white rounded-lg transition-colors"
              >
                <X size={24} className="text-slate-600" />
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-6">
              {/* Seção: Contas Encontradas no Extrato */}
              {Object.keys(reconcileMatches).length > 0 && (
                <div className="mb-8">
                  <h3 className="text-lg font-black text-slate-800 mb-4 flex items-center gap-2">
                    <CheckCircle size={20} className="text-green-600" />
                    Contas Confirmadas no Extrato
                  </h3>
                  <div className="space-y-3">
                {bills
                  .filter(bill => reconcileMatches[bill.id]?.matched)
                  .map(bill => {
                    const supplier = suppliers.find(s => s.id === bill.supplierId);
                    const match = reconcileMatches[bill.id];
                    const priceDiff = match.bankAmount && bill.paidAmount ? Math.abs(match.bankAmount - bill.paidAmount) : 0;
                    
                    return (
                      <div key={bill.id} className="border-2 border-green-200 rounded-xl p-4 bg-green-50/50 hover:bg-green-50 transition-colors">
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-2">
                              <CheckCircle size={18} className="text-green-600 flex-shrink-0" />
                              <h3 className="font-bold text-slate-800">{supplier?.name || 'Fornecedor Desconhecido'}</h3>
                              <span className="text-xs bg-green-600 text-white px-2 py-0.5 rounded-full font-bold">
                                {match.confidence}% confiança
                              </span>
                            </div>
                            <p className="text-sm text-slate-600 mb-3">{bill.description}</p>
                            
                            <div className="grid grid-cols-2 gap-4 text-sm">
                              <div>
                                <p className="text-xs text-slate-500 font-bold uppercase">Valor Lançado</p>
                                <p className="font-bold text-slate-800">
                                  {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(bill.paidAmount || bill.amount)}
                                </p>
                              </div>
                              <div>
                                <p className="text-xs text-slate-500 font-bold uppercase">Valor no Extrato</p>
                                <p className="font-bold text-emerald-700">
                                  {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(match.bankAmount || 0)}
                                </p>
                              </div>
                              <div>
                                <p className="text-xs text-slate-500 font-bold uppercase">Data Lançada</p>
                                <p className="font-semibold text-slate-700">{bill.paidDate ? formatDatePtBR(bill.paidDate) : '—'}</p>
                              </div>
                              <div>
                                <p className="text-xs text-slate-500 font-bold uppercase">Data no Extrato</p>
                                <p className="font-semibold text-slate-700">{match.bankDate ? formatDatePtBR(match.bankDate) : '—'}</p>
                              </div>
                            </div>
                            
                            {priceDiff > 0.01 && (
                              <div className="mt-3 bg-amber-100 border border-amber-300 rounded-lg p-2 flex items-center gap-2">
                                <AlertCircle size={16} className="text-amber-700" />
                                <p className="text-xs font-bold text-amber-800">
                                  Diferença de {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(priceDiff)}
                                </p>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  </div>
                </div>
              )}
              
              {/* Seção: Despesas no Extrato SEM cadastro */}
              {unmatchedTransactions.length > 0 && (
                <div className="mb-8">
                  <h3 className="text-lg font-black text-slate-800 mb-4 flex items-center gap-2">
                    <AlertCircle size={20} className="text-amber-600" />
                    Despesas no Extrato sem Cadastro ({unmatchedTransactions.length})
                  </h3>
                  <div className="space-y-2 max-h-96 overflow-y-auto">
                    {unmatchedTransactions
                      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                      .map((tx, idx) => (
                        <div key={idx} className="border border-amber-200 rounded-lg p-3 bg-amber-50/30 hover:bg-amber-50 transition-colors">
                          <div className="flex items-center justify-between gap-4">
                            <div className="flex-1">
                              <p className="font-semibold text-slate-700 text-sm">{tx.description}</p>
                              <p className="text-xs text-slate-500 mt-0.5">{formatDatePtBR(tx.date)}</p>
                            </div>
                            <div className="text-right">
                              <p className="font-bold text-amber-700">
                                {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(tx.amount)}
                              </p>
                            </div>
                          </div>
                        </div>
                      ))}
                  </div>
                  <div className="mt-4 bg-blue-50 border border-blue-200 rounded-lg p-3">
                    <p className="text-sm text-blue-800">
                      <strong>💡 Dica:</strong> Estas despesas estão no extrato mas não foram encontradas no sistema. 
                      Verifique se precisam ser cadastradas ou se foram pagas em datas muito diferentes.
                    </p>
                  </div>
                </div>
              )}
              
              {/* Mensagem quando não há nada */}
              {Object.keys(reconcileMatches).length === 0 && unmatchedTransactions.length === 0 && (
                  <div className="text-center py-12">
                    <AlertCircle size={48} className="mx-auto text-slate-300 mb-4" />
                    <p className="text-slate-500 font-semibold">Nenhuma correspondência encontrada</p>
                    <p className="text-sm text-slate-400 mt-2">
                      As contas pagas não foram encontradas no extrato bancário
                    </p>
                  </div>
                )}
              </div>
            </div>
            
            <div className="p-6 border-t border-slate-200 bg-slate-50">              <div className="grid grid-cols-3 gap-4 mb-4">
                <div className="bg-white rounded-lg p-3 border border-green-200">
                  <p className="text-xs text-slate-500 font-bold uppercase mb-1">Confirmadas</p>
                  <p className="text-2xl font-black text-green-600">
                    {Object.values(reconcileMatches).filter(m => m.matched).length}
                  </p>
                </div>
                <div className="bg-white rounded-lg p-3 border border-amber-200">
                  <p className="text-xs text-slate-500 font-bold uppercase mb-1">Sem Cadastro</p>
                  <p className="text-2xl font-black text-amber-600">
                    {unmatchedTransactions.length}
                  </p>
                </div>
                <div className="bg-white rounded-lg p-3 border border-slate-200">
                  <p className="text-xs text-slate-500 font-bold uppercase mb-1">Taxa de Match</p>
                  <p className="text-2xl font-black text-slate-700">
                    {Object.keys(reconcileMatches).length + unmatchedTransactions.length > 0
                      ? Math.round((Object.keys(reconcileMatches).length / (Object.keys(reconcileMatches).length + unmatchedTransactions.length)) * 100)
                      : 0}%
                  </p>
                </div>
              </div>              <button
                onClick={() => setShowReconcileModal(false)}
                className="w-full px-6 py-3 bg-slate-800 text-white rounded-xl font-bold hover:bg-slate-900 transition-colors"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

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
