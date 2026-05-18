import React, { useRef, useState } from 'react';
import { Bill, BillAttachment, BillDue, BillInvoice, BillStatus, BoletoExtractionSource, ChartOfAccount, Supplier } from './types';
import { Check, FileText, Layers, ListTree, Plus, Repeat, Trash2, Upload, User, X } from 'lucide-react';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { isMockMode, storage } from './firebase';
import { extractBoletoDataFromFile, normalizeBoletoCode } from './boletoUtils';

declare const __BUILD_INFO__: { commit: string; buildTime: string };

interface BillFormProps {
  suppliers: Supplier[];
  accounts: ChartOfAccount[];
  onClose: () => void;
  onSubmit: (bill: Bill, editScope?: 'single' | 'series') => void;
  initialData?: Bill;
  userEmail?: string;
  canEditBillDate?: boolean;
}

type DraftAttachment = BillAttachment & { file?: File };
type SingleBoletoDraft = {
  line: string;
  attachment?: DraftAttachment;
  source?: BoletoExtractionSource;
  message?: string;
  extracting?: boolean;
};
type DueDraft = {
  date: string;
  amount: number;
  amountInput: string;
  line: string;
  attachment?: DraftAttachment;
  source?: BoletoExtractionSource;
  message?: string;
  extracting?: boolean;
};

const today = () => new Date().toISOString().split('T')[0];
const formatCurrencyInput = (value?: number) =>
  value === undefined ? '' : new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
const parseCurrencyInput = (value: string) => {
  const parsed = Number(value.replace(/\./g, '').replace(',', '.'));
  return Number.isNaN(parsed) ? 0 : parsed;
};
const formatFileSize = (size: number) => {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
};
const buildDraftAttachment = (attachment?: BillAttachment) => (attachment ? { ...attachment } : undefined);
const createDraftAttachment = (file: File, prefix: string): DraftAttachment => ({
  id: `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  name: file.name,
  contentType: file.type || 'application/octet-stream',
  size: file.size,
  url: '',
  order: 1,
  uploadedAt: new Date().toISOString(),
  file,
});
const attachmentKey = (attachment?: BillAttachment) => attachment ? attachment.storagePath || attachment.url || `${attachment.name}-${attachment.size}` : '';
const runWithTimeout = async <T,>(promise: Promise<T>, label: string, timeoutMs = 30000): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`${label} nÃ£o respondeu em ${Math.round(timeoutMs / 1000)}s. O Firebase Storage pode estar sem regra publicada, com acesso bloqueado ou com a conexao lenta.`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

export const BillForm: React.FC<BillFormProps> = ({ suppliers, accounts, onClose, onSubmit, initialData, userEmail, canEditBillDate }) => {
  const buildInfo = typeof __BUILD_INFO__ !== 'undefined' ? __BUILD_INFO__ : { commit: 'unknown', buildTime: '' };
  const buildLabel = buildInfo.buildTime ? `build ${buildInfo.commit} - ${new Date(buildInfo.buildTime).toLocaleString('pt-BR')}` : `build ${buildInfo.commit}`;
  const draftIdRef = useRef(initialData?.id || Math.random().toString(36).slice(2, 10));
  const legacyInvoiceAttachment = initialData?.invoice?.attachment || initialData?.attachments?.find((item) => /nota|nf/i.test(item.name));
  const initialInvoiceFiles: DraftAttachment[] = initialData?.invoice?.attachments?.length
    ? initialData.invoice.attachments.map(buildDraftAttachment).filter(Boolean) as DraftAttachment[]
    : legacyInvoiceAttachment ? [buildDraftAttachment(legacyInvoiceAttachment)].filter(Boolean) as DraftAttachment[] : [];
  const boletoGuess = initialData?.boletoAttachment || initialData?.attachments?.find((item) => /boleto/i.test(item.name));
  const [isUploading, setIsUploading] = useState(false);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [editScope, setEditScope] = useState<'single' | 'series'>(initialData?.parentId ? 'single' : 'series');
  const [legacyAttachments] = useState<BillAttachment[]>(initialData?.attachments || []);
  const [formData, setFormData] = useState<Partial<Bill> & { amountInput?: string; paidAmountInput?: string }>({
    description: '',
    amount: 0,
    supplierId: suppliers[0]?.id || '',
    dueDate: today(),
    paidDate: undefined,
    paidAmount: undefined,
    interestAmount: undefined,
    status: BillStatus.PENDING,
    recurrenceType: 'none',
    accountId: accounts[0]?.id || '',
    totalInstallments: 12,
    selectedMonths: [],
    isEstimate: false,
    launchedBy: userEmail || '',
    ...initialData,
    amountInput: initialData?.amount ? formatCurrencyInput(initialData.amount) : '',
    paidAmountInput: initialData?.paidAmount ? formatCurrencyInput(initialData.paidAmount) : '',
  });
  const [invoice, setInvoice] = useState({ number: initialData?.invoice?.number || '', series: initialData?.invoice?.series || '', issueDate: initialData?.invoice?.issueDate || '' });
  const [invoiceFiles, setInvoiceFiles] = useState<DraftAttachment[]>(initialInvoiceFiles);
  const [singleBoleto, setSingleBoleto] = useState<SingleBoletoDraft>({
    line: initialData?.boletoLine || '',
    attachment: buildDraftAttachment(boletoGuess),
    source: initialData?.boletoExtractionSource,
    message: initialData?.boletoLine ? 'Boleto preenchido.' : undefined,
  });
  const [dueDrafts, setDueDrafts] = useState<DueDraft[]>(
    initialData?.specificDues?.length
      ? initialData.specificDues.map((due) => ({
          date: due.date,
          amount: due.amount,
          amountInput: formatCurrencyInput(due.amount),
          line: due.boletoLine || '',
          attachment: buildDraftAttachment(due.boletoAttachment),
          source: due.boletoExtractionSource,
          message: due.boletoLine ? 'Boleto preenchido.' : undefined,
        }))
      : [{ date: today(), amount: 0, amountInput: '', line: '' }]
  );
  const [splitHelper, setSplitHelper] = useState({ totalInput: '', count: 1, firstDate: today() });

  const isEditingRecurring = Boolean(initialData && (initialData.parentId || ['monthly', 'annual', 'installments', 'custom'].includes(initialData.recurrenceType)));
  const isPaid = formData.status === BillStatus.PAID || Boolean(formData.paidDate);
  const isBankPayment = formData.paymentSource === 'bank';
  const totalAmountSpecific = dueDrafts.reduce((sum, due) => sum + due.amount, 0);
  const invoiceTotal = formData.recurrenceType === 'specific' ? totalAmountSpecific : formData.amount || 0;
  const allowsSingleInstallmentDetails = formData.recurrenceType === 'none' || (isEditingRecurring && editScope === 'single');
  const sortedSuppliers = [...suppliers].sort((a, b) => a.name.localeCompare(b.name));
  const sortedAccounts = [...accounts].sort((a, b) => a.name.localeCompare(b.name));

  const setRecurrenceType = (recurrenceType: Bill['recurrenceType']) =>
    setFormData((prev) => ({
      ...prev,
      recurrenceType,
      status: recurrenceType === 'specific' ? BillStatus.PENDING : prev.status,
      paidDate: recurrenceType === 'specific' ? undefined : prev.paidDate,
      paidAmount: recurrenceType === 'specific' ? undefined : prev.paidAmount,
      paidAmountInput: recurrenceType === 'specific' ? '' : prev.paidAmountInput,
      interestAmount: recurrenceType === 'specific' ? undefined : prev.interestAmount,
    }));

  const mergeAttachments = (...lists: Array<(BillAttachment | undefined)[]>) => {
    const seen = new Set<string>();
    return [...legacyAttachments, ...lists.flat().filter(Boolean) as BillAttachment[]].filter((item) => {
      const key = attachmentKey(item);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };

  const uploadAttachment = async (attachment: DraftAttachment | undefined, billId: string, folder: string) => {
    if (!attachment) return undefined;
    if (!attachment.file) return attachment as BillAttachment;
    const nowIso = new Date().toISOString();
    if (isMockMode || !storage) return { ...attachment, url: attachment.url || URL.createObjectURL(attachment.file), uploadedAt: attachment.uploadedAt || nowIso, uploadedBy: userEmail || undefined } as BillAttachment;
    const safeName = attachment.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const storagePath = `bills/${billId}/${folder}/${Date.now()}-${safeName}`;
    const storageRef = ref(storage, storagePath);
    await runWithTimeout(uploadBytes(storageRef, attachment.file, { contentType: attachment.contentType }), `Upload de ${attachment.name}`);
    const url = await runWithTimeout(getDownloadURL(storageRef), `Leitura da URL de ${attachment.name}`);
    return { id: attachment.id, name: attachment.name, contentType: attachment.contentType, size: attachment.size, url, order: attachment.order || 1, uploadedAt: attachment.uploadedAt || nowIso, uploadedBy: attachment.uploadedBy || userEmail || undefined, storagePath } as BillAttachment;
  };

  const handleInvoiceFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;
    setAttachmentError(null);
    setInvoiceFiles((prev) => {
      const slots = 4 - prev.length;
      if (slots <= 0) return prev;
      return [...prev, ...files.slice(0, slots).map((f, i) => createDraftAttachment(f, `invoice-${prev.length + i + 1}`))];
    });
    event.target.value = '';
  };

  const handleSingleBoletoFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const attachment = createDraftAttachment(file, 'boleto');
    setSingleBoleto({ line: '', attachment, message: 'Lendo boleto...', extracting: true });
    const extraction = await extractBoletoDataFromFile(file);
    setSingleBoleto((prev) => ({ ...prev, attachment, line: extraction.boletoLine || prev.line, source: extraction.source, message: extraction.boletoLine ? `NÃºmero preenchido automaticamente (${extraction.source === 'filename' ? 'arquivo' : 'PDF'}).` : extraction.error, extracting: false }));
    event.target.value = '';
  };

  const handleDueBoletoFile = async (index: number, event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const attachment = createDraftAttachment(file, `due-${index + 1}`);
    setDueDrafts((prev) => prev.map((due, i) => i === index ? { ...due, attachment, message: 'Lendo boleto...', extracting: true } : due));
    const extraction = await extractBoletoDataFromFile(file);
    setDueDrafts((prev) => prev.map((due, i) => i === index ? { ...due, attachment, line: extraction.boletoLine || '', source: extraction.source, message: extraction.boletoLine ? `NÃºmero preenchido automaticamente (${extraction.source === 'filename' ? 'arquivo' : 'PDF'}).` : extraction.error, extracting: false } : due));
    event.target.value = '';
  };

  const handleSubmit = async (event?: React.SyntheticEvent) => {
    event?.preventDefault?.();
    if (!formData.description || !formData.supplierId || !formData.accountId) return alert('Preencha descriÃ§Ã£o, fornecedor e centro de custo.');
    if (formData.recurrenceType === 'specific' && dueDrafts.some((due) => !due.date || due.amount <= 0)) return alert('Todos os vencimentos precisam de data e valor maior que zero.');
    if (formData.recurrenceType !== 'specific' && (!formData.amount || !formData.dueDate)) return alert('Preencha o valor e a data de vencimento.');
    setIsUploading(true);
    setAttachmentError(null);
    try {
      const billId = draftIdRef.current;
      const uploadErrors: string[] = [];
      const uploadAttachmentSafely = async (attachment: DraftAttachment | undefined, folder: string, label: string) => {
        try {
          return await uploadAttachment(attachment, billId, folder);
        } catch (error) {
          const rawMessage = error instanceof Error ? error.message : 'Falha no upload do anexo.';
          const message = rawMessage.includes('storage/unauthorized')
            ? `${rawMessage} Verifique se este login tem permissao efetiva no Firebase para Contas a Pagar e anexos.`
            : rawMessage;
          uploadErrors.push(`${label}: ${message}`);
          return undefined;
        }
      };

      const invoiceFilesNew = invoiceFiles.filter((f) => Boolean(f.file));
      const invoiceSelected = invoiceFilesNew.length > 0;
      const singleBoletoSelected = Boolean(singleBoleto.attachment?.file);
      const dueUploadsSelected = dueDrafts.filter((due) => due.attachment?.file).length;

      const uploadedInvoiceResults = await Promise.all(
        invoiceFiles.map((att, idx) => uploadAttachmentSafely(att, 'invoice', `Nota Fiscal ${idx + 1}`))
      );
      const validUploadedInvoices = uploadedInvoiceResults.filter(Boolean) as BillAttachment[];
      const uploadedSingleBoleto = allowsSingleInstallmentDetails
        ? await uploadAttachmentSafely(singleBoleto.attachment as DraftAttachment | undefined, 'boleto', 'Boleto')
        : undefined;
      const uploadedDues = await Promise.all(
        dueDrafts.map(async (due, index) => ({
          ...due,
          attachment: formData.recurrenceType === 'specific'
            ? await uploadAttachmentSafely(due.attachment as DraftAttachment | undefined, `boletos/parcela-${index + 1}`, `Boleto da parcela ${index + 1}`)
            : due.attachment,
        }))
      );

      if (uploadErrors.length > 0) {
        const mustAbort =
          (invoiceSelected && uploadedInvoiceResults.some((u, i) => invoiceFiles[i]?.file && !u)) ||
          (allowsSingleInstallmentDetails && singleBoletoSelected && !uploadedSingleBoleto) ||
          (formData.recurrenceType === 'specific' && dueUploadsSelected > 0 && uploadedDues.some((due, index) => dueDrafts[index]?.attachment?.file && !due.attachment));

        if (mustAbort) {
          setAttachmentError(`Nao foi possivel concluir o envio dos anexos selecionados. ${uploadErrors[0]}`);
          return;
        }

        setAttachmentError(`A conta sera salva sem ${uploadErrors.length > 1 ? 'alguns anexos' : 'o anexo'}. ${uploadErrors[0]}`);
      }

      const invoicePayload: BillInvoice | undefined = invoice.number || invoice.series || invoice.issueDate || validUploadedInvoices.length > 0 ? { number: invoice.number?.trim() || undefined, series: invoice.series?.trim() || undefined, issueDate: invoice.issueDate || undefined, totalAmount: invoiceTotal || undefined, attachment: validUploadedInvoices[0], attachments: validUploadedInvoices.length > 0 ? validUploadedInvoices : undefined } : undefined;
      const nextBill: Bill = { ...(formData as Bill), id: billId, amount: formData.recurrenceType === 'specific' ? totalAmountSpecific : formData.amount || 0, invoice: invoicePayload, attachments: formData.recurrenceType === 'specific' ? mergeAttachments(validUploadedInvoices, uploadedDues.map((due) => due.attachment as BillAttachment | undefined)) : mergeAttachments(validUploadedInvoices, [uploadedSingleBoleto]) };
      if (formData.recurrenceType === 'specific') {
        nextBill.status = BillStatus.PENDING;
        nextBill.paidDate = undefined;
        nextBill.paidAmount = undefined;
        nextBill.interestAmount = undefined;
        nextBill.specificDues = uploadedDues.map<BillDue>((due) => ({ date: due.date, amount: due.amount, boletoLine: normalizeBoletoCode(due.line) || undefined, boletoAttachment: due.attachment as BillAttachment | undefined, boletoExtractionSource: normalizeBoletoCode(due.line) ? due.source || 'manual' : undefined }));
        nextBill.boletoLine = undefined;
        nextBill.boletoAttachment = undefined;
        nextBill.boletoExtractionSource = undefined;
      } else if (allowsSingleInstallmentDetails) {
        const boletoLine = normalizeBoletoCode(singleBoleto.line);
        nextBill.specificDues = undefined;
        nextBill.boletoLine = boletoLine || undefined;
        nextBill.boletoAttachment = uploadedSingleBoleto;
        nextBill.boletoExtractionSource = boletoLine ? singleBoleto.source || 'manual' : undefined;
      } else {
        nextBill.specificDues = undefined;
        nextBill.boletoLine = undefined;
        nextBill.boletoAttachment = undefined;
        nextBill.boletoExtractionSource = undefined;
      }
      if (!nextBill.paidDate) {
        nextBill.status = BillStatus.PENDING;
        nextBill.paidAmount = undefined;
        nextBill.interestAmount = undefined;
      }
      await Promise.resolve(onSubmit(nextBill, editScope));
    } catch (error) {
      console.error('Erro ao enviar anexos:', error);
      const message = error instanceof Error ? error.message : 'Erro desconhecido no upload.';
      alert(`Erro ao enviar anexos: ${message}`);
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm">
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-white px-6 py-4">
          <div>
            <h2 className="text-xl font-bold text-slate-800">{initialData ? 'Editar Conta' : 'Nova Conta a Pagar'}</h2>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{buildLabel}</p>
          </div>
          <button onClick={onClose} className="rounded-full p-2 text-slate-400 hover:bg-slate-50"><X size={20} /></button>
        </div>
        <form onSubmit={handleSubmit} className="flex-1 space-y-4 overflow-y-auto p-6" noValidate>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">DescriÃ§Ã£o</label>
            <input className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500" value={formData.description || ''} onChange={(e) => setFormData({ ...formData, description: e.target.value })} placeholder="Ex: Compra de insumos - NF 1234" />
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Fornecedor</label>
              <select className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500" value={formData.supplierId} onChange={(e) => setFormData({ ...formData, supplierId: e.target.value })}>
                <option value="">Selecione...</option>
                {sortedSuppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1 flex items-center gap-1 text-sm font-medium text-slate-700"><ListTree size={14} /> Centro de Custo</label>
              <select className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-indigo-500" value={formData.accountId} onChange={(e) => setFormData({ ...formData, accountId: e.target.value })}>
                <option value="">Selecione...</option>
                {sortedAccounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="mb-1 flex items-center gap-1 text-sm font-medium text-slate-700"><User size={14} /> LanÃ§ado Por</label>
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-600">{formData.launchedBy || userEmail || 'N/A'}</div>
          </div>

          {isEditingRecurring && (
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <p className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">Aplicar ediÃ§Ã£o</p>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <label className={`cursor-pointer rounded-xl border-2 p-3 ${editScope === 'single' ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200 bg-slate-50'}`}><input type="radio" className="hidden" checked={editScope === 'single'} onChange={() => setEditScope('single')} />Somente esta parcela</label>
                <label className={`cursor-pointer rounded-xl border-2 p-3 ${editScope === 'series' ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200 bg-slate-50'}`}><input type="radio" className="hidden" checked={editScope === 'series'} onChange={() => setEditScope('series')} />Todas as parcelas</label>
              </div>
            </div>
          )}

          <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Dados da Nota Fiscal</p>
              <span className="rounded-full bg-indigo-50 px-3 py-1 text-[11px] font-bold text-indigo-600">Compartilhada nos vencimentos</span>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
              <input className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 outline-none focus:ring-2 focus:ring-indigo-500" value={invoice.number || ''} onChange={(e) => setInvoice((prev) => ({ ...prev, number: e.target.value }))} placeholder="NÃºmero da NF" />
              <input className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 outline-none focus:ring-2 focus:ring-indigo-500" value={invoice.series || ''} onChange={(e) => setInvoice((prev) => ({ ...prev, series: e.target.value }))} placeholder="SÃ©rie" />
              <input type="date" className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 outline-none focus:ring-2 focus:ring-indigo-500" value={invoice.issueDate || ''} onChange={(e) => setInvoice((prev) => ({ ...prev, issueDate: e.target.value }))} />
              <div className="rounded-xl border border-indigo-100 bg-indigo-50 px-4 py-2.5 text-right"><p className="text-[11px] font-bold uppercase tracking-wider text-indigo-500">Total</p><p className="text-sm font-bold text-indigo-700">{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(invoiceTotal)}</p></div>
            </div>
            {invoiceFiles.length < 4 && (
              <label className="flex cursor-pointer items-center gap-3 rounded-xl border-2 border-dashed border-slate-200 bg-white p-4 hover:border-indigo-300">
                <input type="file" multiple accept="application/pdf,image/jpeg,image/png" className="hidden" onChange={handleInvoiceFile} disabled={isUploading} />
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-50"><FileText size={20} className="text-indigo-600" /></div>
                <div><p className="text-sm font-semibold text-slate-700">{invoiceFiles.length === 0 ? 'Anexar Nota Fiscal' : `Adicionar NF (${invoiceFiles.length}/4)`}</p><p className="text-xs text-slate-400">PDF, JPG ou PNG · até 4 arquivos</p></div>
              </label>
            )}
            {invoiceFiles.map((att, idx) => (
              <div key={att.id} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3">
                <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-slate-800">{att.name}</p><p className="text-xs text-slate-500">{formatFileSize(att.size)}</p></div>
                {att.url && <a href={att.url} target="_blank" rel="noreferrer" className="text-xs font-semibold text-indigo-600">Abrir</a>}
                <button type="button" onClick={() => setInvoiceFiles((prev) => prev.filter((_, i) => i !== idx))} className="rounded-lg p-2 text-slate-300 hover:bg-rose-50 hover:text-rose-500"><Trash2 size={14} /></button>
              </div>
            ))}
          </div>

          <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs font-bold uppercase tracking-wider text-slate-400">ConfiguraÃ§Ã£o de Vencimentos</p>
            <div className="grid grid-cols-1 gap-2">
              <label className={`flex cursor-pointer items-center gap-3 rounded-xl border-2 p-3 ${formData.recurrenceType === 'none' ? 'border-indigo-500 bg-white' : 'border-transparent bg-slate-100/50'}`}><input type="radio" className="hidden" checked={formData.recurrenceType === 'none'} onChange={() => setRecurrenceType('none')} /><span className="flex-1 text-sm font-bold text-slate-800">Pagamento Ãšnico</span></label>
              <label className={`flex cursor-pointer items-center gap-3 rounded-xl border-2 p-3 ${formData.recurrenceType === 'specific' ? 'border-indigo-500 bg-white' : 'border-transparent bg-slate-100/50'}`}><input type="radio" className="hidden" checked={formData.recurrenceType === 'specific'} onChange={() => setRecurrenceType('specific')} /><span className="flex-1 text-sm font-bold text-slate-800">VÃ¡rios Vencimentos</span><Layers size={16} className="text-indigo-500" /></label>
              <label className={`flex cursor-pointer items-center gap-3 rounded-xl border-2 p-3 ${formData.recurrenceType === 'monthly' ? 'border-indigo-500 bg-white' : 'border-transparent bg-slate-100/50'}`}><input type="radio" className="hidden" checked={formData.recurrenceType === 'monthly'} onChange={() => setRecurrenceType('monthly')} /><span className="flex-1 text-sm font-bold text-slate-800">RecorrÃªncia Mensal</span><Repeat size={16} className="text-indigo-500" /></label>
              <label className={`flex cursor-pointer items-center gap-3 rounded-xl border-2 p-3 ${formData.recurrenceType === 'annual' ? 'border-indigo-500 bg-white' : 'border-transparent bg-slate-100/50'}`}><input type="radio" className="hidden" checked={formData.recurrenceType === 'annual'} onChange={() => setRecurrenceType('annual')} /><span className="flex-1 text-sm font-bold text-slate-800">RecorrÃªncia Anual</span><Repeat size={16} className="text-indigo-500" /></label>
            </div>
            {formData.recurrenceType !== 'specific' && (
              <div className="grid grid-cols-1 gap-4 rounded-xl border border-slate-200 bg-white p-4 md:grid-cols-2">
                <input type="date" disabled={!canEditBillDate && !!initialData && formData.recurrenceType === 'none'} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 outline-none focus:ring-2 focus:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-60" value={formData.dueDate || ''} onChange={(e) => setFormData({ ...formData, dueDate: e.target.value })} />
                {formData.recurrenceType === 'monthly' ? (
                  <input type="number" min="1" max="24" className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 outline-none focus:ring-2 focus:ring-indigo-500" value={formData.totalInstallments || 12} onChange={(e) => setFormData({ ...formData, totalInstallments: parseInt(e.target.value, 10) || 12 })} />
                ) : (
                  <input type="text" inputMode="decimal" className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 outline-none focus:ring-2 focus:ring-indigo-500" value={formData.amountInput || ''} onChange={(e) => setFormData({ ...formData, amountInput: e.target.value, amount: parseCurrencyInput(e.target.value) })} placeholder="Valor" />
                )}
                {formData.recurrenceType === 'monthly' && <input type="text" inputMode="decimal" className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 outline-none focus:ring-2 focus:ring-indigo-500 md:col-span-2" value={formData.amountInput || ''} onChange={(e) => setFormData({ ...formData, amountInput: e.target.value, amount: parseCurrencyInput(e.target.value) })} placeholder="Valor mensal" />}
              </div>
            )}
            {formData.recurrenceType === 'specific' && (
              <div className="space-y-3">
                {/* ─── Distribuidor automático ─── */}
                <div className="rounded-2xl border border-indigo-200 bg-indigo-50 p-4 space-y-3">
                  <p className="text-xs font-bold uppercase tracking-wider text-indigo-700">Distribuir automaticamente</p>
                  <p className="text-xs text-indigo-600">Informe o valor total, a quantidade de boletos e a data do 1º vencimento. Os valores serão divididos igualmente, mês a mês.</p>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-indigo-700">Valor total</label>
                      <input
                        type="text"
                        inputMode="decimal"
                        className="w-full rounded-xl border border-indigo-200 bg-white px-4 py-2.5 font-semibold text-indigo-800 outline-none focus:ring-2 focus:ring-indigo-500"
                        placeholder="Ex: 1.000,00"
                        value={splitHelper.totalInput}
                        onChange={(e) => setSplitHelper((prev) => ({ ...prev, totalInput: e.target.value }))}
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-indigo-700">Quantidade de boletos</label>
                      <input
                        type="number"
                        min="1"
                        max="60"
                        className="w-full rounded-xl border border-indigo-200 bg-white px-4 py-2.5 outline-none focus:ring-2 focus:ring-indigo-500"
                        value={splitHelper.count}
                        onChange={(e) => setSplitHelper((prev) => ({ ...prev, count: Math.max(1, parseInt(e.target.value, 10) || 1) }))}
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-indigo-700">Data do 1º vencimento</label>
                      <input
                        type="date"
                        className="w-full rounded-xl border border-indigo-200 bg-white px-4 py-2.5 outline-none focus:ring-2 focus:ring-indigo-500"
                        value={splitHelper.firstDate}
                        onChange={(e) => setSplitHelper((prev) => ({ ...prev, firstDate: e.target.value }))}
                      />
                    </div>
                  </div>
                  <button
                    type="button"
                    className="flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-indigo-700 active:scale-95 transition-all"
                    onClick={() => {
                      const total = parseCurrencyInput(splitHelper.totalInput);
                      if (!total || total <= 0 || !splitHelper.firstDate) return;
                      const count = Math.max(1, splitHelper.count);
                      const perItem = Math.round((total / count) * 100) / 100;
                      const remainder = Math.round((total - perItem * count) * 100) / 100;
                      const [y, m, d] = splitHelper.firstDate.split('-').map(Number);
                      const newDues: DueDraft[] = Array.from({ length: count }, (_, i) => {
                        const date = new Date(y, m - 1 + i, d);
                        const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
                        const amt = i === count - 1 ? Math.round((perItem + remainder) * 100) / 100 : perItem;
                        return { date: dateStr, amount: amt, amountInput: formatCurrencyInput(amt), line: '' };
                      });
                      setDueDrafts(newDues);
                    }}
                  >
                    Distribuir {splitHelper.count}x de {splitHelper.totalInput ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(parseCurrencyInput(splitHelper.totalInput) / Math.max(1, splitHelper.count)) : 'R$ 0,00'}
                  </button>
                </div>
                {/* ─── Lista de parcelas ─── */}
                {dueDrafts.map((due, index) => (
                  <div key={`due-${index}`} className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
                    <div className="flex items-center justify-between"><div><p className="text-xs font-bold uppercase tracking-wider text-slate-400">Parcela {index + 1}</p><p className="text-xs text-slate-500">A mesma NF aparece em todas as parcelas.</p></div><button type="button" onClick={() => setDueDrafts((prev) => prev.length <= 1 ? prev : prev.filter((_, i) => i !== index))} className="rounded-lg p-2 text-slate-300 hover:bg-rose-50 hover:text-rose-500"><Trash2 size={14} /></button></div>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      <input type="date" className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 outline-none focus:ring-2 focus:ring-indigo-500" value={due.date} onChange={(e) => setDueDrafts((prev) => prev.map((item, i) => i === index ? { ...item, date: e.target.value } : item))} />
                      <input type="text" inputMode="decimal" className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 font-semibold text-indigo-700 outline-none focus:ring-2 focus:ring-indigo-500" value={due.amountInput} onChange={(e) => setDueDrafts((prev) => prev.map((item, i) => i === index ? { ...item, amountInput: e.target.value, amount: parseCurrencyInput(e.target.value) } : item))} placeholder="Valor" />
                    </div>
                    <div className="flex flex-wrap items-center gap-2">{invoiceFiles.filter((att) => att.url).map((att, idx) => (<a key={idx} href={att.url} target="_blank" rel="noreferrer" className="rounded-full bg-indigo-50 px-3 py-1 text-[11px] font-bold text-indigo-600">{invoiceFiles.length > 1 ? `NF ${idx + 1}` : 'Ver NF'}</a>))}<span className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-semibold text-slate-600">Boleto individual por parcela</span></div>
                    <label className="flex cursor-pointer items-center gap-3 rounded-xl border-2 border-dashed border-slate-200 bg-slate-50 p-3 hover:border-indigo-300"><input type="file" accept="application/pdf,image/jpeg,image/png" className="hidden" onChange={(e) => void handleDueBoletoFile(index, e)} disabled={isUploading} /><Upload size={18} className="text-indigo-600" /><span className="text-sm font-semibold text-slate-700">{due.attachment ? 'Trocar boleto' : 'Anexar boleto'}</span></label>
                    {due.attachment && <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3"><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-slate-800">{due.attachment.name}</p><p className="text-xs text-slate-500">{formatFileSize(due.attachment.size)}</p></div>{due.attachment.url && <a href={due.attachment.url} target="_blank" rel="noreferrer" className="text-xs font-semibold text-indigo-600">Abrir</a>}</div>}
                    <input className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 font-mono text-sm outline-none focus:ring-2 focus:ring-indigo-500" value={due.line} onChange={(e) => setDueDrafts((prev) => prev.map((item, i) => i === index ? { ...item, line: normalizeBoletoCode(e.target.value), source: e.target.value ? 'manual' : undefined } : item))} placeholder="NÃºmero do boleto" />
                    <p className="text-xs text-slate-500">{due.extracting ? 'Extraindo do arquivo...' : due.message || 'Campo editÃ¡vel para ajuste manual.'}</p>
                  </div>
                ))}
                <button type="button" onClick={() => setDueDrafts((prev) => [...prev, { date: today(), amount: 0, amountInput: '', line: '' }])} className="flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-200 py-2 text-sm font-medium text-slate-400 hover:border-indigo-300 hover:text-indigo-500"><Plus size={16} /> Adicionar Vencimento</button>
              </div>
            )}
          </div>

          {allowsSingleInstallmentDetails && (
            <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Boleto deste vencimento</p>
              {isEditingRecurring && formData.recurrenceType !== 'none' && (
                <p className="text-xs text-slate-500">DisponÃ­vel porque vocÃª estÃ¡ editando somente esta parcela.</p>
              )}
              <label className="flex cursor-pointer items-center gap-3 rounded-xl border-2 border-dashed border-slate-200 bg-white p-4 hover:border-indigo-300"><input type="file" accept="application/pdf,image/jpeg,image/png" className="hidden" onChange={(e) => void handleSingleBoletoFile(e)} disabled={isUploading} /><Upload size={18} className="text-indigo-600" /><span className="text-sm font-semibold text-slate-700">{singleBoleto.attachment ? 'Trocar boleto' : 'Anexar boleto'}</span></label>
              {singleBoleto.attachment && <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3"><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-slate-800">{singleBoleto.attachment.name}</p><p className="text-xs text-slate-500">{formatFileSize(singleBoleto.attachment.size)}</p></div>{singleBoleto.attachment.url && <a href={singleBoleto.attachment.url} target="_blank" rel="noreferrer" className="text-xs font-semibold text-indigo-600">Abrir</a>}<button type="button" onClick={() => setSingleBoleto({ line: '', attachment: undefined })} className="rounded-lg p-2 text-slate-300 hover:bg-rose-50 hover:text-rose-500"><Trash2 size={14} /></button></div>}
              <input className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 font-mono text-sm outline-none focus:ring-2 focus:ring-indigo-500" value={singleBoleto.line} onChange={(e) => setSingleBoleto((prev) => ({ ...prev, line: normalizeBoletoCode(e.target.value), source: e.target.value ? 'manual' : undefined }))} placeholder="NÃºmero do boleto" />
              <p className="text-xs text-slate-500">{singleBoleto.extracting ? 'Extraindo do arquivo...' : singleBoleto.message || 'Campo editÃ¡vel para ajuste manual.'}</p>
            </div>
          )}
          {attachmentError && <p className="text-xs font-semibold text-rose-600">{attachmentError}</p>}

          {allowsSingleInstallmentDetails && (
            <div className="space-y-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
              <div className="flex items-center justify-between">
                <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-emerald-700">
                  <Check size={14} /> Informações de Pagamento
                </p>
                <label className="flex items-center gap-2 text-xs font-bold text-slate-600">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-2 border-emerald-400 accent-emerald-500"
                    checked={isPaid}
                    onChange={(e) => !e.target.checked
                        ? setFormData({
                          ...formData,
                          status: BillStatus.PENDING,
                          bankMatches: undefined,
                          paidDate: undefined,
                          paidAmount: undefined,
                          paidAmountInput: '',
                          interestAmount: undefined,
                          paymentSource: undefined,
                          paymentBankTransactionId: undefined,
                          paymentBankReference: undefined,
                          paymentBankDescription: undefined,
                          paymentBankDocument: undefined,
                        })
                      : setFormData({ ...formData, status: BillStatus.PAID, paymentSource: formData.paymentSource || 'manual' })}
                  />
                  Conta já foi paga
                </label>
              </div>
              {isPaid && (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
                    {isBankPayment ? (
                      <span className="rounded-full bg-blue-100 px-3 py-1 text-blue-700">Origem bancária</span>
                    ) : (
                      <span className="rounded-full bg-emerald-100 px-3 py-1 text-emerald-700">Origem manual</span>
                    )}
                    {isBankPayment && formData.paymentBankReference && (
                      <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-600">Ref: {formData.paymentBankReference}</span>
                    )}
                  </div>
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    <input
                      type="date"
                      disabled={isBankPayment}
                      className="rounded-xl border border-emerald-200 bg-white px-4 py-2 outline-none focus:ring-2 focus:ring-emerald-500 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"
                      value={formData.paidDate || ''}
                      onChange={(e) => setFormData({
                        ...formData,
                        bankMatches: undefined,
                        paidDate: e.target.value || undefined,
                        status: e.target.value ? BillStatus.PAID : BillStatus.PENDING,
                        paymentSource: e.target.value ? 'manual' : undefined,
                        paymentBankTransactionId: undefined,
                        paymentBankReference: undefined,
                        paymentBankDescription: undefined,
                        paymentBankDocument: undefined,
                      })}
                    />
                    <input
                      type="text"
                      inputMode="decimal"
                      disabled={isBankPayment}
                      className="rounded-xl border border-emerald-200 bg-white px-4 py-2 outline-none focus:ring-2 focus:ring-emerald-500 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"
                      value={formData.paidAmountInput || ''}
                      onChange={(e) => {
                        const raw = e.target.value.trim();
                        const paidAmount = raw ? parseCurrencyInput(raw) : undefined;
                        setFormData({
                          ...formData,
                          bankMatches: undefined,
                          paidAmountInput: raw,
                          paidAmount,
                          interestAmount: paidAmount !== undefined && formData.amount ? paidAmount - formData.amount : undefined,
                          paymentSource: raw || formData.paidDate ? 'manual' : undefined,
                          paymentBankTransactionId: undefined,
                          paymentBankReference: undefined,
                          paymentBankDescription: undefined,
                          paymentBankDocument: undefined,
                        });
                      }}
                      placeholder="Valor pago"
                    />
                  </div>
                  <p className="text-xs text-emerald-700">
                    {isBankPayment
                      ? 'Este realizado veio do banco e deve ser alterado pela conciliação, não manualmente.'
                      : 'Quando houver conciliação bancária, estes campos poderão ser preenchidos automaticamente pelo extrato.'}
                  </p>
                </div>
              )}
            </div>
          )}

          <div className="sticky bottom-0 flex gap-3 bg-white pb-2 pt-4">
            <button type="button" onClick={onClose} disabled={isUploading} className="flex-1 rounded-xl border border-slate-200 px-4 py-3 font-medium text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60">Cancelar</button>
            <button type="button" onClick={handleSubmit} disabled={isUploading} className="flex-1 rounded-xl bg-indigo-600 px-4 py-3 font-bold text-white shadow-lg shadow-indigo-200 hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60">{isUploading ? 'Enviando anexos...' : formData.recurrenceType === 'specific' ? 'Salvar Nota e Vencimentos' : 'Confirmar LanÃ§amento'}</button>
          </div>
        </form>
      </div>
    </div>
  );
};
