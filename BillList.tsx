import React, { useMemo, useState } from 'react';
import { Bill, BillStatus, ChartOfAccount, Supplier, UserRole } from './types';
import { AlertCircle, Edit2, FileDown, ListTree, Plus, Repeat, Search, Trash2, User } from 'lucide-react';
import { jsPDF } from 'jspdf';
import 'jspdf-autotable';
import { theme } from './theme';
import { getBillDisplayInterestAmount, getBillDisplayPaidAmount, getBillDisplayPaidDate, getBillOutstandingAmount, getBillPaymentSource, isBillFullyPaid, isBillPartiallyPaid } from './billPaymentUtils';
import { formatBoletoCode, getBoletoBarcodeDataUrl } from './boletoUtils';

interface BillListProps {
  bills: Bill[];
  suppliers: Supplier[];
  accounts: ChartOfAccount[];
  onEdit: (bill: Bill) => void;
  onDelete: (id: string) => void;
  onStatusChange: (id: string, status: BillStatus) => void;
  onUpdate: (bill: Bill) => void;
  onReopenReconciliation: (bill: Bill) => Promise<void> | void;
  onOpenForm: () => void;
  onToggleEstimate: (id: string) => void;
  userRole: UserRole;
  companyName?: string;
}

export const BillList: React.FC<BillListProps> = ({
  bills,
  suppliers,
  accounts,
  onEdit,
  onDelete,
  onStatusChange,
  onUpdate,
  onReopenReconciliation,
  onOpenForm,
  onToggleEstimate,
  userRole,
  companyName = 'PAGA.AI',
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('OPEN');
  const [supplierFilter, setSupplierFilter] = useState('ALL');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [draftSearchTerm, setDraftSearchTerm] = useState('');
  const [draftStatusFilter, setDraftStatusFilter] = useState('OPEN');
  const [draftSupplierFilter, setDraftSupplierFilter] = useState('ALL');
  const [draftStartDate, setDraftStartDate] = useState('');
  const [draftEndDate, setDraftEndDate] = useState('');
  const [showPdfPreview, setShowPdfPreview] = useState(false);
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState('');
  const [sortBy, setSortBy] = useState<'dueDate' | 'paidDate' | 'amount' | 'supplier'>('dueDate');
  const [paidAmountInputs, setPaidAmountInputs] = useState<Record<string, string>>({});

  const formatDatePtBR = (dateStr?: string): string => {
    if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return '—';
    const [year, month, day] = dateStr.split('-');
    return `${day}/${month}/${year}`;
  };

  const parseLocalDate = (value: string, endOfDay = false) => {
    const [yearStr, monthStr, dayStr] = value.split('-');
    const year = Number(yearStr);
    const month = Number(monthStr);
    const day = Number(dayStr);
    if (!year || !month || !day) return null;
    return endOfDay
      ? new Date(year, month - 1, day, 23, 59, 59, 999)
      : new Date(year, month - 1, day, 0, 0, 0, 0);
  };

  const formatCurrency = (value?: number) =>
    value === undefined
      ? '—'
      : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);

  const formatCurrencyInput = (value?: number) => {
    if (value === undefined) return '';
    return new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
  };

  const parseCurrencyInput = (value: string): number | undefined => {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const normalized = trimmed.replace(/\./g, '').replace(',', '.');
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : undefined;
  };

  const isBankPayment = (bill: Bill) => getBillPaymentSource(bill) === 'bank';

  const toDate = (dateStr: string) => new Date(`${dateStr}T12:00:00`);
  const isPaid = (bill: Bill) => isBillFullyPaid(bill);
  const isOverdue = (bill: Bill) => {
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    return !isPaid(bill) && toDate(bill.dueDate) < today;
  };

  const getComputedStatus = (bill: Bill): BillStatus => {
    if (isPaid(bill)) return BillStatus.PAID;
    if (isOverdue(bill)) return BillStatus.OVERDUE;
    return BillStatus.PENDING;
  };

  const applyFilters = () => {
    setSearchTerm(draftSearchTerm);
    setStatusFilter(draftStatusFilter);
    setSupplierFilter(draftSupplierFilter);
    setStartDate(draftStartDate);
    setEndDate(draftEndDate);
  };

  const clearFilters = () => {
    setDraftSearchTerm('');
    setDraftStatusFilter('OPEN');
    setDraftSupplierFilter('ALL');
    setDraftStartDate('');
    setDraftEndDate('');
    setSearchTerm('');
    setStatusFilter('OPEN');
    setSupplierFilter('ALL');
    setStartDate('');
    setEndDate('');
  };

  const filteredBills = useMemo(() => {
    const filtered = bills.filter((bill) => {
      const supplier = suppliers.find((item) => item.id === bill.supplierId);
      const account = accounts.find((item) => item.id === bill.accountId);
      const normalizedSearch = searchTerm.toLowerCase();
      const matchesSearch =
        bill.description.toLowerCase().includes(normalizedSearch) ||
        supplier?.name.toLowerCase().includes(normalizedSearch) ||
        account?.name.toLowerCase().includes(normalizedSearch);

      const computedStatus = getComputedStatus(bill);
      const matchesStatus =
        statusFilter === 'ALL' ||
        (statusFilter === 'OPEN' && computedStatus !== BillStatus.PAID) ||
        (statusFilter === 'OPEN_NOT_OVERDUE' && computedStatus === BillStatus.PENDING) ||
        computedStatus === statusFilter;
      const matchesSupplier = supplierFilter === 'ALL' || bill.supplierId === supplierFilter;

      const isPaidFilter = statusFilter === BillStatus.PAID;
      const displayPaidDateStr = getBillDisplayPaidDate(bill);
      let matchesDate = true;
      if (startDate || endDate) {
        const start = startDate ? parseLocalDate(startDate) : null;
        const end = endDate ? parseLocalDate(endDate, true) : null;
        if (isPaidFilter && computedStatus === BillStatus.PAID) {
          // Para contas pagas, filtrar pela data de pagamento
          if (displayPaidDateStr) {
            const paidDateObj = parseLocalDate(displayPaidDateStr);
            matchesDate =
              (!start || (paidDateObj !== null && paidDateObj >= start)) &&
              (!end || (paidDateObj !== null && paidDateObj <= end));
          }
          // Se não tem data de pagamento registrada, incluir a conta mesmo assim
        } else {
          // Para outros status, filtrar pela data de vencimento
          const billDate = parseLocalDate(bill.dueDate);
          matchesDate =
            (!start || (billDate !== null && billDate >= start)) &&
            (!end || (billDate !== null && billDate <= end));
        }
      }

      return matchesSearch && matchesStatus && matchesSupplier && matchesDate;
    });

    return filtered.sort((a, b) => {
      switch (sortBy) {
        case 'dueDate':
          return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
        case 'paidDate': {
          const aDisplayPaidDate = getBillDisplayPaidDate(a);
          const bDisplayPaidDate = getBillDisplayPaidDate(b);
          const aPaidDate = aDisplayPaidDate ? new Date(`${aDisplayPaidDate}T12:00:00`).getTime() : Infinity;
          const bPaidDate = bDisplayPaidDate ? new Date(`${bDisplayPaidDate}T12:00:00`).getTime() : Infinity;
          return aPaidDate - bPaidDate;
        }
        case 'amount':
          return b.amount - a.amount;
        case 'supplier': {
          const aSupplier = suppliers.find((item) => item.id === a.supplierId)?.name || '';
          const bSupplier = suppliers.find((item) => item.id === b.supplierId)?.name || '';
          return aSupplier.localeCompare(bSupplier);
        }
        default:
          return 0;
      }
    });
  }, [accounts, bills, endDate, searchTerm, sortBy, startDate, statusFilter, supplierFilter, suppliers]);

  const canEdit = userRole !== UserRole.VIEWER;
  const canDelete = userRole !== UserRole.VIEWER;

  const buildPdfDoc = () => {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const rows = filteredBills.map((bill) => {
      const supplier = suppliers.find((item) => item.id === bill.supplierId);
      const computedStatus = getComputedStatus(bill);
      const paymentSource = getBillPaymentSource(bill);

      return [
        supplier?.name || 'Fornecedor desconhecido',
        bill.description,
        formatDatePtBR(bill.dueDate),
        formatCurrency(bill.amount),
        formatDatePtBR(getBillDisplayPaidDate(bill)),
        formatCurrency(getBillDisplayPaidAmount(bill)),
        paymentSource === 'bank' ? 'Banco' : paymentSource === 'manual' ? 'Manual' : '—',
        computedStatus,
      ];
    });

    doc.setFontSize(16);
    doc.text(companyName, 14, 16);
    doc.setFontSize(10);
    const statusLabels: Record<string, string> = {
      'OPEN': 'Pendentes + Atrasadas',
      'OPEN_NOT_OVERDUE': 'Somente não vencidas',
      'ALL': 'Todos os Status',
      [BillStatus.PENDING]: 'Pendentes',
      [BillStatus.OVERDUE]: 'Atrasadas',
      [BillStatus.PAID]: 'Pagas',
    };
    const statusLabel = statusLabels[statusFilter] || statusFilter;
    let subtitle = `Relatório de Contas a Pagar (${statusLabel}) - ${new Date().toLocaleDateString('pt-BR')}`;
    if (startDate || endDate) {
      const rangeStart = startDate ? formatDatePtBR(startDate) : '...';
      const rangeEnd = endDate ? formatDatePtBR(endDate) : '...';
      subtitle += ` | Período: ${rangeStart} a ${rangeEnd}`;
    }
    doc.text(subtitle, 14, 22);

    (doc as any).autoTable({
      startY: 28,
      head: [['Fornecedor', 'Descrição', 'Vencimento', 'Valor previsto', 'Pago em', 'Valor pago', 'Origem', 'Status']],
      body: rows,
      theme: 'grid',
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [79, 70, 229], textColor: 255 },
    });

    const boletoBills = filteredBills.filter((bill) => bill.boletoLine);
    if (boletoBills.length > 0) {
      let cursorY = ((doc as any).lastAutoTable?.finalY || 28) + 12;

      boletoBills.forEach((bill, index) => {
        const supplier = suppliers.find((item) => item.id === bill.supplierId);
        const barcodeDataUrl = getBoletoBarcodeDataUrl(bill.boletoLine);
        const blockHeight = 34;

        if (cursorY + blockHeight > 285) {
          doc.addPage();
          cursorY = 18;
        }

        if (index === 0 || cursorY === 18) {
          doc.setFontSize(11);
          doc.setTextColor(30, 41, 59);
          doc.setFont(undefined, 'bold');
          doc.text('Boletos do periodo', 14, cursorY);
          cursorY += 6;
        }

        doc.setDrawColor(226, 232, 240);
        doc.roundedRect(14, cursorY, 182, 26, 3, 3);

        doc.setFontSize(9);
        doc.setTextColor(51, 65, 85);
        doc.setFont(undefined, 'bold');
        doc.text(supplier?.name || 'Fornecedor desconhecido', 18, cursorY + 6);

        doc.setFontSize(8);
        doc.setTextColor(100, 116, 139);
        doc.setFont(undefined, 'normal');
        doc.text(`Vencimento: ${formatDatePtBR(bill.dueDate)}   Valor: ${formatCurrency(bill.amount)}`, 18, cursorY + 11);
        doc.text(formatBoletoCode(bill.boletoLine), 18, cursorY + 16, { maxWidth: 174 });

        if (barcodeDataUrl) {
          doc.addImage(barcodeDataUrl, 'PNG', 18, cursorY + 18, 174, 8);
        }

        cursorY += 31;
      });
    }

    return doc;
  };

  const exportPDF = () => {
    const doc = buildPdfDoc();
    doc.save('contas-a-pagar.pdf');
  };

  const previewPDF = () => {
    const doc = buildPdfDoc();
    setPdfPreviewUrl(doc.output('datauristring'));
    setShowPdfPreview(true);
  };

  const handlePaidDateChange = (billId: string, paidDate: string) => {
    const bill = bills.find((item) => item.id === billId);
    if (!bill || isBankPayment(bill)) return;

    if (paidDate) {
      onUpdate({
        ...bill,
        paidDate,
        status: BillStatus.PAID,
        bankMatches: undefined,
        paymentSource: 'manual',
        paymentBankTransactionId: undefined,
        paymentBankReference: undefined,
        paymentBankDescription: undefined,
        paymentBankDocument: undefined,
      });
      return;
    }

    onUpdate({
      ...bill,
      paidDate: undefined,
      paidAmount: undefined,
      interestAmount: undefined,
      bankMatches: undefined,
      paymentSource: undefined,
      paymentBankTransactionId: undefined,
      paymentBankReference: undefined,
      paymentBankDescription: undefined,
      paymentBankDocument: undefined,
      status: BillStatus.PENDING,
    });
  };

  const handlePaidAmountChange = (billId: string, paidAmount?: number) => {
    const bill = bills.find((item) => item.id === billId);
    if (!bill || isBankPayment(bill)) return;

    const interestAmount = paidAmount !== undefined ? paidAmount - bill.amount : undefined;

    onUpdate({
      ...bill,
      paidAmount,
      interestAmount,
      bankMatches: undefined,
      paymentSource: bill.paidDate || paidAmount !== undefined ? 'manual' : undefined,
      paymentBankTransactionId: undefined,
      paymentBankReference: undefined,
      paymentBankDescription: undefined,
      paymentBankDocument: undefined,
    });
  };

  const handleDeleteClick = (billId: string, description: string) => {
    if (!window.confirm(`Deseja realmente excluir a conta "${description}"?`)) return;
    onDelete(billId);
  };

  const handleReopenReconciliationClick = (bill: Bill) => {
    if (!window.confirm(`Deseja reabrir a conciliacao bancaria da conta "${bill.description}"?`)) return;
    onReopenReconciliation(bill);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-4xl font-black" style={{ color: theme.colors.neutral.black }}>
            Contas a Pagar
          </h1>
          <p className="text-sm font-semibold text-slate-600">
            Lista padrão mostra apenas contas pendentes e atrasadas.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={previewPDF}
            className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition-all hover:bg-slate-50 hover:shadow-md"
          >
            <FileDown size={18} /> Visualizar PDF
          </button>
          <button
            onClick={exportPDF}
            className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm transition-all hover:bg-slate-50 hover:shadow-md"
          >
            <FileDown size={18} /> Exportar PDF
          </button>
          {canEdit && (
            <button
              onClick={onOpenForm}
              className="flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium text-white shadow-md transition-all hover:-translate-y-0.5 hover:shadow-lg"
              style={{ backgroundColor: theme.colors.primary.purple }}
            >
              <Plus size={18} /> Nova Conta
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 rounded-[20px] border border-slate-100 bg-white p-4 shadow-[0_10px_15px_-3px_rgba(0,0,0,0.04)] sm:grid-cols-2 md:grid-cols-5">
        <div className="relative md:col-span-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input
            type="text"
            placeholder="Buscar..."
            className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pl-10 pr-4 text-sm outline-none transition-all"
            value={draftSearchTerm}
            onChange={(event) => setDraftSearchTerm(event.target.value)}
          />
        </div>

        <div>
          <select
            className="w-full appearance-none rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm outline-none"
            value={draftStatusFilter}
            onChange={(event) => setDraftStatusFilter(event.target.value)}
          >
            <option value="OPEN_NOT_OVERDUE">A Pagar (Somente não vencidas)</option>
            <option value="OPEN">A Pagar (Pendentes + Atrasadas)</option>
            <option value={BillStatus.PENDING}>Pendente</option>
            <option value={BillStatus.OVERDUE}>Atrasado</option>
            <option value={BillStatus.PAID}>Pago</option>
            <option value="ALL">Todos os Status</option>
          </select>
        </div>

        <div>
          <select
            className="w-full appearance-none rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm outline-none"
            value={draftSupplierFilter}
            onChange={(event) => setDraftSupplierFilter(event.target.value)}
          >
            <option value="ALL">Todos Fornecedores</option>
            {suppliers.map((supplier) => (
              <option key={supplier.id} value={supplier.id}>
                {supplier.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">
            {draftStatusFilter === BillStatus.PAID ? 'Pagamento de' : 'Vencimento de'}
          </label>
          <input
            type="date"
            className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm outline-none"
            value={draftStartDate}
            onChange={(event) => setDraftStartDate(event.target.value)}
          />
        </div>

        <div>
          <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">
            {draftStatusFilter === BillStatus.PAID ? 'Pagamento até' : 'Vencimento até'}
          </label>
          <input
            type="date"
            className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm outline-none"
            value={draftEndDate}
            onChange={(event) => setDraftEndDate(event.target.value)}
          />
        </div>

        <div>
          <button
            type="button"
            onClick={applyFilters}
            className="w-full rounded-xl px-4 py-2 text-sm font-bold text-white shadow-sm transition-all hover:shadow-md"
            style={{ backgroundColor: theme.colors.primary.purple }}
          >
            Filtrar
          </button>
        </div>

        <div>
          <button
            type="button"
            onClick={clearFilters}
            className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-600 transition-all hover:bg-slate-50"
          >
            Limpar
          </button>
        </div>

        <div>
          <select
            className="w-full appearance-none rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-sm outline-none"
            value={sortBy}
            onChange={(event) => setSortBy(event.target.value as 'dueDate' | 'paidDate' | 'amount' | 'supplier')}
          >
            <option value="dueDate">Ordenar por vencimento</option>
            <option value="paidDate">Ordenar por pagamento</option>
            <option value="amount">Ordenar por valor</option>
            <option value="supplier">Ordenar por fornecedor</option>
          </select>
        </div>
      </div>

      <div className="overflow-hidden rounded-[20px] border border-slate-100 bg-white shadow-[0_10px_15px_-3px_rgba(0,0,0,0.04)]">
        <div className="divide-y divide-slate-100">
          {filteredBills.map((bill) => {
            const supplier = suppliers.find((item) => item.id === bill.supplierId);
            const account = accounts.find((item) => item.id === bill.accountId);
            const overdue = isOverdue(bill);
            const paymentSource = getBillPaymentSource(bill);
            const bankPayment = isBankPayment(bill);
            const partialPayment = isBillPartiallyPaid(bill);
            const displayPaidDate = getBillDisplayPaidDate(bill);
            const displayPaidAmount = getBillDisplayPaidAmount(bill);
            const displayInterestAmount = getBillDisplayInterestAmount(bill);
            const outstandingAmount = getBillOutstandingAmount(bill);

            return (
              <div key={bill.id} className="grid gap-4 px-4 py-4 lg:grid-cols-12 lg:items-start">
                <div className="space-y-3 lg:col-span-4">
                  <div className="flex items-start gap-3">
                    {bill.recurrenceType !== 'none' && (
                      <div className="mt-0.5 rounded-lg p-1.5" style={{ backgroundColor: '#EDE9FE', color: theme.colors.primary.purple }}>
                        <Repeat size={14} />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold uppercase" style={{ color: theme.colors.neutral.black }}>
                          {(supplier?.name || 'Fornecedor Desconhecido').toUpperCase()}
                        </p>
                        {bill.isEstimate && (
                          <div className="rounded bg-amber-100 px-2 py-1 text-xs font-bold uppercase tracking-tight text-amber-700">
                            Estimativa
                          </div>
                        )}
                      </div>
                      <p className="mt-1 break-words text-sm text-slate-500">{bill.description}</p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-1 font-semibold">
                      <User size={12} className="text-slate-400" />
                      {bill.launchedBy ? bill.launchedBy.split('@')[0] : 'N/A'}
                    </span>
                    {overdue && (
                      <span className="rounded-full bg-rose-100 px-2 py-1 font-bold uppercase text-rose-600">Atrasada</span>
                    )}
                    {getComputedStatus(bill) === BillStatus.PAID && (
                      <span className="rounded-full bg-emerald-100 px-2 py-1 font-bold uppercase text-emerald-600">Pago</span>
                    )}
                    {partialPayment && (
                      <span className="rounded-full bg-amber-100 px-2 py-1 font-bold uppercase text-amber-700">Parcial</span>
                    )}
                    {paymentSource === 'bank' && (
                      <span className="rounded-full bg-blue-100 px-2 py-1 font-bold uppercase text-blue-700">Banco</span>
                    )}
                    {paymentSource === 'manual' && (
                      <span className="rounded-full bg-emerald-100 px-2 py-1 font-bold uppercase text-emerald-700">Manual</span>
                    )}
                  </div>
                </div>

                <div className="space-y-3 lg:col-span-3">
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Vencimento</p>
                    <p className="mt-1 text-sm font-semibold text-slate-700">{formatDatePtBR(bill.dueDate)}</p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className="rounded px-2 py-0.5 text-xs font-black uppercase"
                      style={{
                        backgroundColor: account?.type === 'VARIABLE' ? '#DBEAFE' : '#EDE9FE',
                        color: account?.type === 'VARIABLE' ? theme.colors.accent.blue : theme.colors.primary.purple,
                      }}
                    >
                      {account?.type === 'VARIABLE' ? 'Variável' : 'Fixa'}
                    </span>

                    <div
                      className="flex max-w-[180px] items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold tracking-tight"
                      style={{ backgroundColor: '#EDE9FE', color: theme.colors.primary.purple }}
                      title={account?.name || 'N/A'}
                    >
                      <ListTree size={12} />
                      <span className="truncate">{account?.name || 'N/A'}</span>
                    </div>
                  </div>
                </div>

                <div className="space-y-3 lg:col-span-3">
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Pago em</p>
                      {paymentSource && (
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${bankPayment ? 'bg-blue-100 text-blue-700' : 'bg-emerald-100 text-emerald-700'}`}>
                          {bankPayment ? 'Banco' : 'Manual'}
                        </span>
                      )}
                    </div>
                    {canEdit ? (
                      <div className="mt-1 space-y-2">
                        <input
                          type="date"
                          value={displayPaidDate || ''}
                          disabled={bankPayment}
                          onChange={(event) => handlePaidDateChange(bill.id, event.target.value)}
                          className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-emerald-500 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"
                        />
                        {displayPaidDate && !bankPayment && (
                          <button
                            type="button"
                            onClick={() => handlePaidDateChange(bill.id, '')}
                            className="rounded-lg px-2 py-1 text-[10px] font-bold text-rose-600 transition-colors hover:bg-rose-50"
                          >
                            Limpar pagamento
                          </button>
                        )}
                        {bankPayment && (
                          <p className="text-[11px] text-blue-700">
                            Preenchido pelo banco. Altere pela conciliação.
                          </p>
                        )}
                      </div>
                    ) : (
                      <p className="mt-1 text-sm text-slate-700">{formatDatePtBR(displayPaidDate)}</p>
                    )}
                  </div>

                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Valor pago</p>
                    {canEdit ? (
                      <input
                        type="text"
                        inputMode="decimal"
                        value={paidAmountInputs[bill.id] ?? (displayPaidAmount !== undefined ? formatCurrencyInput(displayPaidAmount) : '')}
                        disabled={bankPayment}
                        onChange={(event) => {
                          const raw = event.target.value;
                          setPaidAmountInputs((prev) => ({ ...prev, [bill.id]: raw }));
                          handlePaidAmountChange(bill.id, parseCurrencyInput(raw));
                        }}
                        className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-emerald-500 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"
                        placeholder="0,00"
                      />
                    ) : (
                      <p className="mt-1 text-sm text-slate-700">{formatCurrency(displayPaidAmount)}</p>
                    )}
                    {bankPayment && bill.paymentBankReference && (
                      <p className="mt-1 text-[11px] text-slate-500">Ref. bancária: {bill.paymentBankReference}</p>
                    )}
                  </div>
                </div>

                <div className="space-y-3 lg:col-span-1">
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Valor previsto</p>
                    <p className="mt-1 text-sm font-semibold" style={{ color: theme.colors.neutral.black }}>
                      {formatCurrency(bill.amount)}
                    </p>
                    {partialPayment && (
                      <p className="mt-1 text-[11px] font-semibold text-amber-700">
                        Saldo em aberto: {formatCurrency(outstandingAmount)}
                      </p>
                    )}
                  </div>

                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Juros</p>
                    {bill.isEstimate ? (
                      <p className="mt-1 text-sm text-slate-400">—</p>
                    ) : displayInterestAmount !== undefined && displayInterestAmount !== 0 ? (
                      <p className={`mt-1 text-sm font-bold ${displayInterestAmount > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                        {displayInterestAmount > 0 ? '+' : ''}
                        {formatCurrency(displayInterestAmount)}
                      </p>
                    ) : (
                      <p className="mt-1 text-sm text-slate-400">—</p>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap items-start justify-start gap-2 lg:col-span-1 lg:justify-end">
                  {canEdit && bankPayment && (
                    <button
                      type="button"
                      onClick={() => handleReopenReconciliationClick(bill)}
                      className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-amber-700 transition-colors hover:bg-amber-100"
                      title="Reabrir conciliacao bancaria"
                    >
                      Reabrir conciliacao
                    </button>
                  )}
                  {canEdit && (
                    <button
                      onClick={() => onToggleEstimate(bill.id)}
                      className={`rounded-lg p-2 transition-colors ${bill.isEstimate ? 'text-amber-600 hover:bg-amber-50' : 'text-slate-400 hover:bg-slate-50'}`}
                      title={bill.isEstimate ? 'Marcar como valor real' : 'Marcar como estimativa'}
                    >
                      <AlertCircle size={18} />
                    </button>
                  )}
                  {canEdit && (
                    <button
                      onClick={() => onEdit(bill)}
                      className="rounded-lg p-2 transition-colors hover:bg-purple-50"
                      style={{ color: theme.colors.primary.purple }}
                      title="Editar"
                    >
                      <Edit2 size={18} />
                    </button>
                  )}
                  {canDelete && (
                    <button
                      onClick={() => handleDeleteClick(bill.id, bill.description)}
                      className="rounded-lg p-2 text-rose-600 transition-colors hover:bg-rose-50"
                      title="Excluir"
                    >
                      <Trash2 size={18} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}

          {filteredBills.length === 0 && (
            <div className="p-20 text-center">
              <p className="font-medium text-slate-400">Nenhuma conta encontrada com os filtros aplicados.</p>
            </div>
          )}
        </div>
      </div>

      {showPdfPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
          <div className="relative h-[90vh] w-full max-w-5xl overflow-hidden rounded-2xl bg-white shadow-2xl">
            <button
              type="button"
              onClick={() => setShowPdfPreview(false)}
              className="absolute right-4 top-4 z-10 rounded-lg bg-slate-900/80 px-3 py-1 text-sm font-semibold text-white"
            >
              Fechar
            </button>
            <iframe title="Prévia PDF" src={pdfPreviewUrl} className="h-full w-full" />
          </div>
        </div>
      )}
    </div>
  );
};
