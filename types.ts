
export enum BillStatus {
  PENDING = 'Pendente',
  PAID = 'Pago',
  OVERDUE = 'Atrasado'
}

export type RecurrenceType = 'none' | 'monthly' | 'installments' | 'custom' | 'specific';

export enum UserRole {
  ADMIN = 'ADMIN',
  EDITOR = 'EDITOR',
  VIEWER = 'VIEWER'
}

export interface ModulePermissions {
  dashboard: boolean;
  bills: boolean;
  suppliers: boolean;
  accounts: boolean;
  team: boolean;
  profile: boolean;
  dre: boolean;
  cashbox: boolean;
  reconciliation?: boolean; // Conciliação Bancária
  canEditBillDate?: boolean;
  canCreateSupplier?: boolean;
  canEditCashBoxStatus?: boolean;
}

export type AccountType = 'FIXED' | 'VARIABLE';

export type DreCategory = 
  | 'PRODUCT_COST'     // Aba 2: PRODUTOS
  | 'COMMISSION'       // Aba 1: COMISSOES
  | 'FIXED_SALARY'     // Aba 3: SAL_FIXO
  | 'FIXED_EXPENSES'   // Aba 5: DESP.FIXAS
  | 'VARIABLE_EXPENSES' // Aba: DESP.VARIAVEIS
  | 'PRO_LABORE'       // Aba: PROLABORE
  | 'REVENUE';         // Receita Bruta

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

export interface Bill {
  id: string;
  supplierId: string;
  description: string;
  amount: number;
  dueDate: string;
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
  specificDues?: { date: string, amount: number }[];
  isEstimate?: boolean;
  launchedBy?: string; // Email/Login do usuário que lançou a conta
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
  // Dados da Conciliação Bancária
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

// Conciliação Bancária
export interface BankTransaction {
  id: string;
  date: string; // YYYY-MM-DD
  time?: string; // HH:MM
  type: 'CREDIT' | 'DEBIT';
  amount: number;
  description: string;
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
