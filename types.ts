
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
  status: BillStatus;
  recurrenceType: RecurrenceType;
  totalInstallments?: number;
  currentInstallment?: number;
  accountId: string;
  parentId?: string;
  selectedMonths?: number[];
  specificDues?: { date: string, amount: number }[];
  isEstimate?: boolean;
}

export interface FilterOptions {
  startDate: string;
  endDate: string;
  status?: string;
  supplierId?: string;
}
