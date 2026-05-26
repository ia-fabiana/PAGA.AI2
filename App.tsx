
import React, { useState, useEffect, useRef } from 'react';
import { Layout } from './Layout';
import { Dashboard } from './Dashboard';
import { BillList } from './BillList';
import { SupplierList } from './SupplierList';
import { BillForm } from './BillForm';
import { SupplierForm } from './SupplierForm';
import { TeamManagement } from './TeamManagement';
import { CompanyProfile } from './CompanyProfile';
import { AccountManagement } from './AccountManagement';
import { DRE } from './DRE';
import { CashBox } from './CashBox';
import { CashBoxReport } from './CashBoxReport';
import { BankReconciliationComponent } from './BankReconciliationComponent';
import { TrinksReconciliation } from './TrinksReconciliation';
import { CaixaPequeno } from './CaixaPequeno';

import { Login } from './Login';
import { auth, db, isMockMode } from './firebase';
import { BankTransaction, Bill, BillBankMatch, Supplier, BillStatus, UserRole, TeamMember, Company, ChartOfAccount, Revenue, RecurrenceType, ModulePermissions, CaixaPequenoConfig } from './types';
import { collection, doc, onSnapshot, setDoc, deleteDoc, updateDoc, writeBatch, getDocs, getDoc } from 'firebase/firestore';
import { Loader2 } from 'lucide-react';
import { doesBankMatchTransaction, getBillBankMatches, getBillBankPaidAmount, getBillLastBankPaymentDate } from './billPaymentUtils';

const SHARED_WORKSPACE_ID = 'paga-ai2-shared';

const App: React.FC = () => {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'dashboard' | 'bills' | 'suppliers' | 'revenues' | 'team' | 'profile' | 'accounts' | 'dre' | 'cashbox' | 'cashbox-report' | 'cashbox-entry' | 'reconciliation' | 'caixa-pequeno'>('dashboard');
  
  const [bills, setBills] = useState<Bill[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [accounts, setAccounts] = useState<ChartOfAccount[]>([]);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [revenues, setRevenues] = useState<Revenue[]>([]);
  const [firestoreError, setFirestoreError] = useState<string>('');
  const defaultCompany: Company = { name: 'Unidade Vila Leopoldina', taxId: '', email: '', phone: '', address: '' };
  const [company, setCompany] = useState<Company>(defaultCompany);
  const [caixaPequenoConfig, setCaixaPequenoConfig] = useState<CaixaPequenoConfig>({ saldoInicial: 0, saldoInicialData: '2026-01-01' });

  const [showBillForm, setShowBillForm] = useState(false);
  const [editingBill, setEditingBill] = useState<Bill | undefined>(undefined);
  const [showSupplierForm, setShowSupplierForm] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | undefined>(undefined);

  const seededAccountsRef = useRef(false);
  const seededCompanyRef = useRef(false);
  const seededRecurringBillsRef = useRef(false);
  const seededPaidBillsRef = useRef(false);
  const seededSuppliersRef = useRef(false);
  const seededImportedBillsRef = useRef(false);
  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth();

  const getSharedBillsRef = () => collection(db, 'workspaces', SHARED_WORKSPACE_ID, 'bills');
  const getSharedSuppliersRef = () => collection(db, 'workspaces', SHARED_WORKSPACE_ID, 'suppliers');
  const getSharedAccountsRef = () => collection(db, 'workspaces', SHARED_WORKSPACE_ID, 'accounts');
  const getSharedRevenuesRef = () => collection(db, 'workspaces', SHARED_WORKSPACE_ID, 'revenues');
  const getSharedTeamRef = () => collection(db, 'workspaces', SHARED_WORKSPACE_ID, 'team');
  const getSharedCompanyRef = () => doc(db, 'workspaces', SHARED_WORKSPACE_ID, 'meta', 'company');
  const getSharedSettingsRef = () => doc(db, 'workspaces', SHARED_WORKSPACE_ID, 'meta', 'settings');
  const getSharedAccessRef = () => doc(db, 'workspaces', SHARED_WORKSPACE_ID, 'meta', 'access');
  const getSharedCaixaPequenoRef = () => doc(db, 'workspaces', SHARED_WORKSPACE_ID, 'meta', 'caixaPequeno');

  const LED10_ACCOUNT_ID = '22';

  const normalizeSupplierName = (value: string) =>
    value
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]/g, '');

  const choosePreferredSupplierValue = <K extends keyof Supplier>(records: Supplier[], field: K) => {
    for (const record of records) {
      const value = record[field];
      if (typeof value === 'string' && value.trim()) {
        return value;
      }
    }
    return records[0]?.[field];
  };

  const consolidateLed10Supplier = (currentSuppliers: Supplier[], currentBills: Bill[]) => {
    const led10Suppliers = currentSuppliers.filter((supplier) => normalizeSupplierName(supplier.name) === 'led10');

    if (led10Suppliers.length === 0) {
      return {
        suppliers: currentSuppliers,
        bills: currentBills,
        changed: false,
        removedSupplierIds: [] as string[],
        updatedBills: [] as Bill[],
      };
    }

    const supplierScore = (supplier: Supplier) => {
      let score = 0;
      if (supplier.taxId.trim()) score += 2;
      if (supplier.email.trim()) score += 2;
      if (supplier.phone?.trim()) score += 1;
      if (supplier.contactPerson?.trim()) score += 1;
      if (supplier.accountId === LED10_ACCOUNT_ID) score += 1;
      return score;
    };

    const canonicalSupplier = [...led10Suppliers].sort((left, right) => supplierScore(right) - supplierScore(left))[0];
    const mergedSupplier: Supplier = {
      ...canonicalSupplier,
      name: 'LED10',
      taxId: choosePreferredSupplierValue(led10Suppliers, 'taxId') || '',
      email: choosePreferredSupplierValue(led10Suppliers, 'email') || '',
      phone: choosePreferredSupplierValue(led10Suppliers, 'phone'),
      contactPerson: choosePreferredSupplierValue(led10Suppliers, 'contactPerson'),
      accountId: LED10_ACCOUNT_ID,
    };

    const removedSupplierIds = led10Suppliers
      .filter((supplier) => supplier.id !== canonicalSupplier.id)
      .map((supplier) => supplier.id);

    let billsChanged = false;
    const updatedBills = currentBills.reduce<Bill[]>((acc, bill) => {
      if (!removedSupplierIds.includes(bill.supplierId)) return acc;
      billsChanged = true;
      acc.push({ ...bill, supplierId: canonicalSupplier.id });
      return acc;
    }, []);

    const nextBills = billsChanged
      ? currentBills.map((bill) => {
          if (!removedSupplierIds.includes(bill.supplierId)) return bill;
          return { ...bill, supplierId: canonicalSupplier.id };
        })
      : currentBills;

    const nextSuppliers = currentSuppliers
      .filter((supplier) => !removedSupplierIds.includes(supplier.id))
      .map((supplier) => (supplier.id === canonicalSupplier.id ? mergedSupplier : supplier));

    const supplierChanged =
      removedSupplierIds.length > 0 ||
      canonicalSupplier.name !== mergedSupplier.name ||
      canonicalSupplier.accountId !== mergedSupplier.accountId ||
      canonicalSupplier.taxId !== mergedSupplier.taxId ||
      canonicalSupplier.email !== mergedSupplier.email ||
      canonicalSupplier.phone !== mergedSupplier.phone ||
      canonicalSupplier.contactPerson !== mergedSupplier.contactPerson;

    return {
      suppliers: nextSuppliers,
      bills: nextBills,
      changed: supplierChanged || billsChanged,
      removedSupplierIds,
      updatedBills,
    };
  };

  const coerceNumber = (value: unknown): number | undefined => {
    if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) return undefined;
      const normalized = trimmed.replace(/\./g, '').replace(',', '.');
      const parsed = Number(normalized);
      return Number.isFinite(parsed) ? parsed : undefined;
    }
    return undefined;
  };

  const normalizeBillNumbers = (bill: Bill): Bill => {
    const normalizedAmount = coerceNumber(bill.amount);
    const normalizedPaidAmount = coerceNumber(bill.paidAmount);
    const normalizedInterestAmount = coerceNumber(bill.interestAmount);
    const normalizedBankMatches = bill.bankMatches?.map((match) => ({
      ...match,
      amount: coerceNumber(match.amount) ?? 0,
    }));
    const normalizedSpecificDues = bill.specificDues?.map((due) => ({
      ...due,
      amount: coerceNumber(due.amount) ?? 0,
    }));

    return {
      ...bill,
      amount: normalizedAmount ?? (typeof bill.amount === 'number' ? bill.amount : 0),
      paidAmount: normalizedPaidAmount ?? (typeof bill.paidAmount === 'number' ? bill.paidAmount : undefined),
      interestAmount: normalizedInterestAmount ?? (typeof bill.interestAmount === 'number' ? bill.interestAmount : undefined),
      bankMatches: normalizedBankMatches,
      invoice: bill.invoice
        ? {
            ...bill.invoice,
            totalAmount: coerceNumber(bill.invoice.totalAmount),
          }
        : bill.invoice,
      specificDues: normalizedSpecificDues,
    };
  };

  const normalizeBillDates = (bill: Bill): Bill => {
    const normalizeDate = (value?: string) => {
      if (!value) return value;
      if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
      if (/^\d{2}\/\d{2}\/\d{4}$/.test(value)) {
        const [day, month, year] = value.split('/');
        return `${year}-${month}-${day}`;
      }
      const isoMatch = value.match(/^(\d{4}-\d{2}-\d{2})[T\s]/);
      if (isoMatch) {
        return isoMatch[1];
      }
      return value;
    };

    return {
      ...bill,
      dueDate: normalizeDate(bill.dueDate) || bill.dueDate,
      paidDate: normalizeDate(bill.paidDate) || bill.paidDate,
      bankMatches: bill.bankMatches?.map((match) => ({
        ...match,
        date: normalizeDate(match.date) || match.date,
      })),
      invoice: bill.invoice
        ? {
            ...bill.invoice,
            issueDate: normalizeDate(bill.invoice.issueDate) || bill.invoice.issueDate,
          }
        : bill.invoice,
      specificDues: bill.specificDues?.map((due) => ({
        ...due,
        date: normalizeDate(due.date) || due.date,
      })),
    };
  };

  const normalizeBillPaymentSource = (bill: Bill): Bill => {
    const migratedBankMatches = bill.bankMatches?.length
      ? bill.bankMatches
      : bill.paymentSource === 'bank' && bill.paymentBankTransactionId
        ? [{
            transactionId: bill.paymentBankTransactionId,
            date: bill.paidDate || bill.dueDate,
            amount: bill.paidAmount ?? bill.amount,
            reference: bill.paymentBankReference,
            description: bill.paymentBankDescription,
            document: bill.paymentBankDocument,
          }]
        : [];

    if (migratedBankMatches.length > 0) {
      const paidAmount = getBillBankPaidAmount({ ...bill, bankMatches: migratedBankMatches });
      const latestPaidDate = getBillLastBankPaymentDate({ ...bill, bankMatches: migratedBankMatches });
      const isFullyPaid = paidAmount >= bill.amount - 0.01;

      return {
        ...bill,
        bankMatches: migratedBankMatches,
        paymentSource: 'bank',
        paymentBankTransactionId: migratedBankMatches[migratedBankMatches.length - 1]?.transactionId,
        paymentBankReference: migratedBankMatches[migratedBankMatches.length - 1]?.reference,
        paymentBankDescription: migratedBankMatches[migratedBankMatches.length - 1]?.description,
        paymentBankDocument: migratedBankMatches[migratedBankMatches.length - 1]?.document,
        paidAmount,
        paidDate: isFullyPaid ? latestPaidDate : undefined,
        interestAmount: isFullyPaid ? paidAmount - bill.amount : undefined,
        status: isFullyPaid ? BillStatus.PAID : BillStatus.PENDING,
      };
    }

    const hasPaymentInfo = Boolean(bill.paidDate) || bill.paidAmount !== undefined;

    if (!hasPaymentInfo) {
      return {
        ...bill,
        bankMatches: undefined,
        paymentSource: undefined,
        paymentBankTransactionId: undefined,
        paymentBankReference: undefined,
        paymentBankDescription: undefined,
        paymentBankDocument: undefined,
      };
    }

    return {
      ...bill,
      bankMatches: undefined,
      paymentSource: bill.paymentSource || 'manual',
    };
  };

  // Validar integridade das contas: PAID sem paidDate devem ser PENDING
  const validateBills = (billsToValidate: Bill[]): Bill[] => {
    return billsToValidate.map((bill) => {
      const normalized = normalizeBillPaymentSource(normalizeBillDates(normalizeBillNumbers(bill)));
      if (normalized.status === BillStatus.PAID && !normalized.paidDate) {
        console.warn(`Ã¢Å¡Â Ã¯Â¸Â Conta "${normalized.description}" estava PAID sem Data de Pagamento - revertendo para PENDENTE`);
        return { ...normalized, status: BillStatus.PENDING };
      }
      return normalized;
    });
  };

  const getVisibleBills = (billsToFilter: Bill[]) => billsToFilter.filter((bill) => !bill.isDeleted);

  // Contas recorrentes mensais fixas
  const defaultRecurringBills: Bill[] = [
    { id: 'rec-1', supplierId: '', description: 'LED10', amount: 1264.59, dueDate: '2026-02-01', status: BillStatus.PENDING, recurrenceType: 'monthly', totalInstallments: 12, accountId: '22', isEstimate: true },
    { id: 'rec-2', supplierId: '', description: 'MANOBRISTA - RECORRENTE', amount: 3000.00, dueDate: '2026-02-05', status: BillStatus.PENDING, recurrenceType: 'monthly', totalInstallments: 12, accountId: '19', isEstimate: true },
    { id: 'rec-3', supplierId: '', description: 'VIVO INTERNET COD 899927163920', amount: 149.58, dueDate: '2026-02-08', status: BillStatus.PENDING, recurrenceType: 'monthly', totalInstallments: 12, accountId: '35', isEstimate: true },
    { id: 'rec-4', supplierId: '', description: 'CONTABILIDADE REPRECON', amount: 850.00, dueDate: '2026-02-15', status: BillStatus.PENDING, recurrenceType: 'monthly', totalInstallments: 12, accountId: '8', isEstimate: true },
    { id: 'rec-5', supplierId: '', description: 'CONTBEL - CONTABILIDADE KELLY', amount: 650.00, dueDate: '2026-02-20', status: BillStatus.PENDING, recurrenceType: 'monthly', totalInstallments: 12, accountId: '42', isEstimate: true },
    { id: 'rec-6', supplierId: '', description: 'DAS EQUIPE - MENSAL', amount: 1051.70, dueDate: '2026-02-20', status: BillStatus.PENDING, recurrenceType: 'monthly', totalInstallments: 12, accountId: '43', isEstimate: true },
    { id: 'rec-7', supplierId: '', description: 'ALUGUEL - RGB EMPREED', amount: 17260.86, dueDate: '2026-02-25', status: BillStatus.PENDING, recurrenceType: 'monthly', totalInstallments: 12, accountId: '4', isEstimate: true },
    { id: 'rec-8', supplierId: '21', description: 'FRANQUEADORA - TAXA DE PUBLICIDADE', amount: 1784.81, dueDate: '2026-02-25', status: BillStatus.PENDING, recurrenceType: 'monthly', totalInstallments: 12, accountId: '25', isEstimate: true },
    { id: 'rec-9', supplierId: '', description: 'IPTU - CARLOS WEBER 1048', amount: 1772.62, dueDate: '2026-02-25', status: BillStatus.PENDING, recurrenceType: 'monthly', totalInstallments: 12, accountId: '16', isEstimate: true },
    { id: 'rec-10', supplierId: '', description: 'SABESP - ÃƒÂGUA', amount: 2070.86, dueDate: '2026-02-25', status: BillStatus.PENDING, recurrenceType: 'monthly', totalInstallments: 12, accountId: '2', isEstimate: true },
  ];

  // Contas pagas sÃƒÂ£o adicionadas apenas quando o usuÃƒÂ¡rio marca manualmente com paidDate
  const defaultPaidBills: Bill[] = [
    { id: 'paid-02052026-fabiana', supplierId: '', description: 'FOLHA DE PAGAMENTO DIA 05 - COMISSÃƒâ€¢ES - GESTOR ADMINISTRATIVO - PROLABORE - FABIANA', amount: 13000.00, dueDate: '2026-02-05', paidDate: '2026-02-05', status: BillStatus.PAID, recurrenceType: 'none', accountId: '97', isEstimate: false },
    { id: 'paid-02052026-caio', supplierId: '', description: 'FOLHA DE PAGAMENTO DIA 05 - COMISSÃƒâ€¢ES - GESTOR ADMINISTRATIVO - PROLABORE - CAIO', amount: 13000.00, dueDate: '2026-02-05', paidDate: '2026-02-05', status: BillStatus.PAID, recurrenceType: 'none', accountId: '98', isEstimate: false },
    // LanÃƒÂ§amentos individuais de marÃƒÂ§o a dezembro - NÃƒÆ’O SÃƒÆ’O RECORRENTES, sÃƒÂ£o criados uma ÃƒÂºnica vez
    { id: 'manual-03052026-fabiana', supplierId: '', description: 'FOLHA DE PAGAMENTO DIA 05 - COMISSÃƒâ€¢ES - GESTOR ADMINISTRATIVO - PROLABORE - FABIANA', amount: 13000.00, dueDate: '2026-03-05', status: BillStatus.PENDING, recurrenceType: 'none', accountId: '97', isEstimate: true },
    { id: 'manual-04052026-fabiana', supplierId: '', description: 'FOLHA DE PAGAMENTO DIA 05 - COMISSÃƒâ€¢ES - GESTOR ADMINISTRATIVO - PROLABORE - FABIANA', amount: 13000.00, dueDate: '2026-04-05', status: BillStatus.PENDING, recurrenceType: 'none', accountId: '97', isEstimate: true },
    { id: 'manual-05052026-fabiana', supplierId: '', description: 'FOLHA DE PAGAMENTO DIA 05 - COMISSÃƒâ€¢ES - GESTOR ADMINISTRATIVO - PROLABORE - FABIANA', amount: 13000.00, dueDate: '2026-05-05', status: BillStatus.PENDING, recurrenceType: 'none', accountId: '97', isEstimate: true },
    { id: 'manual-06052026-fabiana', supplierId: '', description: 'FOLHA DE PAGAMENTO DIA 05 - COMISSÃƒâ€¢ES - GESTOR ADMINISTRATIVO - PROLABORE - FABIANA', amount: 13000.00, dueDate: '2026-06-05', status: BillStatus.PENDING, recurrenceType: 'none', accountId: '97', isEstimate: true },
    { id: 'manual-07052026-fabiana', supplierId: '', description: 'FOLHA DE PAGAMENTO DIA 05 - COMISSÃƒâ€¢ES - GESTOR ADMINISTRATIVO - PROLABORE - FABIANA', amount: 13000.00, dueDate: '2026-07-05', status: BillStatus.PENDING, recurrenceType: 'none', accountId: '97', isEstimate: true },
    { id: 'manual-08052026-fabiana', supplierId: '', description: 'FOLHA DE PAGAMENTO DIA 05 - COMISSÃƒâ€¢ES - GESTOR ADMINISTRATIVO - PROLABORE - FABIANA', amount: 13000.00, dueDate: '2026-08-05', status: BillStatus.PENDING, recurrenceType: 'none', accountId: '97', isEstimate: true },
    { id: 'manual-09052026-fabiana', supplierId: '', description: 'FOLHA DE PAGAMENTO DIA 05 - COMISSÃƒâ€¢ES - GESTOR ADMINISTRATIVO - PROLABORE - FABIANA', amount: 13000.00, dueDate: '2026-09-05', status: BillStatus.PENDING, recurrenceType: 'none', accountId: '97', isEstimate: true },
    { id: 'manual-10052026-fabiana', supplierId: '', description: 'FOLHA DE PAGAMENTO DIA 05 - COMISSÃƒâ€¢ES - GESTOR ADMINISTRATIVO - PROLABORE - FABIANA', amount: 13000.00, dueDate: '2026-10-05', status: BillStatus.PENDING, recurrenceType: 'none', accountId: '97', isEstimate: true },
    { id: 'manual-11052026-fabiana', supplierId: '', description: 'FOLHA DE PAGAMENTO DIA 05 - COMISSÃƒâ€¢ES - GESTOR ADMINISTRATIVO - PROLABORE - FABIANA', amount: 13000.00, dueDate: '2026-11-05', status: BillStatus.PENDING, recurrenceType: 'none', accountId: '97', isEstimate: true },
    { id: 'manual-12052026-fabiana', supplierId: '', description: 'FOLHA DE PAGAMENTO DIA 05 - COMISSÃƒâ€¢ES - GESTOR ADMINISTRATIVO - PROLABORE - FABIANA', amount: 13000.00, dueDate: '2026-12-05', status: BillStatus.PENDING, recurrenceType: 'none', accountId: '97', isEstimate: true },
    { id: 'manual-03052026-caio', supplierId: '', description: 'FOLHA DE PAGAMENTO DIA 05 - COMISSÃƒâ€¢ES - GESTOR ADMINISTRATIVO - PROLABORE - CAIO', amount: 13000.00, dueDate: '2026-03-05', status: BillStatus.PENDING, recurrenceType: 'none', accountId: '98', isEstimate: true },
    { id: 'manual-04052026-caio', supplierId: '', description: 'FOLHA DE PAGAMENTO DIA 05 - COMISSÃƒâ€¢ES - GESTOR ADMINISTRATIVO - PROLABORE - CAIO', amount: 13000.00, dueDate: '2026-04-05', status: BillStatus.PENDING, recurrenceType: 'none', accountId: '98', isEstimate: true },
    { id: 'manual-05052026-caio', supplierId: '', description: 'FOLHA DE PAGAMENTO DIA 05 - COMISSÃƒâ€¢ES - GESTOR ADMINISTRATIVO - PROLABORE - CAIO', amount: 13000.00, dueDate: '2026-05-05', status: BillStatus.PENDING, recurrenceType: 'none', accountId: '98', isEstimate: true },
    { id: 'manual-06052026-caio', supplierId: '', description: 'FOLHA DE PAGAMENTO DIA 05 - COMISSÃƒâ€¢ES - GESTOR ADMINISTRATIVO - PROLABORE - CAIO', amount: 13000.00, dueDate: '2026-06-05', status: BillStatus.PENDING, recurrenceType: 'none', accountId: '98', isEstimate: true },
    { id: 'manual-07052026-caio', supplierId: '', description: 'FOLHA DE PAGAMENTO DIA 05 - COMISSÃƒâ€¢ES - GESTOR ADMINISTRATIVO - PROLABORE - CAIO', amount: 13000.00, dueDate: '2026-07-05', status: BillStatus.PENDING, recurrenceType: 'none', accountId: '98', isEstimate: true },
    { id: 'manual-08052026-caio', supplierId: '', description: 'FOLHA DE PAGAMENTO DIA 05 - COMISSÃƒâ€¢ES - GESTOR ADMINISTRATIVO - PROLABORE - CAIO', amount: 13000.00, dueDate: '2026-08-05', status: BillStatus.PENDING, recurrenceType: 'none', accountId: '98', isEstimate: true },
    { id: 'manual-09052026-caio', supplierId: '', description: 'FOLHA DE PAGAMENTO DIA 05 - COMISSÃƒâ€¢ES - GESTOR ADMINISTRATIVO - PROLABORE - CAIO', amount: 13000.00, dueDate: '2026-09-05', status: BillStatus.PENDING, recurrenceType: 'none', accountId: '98', isEstimate: true },
    { id: 'manual-10052026-caio', supplierId: '', description: 'FOLHA DE PAGAMENTO DIA 05 - COMISSÃƒâ€¢ES - GESTOR ADMINISTRATIVO - PROLABORE - CAIO', amount: 13000.00, dueDate: '2026-10-05', status: BillStatus.PENDING, recurrenceType: 'none', accountId: '98', isEstimate: true },
    { id: 'manual-11052026-caio', supplierId: '', description: 'FOLHA DE PAGAMENTO DIA 05 - COMISSÃƒâ€¢ES - GESTOR ADMINISTRATIVO - PROLABORE - CAIO', amount: 13000.00, dueDate: '2026-11-05', status: BillStatus.PENDING, recurrenceType: 'none', accountId: '98', isEstimate: true },
    { id: 'manual-12052026-caio', supplierId: '', description: 'FOLHA DE PAGAMENTO DIA 05 - COMISSÃƒâ€¢ES - GESTOR ADMINISTRATIVO - PROLABORE - CAIO', amount: 13000.00, dueDate: '2026-12-05', status: BillStatus.PENDING, recurrenceType: 'none', accountId: '98', isEstimate: true },
  ];

  // Limpar dados se ?clear=true na URL
  // Estornar contas pagas se ?revert-paid=true na URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('clear') === 'true') {
      localStorage.clear();
      window.location.href = '/';
    }
    if (params.get('revert-paid') === 'true') {
      try {
        const stored = localStorage.getItem('bills');
        if (stored) {
          const bills = JSON.parse(stored);
          const reverted = bills.map((b: Bill) => 
            b.status === BillStatus.PAID ? { ...b, status: BillStatus.PENDING, paidDate: undefined } : b
          );
          localStorage.setItem('bills', JSON.stringify(reverted));
          console.log(`Ã¢Å“â€¦ ${bills.filter((b: Bill) => b.status === BillStatus.PAID).length} contas estornadas para PENDENTE`);
          window.location.href = '/';
        }
      } catch (e) {
        console.error('Erro ao estornar contas:', e);
      }
    }
  }, []);

  const SUPER_ADMIN_EMAIL = 'fabianajjvsf@gmail.com';
  const normalizeEmail = (value?: string | null) => (value || '').trim().toLowerCase();
  const normalizeUserRole = (value?: string | null): UserRole => {
    const normalized = (value || '').trim().toUpperCase();
    if (normalized === UserRole.ADMIN) return UserRole.ADMIN;
    if (normalized === UserRole.EDITOR) return UserRole.EDITOR;
    if (normalized === UserRole.VIEWER) return UserRole.VIEWER;
    return UserRole.VIEWER;
  };
  const hasAccess = (perm: string | boolean | undefined): boolean => {
    if (perm === undefined || perm === false || perm === 'none') return false;
    return true;
  };
  const isEditor = (perm: string | boolean | undefined): boolean => {
    if (typeof perm === 'boolean') return perm;
    return perm === 'editor';
  };
  const bestAccess = (...perms: (string | boolean | undefined)[]): import('./types').ModuleAccess => {
    if (perms.some(p => p === 'editor' || p === true)) return 'editor';
    if (perms.some(p => p === 'viewer')) return 'viewer';
    return 'none';
  };

  const fullPermissions = {
    dashboard: 'editor' as const,
    bills: 'editor' as const,
    suppliers: 'editor' as const,
    accounts: 'editor' as const,
    team: 'editor' as const,
    profile: 'editor' as const,
    dre: 'editor' as const,
    cashbox: 'editor' as const,
    'cashbox-report': 'editor' as const,
    reconciliation: 'editor' as const,
    'bills_reconciliation': 'editor' as const,
    canEditCashBoxStatus: true,
    canEditBillDate: true,
    canCreateSupplier: true,
    canLaunchCaixa: true,
  };
  const blockedPermissions = {
    dashboard: 'none' as const,
    bills: 'none' as const,
    suppliers: 'none' as const,
    accounts: 'none' as const,
    team: 'none' as const,
    profile: 'none' as const,
    dre: 'none' as const,
    cashbox: 'none' as const,
    'cashbox-report': 'none' as const,
    reconciliation: 'none' as const,
    'bills_reconciliation': 'none' as const,
    canEditCashBoxStatus: false,
    canEditBillDate: false,
    canCreateSupplier: false,
    canLaunchCaixa: false,
  };
  const legacyFullAccessKeys = ['dashboard', 'bills', 'suppliers', 'accounts', 'team', 'profile', 'dre', 'cashbox'] as const;
  const getPermissionScore = (permissions?: Partial<ModulePermissions>) =>
    Object.values(permissions || {}).filter(v => hasAccess(v as string | boolean | undefined)).length;
  const sortTeamMembersByPriority = (members: TeamMember[]) =>
    [...members].sort((a, b) => {
      const activeDelta = Number(b.active !== false) - Number(a.active !== false);
      if (activeDelta !== 0) return activeDelta;

      const roleDelta = Number(normalizeUserRole(b.role) === UserRole.ADMIN) - Number(normalizeUserRole(a.role) === UserRole.ADMIN);
      if (roleDelta !== 0) return roleDelta;

      return getPermissionScore(b.permissions) - getPermissionScore(a.permissions);
    });
  const resolveTeamContextForMembers = (members: TeamMember[]) => {
    const sorted = sortTeamMembersByPriority(members);
    const matchedTeamMember = sorted[0];
    const mergedTeamPermissions = members.reduce<Partial<ModulePermissions>>((acc, member) => {
      Object.entries(member.permissions || {}).forEach(([key, value]) => {
        const current = (acc as Record<string, unknown>)[key];
        if (typeof value === 'boolean') {
          if (value && !current) (acc as Record<string, unknown>)[key] = value;
        } else if (typeof value === 'string' && value !== 'none') {
          if (value === 'editor' || current !== 'editor') {
            (acc as Record<string, unknown>)[key] = value;
          }
        }
      });
      return acc;
    }, {});
    const mergedCategoryPermissions = Array.from(
      new Set(members.flatMap((member) => member.categoryPermissions || []))
    );
    const hasAnyActiveMember = members.some((member) => member.active !== false);
    const resolvedRole = members.some((member) => normalizeUserRole(member.role) === UserRole.ADMIN)
      ? UserRole.ADMIN
      : normalizeUserRole(matchedTeamMember?.role || UserRole.VIEWER);
    const hasLegacyFullAccess = Boolean(
      Object.keys(mergedTeamPermissions).length > 0 &&
      legacyFullAccessKeys.every((key) => hasAccess(mergedTeamPermissions[key] as string | boolean | undefined))
    );
    const permissionBase = hasLegacyFullAccess || resolvedRole === UserRole.ADMIN ? fullPermissions : blockedPermissions;
    const resolvedPermissionsRaw = matchedTeamMember
      ? (!hasAnyActiveMember ? blockedPermissions : { ...permissionBase, ...mergedTeamPermissions })
      : blockedPermissions;
    const resolvedPermissions = {
      ...resolvedPermissionsRaw,
      reconciliation: bestAccess(resolvedPermissionsRaw.reconciliation, resolvedPermissionsRaw['bills_reconciliation']),
      'bills_reconciliation': bestAccess(resolvedPermissionsRaw['bills_reconciliation'], resolvedPermissionsRaw.reconciliation),
    };

    return {
      matchedTeamMember,
      mergedCategoryPermissions,
      hasAnyActiveMember,
      resolvedRole,
      resolvedPermissions,
    };
  };
  const buildWorkspaceAccessMembers = (members: TeamMember[]) => {
    const groupedMembers = members.reduce<Record<string, TeamMember[]>>((acc, member) => {
      const email = normalizeEmail(member.email);
      if (!email) return acc;
      if (!acc[email]) acc[email] = [];
      acc[email].push(member);
      return acc;
    }, {});

    const accessMembers = Object.entries(groupedMembers).reduce<Record<string, {
      active: boolean;
      role: UserRole;
      permissions: ModulePermissions;
    }>>((acc, [email, grouped]) => {
      const context = resolveTeamContextForMembers(grouped);
      const firstRawEmail = (grouped[0]?.email || '').trim();
      const payload = {
        active: context.hasAnyActiveMember,
        role: context.resolvedRole,
        permissions: context.resolvedPermissions,
      };

      acc[email] = payload;
      if (firstRawEmail) {
        acc[firstRawEmail] = payload;
      }
      return acc;
    }, {});

    const superAdminEmail = normalizeEmail(SUPER_ADMIN_EMAIL);
    accessMembers[superAdminEmail] = {
      active: true,
      role: UserRole.ADMIN,
      permissions: { ...fullPermissions },
    };
    accessMembers[SUPER_ADMIN_EMAIL] = {
      active: true,
      role: UserRole.ADMIN,
      permissions: { ...fullPermissions },
    };

    return accessMembers;
  };
  const persistWorkspaceAccessIndex = async (members: TeamMember[]) => {
    if (isMockMode || !user) return;
    const accessRef = getSharedAccessRef();
    await setDoc(accessRef, {
      members: buildWorkspaceAccessMembers(members),
      updatedAt: new Date().toISOString(),
      updatedBy: normalizeEmail(user.email),
    }, { merge: true });
  };

  const getClampedDay = (year: number, monthIndex: number, day: number) => {
    const lastDay = new Date(year, monthIndex + 1, 0).getDate();
    return Math.min(day, lastDay);
  };

  const buildRecurringBillsForYear = (baseBills: Bill[], year: number, startMonth: number, existingIds: Set<string>) => {
    const generated: Bill[] = [];

    baseBills.forEach((bill) => {
      const isMonthly = bill.recurrenceType === 'monthly';
      const isAnnual = bill.recurrenceType === 'annual';
      if (!isMonthly && !isAnnual) return;

      // Extrair dia da data base sem timezone issues
      const [baseYearStr, baseMonthStr, baseDayStr] = bill.dueDate.split('-');
      const baseYear = Number(baseYearStr) || year;
      const baseMonthIndex = Math.max(0, Math.min(11, (Number(baseMonthStr) || 1) - 1));
      const baseDay = Number(baseDayStr) || 1;

      if (isAnnual) {
        const newId = `${bill.id}-${year}`;
        if (existingIds.has(newId)) return;
        if (baseYear === year && existingIds.has(bill.id)) return;

        const clampedDay = getClampedDay(year, baseMonthIndex, baseDay);
        const monthKey = String(baseMonthIndex + 1).padStart(2, '0');
        const dayKey = String(clampedDay).padStart(2, '0');
        const dueDate = `${year}-${monthKey}-${dayKey}`;

        generated.push({
          ...bill,
          id: newId,
          parentId: bill.id,
          dueDate,
          status: BillStatus.PENDING,
        });
        return;
      }

      const installments = Math.max(1, bill.totalInstallments || 12);
      for (let i = 0; i < installments; i += 1) {
        const monthIndex = baseMonthIndex + i;
        const targetYear = baseYear + Math.floor(monthIndex / 12);
        if (targetYear !== year) continue;

        const normalizedMonth = monthIndex % 12;
        const monthKey = String(normalizedMonth + 1).padStart(2, '0');
        const newId = `${bill.id}-${targetYear}-${monthKey}`;

        if (existingIds.has(newId)) continue;
        if (normalizedMonth === currentMonth && existingIds.has(bill.id)) continue;

        const clampedDay = getClampedDay(targetYear, normalizedMonth, baseDay);
        const dayKey = String(clampedDay).padStart(2, '0');
        const dueDate = `${targetYear}-${monthKey}-${dayKey}`;

        generated.push({
          ...bill,
          id: newId,
          parentId: bill.id,
          dueDate,
          status: BillStatus.PENDING,
        });
      }
    });

    return generated;
  };

  const mergeRecurringBillsForYear = (existing: Bill[]) => {
    const existingIds = new Set(existing.map((b) => b.id));
    const added = buildRecurringBillsForYear(defaultRecurringBills, currentYear, currentMonth, existingIds);
    return { merged: [...existing, ...added], added };
  };

  const appendMissingBillsById = (existing: Bill[], candidates: Bill[]) => {
    const existingIds = new Set(existing.map((b) => b.id));
    const missing = candidates.filter((b) => !existingIds.has(b.id));
    return { merged: [...existing, ...missing], missing };
  };

  const loadImportedBills = async (existing: Bill[]) => {
    try {
      const response = await fetch('/seed-bills.json');
      if (!response.ok) {
        console.warn('Arquivo seed-bills.json nÃƒÂ£o encontrado');
        return existing;
      }
      
      const seedData = await response.json();
      const imported = seedData.map((item: any, idx: number) => ({
        id: `seed-${Date.now()}-${idx}`,
        supplierId: '',
        description: item.description,
        amount: item.amount || 0,
        dueDate: item.dueDate,
        observations: item.observations,
        status: BillStatus.PENDING,
        recurrenceType: 'none' as const,
        accountId: '27', // Default PRODUCT_COST
        isEstimate: false,
      }));

      console.log(`Ã¢Å“â€¦ Carregadas ${imported.length} contas do seed-bills.json`);
      return [...existing, ...imported];
    } catch (e) {
      console.error('Erro ao carregar seed-bills.json:', e);
      return existing;
    }
  };

  const defaultAccounts: ChartOfAccount[] = [
    // DESPESAS FIXAS
    { id: '1', name: 'ADVOGADO - DORIVAL', category: 'FIXED_EXPENSES', type: 'FIXED' },
    { id: '2', name: 'ÃƒÂGUA - SABESP', category: 'FIXED_EXPENSES', type: 'FIXED' },
    { id: '3', name: 'ALARME - EXTREMA', category: 'FIXED_EXPENSES', type: 'FIXED' },
    { id: '4', name: 'ALUGUEL 8000', category: 'FIXED_EXPENSES', type: 'FIXED' },
    { id: '5', name: 'CAIXA PEQUENO', category: 'FIXED_EXPENSES', type: 'FIXED' },
    { id: '6', name: 'CARTÃƒÆ’O DE CRÃƒâ€°DITO INTER EMPRESAS', category: 'FIXED_EXPENSES', type: 'FIXED' },
    { id: '7', name: 'CERTIFICADO DIGITAL A1', category: 'FIXED_EXPENSES', type: 'FIXED' },
    { id: '8', name: 'CONTABILIDADE', category: 'FIXED_EXPENSES', type: 'FIXED' },
    { id: '9', name: 'DEFIS - SIMPLES NACIONAL', category: 'FIXED_EXPENSES', type: 'FIXED' },
    { id: '10', name: 'DESPESAS BANCÃƒÂRIAS', category: 'FIXED_EXPENSES', type: 'FIXED' },
    { id: '11', name: 'DOMÃƒÂNIO APARE', category: 'FIXED_EXPENSES', type: 'FIXED' },
    { id: '12', name: 'DOMÃƒÂNIO IAFABIANA', category: 'FIXED_EXPENSES', type: 'FIXED' },
    { id: '13', name: 'DOMÃƒÂNIO MARIA VANTAGEM', category: 'FIXED_EXPENSES', type: 'FIXED' },
    { id: '14', name: 'ENERGIA - ELETROPAULO', category: 'FIXED_EXPENSES', type: 'FIXED' },
    { id: '15', name: 'EXTINTORES', category: 'FIXED_EXPENSES', type: 'FIXED' },
    { id: '16', name: 'IPTU', category: 'FIXED_EXPENSES', type: 'FIXED' },
    { id: '17', name: 'ITENS COMEMORATIVOS', category: 'FIXED_EXPENSES', type: 'FIXED' },
    { id: '18', name: 'LICENÃƒâ€¡A DE FUNCIONAMENTO', category: 'FIXED_EXPENSES', type: 'FIXED' },
    { id: '19', name: 'MANOBRISTA 1000', category: 'FIXED_EXPENSES', type: 'FIXED' },
    { id: '20', name: 'MANUTENÃƒâ€¡ÃƒÆ’O - OBRA', category: 'FIXED_EXPENSES', type: 'FIXED' },
    { id: '21', name: 'REPARO EQUIPAMENTOS', category: 'FIXED_EXPENSES', type: 'FIXED' },
    { id: '22', name: 'MARKETING - SITE', category: 'FIXED_EXPENSES', type: 'FIXED' },
    { id: '23', name: 'MARKETING VAN BRADESCO', category: 'FIXED_EXPENSES', type: 'FIXED' },
    { id: '24', name: 'MARKETING GRÃƒÂFICA', category: 'FIXED_EXPENSES', type: 'FIXED' },
    { id: '25', name: 'MKT FRANQUEADORA', category: 'FIXED_EXPENSES', type: 'FIXED' },
    { id: '26', name: 'MÃƒâ€œVEIS - INVESTIMENTO', category: 'FIXED_EXPENSES', type: 'FIXED' },
    { id: '27', name: 'PRODUTO DE LIMPEZA', category: 'FIXED_EXPENSES', type: 'FIXED' },
    { id: '28', name: 'SEGURO SALÃƒÆ’O', category: 'FIXED_EXPENSES', type: 'FIXED' },
    { id: '29', name: 'SISTEMA W8 / TRINKS', category: 'FIXED_EXPENSES', type: 'FIXED' },
    { id: '30', name: 'SISTEMA INTEGRAÃƒâ€¡ÃƒÆ’O TRINKS/BITRIX/ALE', category: 'FIXED_EXPENSES', type: 'FIXED' },
    { id: '31', name: 'SISTEMA BITRIX', category: 'FIXED_EXPENSES', type: 'FIXED' },
    { id: '32', name: 'BITRIX - LUCAS - ASSESSORIA', category: 'FIXED_EXPENSES', type: 'FIXED' },
    { id: '33', name: 'TELEFONE - CELULARES VENC 20', category: 'FIXED_EXPENSES', type: 'FIXED' },
    { id: '34', name: 'TELEFONE - VIVO 3682-3002', category: 'FIXED_EXPENSES', type: 'FIXED' },
    { id: '35', name: 'TELEFONE - SONAVOIP', category: 'FIXED_EXPENSES', type: 'FIXED' },
    { id: '36', name: 'TELEFONE - VIVONET', category: 'FIXED_EXPENSES', type: 'FIXED' },
    { id: '37', name: 'TELEFONE - CEL APARE', category: 'FIXED_EXPENSES', type: 'FIXED' },
    { id: '38', name: 'HCF NACIONAL', category: 'FIXED_EXPENSES', type: 'FIXED' },
    
    // COMISSÃƒâ€¢ES E SALÃƒÂRIOS VARIÃƒÂVEIS
    { id: '39', name: 'FOLHA DE PAGAMENTO - COMISSIONADOS DIA 05', category: 'COMMISSION', type: 'VARIABLE' },
    { id: '40', name: 'FOLHA DE PAGAMENTO - COMISSIONADOS DIA 20', category: 'COMMISSION', type: 'VARIABLE' },
    { id: '41', name: 'COMISSÃƒÆ’O NOIVAS', category: 'COMMISSION', type: 'VARIABLE' },
    { id: '42', name: 'CONTABILIDADE MEIS KELLY', category: 'COMMISSION', type: 'VARIABLE' },
    { id: '43', name: 'DAS EQUIPE', category: 'COMMISSION', type: 'VARIABLE' },
    { id: '44', name: 'DAS ACORDO PROFISSIONAIS', category: 'COMMISSION', type: 'VARIABLE' },
    { id: '45', name: 'CABELO CLIENTE REEMBOLSO PROFISSIONAL', category: 'COMMISSION', type: 'VARIABLE' },
    { id: '46', name: 'DÃƒâ€°BITOS CAFÃƒâ€° TERCERIZADO EQUIPE', category: 'COMMISSION', type: 'VARIABLE' },
    { id: '47', name: 'FREE LANCE ESTÃƒâ€°TICA', category: 'COMMISSION', type: 'VARIABLE' },
    { id: '48', name: 'VALE EXTRA RODOLFO', category: 'COMMISSION', type: 'VARIABLE' },
    { id: '49', name: 'VALE EXTRA THAYNÃƒÂ', category: 'COMMISSION', type: 'VARIABLE' },
    { id: '50', name: 'VALE EXTRA OTAVIO', category: 'COMMISSION', type: 'VARIABLE' },
    { id: '51', name: 'VALE EXTRA RAFA', category: 'COMMISSION', type: 'VARIABLE' },
    { id: '52', name: 'VALE EXTRA LUCIO', category: 'COMMISSION', type: 'VARIABLE' },
    { id: '53', name: 'BÃƒâ€NUS ADM', category: 'COMMISSION', type: 'VARIABLE' },
    
    // CUSTO DE PRODUTOS
    { id: '54', name: 'BASE BR', category: 'PRODUCT_COST', type: 'VARIABLE' },
    { id: '55', name: 'BRISA', category: 'PRODUCT_COST', type: 'VARIABLE' },
    { id: '56', name: 'GEO', category: 'PRODUCT_COST', type: 'VARIABLE' },
    { id: '57', name: 'ESMALTES', category: 'PRODUCT_COST', type: 'VARIABLE' },
    { id: '58', name: 'KEUNE', category: 'PRODUCT_COST', type: 'VARIABLE' },
    { id: '59', name: 'KERASTASE', category: 'PRODUCT_COST', type: 'VARIABLE' },
    { id: '60', name: 'KIT MANICURE', category: 'PRODUCT_COST', type: 'VARIABLE' },
    { id: '61', name: 'LUVAS - DVS', category: 'PRODUCT_COST', type: 'VARIABLE' },
    { id: '62', name: 'ROYAL/GEO', category: 'PRODUCT_COST', type: 'VARIABLE' },
    { id: '63', name: 'SAECO - cafÃƒÂ© - PILÃƒÆ’O', category: 'PRODUCT_COST', type: 'VARIABLE' },
    { id: '64', name: 'SOFTCLEAN', category: 'PRODUCT_COST', type: 'VARIABLE' },
    { id: '65', name: 'TRUSS', category: 'PRODUCT_COST', type: 'VARIABLE' },
    { id: '66', name: 'A. R. COSMÃƒâ€°TICO', category: 'PRODUCT_COST', type: 'VARIABLE' },
    { id: '67', name: 'JJP', category: 'PRODUCT_COST', type: 'VARIABLE' },
    { id: '68', name: 'SPA DOS PÃƒâ€°S', category: 'PRODUCT_COST', type: 'VARIABLE' },
    { id: '69', name: 'K-PRO', category: 'PRODUCT_COST', type: 'VARIABLE' },
    
    // DESPESAS VARIÃƒÂVEIS
    { id: '70', name: 'ROYALTIES 2500,00', category: 'VARIABLE_EXPENSES', type: 'VARIABLE' },
    { id: '71', name: 'TAXA DE CARTÃƒÆ’O', category: 'VARIABLE_EXPENSES', type: 'VARIABLE' },
    { id: '72', name: 'DAS SALÃƒÆ’O', category: 'VARIABLE_EXPENSES', type: 'VARIABLE' },
    { id: '73', name: 'DEVOLUÃƒâ€¡ÃƒÆ’O CLIENTE', category: 'VARIABLE_EXPENSES', type: 'VARIABLE' },
    { id: '74', name: 'BANCO ITAU PLANO ADAPTA', category: 'VARIABLE_EXPENSES', type: 'VARIABLE' },
    { id: '98', name: 'JUROS E MULTAS', category: 'VARIABLE_EXPENSES', type: 'VARIABLE' },
    
    // SALÃƒÂRIOS FIXOS
    { id: '75', name: 'FOLHA DE PAGAMENTO - SALÃƒÂRIOS-05', category: 'FIXED_SALARY', type: 'FIXED' },
    { id: '76', name: 'FOLHA DE PAGAMENTO - SALÃƒÂRIOS-20', category: 'FIXED_SALARY', type: 'FIXED' },
    { id: '77', name: 'CRISTIANO DE JESUS', category: 'FIXED_SALARY', type: 'FIXED' },
    { id: '78', name: 'REBEKA DE LUCENA', category: 'FIXED_SALARY', type: 'FIXED' },
    { id: '79', name: 'BRUNO GALDINO', category: 'FIXED_SALARY', type: 'FIXED' },
    { id: '80', name: 'FLÃƒÂVIA - TEREAPIA WENDY', category: 'FIXED_SALARY', type: 'FIXED' },
    { id: '81', name: 'VA - VALE ALIMENTAÃƒâ€¡ÃƒÆ’O - REFEIÃƒâ€¡ÃƒÆ’O - ALELO', category: 'FIXED_SALARY', type: 'FIXED' },
    { id: '82', name: 'VT BEM - VALE TRANSPORTE', category: 'FIXED_SALARY', type: 'FIXED' },
    { id: '83', name: 'RESCISAO', category: 'FIXED_SALARY', type: 'FIXED' },
    { id: '84', name: 'FGTS', category: 'FIXED_SALARY', type: 'FIXED' },
    { id: '85', name: 'FGTS MULTA', category: 'FIXED_SALARY', type: 'FIXED' },
    { id: '86', name: 'MULTA - DCTFWEB - IMPOSTO', category: 'FIXED_SALARY', type: 'FIXED' },
    { id: '87', name: 'FÃƒâ€°RIAS', category: 'FIXED_SALARY', type: 'FIXED' },
    { id: '88', name: 'INSS', category: 'FIXED_SALARY', type: 'FIXED' },
    { id: '89', name: 'INSS - 13 SALÃƒÂRIO', category: 'FIXED_SALARY', type: 'FIXED' },
    { id: '90', name: 'SAÃƒÅ¡DE PASS', category: 'FIXED_SALARY', type: 'FIXED' },
    { id: '91', name: 'SINDICATO - 10', category: 'FIXED_SALARY', type: 'FIXED' },
    { id: '92', name: 'SINDICATO - 13 SAL', category: 'FIXED_SALARY', type: 'FIXED' },
    { id: '93', name: 'SINDICATO PATRONAL', category: 'FIXED_SALARY', type: 'FIXED' },
    { id: '94', name: 'HOMOLOGAÃƒâ€¡ÃƒÆ’O DE CONTRATOS - SINDICATO', category: 'FIXED_SALARY', type: 'FIXED' },
    { id: '95', name: '13 - SALÃƒÂRIO 1 PARCELA', category: 'FIXED_SALARY', type: 'FIXED' },
    { id: '96', name: '13 - SALÃƒÂRIO 2 PARCELA', category: 'FIXED_SALARY', type: 'FIXED' },
    
    // PRÃƒâ€œ-LABORE
    { id: '97', name: 'GESTOR ADMINISTRATIVO - PROLABORE - FABIANA', category: 'PRO_LABORE', type: 'FIXED' },
    { id: '98', name: 'GESTOR ADMINISTRATIVO - PROLABORE - CAIO', category: 'PRO_LABORE', type: 'FIXED' },
  ];

  const defaultSuppliers: Supplier[] = [
    { id: '36', name: 'LED10', taxId: '95477-3448', email: 'Douglas', accountId: '22' },
    { id: '2', name: 'VT CLTS', taxId: '', email: '', accountId: '82' },
    { id: '3', name: 'CLEANER BRASIL', taxId: '', email: '', accountId: '27' },
    { id: '4', name: 'MANOBRISTA', taxId: '', email: '', accountId: '19' },
    { id: '5', name: 'FOLHA DE PAGAMENTO', taxId: '', email: '', accountId: '39' },
    { id: '6', name: 'VIVO', taxId: '3641-5557', email: '', accountId: '33' },
    { id: '7', name: 'VIVO INTERNET', taxId: '899927163920', email: '', accountId: '35' },
    { id: '8', name: 'BANCO INTER', taxId: '', email: '', accountId: '6' },
    { id: '9', name: 'SINDICATO - PRÃƒâ€œ BELEZA', taxId: '', email: '', accountId: '91' },
    { id: '10', name: 'PREFEITURA', taxId: '', email: '', accountId: '9' },
    { id: '11', name: 'DORIVAL CESÃƒÂRIO', taxId: '98459-0790', email: 'Dorival', accountId: '1' },
    { id: '12', name: 'INTERLUX', taxId: '', email: '', accountId: '27' },
    { id: '13', name: 'CONTABILIDADE REPRECON', taxId: '26.764.986/0001-60', email: 'Wellington', accountId: '8' },
    { id: '14', name: 'CONTBEL', taxId: '', email: 'Kelly (MEI)', accountId: '42' },
    { id: '15', name: 'DAS EQUIPE', taxId: '', email: '', accountId: '43' },
    { id: '16', name: 'DAS SALÃƒÆ’O', taxId: '', email: '', accountId: '72' },
    { id: '17', name: 'FGTS', taxId: '', email: '', accountId: '84' },
    { id: '18', name: 'INSS', taxId: '', email: '', accountId: '88' },
    { id: '19', name: 'ENEL', taxId: '', email: '', accountId: '14' },
    { id: '20', name: 'RGB EMPREED IMOBILIÃƒÂRIOS', taxId: '', email: '', accountId: '4' },
    { id: '21', name: 'FRANQUEADORA', taxId: '', email: '', accountId: '25' },
    { id: '22', name: 'BANCO ITAÃƒÅ¡', taxId: '', email: 'IMPERATRIZ', accountId: '6' },
    { id: '23', name: 'SABESP', taxId: '', email: '', accountId: '2' },
    // Advogado
    { id: '24', name: 'Dorival CesÃƒÂ¡rio', taxId: '98459-0790', email: 'Dorival', accountId: '1' },
    // Autoclave
    { id: '25', name: 'Autoclave', taxId: '98200-7006', email: 'Rodrigo', accountId: '21' },
    // Contabilidade Reprecon Financeiro
    { id: '26', name: 'REPRECON FINANCEIRO', taxId: '', email: '', accountId: '8' },
    // Dedetizador
    { id: '27', name: 'Dedetizador', taxId: '98133-4506', email: 'Milena', accountId: '20' },
    // Estacionamento
    { id: '28', name: 'Estacionamento', taxId: '97476-4083', email: 'Cleber', accountId: '20' },
    // Extintores
    { id: '29', name: 'Extintores', taxId: '94854-7062', email: 'Dirceu', accountId: '15' },
    // ImobiliÃƒÂ¡ria
    { id: '30', name: 'ImobiliÃƒÂ¡ria', taxId: '94149-2402', email: 'Jeane', accountId: '4' },
    { id: '31', name: 'RGH', taxId: '95819-0547', email: '', accountId: '4' },
    // Lavanderia Interlux
    { id: '32', name: 'Interlux', taxId: '97058-5814', email: 'Vagner (Dono)', accountId: '27' },
    { id: '33', name: 'Interlux', taxId: '97662-9153', email: 'Andressa', accountId: '27' },
    { id: '34', name: 'Interlux', taxId: '98968-3457', email: 'Jessica', accountId: '27' },
    // LavatÃƒÂ³rios
    { id: '35', name: 'Ferrante', taxId: '99782-5508', email: 'Wilson', accountId: '21' },
    // ManutenÃƒÂ§ÃƒÂ£o Geral
    { id: '38', name: 'Badeco', taxId: '98391-5814', email: '', accountId: '20' },
    { id: '39', name: 'Pintura', taxId: '96353-4491', email: 'Gil', accountId: '20' },
    { id: '40', name: 'Ar Condicionado', taxId: '95143-3584', email: 'Daniel', accountId: '20' },
    // Parcerias
    { id: '41', name: 'Fotografias Zotarelli', taxId: '99603-5298', email: 'Jonathan', accountId: '24' },
    { id: '42', name: 'Flores', taxId: '99905-1268', email: 'Roseli', accountId: '27' },
    // Produtos - TRUSS
    { id: '43', name: 'TRUSS', taxId: '96192-1527', email: 'Andreia', accountId: '58' },
    { id: '44', name: 'TRUSS', taxId: '98999-5390', email: 'Denise', accountId: '58' },
    // Produtos - Keune
    { id: '45', name: 'Keune', taxId: '97652-4337', email: 'Alex', accountId: '58' },
    // Produtos - CafÃƒÂ©
    { id: '46', name: 'CafÃƒÂ© TrÃƒÂªs CoraÃƒÂ§ÃƒÂµes', taxId: '98803-5064', email: 'Juliana', accountId: '63' },
    // Produtos - Cleaner
    { id: '47', name: 'Cleaner', taxId: '98142-1467', email: 'Sergio', accountId: '27' },
    // Produtos - Sales
    { id: '48', name: 'Sales', taxId: '2723-3876', email: 'Thamy', accountId: '64' },
    // Produtos - Soft Clean
    { id: '49', name: 'Soft Clean', taxId: '94035-3856', email: '', accountId: '64' },
    // Produtos - GEO
    { id: '50', name: 'GEO', taxId: '94035-3856', email: '', accountId: '56' },
    // Produtos - Loreal/Kerastase
    { id: '51', name: 'Loreal/Kerastase', taxId: '', email: 'Andrea (ChÃƒÂ¡cara Flora)', accountId: '59' },
    { id: '52', name: 'Loreal/Kerastase', taxId: '', email: 'Caio', accountId: '59' },
  ];

  useEffect(() => {
    const safetyTimeout = setTimeout(() => {
      if (loading) setLoading(false);
    }, 5000);

    const unsubscribeAuth = auth.onAuthStateChanged(async (u: any) => {
      setUser(u);
      
      if (u) {
        console.log('Ã°Å¸â€˜Â¤ UsuÃƒÂ¡rio logado:', u.email);
        console.log('Ã°Å¸â€Â¥ Status Firebase:', isMockMode ? 'Ã¢ÂÅ’ MODO LOCAL (localStorage) - Dados NÃƒÆ’O sÃƒÂ£o salvos no Firebase!' : 'Ã¢Å“â€¦ MODO REAL (Firebase Cloud) - Dados sendo salvos no servidor!');
      }
      
      if (isMockMode) {
        try {
          const savedBills = localStorage.getItem('pagaai_bills');
          const savedSuppliers = localStorage.getItem('pagaai_suppliers');
          const savedAccounts = localStorage.getItem('pagaai_accounts');
          const savedRevenues = localStorage.getItem('pagaai_revenues');
          const savedCompany = localStorage.getItem('pagaai_company');
          const savedTeam = localStorage.getItem('pagaai_team');
          
          if (savedBills) {
            const parsedBills = JSON.parse(savedBills);
            let nextBills = parsedBills;

            if (!seededPaidBillsRef.current) {
              const { merged: mergedWithPaid, missing } = appendMissingBillsById(parsedBills, defaultPaidBills);
              seededPaidBillsRef.current = true;
              nextBills = mergedWithPaid;
              if (missing.length > 0) {
                console.log(`Ã¢Å“â€¦ ${missing.length} contas pagas padrÃƒÂ£o adicionadas (modo local)`);
              }
            }

            seededRecurringBillsRef.current = true;
            setBills(validateBills(getVisibleBills(nextBills)));
          } else if (!seededRecurringBillsRef.current) {
            seededRecurringBillsRef.current = true;
            seededPaidBillsRef.current = true;
            const { merged } = mergeRecurringBillsForYear(defaultPaidBills);
            setBills(validateBills(getVisibleBills(merged)));
          }
          if (savedSuppliers) {
            const parsed = JSON.parse(savedSuppliers);
            setSuppliers(parsed.length > 0 ? parsed : defaultSuppliers);
          } else {
            setSuppliers(defaultSuppliers);
          }
          if (savedAccounts) {
            setAccounts(JSON.parse(savedAccounts));
          } else {
            setAccounts(defaultAccounts);
          }
          if (savedRevenues) setRevenues(JSON.parse(savedRevenues));
          if (savedCompany) setCompany(JSON.parse(savedCompany));
          if (savedTeam) setTeam(JSON.parse(savedTeam));
        } catch (e) {
          console.error("Erro ao ler dados locais:", e);
        }
        setLoading(false);
      } else {
        if (!u) setLoading(false);
      }
    });

    return () => {
      unsubscribeAuth();
      clearTimeout(safetyTimeout);
    };
  }, []);

  // Carregar contas importadas do seed-bills.json
  useEffect(() => {
    if (isMockMode && user && !seededImportedBillsRef.current && bills.length > 0) {
      seededImportedBillsRef.current = true;
      loadImportedBills(bills).then(merged => {
        if (merged.length > bills.length) {
          setBills(merged);
          console.log(`Ã°Å¸â€œÂ¥ ${merged.length - bills.length} contas importadas adicionadas`);
        }
      });
    }
  }, [user, bills.length, isMockMode]);

  useEffect(() => {
    if (isMockMode && user) {
      localStorage.setItem('pagaai_bills', JSON.stringify(bills));
      localStorage.setItem('pagaai_suppliers', JSON.stringify(suppliers));
      localStorage.setItem('pagaai_accounts', JSON.stringify(accounts));
      localStorage.setItem('pagaai_revenues', JSON.stringify(revenues));
      localStorage.setItem('pagaai_company', JSON.stringify(company));
      localStorage.setItem('pagaai_team', JSON.stringify(team));
    }
  }, [bills, suppliers, accounts, revenues, company, team, user]);

  useEffect(() => {
    if (suppliers.length === 0) return;

    const { suppliers: normalizedSuppliers, bills: normalizedBills, changed, removedSupplierIds, updatedBills } = consolidateLed10Supplier(suppliers, bills);

    if (!changed) return;

    setSuppliers(normalizedSuppliers);

    if (updatedBills.length > 0) {
      setBills(normalizedBills);
    }

    if (isMockMode || !user) return;

    const suppliersRef = getSharedSuppliersRef();
    const billsRef = getSharedBillsRef();
    const batch = writeBatch(db);
    const canonicalLed10 = normalizedSuppliers.find((supplier) => normalizeSupplierName(supplier.name) === 'led10');

    if (canonicalLed10) {
      batch.set(doc(suppliersRef, canonicalLed10.id), stripUndefined(canonicalLed10), { merge: true });
    }

    removedSupplierIds.forEach((supplierId) => {
      batch.delete(doc(suppliersRef, supplierId));
    });

    updatedBills.forEach((bill) => {
      batch.set(doc(billsRef, bill.id), stripUndefined(bill), { merge: true });
    });

    batch.commit().catch((error) => console.error('Erro ao consolidar fornecedor LED10:', error));
  }, [bills, suppliers, isMockMode, user]);

  useEffect(() => {
    if (isMockMode || !user) return;
    let cancelled = false;

    const migrateLegacyUserDataIfNeeded = async () => {
      try {
        const billsRef = getSharedBillsRef();
        const suppliersRef = getSharedSuppliersRef();
        const accountsRef = getSharedAccountsRef();
        const revenuesRef = getSharedRevenuesRef();
        const teamRef = getSharedTeamRef();
        const companyRef = getSharedCompanyRef();

        const [
          sharedBillsSnap,
          sharedSuppliersSnap,
          sharedAccountsSnap,
          sharedRevenuesSnap,
          sharedTeamSnap,
          sharedCompanySnap,
        ] = await Promise.all([
          getDocs(billsRef),
          getDocs(suppliersRef),
          getDocs(accountsRef),
          getDocs(revenuesRef),
          getDocs(teamRef),
          getDoc(companyRef),
        ]);

        if (cancelled) return;

        const hasSharedData =
          !sharedBillsSnap.empty ||
          !sharedSuppliersSnap.empty ||
          !sharedAccountsSnap.empty ||
          !sharedRevenuesSnap.empty ||
          !sharedTeamSnap.empty ||
          sharedCompanySnap.exists();

        if (hasSharedData) return;

        const legacyBillsRef = collection(db, 'users', user.uid, 'bills');
        const legacySuppliersRef = collection(db, 'users', user.uid, 'suppliers');
        const legacyAccountsRef = collection(db, 'users', user.uid, 'accounts');
        const legacyRevenuesRef = collection(db, 'users', user.uid, 'revenues');
        const legacyTeamRef = collection(db, 'users', user.uid, 'team');
        const legacyCompanyRef = doc(db, 'users', user.uid, 'meta', 'company');

        const [
          legacyBillsSnap,
          legacySuppliersSnap,
          legacyAccountsSnap,
          legacyRevenuesSnap,
          legacyTeamSnap,
          legacyCompanySnap,
        ] = await Promise.all([
          getDocs(legacyBillsRef),
          getDocs(legacySuppliersRef),
          getDocs(legacyAccountsRef),
          getDocs(legacyRevenuesRef),
          getDocs(legacyTeamRef),
          getDoc(legacyCompanyRef),
        ]);

        if (cancelled) return;

        const hasLegacyData =
          !legacyBillsSnap.empty ||
          !legacySuppliersSnap.empty ||
          !legacyAccountsSnap.empty ||
          !legacyRevenuesSnap.empty ||
          !legacyTeamSnap.empty ||
          legacyCompanySnap.exists();

        if (!hasLegacyData) return;

        const batch = writeBatch(db);
        legacyBillsSnap.docs.forEach((d) => batch.set(doc(billsRef, d.id), d.data()));
        legacySuppliersSnap.docs.forEach((d) => batch.set(doc(suppliersRef, d.id), d.data()));
        legacyAccountsSnap.docs.forEach((d) => batch.set(doc(accountsRef, d.id), d.data()));
        legacyRevenuesSnap.docs.forEach((d) => batch.set(doc(revenuesRef, d.id), d.data()));
        legacyTeamSnap.docs.forEach((d) => batch.set(doc(teamRef, d.id), d.data()));
        if (legacyCompanySnap.exists()) {
          batch.set(companyRef, legacyCompanySnap.data());
        }
        await batch.commit();
        const migratedTeam = legacyTeamSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<TeamMember, 'id'>) }));
        await persistWorkspaceAccessIndex(migratedTeam);
        console.log('Ã¢Å“â€¦ Dados migrados para workspace compartilhado');
      } catch (e) {
        console.error('Erro ao migrar dados para workspace compartilhado:', e);
      }
    };

    void migrateLegacyUserDataIfNeeded();

    return () => {
      cancelled = true;
    };
  }, [isMockMode, user]);

  useEffect(() => {
    if (isMockMode || !user) return;
    let didSetLoading = false;
    const markLoaded = () => {
      if (!didSetLoading) {
        setLoading(false);
        didSetLoading = true;
      }
    };

    const billsRef = getSharedBillsRef();
    const suppliersRef = getSharedSuppliersRef();
    const accountsRef = getSharedAccountsRef();
    const revenuesRef = getSharedRevenuesRef();
    const teamRef = getSharedTeamRef();
    const companyRef = getSharedCompanyRef();

    const handleSnapshotError = (e: any) => {
      const code = typeof e?.code === 'string' ? e.code : 'firestore/unknown';
      const message = e?.message || 'Falha ao ler dados do Firebase.';
      setFirestoreError(`${message} (${code})`);
      markLoaded();
    };

    const unsubBills = onSnapshot(billsRef, (snap) => {
      if (snap.empty && !seededRecurringBillsRef.current) {
        seededRecurringBillsRef.current = true;
        seededPaidBillsRef.current = true;
        const batch = writeBatch(db);
        const { merged } = mergeRecurringBillsForYear(defaultPaidBills);
        merged.forEach((bill) => {
          batch.set(doc(billsRef, bill.id), bill);
        });
        batch.commit().catch((e) => console.error('Erro ao criar contas recorrentes e pagas:', e));
        setBills(validateBills(getVisibleBills(merged)));
        markLoaded();
        return;
      }
      const next = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Bill, 'id'>) }));

      let nextBills = next;
      if (!seededPaidBillsRef.current) {
        seededPaidBillsRef.current = true;
        const { merged: mergedWithPaid, missing } = appendMissingBillsById(next, defaultPaidBills);
        if (missing.length > 0) {
          const batch = writeBatch(db);
          missing.forEach((bill) => {
            batch.set(doc(billsRef, bill.id), bill);
          });
          batch.commit().catch((e) => console.error('Erro ao criar contas pagas:', e));
        }
        nextBills = mergedWithPaid;
      }

      seededRecurringBillsRef.current = true;
      // Evita recriar automaticamente parcelas que o usuario excluiu manualmente.
      setBills(validateBills(getVisibleBills(nextBills)));
      markLoaded();
    }, handleSnapshotError);

    const unsubSuppliers = onSnapshot(suppliersRef, (snap) => {
      if (snap.empty && !seededSuppliersRef.current) {
        seededSuppliersRef.current = true;
        const batch = writeBatch(db);
        defaultSuppliers.forEach((sup) => {
          batch.set(doc(suppliersRef, sup.id), sup);
        });
        batch.commit().catch((e) => console.error('Erro ao criar fornecedores padrÃƒÂ£o:', e));
        setSuppliers(defaultSuppliers);
        markLoaded();
        return;
      }
      const next = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Supplier, 'id'>) }));
      setSuppliers(next);
      markLoaded();
    }, handleSnapshotError);

    const unsubAccounts = onSnapshot(accountsRef, async (snap) => {
      if (snap.empty && !seededAccountsRef.current) {
        seededAccountsRef.current = true;
        try {
          const settingsRef = getSharedSettingsRef();
          const settingsSnap = await getDoc(settingsRef);
          const settings = settingsSnap.exists() ? settingsSnap.data() as { accountsSeeded?: boolean } : {};
          if (settings.accountsSeeded) {
            setAccounts([]);
            markLoaded();
            return;
          }

          const batch = writeBatch(db);
          defaultAccounts.forEach((acc) => {
            batch.set(doc(accountsRef, acc.id), acc);
          });
          batch.set(settingsRef, { accountsSeeded: true }, { merge: true });
          await batch.commit();
          setAccounts(defaultAccounts);
        } catch (e) {
          console.error('Erro ao criar contas padrao:', e);
        }
        markLoaded();
        return;
      }
      const next = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<ChartOfAccount, 'id'>) }));
      setAccounts(next);
      markLoaded();
    }, handleSnapshotError);

    const unsubRevenues = onSnapshot(revenuesRef, (snap) => {
      const next = snap.docs.map((d) => d.data() as Revenue);
      setRevenues(next);
      markLoaded();
    }, handleSnapshotError);

    const unsubTeam = onSnapshot(teamRef, (snap) => {
      const next = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<TeamMember, 'id'>) }));
      setTeam(next);

      const normalizedCurrentEmail = normalizeEmail(user.email);
      const isCurrentUserSuperAdmin = normalizedCurrentEmail === normalizeEmail(SUPER_ADMIN_EMAIL);
      const matchingMembers = next.filter((member) => normalizeEmail(member.email) === normalizedCurrentEmail);
      const currentUserTeamContext = resolveTeamContextForMembers(matchingMembers);
      const canCurrentUserManageTeam = Boolean(currentUserTeamContext.resolvedPermissions.team);

      if (isCurrentUserSuperAdmin || canCurrentUserManageTeam) {
        void persistWorkspaceAccessIndex(next).catch((e) => console.error('Erro ao sincronizar indice de acesso:', e));
      }
      markLoaded();
    }, handleSnapshotError);

    const unsubCompany = onSnapshot(companyRef, (snap) => {
      if (snap.exists()) {
        setCompany({ ...defaultCompany, ...(snap.data() as Company) });
      } else if (!seededCompanyRef.current) {
        seededCompanyRef.current = true;
        setDoc(companyRef, defaultCompany).catch((e) => console.error('Erro ao criar empresa:', e));
      }
      markLoaded();
    }, handleSnapshotError);

    const caixaPequenoRef = getSharedCaixaPequenoRef();
    const unsubCaixaPequeno = onSnapshot(caixaPequenoRef, (snap) => {
      if (snap.exists()) setCaixaPequenoConfig(snap.data() as CaixaPequenoConfig);
    }, () => {});

    return () => {
      unsubBills();
      unsubSuppliers();
      unsubAccounts();
      unsubRevenues();
      unsubTeam();
      unsubCompany();
      unsubCaixaPequeno();
    };
  }, [isMockMode, user]);

  const persistAccounts = async (prev: ChartOfAccount[], next: ChartOfAccount[]) => {
    if (isMockMode || !user) return;
    const accountsRef = getSharedAccountsRef();
    const settingsRef = getSharedSettingsRef();
    const batch = writeBatch(db);
    const nextIds = new Set(next.map((a) => a.id));
    prev.forEach((a) => {
      if (!nextIds.has(a.id)) batch.delete(doc(accountsRef, a.id));
    });
    next.forEach((a) => batch.set(doc(accountsRef, a.id), a));
    batch.set(settingsRef, { accountsSeeded: true }, { merge: true });
    await batch.commit();
  };

  const persistTeam = async (prev: TeamMember[], next: TeamMember[]) => {
    if (isMockMode || !user) return;
    const teamRef = getSharedTeamRef();
    const batch = writeBatch(db);
    const nextIds = new Set(next.map((m) => m.id));
    prev.forEach((m) => {
      if (!nextIds.has(m.id)) batch.delete(doc(teamRef, m.id));
    });
    next.forEach((m) => batch.set(doc(teamRef, m.id), m));
    await batch.commit();
    await persistWorkspaceAccessIndex(next);
  };

  const persistRevenues = async (prev: Revenue[], next: Revenue[]) => {
    if (isMockMode || !user) return;
    const revenuesRef = getSharedRevenuesRef();
    const batch = writeBatch(db);
    const nextIds = new Set(next.map((r) => r.id));
    prev.forEach((r) => {
      if (!nextIds.has(r.id)) batch.delete(doc(revenuesRef, r.id));
    });
    next.forEach((r) => batch.set(doc(revenuesRef, r.id), r));
    try {
      await batch.commit();
      console.log('Ã¢Å“â€¦ Receitas sincronizadas com Firebase:', next.length, 'itens');
    } catch (e: any) {
      console.error('Ã¢ÂÅ’ Erro ao sincronizar receitas:', e.message);
    }
  };

  const setAccountsWithPersist = (updater: React.SetStateAction<ChartOfAccount[]>) => {
    setAccounts((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      void persistAccounts(prev, next);
      return next;
    });
  };

  const setTeamWithPersist = (updater: React.SetStateAction<TeamMember[]>) => {
    setTeam((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      void persistTeam(prev, next);
      return next;
    });
  };

  const handleResyncWorkspaceAccess = async () => {
    if (isMockMode || !user) {
      throw new Error('Faça login em um ambiente conectado ao Firebase para sincronizar os acessos.');
    }
    await persistWorkspaceAccessIndex(team);
  };

  const setRevenuesWithPersist = (updater: React.SetStateAction<Revenue[]>) => {
    setRevenues((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      void persistRevenues(prev, next);
      return next;
    });
  };

  const setCompanyWithPersist = (next: Company) => {
    setCompany(next);
    if (isMockMode || !user) return;
    const companyRef = getSharedCompanyRef();
    setDoc(companyRef, next, { merge: true }).catch((e) => console.error('Erro ao salvar empresa:', e));
  };

  const handleSaveCaixaPequenoConfig = (next: CaixaPequenoConfig) => {
    setCaixaPequenoConfig(next);
    if (isMockMode || !user) return;
    setDoc(getSharedCaixaPequenoRef(), next, { merge: true }).catch(e => console.error('Erro ao salvar caixaPequeno:', e));
  };

  const handleCaixaPequenoExpense = async (expense: { date: string; description: string; amount: number; accountId: string }) => {
    const newBill: Bill = {
      id: `cxp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      supplierId: '',
      description: expense.description,
      amount: expense.amount,
      dueDate: expense.date,
      paidDate: expense.date,
      paidAmount: expense.amount,
      status: BillStatus.PAID,
      paymentSource: 'caixa_pequeno',
      accountId: expense.accountId,
      recurrenceType: 'none' as RecurrenceType,
      launchedBy: user?.email || '',
      isEstimate: false,
    };
    setBills(prev => [...prev, newBill]);
    if (!isMockMode && user) {
      const billsRef = getSharedBillsRef();
      await setDoc(doc(billsRef, newBill.id), newBill).catch(e => console.error('Erro ao salvar despesa caixa pequeno:', e));
    }
  };

  const handleUpdateCaixaPequenoExpense = async (id: string, update: { description: string; date: string; amount: number; accountId: string }) => {
    setBills(prev => prev.map(b => b.id !== id ? b : {
      ...b,
      description: update.description,
      dueDate: update.date,
      paidDate: update.date,
      amount: update.amount,
      paidAmount: update.amount,
      accountId: update.accountId,
    }));
    if (!isMockMode && user) {
      const billRef = doc(getSharedBillsRef(), id);
      await updateDoc(billRef, {
        description: update.description,
        dueDate: update.date,
        paidDate: update.date,
        amount: update.amount,
        paidAmount: update.amount,
        accountId: update.accountId,
      }).catch(e => console.error('Erro ao atualizar despesa:', e));
    }
  };

  const handleDeleteCaixaPequenoExpense = async (id: string) => {
    setBills(prev => prev.filter(b => b.id !== id));
    if (!isMockMode && user) {
      await deleteDoc(doc(getSharedBillsRef(), id)).catch(e => console.error('Erro ao excluir despesa:', e));
    }
  };

  const handleBulkCaixaPequenoImport = async (rows: Array<{ id: string; date: string; description: string; amount: number; accountId: string }>) => {
    const billsRef = getSharedBillsRef();
    const existingIds = new Set(bills.map(b => b.id));
    const newBills: Bill[] = rows
      .filter(r => !existingIds.has(r.id))
      .map(r => ({
        id: r.id,
        supplierId: '',
        description: r.description,
        amount: r.amount,
        dueDate: r.date,
        paidDate: r.date,
        paidAmount: r.amount,
        status: BillStatus.PAID,
        paymentSource: 'caixa_pequeno' as const,
        accountId: r.accountId,
        recurrenceType: 'none' as RecurrenceType,
        launchedBy: user?.email || '',
        isEstimate: false,
      }));
    setBills(prev => [...prev, ...newBills]);
    if (!isMockMode && user && newBills.length > 0) {
      const batch = writeBatch(db);
      for (const b of newBills) {
        batch.set(doc(billsRef, b.id), b);
      }
      await batch.commit().catch(e => console.error('Erro ao importar caixa pequeno em lote:', e));
    }
    return newBills.length;
  };

  const stripUndefined = <T,>(value: T): T => {
    if (Array.isArray(value)) {
      return value
        .map((item) => stripUndefined(item))
        .filter((item) => item !== undefined) as T;
    }

    if (value && typeof value === 'object') {
      return Object.entries(value as Record<string, unknown>).reduce((acc, [key, val]) => {
        if (val === undefined) return acc;
        const cleaned = stripUndefined(val);
        if (cleaned !== undefined) {
          acc[key] = cleaned;
        }
        return acc;
      }, {} as Record<string, unknown>) as T;
    }

    return value;
  };

  const saveBill = async (bill: Bill): Promise<boolean> => {
    if (isMockMode || !user) return false;
    const billsRef = getSharedBillsRef();
    try {
      const payload = stripUndefined(bill);
      await setDoc(doc(billsRef, bill.id), payload);
      console.log('Ã¢Å“â€¦ Fatura salva no Firebase:', payload);
      return true;
    } catch (e: any) {
      console.error('Ã¢ÂÅ’ Erro ao salvar fatura:', e.message);
      return false;
    }
  };

  const saveSupplier = async (supplier: Supplier) => {
    if (isMockMode || !user) return;
    const suppliersRef = getSharedSuppliersRef();
    try {
      await setDoc(doc(suppliersRef, supplier.id), supplier, { merge: true });
      console.log('Ã¢Å“â€¦ Fornecedor salvo no Firebase:', supplier);
    } catch (e: any) {
      console.error('Ã¢ÂÅ’ Erro ao salvar fornecedor:', e.message);
    }
  };

  const handleDuplicateBill = async (bill: Bill) => {
    const duplicatedBill: Bill = normalizeBillPaymentSource({
      ...bill,
      id: Math.random().toString(36).slice(2, 10),
      parentId: undefined,
      paymentSource: undefined,
      paymentBankTransactionId: undefined,
      paymentBankReference: undefined,
      paymentBankDescription: undefined,
      paymentBankDocument: undefined,
      bankMatches: undefined,
      paidDate: undefined,
      paidAmount: undefined,
      interestAmount: undefined,
      status: BillStatus.PENDING,
      launchedBy: user?.email || bill.launchedBy,
      observations: bill.observations
        ? `${bill.observations}\nDuplicada em ${new Date().toLocaleDateString('pt-BR')}.`
        : `Duplicada em ${new Date().toLocaleDateString('pt-BR')}.`,
    });

    setBills((prev) => [...prev, duplicatedBill]);

    if (isMockMode || !user) return;

    const saved = await saveBill(duplicatedBill);
    if (!saved) {
      setBills((prev) => prev.filter((item) => item.id !== duplicatedBill.id));
      alert('Nao foi possivel duplicar a conta. Tente novamente.');
    }
  };

  const handleBillSubmit = async (bill: Bill) => {
    const nextBill: Bill = normalizeBillPaymentSource({
      ...bill,
      id: bill.id || editingBill?.id || Math.random().toString(36).slice(2, 10),
    });
    const isNewBill = !editingBill;
    const isRecurringType = (value?: RecurrenceType) => value === 'monthly' || value === 'annual';
    const wasNotRecurring = editingBill && !isRecurringType(editingBill.recurrenceType);
    const isNowRecurring = isRecurringType(nextBill.recurrenceType);

    const buildSpecificBills = (base: Bill) => {
      const dues = base.specificDues || [];
      if (dues.length === 0) return [base];
      return dues.map((due, index) => ({
        ...base,
        id: `${base.id}-due-${index + 1}`,
        parentId: base.id,
        dueDate: due.date,
        amount: due.amount,
        status: BillStatus.PENDING,
        recurrenceType: 'none' as RecurrenceType,
        currentInstallment: index + 1,
        totalInstallments: dues.length,
        boletoLine: due.boletoLine,
        boletoAttachment: due.boletoAttachment,
        boletoExtractionSource: due.boletoExtractionSource,
        attachments: [...(base.invoice?.attachments || (base.invoice?.attachment ? [base.invoice.attachment] : [])), due.boletoAttachment].filter(Boolean),
        specificDues: undefined,
      }));
    };
    
    if (isMockMode) {
      setBills((prev) => {
        const toSave = nextBill.recurrenceType === 'specific' ? buildSpecificBills(nextBill) : [nextBill];
        const nextIds = new Set(toSave.map((b) => b.id));
        let updatedBills = prev.filter((b) => !nextIds.has(b.id));
        updatedBills = [...updatedBills, ...toSave];
        
        // Se ÃƒÂ© nova conta recorrente OU se mudou para recorrente, gerar instÃƒÂ¢ncias mensais
        if ((isNewBill || wasNotRecurring) && isNowRecurring) {
          const existingIds = new Set<string>(updatedBills.map(b => b.id));
          const generated = buildRecurringBillsForYear([nextBill], currentYear, 0, existingIds);
          updatedBills = [...updatedBills, ...generated];
          console.log(`Ã¢Å“â€¦ Geradas ${generated.length} instÃƒÂ¢ncias mensais para "${nextBill.description}"`);
        }
        
        return updatedBills;
      });
    } else {
      if (!user) {
        alert('Sessao expirada. Faca login novamente para salvar.');
        return;
      }

      if (nextBill.recurrenceType === 'specific') {
        const specificBills = buildSpecificBills(nextBill);
        const billsRef = getSharedBillsRef();
        const batch = writeBatch(db);
        specificBills.forEach((item) => {
          const payload = stripUndefined(item);
          batch.set(doc(billsRef, item.id), payload);
        });
        await batch.commit();
      } else {
        const saved = await saveBill(nextBill);
        if (!saved) {
          alert('Nao foi possivel salvar a conta. Verifique sua conexao e tente novamente.');
          return;
        }
      }
      
      // Se ÃƒÂ© nova conta recorrente OU se mudou para recorrente, gerar instÃƒÂ¢ncias mensais no Firebase
      if ((isNewBill || wasNotRecurring) && isNowRecurring) {
        const existingIds = new Set<string>(bills.map(b => b.id));
        const generated = buildRecurringBillsForYear([nextBill], currentYear, 0, existingIds);
        
        if (generated.length > 0 && user) {
          const billsRef = getSharedBillsRef();
          const batch = writeBatch(db);
          generated.forEach((generatedBill) => {
            const payload = stripUndefined(generatedBill);
            batch.set(doc(billsRef, generatedBill.id), payload);
          });
          await batch.commit().catch((e) => console.error('Erro ao criar instÃƒÂ¢ncias recorrentes:', e));
          console.log(`Ã¢Å“â€¦ Geradas ${generated.length} instÃƒÂ¢ncias mensais para "${nextBill.description}"`);
        }
      }
    }
    setEditingBill(undefined);
    setShowBillForm(false);
  };

  const handleSupplierSubmit = async (supplier: Supplier) => {
    const nextSupplier: Supplier = { ...supplier, id: supplier.id || editingSupplier?.id || Math.random().toString(36).slice(2, 10) };
    if (isMockMode) {
      setSuppliers((prev) => {
        const exists = prev.some((s) => s.id === nextSupplier.id);
        return exists ? prev.map((s) => (s.id === nextSupplier.id ? nextSupplier : s)) : [...prev, nextSupplier];
      });
    } else {
      await saveSupplier(nextSupplier);
    }
    setEditingSupplier(undefined);
    setShowSupplierForm(false);
  };

  const handleDeleteBill = async (id: string) => {
    if (isMockMode) {
      setBills((prev) => prev.filter((b) => b.id !== id));
      return;
    }
    if (!user) return;
    const billsRef = getSharedBillsRef();
    try {
      await updateDoc(doc(billsRef, id), {
        isDeleted: true,
        deletedAt: new Date().toISOString(),
        deletedBy: user.email || '',
      });
      setBills((prev) => prev.filter((b) => b.id !== id));
    } catch (e) {
      console.error('Erro ao excluir conta:', e);
      alert('Nao foi possivel excluir a conta. Tente novamente.');
    }
  };

  const handleDeleteSupplier = async (id: string) => {
    if (isMockMode) {
      setSuppliers((prev) => prev.filter((s) => s.id !== id));
      return;
    }
    if (!user) return;
    const suppliersRef = getSharedSuppliersRef();
    await deleteDoc(doc(suppliersRef, id));
  };

  const handleBillStatusChange = async (id: string, status: BillStatus) => {
    if (isMockMode) {
      setBills((prev) => prev.map((b) => (b.id === id ? { ...b, status } : b)));
      return;
    }
    if (!user) return;
    const billsRef = getSharedBillsRef();
    await updateDoc(doc(billsRef, id), { status });
  };

  const handleToggleEstimate = async (id: string) => {
    const bill = bills.find((b) => b.id === id);
    if (!bill) return;
    
    const newIsEstimate = !bill.isEstimate;
    
    if (isMockMode) {
      setBills((prev) => prev.map((b) => (b.id === id ? { ...b, isEstimate: newIsEstimate } : b)));
      return;
    }
    if (!user) return;
    const billsRef = getSharedBillsRef();
    await updateDoc(doc(billsRef, id), { isEstimate: newIsEstimate });
  };

  const handleBillInlineUpdate = async (bill: Bill) => {
    const normalizedBill = normalizeBillPaymentSource(bill);
    if (isMockMode) {
      setBills((prev) => prev.map((b) => (b.id === normalizedBill.id ? normalizedBill : b)));
      return;
    }
    if (!user) return;
    await saveBill(normalizedBill);
  };

  const handleBulkBankTransactionBillReconcile = async (transactions: BankTransaction[], bill: Bill) => {
    const conflict = transactions.find((tx) =>
      bills.some((item) => item.id !== bill.id && getBillBankMatches(item).some((m) => m.transactionId === tx.id))
    );
    if (conflict) throw new Error(`Lancamento ${conflict.description} ja conciliado com outra conta.`);

    const existingMatches = getBillBankMatches(bill).filter(
      (m) => !transactions.some((tx) => tx.id === m.transactionId)
    );
    const newMatches = transactions.map((tx) => ({
      transactionId: tx.id,
      date: tx.date,
      amount: tx.amount,
      reference: tx.reference,
      description: tx.description,
      document: tx.document,
      counterparty: tx.counterparty,
      reconciledAt: new Date().toISOString(),
      reconciledBy: user?.email ?? '',
    }));
    const nextBankMatches = [...existingMatches, ...newMatches].sort((a, b) => a.date.localeCompare(b.date));
    const totalPaid = nextBankMatches.reduce((sum, m) => sum + m.amount, 0);
    const latestPaidDate = nextBankMatches[nextBankMatches.length - 1]?.date;
    const isFullyPaid = totalPaid >= bill.amount - 0.01;
    const last = transactions[transactions.length - 1];
    const updatedBill = normalizeBillPaymentSource({
      ...bill,
      bankMatches: nextBankMatches,
      paidDate: isFullyPaid ? latestPaidDate : undefined,
      paidAmount: totalPaid,
      interestAmount: isFullyPaid ? totalPaid - bill.amount : undefined,
      paymentSource: 'bank',
      paymentBankTransactionId: last.id,
      paymentBankReference: last.reference,
      paymentBankDescription: last.description,
      paymentBankDocument: last.document,
      status: isFullyPaid ? BillStatus.PAID : BillStatus.PENDING,
    });
    if (isMockMode) {
      setBills((prev) => prev.map((item) => (item.id === updatedBill.id ? updatedBill : item)));
      return;
    }
    if (!user) throw new Error('Usuario nao autenticado.');
    const saved = await saveBill(updatedBill);
    if (!saved) throw new Error('Nao foi possivel salvar a conciliacao em grupo.');
  };

  const handleBankTransactionBillReconcile = async (transaction: BankTransaction, bill: Bill) => {
    const alreadyLinkedBill = bills.find(
      (item) =>
        item.id !== bill.id &&
        getBillBankMatches(item).some((match) => match.transactionId === transaction.id)
    );

    if (alreadyLinkedBill) {
      throw new Error(
        `Este lancamento ja foi conciliado com outra conta: ${alreadyLinkedBill.description}. Reabra a conciliacao antes de mover.`
      );
    }

    const nextBankMatches = [
      ...getBillBankMatches(bill).filter((match) => match.transactionId !== transaction.id),
      {
        transactionId: transaction.id,
        date: transaction.date,
        amount: transaction.amount,
        reference: transaction.reference,
        description: transaction.description,
        document: transaction.document,
        counterparty: transaction.counterparty,
        reconciledAt: new Date().toISOString(),
        reconciledBy: user.email,
      },
    ].sort((a, b) => a.date.localeCompare(b.date));

    const totalPaid = nextBankMatches.reduce((sum, match) => sum + match.amount, 0);
    const latestPaidDate = nextBankMatches[nextBankMatches.length - 1]?.date;
    const isFullyPaid = totalPaid >= bill.amount - 0.01;

    const updatedBill = normalizeBillPaymentSource({
      ...bill,
      bankMatches: nextBankMatches,
      paidDate: isFullyPaid ? latestPaidDate : undefined,
      paidAmount: totalPaid,
      interestAmount: isFullyPaid ? totalPaid - bill.amount : undefined,
      paymentSource: 'bank',
      paymentBankTransactionId: transaction.id,
      paymentBankReference: transaction.reference,
      paymentBankDescription: transaction.description,
      paymentBankDocument: transaction.document,
      status: isFullyPaid ? BillStatus.PAID : BillStatus.PENDING,
    });

    if (isMockMode) {
      setBills((prev) => prev.map((item) => (item.id === updatedBill.id ? updatedBill : item)));
      return;
    }

    if (!user) throw new Error('Usuario nao autenticado para reabrir a conciliacao.');
    const saved = await saveBill(updatedBill);
    if (!saved) throw new Error('Nao foi possivel salvar a reabertura da conciliacao.');
  };

  const isBankMatchForTransaction = (match: BillBankMatch, transaction: BankTransaction) =>
    doesBankMatchTransaction(match, transaction);

  const handleReopenBillReconciliation = async (bill: Bill) => {
    const updatedBill = normalizeBillPaymentSource({
      ...bill,
      bankMatches: undefined,
      paidDate: undefined,
      paidAmount: undefined,
      interestAmount: undefined,
      paymentSource: undefined,
      paymentBankTransactionId: undefined,
      paymentBankReference: undefined,
      paymentBankDescription: undefined,
      paymentBankDocument: undefined,
      status: BillStatus.PENDING,
    });

    if (isMockMode) {
      setBills((prev) => prev.map((item) => (item.id === updatedBill.id ? updatedBill : item)));
      return;
    }

    if (!user) throw new Error('Usuario nao autenticado para reabrir a conciliacao.');
    const saved = await saveBill(updatedBill);
    if (!saved) throw new Error('Nao foi possivel salvar a reabertura da conciliacao.');
  };

  const handleReopenTransactionBillReconciliation = async (transaction: BankTransaction, bill: Bill) => {
    let removedMatch = false;
    const remainingMatches = getBillBankMatches(bill)
      .filter((match) => {
        if (!removedMatch && isBankMatchForTransaction(match, transaction)) {
          removedMatch = true;
          return false;
        }

        return true;
      })
      .sort((a, b) => a.date.localeCompare(b.date));

    const totalPaid = remainingMatches.reduce((sum, match) => sum + match.amount, 0);
    const latestPaidDate = remainingMatches[remainingMatches.length - 1]?.date;
    const isFullyPaid = totalPaid >= bill.amount - 0.01;
    const latestMatch = remainingMatches[remainingMatches.length - 1];

    const updatedBill = normalizeBillPaymentSource({
      ...bill,
      bankMatches: remainingMatches.length > 0 ? remainingMatches : undefined,
      paidDate: isFullyPaid ? latestPaidDate : undefined,
      paidAmount: remainingMatches.length > 0 ? totalPaid : undefined,
      interestAmount: isFullyPaid ? totalPaid - bill.amount : undefined,
      paymentSource: remainingMatches.length > 0 ? 'bank' : undefined,
      paymentBankTransactionId: latestMatch?.transactionId,
      paymentBankReference: latestMatch?.reference,
      paymentBankDescription: latestMatch?.description,
      paymentBankDocument: latestMatch?.document,
      status: isFullyPaid ? BillStatus.PAID : BillStatus.PENDING,
    });

    if (isMockMode) {
      setBills((prev) => prev.map((item) => (item.id === updatedBill.id ? updatedBill : item)));
      return;
    }

    if (!user) return;
    await saveBill(updatedBill);
  };

  const handleCreateBillFromBankTransaction = async (transaction: BankTransaction, accountId: string): Promise<Bill> => {
    const normalizeText = (value?: string) =>
      (value || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    const supplierLabel = transaction.counterparty || transaction.description || 'Fornecedor nao identificado';
    const matchedSupplier = suppliers.find((supplier) => {
      const supplierText = normalizeText(supplier.name);
      const transactionText = normalizeText(supplierLabel);
      return supplierText === transactionText || supplierText.includes(transactionText) || transactionText.includes(supplierText);
    });

    let supplierId = matchedSupplier?.id || '';

    if (!supplierId) {
      const nextSupplier: Supplier = {
        id: `supplier-bank-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name: supplierLabel,
        taxId: transaction.document || '',
        email: '',
        accountId,
      };

      supplierId = nextSupplier.id;

      if (isMockMode) {
        setSuppliers((prev) => [...prev, nextSupplier]);
      } else {
        setSuppliers((prev) => [...prev, nextSupplier]);
        await saveSupplier(nextSupplier);
      }
    }

    const createdBill = normalizeBillPaymentSource({
      id: `bill-bank-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      supplierId,
      description: transaction.counterparty ? `${transaction.description} - ${transaction.counterparty}` : transaction.description,
      amount: transaction.amount,
      dueDate: transaction.date,
      paymentSource: 'bank',
      paymentBankTransactionId: transaction.id,
      paymentBankReference: transaction.reference,
      paymentBankDescription: transaction.description,
      paymentBankDocument: transaction.document,
      bankMatches: [{
        transactionId: transaction.id,
        date: transaction.date,
        amount: transaction.amount,
        reference: transaction.reference,
        description: transaction.description,
        document: transaction.document,
        counterparty: transaction.counterparty,
        reconciledAt: new Date().toISOString(),
        reconciledBy: user?.email,
      }],
      paidDate: transaction.date,
      paidAmount: transaction.amount,
      interestAmount: 0,
      status: BillStatus.PAID,
      recurrenceType: 'none',
      accountId,
      isEstimate: false,
      launchedBy: user?.email,
      observations: `Criada a partir do extrato bancario. Ref: ${transaction.reference || '-'}`,
    });

    if (isMockMode) {
      setBills((prev) => [...prev, createdBill]);
      return createdBill;
    }

    setBills((prev) => [...prev, createdBill]);
    if (!user) return createdBill;
    await saveBill(createdBill);
    return createdBill;
  };

  const handleQuickCreateBillFromBankTransaction = async (
    transaction: BankTransaction,
    supplierId: string,
    accountId: string,
  ): Promise<Bill> => {
    const createdBill = normalizeBillPaymentSource({
      id: `bill-bank-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      supplierId,
      description: transaction.counterparty
        ? `${transaction.description} - ${transaction.counterparty}`
        : transaction.description,
      amount: transaction.amount,
      dueDate: transaction.date,
      paymentSource: 'bank',
      paymentBankTransactionId: transaction.id,
      paymentBankReference: transaction.reference,
      paymentBankDescription: transaction.description,
      paymentBankDocument: transaction.document,
      bankMatches: [{
        transactionId: transaction.id,
        date: transaction.date,
        amount: transaction.amount,
        reference: transaction.reference,
        description: transaction.description,
        document: transaction.document,
        counterparty: transaction.counterparty,
        reconciledAt: new Date().toISOString(),
        reconciledBy: user?.email,
      }],
      paidDate: transaction.date,
      paidAmount: transaction.amount,
      interestAmount: 0,
      status: BillStatus.PAID,
      recurrenceType: 'none',
      accountId,
      isEstimate: false,
      launchedBy: user?.email,
      observations: `Criada a partir do extrato bancario. Ref: ${transaction.reference || '-'}`,
    });

    setBills((prev) => [...prev, createdBill]);
    if (!isMockMode && user) await saveBill(createdBill);
    return createdBill;
  };

  const handleBulkDeleteBillsByDateRange = async (startDate: string, endDate: string): Promise<number> => {
    const toDelete = bills.filter((b) => !b.isDeleted && b.dueDate >= startDate && b.dueDate <= endDate);
    if (toDelete.length === 0) return 0;

    if (isMockMode) {
      setBills((prev) => prev.filter((b) => b.isDeleted || b.dueDate < startDate || b.dueDate > endDate));
      return toDelete.length;
    }

    if (!user) return 0;
    const billsRef = getSharedBillsRef();
    const CHUNK = 499;
    for (let i = 0; i < toDelete.length; i += CHUNK) {
      const batch = writeBatch(db);
      toDelete.slice(i, i + CHUNK).forEach((b) => {
        batch.update(doc(billsRef, b.id), {
          isDeleted: true,
          deletedAt: new Date().toISOString(),
          deletedBy: user.email || '',
        });
      });
      await batch.commit();
    }
    setBills((prev) => prev.filter((b) => b.isDeleted || b.dueDate < startDate || b.dueDate > endDate));
    return toDelete.length;
  };

  const handleAddRevenue = async (revenue: Omit<Revenue, 'id'>) => {
    const id = `rev-${Date.now()}`;
    const newRevenue = { ...revenue, id };
    
    setRevenues((prev) => [...prev, newRevenue]);
    
    if (isMockMode) return;
    if (!user) return;
    const revenuesRef = getSharedRevenuesRef();
    await setDoc(doc(revenuesRef, id), newRevenue);
  };

  const handleEditRevenue = async (id: string, revenue: Omit<Revenue, 'id'>) => {
    setRevenues((prev) => prev.map((r) => (r.id === id ? { ...r, ...revenue } : r)));
    
    if (isMockMode) return;
    if (!user) return;
    const revenuesRef = getSharedRevenuesRef();
    await updateDoc(doc(revenuesRef, id), revenue);
  };

  const handleDeleteRevenue = async (id: string) => {
    if (isMockMode) {
      setRevenues((prev) => prev.filter((r) => r.id !== id));
      return;
    }
    if (!user) return;
    const revenuesRef = getSharedRevenuesRef();
    await deleteDoc(doc(revenuesRef, id));
  };

  useEffect(() => {
    if (loading || !user) return;

    const isSuperAdmin = user.email === SUPER_ADMIN_EMAIL;
    const normalizedUserEmail = normalizeEmail(user.email);
    const matchingTeamMembers = team.filter((member) => normalizeEmail(member.email) === normalizedUserEmail);
    const teamContext = resolveTeamContextForMembers(matchingTeamMembers);
    const resolvedPermissions = isSuperAdmin ? fullPermissions : teamContext.resolvedPermissions;
    const resolvedRole = isSuperAdmin ? UserRole.ADMIN : teamContext.resolvedRole;

    const canAccessTargetView = (targetView: typeof view) => {
      if (targetView === 'dashboard') {
        return resolvedRole === UserRole.ADMIN && Boolean(resolvedPermissions.dashboard);
      }
      if (targetView === 'reconciliation') {
        return hasAccess(resolvedPermissions.reconciliation) || hasAccess(resolvedPermissions['bills_reconciliation']);
      }
      if (targetView === 'cashbox-report') {
        return hasAccess(resolvedPermissions['cashbox-report']) || hasAccess(resolvedPermissions.cashbox);
      }
      if (targetView === 'cashbox-entry') {
        return hasAccess(resolvedPermissions.cashbox);
      }
      if (targetView === 'caixa-pequeno') {
        return hasAccess(resolvedPermissions.cashbox);
      }
      const permissionKey = targetView as keyof typeof resolvedPermissions;
      return hasAccess(resolvedPermissions[permissionKey] as string | boolean | undefined);
    };

    if (canAccessTargetView(view)) return;

    const nextAllowedView = ([
      'bills',
      'cashbox',
      'suppliers',
      'accounts',
      'dre',
      'reconciliation',
      'team',
      'profile',
      'dashboard',
    ] as const).find((candidate) => canAccessTargetView(candidate));

    if (nextAllowedView && nextAllowedView !== view) {
      setView(nextAllowedView);
    }
  }, [loading, user, team, view]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center gap-6 p-4">
        <Loader2 className="animate-spin text-indigo-500" size={64} />
      </div>
    );
  }

  if (!user) return <Login />;

  const isSuperAdmin = user.email === SUPER_ADMIN_EMAIL;
  const normalizedUserEmail = normalizeEmail(user.email);
  const matchingTeamMembers = team.filter((member) => normalizeEmail(member.email) === normalizedUserEmail);
  const teamContext = resolveTeamContextForMembers(matchingTeamMembers);
  const matchedTeamMember = teamContext.matchedTeamMember;
  const resolvedRole = isSuperAdmin ? UserRole.ADMIN : teamContext.resolvedRole;
  const resolvedPermissions = isSuperAdmin ? fullPermissions : teamContext.resolvedPermissions;

  const currentUser: TeamMember = {
    id: matchedTeamMember?.id || user.uid,
    name: isSuperAdmin ? 'Fabiana JJVSF' : (matchedTeamMember?.name || user.displayName || 'Usuario'),
    email: user.email || '',
    role: resolvedRole,
    active: isSuperAdmin ? true : (matchedTeamMember ? teamContext.hasAnyActiveMember : false),
    permissions: resolvedPermissions,
    categoryPermissions: teamContext.mergedCategoryPermissions.length > 0 ? teamContext.mergedCategoryPermissions : matchedTeamMember?.categoryPermissions,
    inviteSent: matchedTeamMember?.inviteSent,
    inviteSentDate: matchedTeamMember?.inviteSentDate,
  };
  const canAccessView = (targetView: typeof view) => {
    if (!currentUser.permissions) return false;
    if (targetView === 'dashboard') {
      return currentUser.role === UserRole.ADMIN && Boolean(currentUser.permissions.dashboard);
    }
    if (targetView === 'reconciliation') {
      return hasAccess(currentUser.permissions.reconciliation) || hasAccess(currentUser.permissions['bills_reconciliation']);
    }
    if (targetView === 'cashbox-report') {
      return hasAccess(currentUser.permissions['cashbox-report']) || hasAccess(currentUser.permissions.cashbox);
    }
    if (targetView === 'cashbox-entry') {
      return hasAccess(currentUser.permissions.cashbox);
    }
    if (targetView === 'caixa-pequeno') {
      return hasAccess(currentUser.permissions.cashbox);
    }
    const permissionKey = targetView as keyof typeof currentUser.permissions;
    return hasAccess(currentUser.permissions[permissionKey] as string | boolean | undefined);
  };
  const currentViewAllowed = canAccessView(view);
  const fallbackView = ([
    'bills',
    'cashbox',
    'suppliers',
    'accounts',
    'dre',
    'reconciliation',
    'team',
    'profile',
    'dashboard',
  ] as const).find((candidate) => canAccessView(candidate)) || null;
  const viewLabels: Record<typeof view, string> = {
    dashboard: 'Dashboard',
    bills: 'Contas a Pagar',
    suppliers: 'Fornecedores',
    revenues: 'Receitas',
    team: 'Equipe',
    profile: 'Empresa',
    accounts: 'Centro de Custo',
    dre: 'DRE',
    cashbox: 'Caixa',
    'cashbox-report': 'Relatorio de Caixa',
    'cashbox-entry': 'Lancamentos Caixa',
    reconciliation: 'Extrato Bancario',
    'caixa-pequeno': 'Dinheiro',
  };

  return (
    <Layout currentView={view} setView={setView} user={currentUser} company={company}>
      <main className="flex-1 overflow-y-auto p-4 md:p-8">
        {firestoreError && (
          <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-rose-700 text-sm font-bold">
            {firestoreError}
          </div>
        )}
        {!currentViewAllowed && (
          <div className="flex items-center justify-center h-screen">
            <div className="text-center">
              <h1 className="text-3xl font-bold text-slate-800 mb-4">Acesso Negado</h1>
              <p className="text-slate-600 mb-6">
                {matchingTeamMembers.length === 0 && !isSuperAdmin
                  ? 'Seu usuario esta autenticado, mas ainda nao foi liberado na equipe deste projeto.'
                  : 'Seu perfil nao possui permissao para abrir este modulo.'}
              </p>
              {fallbackView && fallbackView !== view && (
                <button
                  onClick={() => setView(fallbackView)}
                  className="px-6 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
                >
                  Ir para {viewLabels[fallbackView]}
                </button>
              )}
            </div>
          </div>
        )}
        {currentViewAllowed && (
          <>
            {view === 'dashboard' && (
              <Dashboard
                bills={bills}
                suppliers={suppliers}
                accounts={accounts}
                onEditBill={(bill) => {
                  setEditingBill(bill);
                  setShowBillForm(true);
                }}
                onStatusChange={handleBillStatusChange}
              />
            )}
            {view === 'bills' && (
              <BillList
                bills={bills}
                suppliers={suppliers}
                accounts={accounts}
                teamMembers={team}
                onEdit={(bill) => {
                  setEditingBill(bill);
                  setShowBillForm(true);
                }}
            onDelete={handleDeleteBill}
            onStatusChange={handleBillStatusChange}
            onUpdate={handleBillInlineUpdate}
            onDuplicate={handleDuplicateBill}
            onReopenReconciliation={handleReopenBillReconciliation}
            onToggleEstimate={handleToggleEstimate}
                onOpenForm={() => {
                  setEditingBill(undefined);
                  setShowBillForm(true);
                }}
                userRole={currentUser.role}
                canEditBills={isEditor(currentUser.permissions?.bills)}
                companyName={company.name}
              />
            )}
            {view === 'suppliers' && (
              <SupplierList
                suppliers={suppliers}
                accounts={accounts}
                onEdit={(supplier) => {
                  setEditingSupplier(supplier);
                  setShowSupplierForm(true);
                }}
                onDelete={handleDeleteSupplier}
                onOpenForm={() => {
                  setEditingSupplier(undefined);
                  setShowSupplierForm(true);
                }}
                userRole={currentUser.role}
                canCreateSupplier={currentUser.permissions?.canCreateSupplier}
              />
            )}
            {view === 'accounts' && <AccountManagement accounts={accounts} setAccounts={setAccountsWithPersist} canManage={isEditor(currentUser.permissions?.accounts)} />}
            {view === 'dre' && <DRE bills={bills} revenues={revenues} accounts={accounts} setRevenues={setRevenuesWithPersist} />}
            {view === 'cashbox' && <TrinksReconciliation user={currentUser} onBack={() => setView('dashboard')} onShowCashBoxEntry={() => setView('cashbox-entry')} />}
            {view === 'cashbox-entry' && <CashBox user={currentUser} onShowReport={() => setView('cashbox-report')} onShowTrinksReconciliation={() => setView('cashbox')} />}
            {view === 'cashbox-report' && <CashBoxReport onBack={() => setView('cashbox-entry')} canEdit={currentUser.permissions?.canEditCashBoxStatus} />}
            {view === 'reconciliation' && (
              <BankReconciliationComponent
                user={currentUser}
                bills={bills}
                suppliers={suppliers}
                accounts={accounts}
                onReconcileBill={handleBankTransactionBillReconcile}
                onReconcileMultiple={handleBulkBankTransactionBillReconcile}
                onReopenReconciliation={handleReopenTransactionBillReconciliation}
                onCreateBillFromTransaction={handleCreateBillFromBankTransaction}
                onQuickCreateBillFromTransaction={handleQuickCreateBillFromBankTransaction}
                onBulkDeleteBillsByDateRange={handleBulkDeleteBillsByDateRange}
              />
            )}
            {view === 'caixa-pequeno' && (
              <CaixaPequeno
                bills={bills}
                accounts={accounts}
                config={caixaPequenoConfig}
                onSaveConfig={handleSaveCaixaPequenoConfig}
                onCreateExpense={handleCaixaPequenoExpense}
                onBulkImportExpenses={handleBulkCaixaPequenoImport}
                onUpdateExpense={handleUpdateCaixaPequenoExpense}
                onDeleteExpense={handleDeleteCaixaPequenoExpense}
              />
            )}
            {view === 'team' && <TeamManagement team={team} setTeam={setTeamWithPersist} canManage={isEditor(currentUser.permissions?.team)} accounts={accounts} onResyncAccess={handleResyncWorkspaceAccess} />}
            {view === 'profile' && <CompanyProfile company={company} setCompany={setCompanyWithPersist} canEdit={Boolean(currentUser.permissions?.profile)} />}
          </>
        )}
      </main>

      {showBillForm && canAccessView('bills') && (
        <BillForm
          suppliers={suppliers}
          accounts={accounts}
          onClose={() => {
            setShowBillForm(false);
            setEditingBill(undefined);
          }}
          onSubmit={handleBillSubmit}
          initialData={editingBill}
          userEmail={user.email}
          canEditBillDate={currentUser.permissions?.canEditBillDate}
        />
      )}

      {showSupplierForm && canAccessView('suppliers') && (
        <SupplierForm
          accounts={accounts}
          onClose={() => {
            setShowSupplierForm(false);
            setEditingSupplier(undefined);
          }}
          onSubmit={handleSupplierSubmit}
          initialData={editingSupplier}
        />
      )}
    </Layout>
  );
};

export default App;

