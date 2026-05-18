
export enum BillStatus {
  PENDING = 'Pendente',
  PAID = 'Pago',
  OVERDUE = 'Atrasado'
}

export type RecurrenceType = 'none' | 'monthly' | 'annual' | 'installments' | 'custom' | 'specific';

export enum UserRole {
  ADMIN = 'ADMIN',
  EDITOR = 'EDITOR',
  VIEWER = 'VIEWER'
}

export type ModuleAccess = 'none' | 'viewer' | 'editor';

export interface ModulePermissions {
  dashboard: ModuleAccess;
  bills: ModuleAccess;
  suppliers: ModuleAccess;
  accounts: ModuleAccess;
  team: ModuleAccess;
  profile: ModuleAccess;
  dre: ModuleAccess;
  cashbox: ModuleAccess;
  'cashbox-report'?: ModuleAccess;
  reconciliation?: ModuleAccess;
  'bills_reconciliation'?: ModuleAccess;
  // Capacidades de ação (mantidas como boolean)
  canEditBillDate?: boolean;
  canCreateSupplier?: boolean;
  canEditCashBoxStatus?: boolean;
  canLaunchCaixa?: boolean;
}

export type AccountType = 'FIXED' | 'VARIABLE';

export type DreCategory =
  | 'PRODUCT_COST' // Aba 2: PRODUTOS
  | 'COMMISSION' // Aba 1: COMISSOES
  | 'FIXED_SALARY' // Aba 3: SAL_FIXO
  | 'FIXED_EXPENSES' // Aba 5: DESP.FIXAS
  | 'VARIABLE_EXPENSES' // Aba: DESP.VARIAVEIS
  | 'PRO_LABORE' // Aba: PROLABORE
  | 'REVENUE'; // Receita Bruta

export interface ChartOfAccount {
  id: string;
  name: string;
  description?: string;
  type?: AccountType;
  category: DreCategory;
}

export interface Revenue {
  id: string;
  date: string; // YYYY-MM-DD
  amount: number;
  description?: string;
  isEstimate?: boolean;
}

export interface Supplier {
  id: string;
  name: string;
  taxId: string;
  email: string;
  phone?: string;
  contactPerson?: string;
  accountId: string;
}

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  phone?: string;
  role: UserRole;
  active: boolean;
  permissions: ModulePermissions;
  categoryPermissions?: string[]; // IDs das categorias que pode acessar
  inviteSent?: boolean; // Indica se o convite já foi enviado
  inviteSentDate?: string; // Data do envio do convite
}

export interface Company {
  name: string;
  taxId: string;
  email: string;
  phone: string;
  address: string;
}

export interface BillAttachment {
  id: string;
  name: string;
  contentType: string;
  size: number;
  url: string;
  order: number;
  uploadedAt: string;
  uploadedBy?: string;
  storagePath?: string;
}

export type BoletoExtractionSource = 'manual' | 'filename' | 'pdf_text';

export interface BillInvoice {
  number?: string;
  series?: string;
  issueDate?: string;
  totalAmount?: number;
  attachment?: BillAttachment;
  attachments?: BillAttachment[];
}

export interface BillDue {
  date: string;
  amount: number;
  boletoLine?: string;
  boletoAttachment?: BillAttachment;
  boletoExtractionSource?: BoletoExtractionSource;
}

export interface BillBankMatch {
  transactionId: string;
  date: string;
  amount: number;
  reference?: string;
  description?: string;
  document?: string;
  counterparty?: string;
  reconciledAt?: string;
  reconciledBy?: string;
}

export interface Bill {
  id: string;
  supplierId: string;
  description: string;
  amount: number;
  dueDate: string;
  isDeleted?: boolean;
  deletedAt?: string;
  deletedBy?: string;
  paymentSource?: 'manual' | 'bank'; // Origem do realizado
  paymentBankTransactionId?: string; // ID da transacao conciliada no banco
  paymentBankReference?: string; // Referencia bancaria
  paymentBankDescription?: string; // Historico bancario
  paymentBankDocument?: string; // Documento do favorecido/fornecedor no extrato
  bankMatches?: BillBankMatch[];
  paidDate?: string; // Data de pagamento - quando preenchida, conta é considerada paga
  paidAmount?: number; // Valor efetivamente pago (pode incluir juros/multas ou descontos)
  interestAmount?: number; // Diferença entre valor pago e valor da conta (juros/multas ou descontos)
  romaneioWeek?: string; // Data do sábado da semana do romaneio (YYYY-MM-DD)
  observations?: string; // Campo de observações/anotações
  status: BillStatus;
  recurrenceType: RecurrenceType;
  totalInstallments?: number;
  currentInstallment?: number;
  accountId: string;
  parentId?: string;
  selectedMonths?: number[];
  specificDues?: BillDue[];
  isEstimate?: boolean;
  launchedBy?: string; // Email/Login do usuário que lançou a conta
  invoice?: BillInvoice;
  boletoLine?: string;
  boletoAttachment?: BillAttachment;
  boletoExtractionSource?: BoletoExtractionSource;
  attachments?: BillAttachment[];
}

export interface FilterOptions {
  startDate: string;
  endDate: string;
  status?: string;
  supplierId?: string;
}

export type CashBoxStatus = 'pending' | 'ok' | 'warning' | 'error' | 'sem_movimento';

export interface CashBoxEntry {
  date: string; // YYYY-MM-DD
  din: number;
  rede: number;
  frog: number;
  pagSeg: number;
  inter: number;
  status: CashBoxStatus;
  observations?: string;
  validatedBy?: string; // Email do ADM que validou
  validatedAt?: string; // Timestamp da validação
  isWeekendOrHoliday?: boolean;
}

export interface CashBoxData {
  id: string;
  date: string; // YYYY-MM-DD
  dinTotal: number;
  redeTotal: number;
  frogTotal: number;
  pagSegTotal: number;
  interTotal: number;
  grandTotal: number;
  informedTotal?: number; // Valor total informado do caixa físico
  status: CashBoxStatus; // 'pending', 'ok', 'warning', 'error'
  observations: string;
  createdBy: string;
  createdAt: string;
  validatedBy?: string; // Email do ADM
  validatedAt?: string;
  isWeekendOrHoliday: boolean;
  methodStatuses?: Record<string, 'ok' | 'pending' | 'warning' | 'error' | 'sem_movimento'>; // Status por forma de pagamento
  interBankTotal?: number; // Valor que veio do extrato bancário
  interBankTransactions?: BankTransaction[]; // Detalhes das transações PIX
  interReconciled?: boolean; // Se foi conferido com o banco
  interReconciledAt?: string; // Quando foi conferido
  interReconciledBy?: string; // Quem conferiu
}

export interface PaymentMethod {
  id: string;
  name: string;
  order: number;
  enabled: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface BankTransaction {
  id: string;
  date: string; // YYYY-MM-DD
  time?: string; // HH:MM
  type: 'CREDIT' | 'DEBIT';
  amount: number;
  description: string;
  counterparty?: string; // Favorecido/fornecedor/cliente
  reference?: string; // ID da transação no banco
  document?: string; // CNPJ/CPF se houver
  reconciled: boolean;
  reconciledWith?: string; // ID da conta/caixa que foi conciliada
  reconciledType?: 'bill' | 'cashbox' | 'manual';
  reconciledAt?: string;
  reconciledBy?: string;
}

export interface BankReconciliation {
  id: string;
  uploadedAt: string;
  uploadedBy: string;
  fileName: string;
  bankName: string; // Ex: "Banco Inter"
  accountNumber: string;
  startDate: string;
  endDate: string;
  initialBalance: number;
  finalBalance: number;
  totalTransactions: number;
  reconciledTransactions: number;
  transactions: BankTransaction[];
  status: 'pending' | 'partial' | 'complete';
}

export interface BillReconciliationMatch {
  id: string; // unique ID para este match
  bankTransaction: BankTransaction; // Débito do extrato
  billId?: string; // ID da Bill matched (pode ser undefined antes de confirmar)
  matchType: 'auto' | 'manual' | 'none'; // auto = matched automaticamente, manual = user confirmou, none = débito sem Bill
  matchScore?: number; // 0-100: confiança do match automático
  confirmedAt?: string;
  confirmedBy?: string;
  notes?: string;
}

export interface BillsReconciliation {
  id: string;
  uploadedAt: string;
  uploadedBy: string;
  fileName: string;
  bankName: string;
  accountNumber: string;
  startDate: string;
  endDate: string;
  debitTransactions: BankTransaction[]; // Apenas débitos
  matches: BillReconciliationMatch[]; // Matches entre débitos e Bills
  totalDebits: number;
  totalMatched: number;
  status: 'pending' | 'partial' | 'complete';
}


