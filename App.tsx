
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

import { Login } from './Login';
import { auth, db, isMockMode } from './firebase';
import { Bill, Supplier, BillStatus, UserRole, TeamMember, Company, ChartOfAccount, Revenue, RecurrenceType } from './types';
import { collection, doc, onSnapshot, setDoc, deleteDoc, updateDoc, writeBatch, getDocs, getDoc } from 'firebase/firestore';
import { Loader2 } from 'lucide-react';

const SHARED_WORKSPACE_ID = 'paga-ai2-shared';

const App: React.FC = () => {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'dashboard' | 'bills' | 'suppliers' | 'revenues' | 'team' | 'profile' | 'accounts' | 'dre' | 'cashbox' | 'cashbox-report' | 'reconciliation'>('dashboard');
  
  const [bills, setBills] = useState<Bill[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [accounts, setAccounts] = useState<ChartOfAccount[]>([]);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [revenues, setRevenues] = useState<Revenue[]>([]);
  const defaultCompany: Company = { name: 'Unidade Vila Leopoldina', taxId: '', email: '', phone: '', address: '' };
  const [company, setCompany] = useState<Company>(defaultCompany);

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

  // Validar integridade das contas: PAID sem paidDate devem ser PENDING
  const validateBills = (billsToValidate: Bill[]): Bill[] => {
    return billsToValidate.map(bill => {
      if (bill.status === BillStatus.PAID && !bill.paidDate) {
        console.warn(`⚠️ Conta "${bill.description}" estava PAID sem Data de Pagamento - revertendo para PENDENTE`);
        return { ...bill, status: BillStatus.PENDING };
      }
      return bill;
    });
  };

  // Contas recorrentes mensais fixas
  const defaultRecurringBills: Bill[] = [
    { id: 'rec-1', supplierId: '', description: 'LED10', amount: 1264.59, dueDate: '2026-02-01', status: BillStatus.PENDING, recurrenceType: 'monthly', totalInstallments: 12, accountId: '1', isEstimate: true },
    { id: 'rec-2', supplierId: '', description: 'MANOBRISTA - RECORRENTE', amount: 3000.00, dueDate: '2026-02-05', status: BillStatus.PENDING, recurrenceType: 'monthly', totalInstallments: 12, accountId: '19', isEstimate: true },
    { id: 'rec-3', supplierId: '', description: 'VIVO INTERNET COD 899927163920', amount: 149.58, dueDate: '2026-02-08', status: BillStatus.PENDING, recurrenceType: 'monthly', totalInstallments: 12, accountId: '35', isEstimate: true },
    { id: 'rec-4', supplierId: '', description: 'CONTABILIDADE REPRECON', amount: 850.00, dueDate: '2026-02-15', status: BillStatus.PENDING, recurrenceType: 'monthly', totalInstallments: 12, accountId: '8', isEstimate: true },
    { id: 'rec-5', supplierId: '', description: 'CONTBEL - CONTABILIDADE KELLY', amount: 650.00, dueDate: '2026-02-20', status: BillStatus.PENDING, recurrenceType: 'monthly', totalInstallments: 12, accountId: '42', isEstimate: true },
    { id: 'rec-6', supplierId: '', description: 'DAS EQUIPE - MENSAL', amount: 1051.70, dueDate: '2026-02-20', status: BillStatus.PENDING, recurrenceType: 'monthly', totalInstallments: 12, accountId: '43', isEstimate: true },
    { id: 'rec-7', supplierId: '', description: 'ALUGUEL - RGB EMPREED', amount: 17260.86, dueDate: '2026-02-25', status: BillStatus.PENDING, recurrenceType: 'monthly', totalInstallments: 12, accountId: '4', isEstimate: true },
    { id: 'rec-8', supplierId: '21', description: 'FRANQUEADORA - TAXA DE PUBLICIDADE', amount: 1784.81, dueDate: '2026-02-25', status: BillStatus.PENDING, recurrenceType: 'monthly', totalInstallments: 12, accountId: '25', isEstimate: true },
    { id: 'rec-9', supplierId: '', description: 'IPTU - CARLOS WEBER 1048', amount: 1772.62, dueDate: '2026-02-25', status: BillStatus.PENDING, recurrenceType: 'monthly', totalInstallments: 12, accountId: '16', isEstimate: true },
    { id: 'rec-10', supplierId: '', description: 'SABESP - ÁGUA', amount: 2070.86, dueDate: '2026-02-25', status: BillStatus.PENDING, recurrenceType: 'monthly', totalInstallments: 12, accountId: '2', isEstimate: true },
  ];

  // Contas pagas são adicionadas apenas quando o usuário marca manualmente com paidDate
  const defaultPaidBills: Bill[] = [
    { id: 'paid-02052026-fabiana', supplierId: '', description: 'FOLHA DE PAGAMENTO DIA 05 - COMISSÕES - GESTOR ADMINISTRATIVO - PROLABORE - FABIANA', amount: 13000.00, dueDate: '2026-02-05', paidDate: '2026-02-05', status: BillStatus.PAID, recurrenceType: 'none', accountId: '97', isEstimate: false },
    { id: 'paid-02052026-caio', supplierId: '', description: 'FOLHA DE PAGAMENTO DIA 05 - COMISSÕES - GESTOR ADMINISTRATIVO - PROLABORE - CAIO', amount: 13000.00, dueDate: '2026-02-05', paidDate: '2026-02-05', status: BillStatus.PAID, recurrenceType: 'none', accountId: '98', isEstimate: false },
    // Lançamentos individuais de março a dezembro - NÃO SÃO RECORRENTES, são criados uma única vez
    { id: 'manual-03052026-fabiana', supplierId: '', description: 'FOLHA DE PAGAMENTO DIA 05 - COMISSÕES - GESTOR ADMINISTRATIVO - PROLABORE - FABIANA', amount: 13000.00, dueDate: '2026-03-05', status: BillStatus.PENDING, recurrenceType: 'none', accountId: '97', isEstimate: true },
    { id: 'manual-04052026-fabiana', supplierId: '', description: 'FOLHA DE PAGAMENTO DIA 05 - COMISSÕES - GESTOR ADMINISTRATIVO - PROLABORE - FABIANA', amount: 13000.00, dueDate: '2026-04-05', status: BillStatus.PENDING, recurrenceType: 'none', accountId: '97', isEstimate: true },
    { id: 'manual-05052026-fabiana', supplierId: '', description: 'FOLHA DE PAGAMENTO DIA 05 - COMISSÕES - GESTOR ADMINISTRATIVO - PROLABORE - FABIANA', amount: 13000.00, dueDate: '2026-05-05', status: BillStatus.PENDING, recurrenceType: 'none', accountId: '97', isEstimate: true },
    { id: 'manual-06052026-fabiana', supplierId: '', description: 'FOLHA DE PAGAMENTO DIA 05 - COMISSÕES - GESTOR ADMINISTRATIVO - PROLABORE - FABIANA', amount: 13000.00, dueDate: '2026-06-05', status: BillStatus.PENDING, recurrenceType: 'none', accountId: '97', isEstimate: true },
    { id: 'manual-07052026-fabiana', supplierId: '', description: 'FOLHA DE PAGAMENTO DIA 05 - COMISSÕES - GESTOR ADMINISTRATIVO - PROLABORE - FABIANA', amount: 13000.00, dueDate: '2026-07-05', status: BillStatus.PENDING, recurrenceType: 'none', accountId: '97', isEstimate: true },
    { id: 'manual-08052026-fabiana', supplierId: '', description: 'FOLHA DE PAGAMENTO DIA 05 - COMISSÕES - GESTOR ADMINISTRATIVO - PROLABORE - FABIANA', amount: 13000.00, dueDate: '2026-08-05', status: BillStatus.PENDING, recurrenceType: 'none', accountId: '97', isEstimate: true },
    { id: 'manual-09052026-fabiana', supplierId: '', description: 'FOLHA DE PAGAMENTO DIA 05 - COMISSÕES - GESTOR ADMINISTRATIVO - PROLABORE - FABIANA', amount: 13000.00, dueDate: '2026-09-05', status: BillStatus.PENDING, recurrenceType: 'none', accountId: '97', isEstimate: true },
    { id: 'manual-10052026-fabiana', supplierId: '', description: 'FOLHA DE PAGAMENTO DIA 05 - COMISSÕES - GESTOR ADMINISTRATIVO - PROLABORE - FABIANA', amount: 13000.00, dueDate: '2026-10-05', status: BillStatus.PENDING, recurrenceType: 'none', accountId: '97', isEstimate: true },
    { id: 'manual-11052026-fabiana', supplierId: '', description: 'FOLHA DE PAGAMENTO DIA 05 - COMISSÕES - GESTOR ADMINISTRATIVO - PROLABORE - FABIANA', amount: 13000.00, dueDate: '2026-11-05', status: BillStatus.PENDING, recurrenceType: 'none', accountId: '97', isEstimate: true },
    { id: 'manual-12052026-fabiana', supplierId: '', description: 'FOLHA DE PAGAMENTO DIA 05 - COMISSÕES - GESTOR ADMINISTRATIVO - PROLABORE - FABIANA', amount: 13000.00, dueDate: '2026-12-05', status: BillStatus.PENDING, recurrenceType: 'none', accountId: '97', isEstimate: true },
    { id: 'manual-03052026-caio', supplierId: '', description: 'FOLHA DE PAGAMENTO DIA 05 - COMISSÕES - GESTOR ADMINISTRATIVO - PROLABORE - CAIO', amount: 13000.00, dueDate: '2026-03-05', status: BillStatus.PENDING, recurrenceType: 'none', accountId: '98', isEstimate: true },
    { id: 'manual-04052026-caio', supplierId: '', description: 'FOLHA DE PAGAMENTO DIA 05 - COMISSÕES - GESTOR ADMINISTRATIVO - PROLABORE - CAIO', amount: 13000.00, dueDate: '2026-04-05', status: BillStatus.PENDING, recurrenceType: 'none', accountId: '98', isEstimate: true },
    { id: 'manual-05052026-caio', supplierId: '', description: 'FOLHA DE PAGAMENTO DIA 05 - COMISSÕES - GESTOR ADMINISTRATIVO - PROLABORE - CAIO', amount: 13000.00, dueDate: '2026-05-05', status: BillStatus.PENDING, recurrenceType: 'none', accountId: '98', isEstimate: true },
    { id: 'manual-06052026-caio', supplierId: '', description: 'FOLHA DE PAGAMENTO DIA 05 - COMISSÕES - GESTOR ADMINISTRATIVO - PROLABORE - CAIO', amount: 13000.00, dueDate: '2026-06-05', status: BillStatus.PENDING, recurrenceType: 'none', accountId: '98', isEstimate: true },
    { id: 'manual-07052026-caio', supplierId: '', description: 'FOLHA DE PAGAMENTO DIA 05 - COMISSÕES - GESTOR ADMINISTRATIVO - PROLABORE - CAIO', amount: 13000.00, dueDate: '2026-07-05', status: BillStatus.PENDING, recurrenceType: 'none', accountId: '98', isEstimate: true },
    { id: 'manual-08052026-caio', supplierId: '', description: 'FOLHA DE PAGAMENTO DIA 05 - COMISSÕES - GESTOR ADMINISTRATIVO - PROLABORE - CAIO', amount: 13000.00, dueDate: '2026-08-05', status: BillStatus.PENDING, recurrenceType: 'none', accountId: '98', isEstimate: true },
    { id: 'manual-09052026-caio', supplierId: '', description: 'FOLHA DE PAGAMENTO DIA 05 - COMISSÕES - GESTOR ADMINISTRATIVO - PROLABORE - CAIO', amount: 13000.00, dueDate: '2026-09-05', status: BillStatus.PENDING, recurrenceType: 'none', accountId: '98', isEstimate: true },
    { id: 'manual-10052026-caio', supplierId: '', description: 'FOLHA DE PAGAMENTO DIA 05 - COMISSÕES - GESTOR ADMINISTRATIVO - PROLABORE - CAIO', amount: 13000.00, dueDate: '2026-10-05', status: BillStatus.PENDING, recurrenceType: 'none', accountId: '98', isEstimate: true },
    { id: 'manual-11052026-caio', supplierId: '', description: 'FOLHA DE PAGAMENTO DIA 05 - COMISSÕES - GESTOR ADMINISTRATIVO - PROLABORE - CAIO', amount: 13000.00, dueDate: '2026-11-05', status: BillStatus.PENDING, recurrenceType: 'none', accountId: '98', isEstimate: true },
    { id: 'manual-12052026-caio', supplierId: '', description: 'FOLHA DE PAGAMENTO DIA 05 - COMISSÕES - GESTOR ADMINISTRATIVO - PROLABORE - CAIO', amount: 13000.00, dueDate: '2026-12-05', status: BillStatus.PENDING, recurrenceType: 'none', accountId: '98', isEstimate: true },
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
          console.log(`✅ ${bills.filter((b: Bill) => b.status === BillStatus.PAID).length} contas estornadas para PENDENTE`);
          window.location.href = '/';
        }
      } catch (e) {
        console.error('Erro ao estornar contas:', e);
      }
    }
  }, []);

  const SUPER_ADMIN_EMAIL = 'fabianajjvsf@gmail.com';

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

      // Gerar para TODOS OS MESES DO ANO (0 a 11), não apenas a partir do mês atual
      for (let month = 0; month < 12; month += 1) {
        const monthKey = String(month + 1).padStart(2, '0');
        const newId = `${bill.id}-${year}-${monthKey}`;

        if (existingIds.has(newId)) continue;
        if (month === currentMonth && existingIds.has(bill.id)) continue;

        const clampedDay = getClampedDay(year, month, baseDay);
        const dayKey = String(clampedDay).padStart(2, '0');
        const dueDate = `${year}-${monthKey}-${dayKey}`;

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
        console.warn('Arquivo seed-bills.json não encontrado');
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

      console.log(`✅ Carregadas ${imported.length} contas do seed-bills.json`);
      return [...existing, ...imported];
    } catch (e) {
      console.error('Erro ao carregar seed-bills.json:', e);
      return existing;
    }
  };

  const defaultAccounts: ChartOfAccount[] = [
    // DESPESAS FIXAS
    { id: '1', name: 'ADVOGADO - DORIVAL', category: 'FIXED_EXPENSES', type: 'FIXED' },
    { id: '2', name: 'ÁGUA - SABESP', category: 'FIXED_EXPENSES', type: 'FIXED' },
    { id: '3', name: 'ALARME - EXTREMA', category: 'FIXED_EXPENSES', type: 'FIXED' },
    { id: '4', name: 'ALUGUEL 8000', category: 'FIXED_EXPENSES', type: 'FIXED' },
    { id: '5', name: 'CAIXA PEQUENO', category: 'FIXED_EXPENSES', type: 'FIXED' },
    { id: '6', name: 'CARTÃO DE CRÉDITO INTER EMPRESAS', category: 'FIXED_EXPENSES', type: 'FIXED' },
    { id: '7', name: 'CERTIFICADO DIGITAL A1', category: 'FIXED_EXPENSES', type: 'FIXED' },
    { id: '8', name: 'CONTABILIDADE', category: 'FIXED_EXPENSES', type: 'FIXED' },
    { id: '9', name: 'DEFIS - SIMPLES NACIONAL', category: 'FIXED_EXPENSES', type: 'FIXED' },
    { id: '10', name: 'DESPESAS BANCÁRIAS', category: 'FIXED_EXPENSES', type: 'FIXED' },
    { id: '11', name: 'DOMÍNIO APARE', category: 'FIXED_EXPENSES', type: 'FIXED' },
    { id: '12', name: 'DOMÍNIO IAFABIANA', category: 'FIXED_EXPENSES', type: 'FIXED' },
    { id: '13', name: 'DOMÍNIO MARIA VANTAGEM', category: 'FIXED_EXPENSES', type: 'FIXED' },
    { id: '14', name: 'ENERGIA - ELETROPAULO', category: 'FIXED_EXPENSES', type: 'FIXED' },
    { id: '15', name: 'EXTINTORES', category: 'FIXED_EXPENSES', type: 'FIXED' },
    { id: '16', name: 'IPTU', category: 'FIXED_EXPENSES', type: 'FIXED' },
    { id: '17', name: 'ITENS COMEMORATIVOS', category: 'FIXED_EXPENSES', type: 'FIXED' },
    { id: '18', name: 'LICENÇA DE FUNCIONAMENTO', category: 'FIXED_EXPENSES', type: 'FIXED' },
    { id: '19', name: 'MANOBRISTA 1000', category: 'FIXED_EXPENSES', type: 'FIXED' },
    { id: '20', name: 'MANUTENÇÃO - OBRA', category: 'FIXED_EXPENSES', type: 'FIXED' },
    { id: '21', name: 'REPARO EQUIPAMENTOS', category: 'FIXED_EXPENSES', type: 'FIXED' },
    { id: '22', name: 'MARKETING - SITE', category: 'FIXED_EXPENSES', type: 'FIXED' },
    { id: '23', name: 'MARKETING VAN BRADESCO', category: 'FIXED_EXPENSES', type: 'FIXED' },
    { id: '24', name: 'MARKETING GRÁFICA', category: 'FIXED_EXPENSES', type: 'FIXED' },
    { id: '25', name: 'MKT FRANQUEADORA', category: 'FIXED_EXPENSES', type: 'FIXED' },
    { id: '26', name: 'MÓVEIS - INVESTIMENTO', category: 'FIXED_EXPENSES', type: 'FIXED' },
    { id: '27', name: 'PRODUTO DE LIMPEZA', category: 'FIXED_EXPENSES', type: 'FIXED' },
    { id: '28', name: 'SEGURO SALÃO', category: 'FIXED_EXPENSES', type: 'FIXED' },
    { id: '29', name: 'SISTEMA W8 / TRINKS', category: 'FIXED_EXPENSES', type: 'FIXED' },
    { id: '30', name: 'SISTEMA INTEGRAÇÃO TRINKS/BITRIX/ALE', category: 'FIXED_EXPENSES', type: 'FIXED' },
    { id: '31', name: 'SISTEMA BITRIX', category: 'FIXED_EXPENSES', type: 'FIXED' },
    { id: '32', name: 'BITRIX - LUCAS - ASSESSORIA', category: 'FIXED_EXPENSES', type: 'FIXED' },
    { id: '33', name: 'TELEFONE - CELULARES VENC 20', category: 'FIXED_EXPENSES', type: 'FIXED' },
    { id: '34', name: 'TELEFONE - VIVO 3682-3002', category: 'FIXED_EXPENSES', type: 'FIXED' },
    { id: '35', name: 'TELEFONE - SONAVOIP', category: 'FIXED_EXPENSES', type: 'FIXED' },
    { id: '36', name: 'TELEFONE - VIVONET', category: 'FIXED_EXPENSES', type: 'FIXED' },
    { id: '37', name: 'TELEFONE - CEL APARE', category: 'FIXED_EXPENSES', type: 'FIXED' },
    { id: '38', name: 'HCF NACIONAL', category: 'FIXED_EXPENSES', type: 'FIXED' },
    
    // COMISSÕES E SALÁRIOS VARIÁVEIS
    { id: '39', name: 'FOLHA DE PAGAMENTO - COMISSIONADOS DIA 05', category: 'COMMISSION', type: 'VARIABLE' },
    { id: '40', name: 'FOLHA DE PAGAMENTO - COMISSIONADOS DIA 20', category: 'COMMISSION', type: 'VARIABLE' },
    { id: '41', name: 'COMISSÃO NOIVAS', category: 'COMMISSION', type: 'VARIABLE' },
    { id: '42', name: 'CONTABILIDADE MEIS KELLY', category: 'COMMISSION', type: 'VARIABLE' },
    { id: '43', name: 'DAS EQUIPE', category: 'COMMISSION', type: 'VARIABLE' },
    { id: '44', name: 'DAS ACORDO PROFISSIONAIS', category: 'COMMISSION', type: 'VARIABLE' },
    { id: '45', name: 'CABELO CLIENTE REEMBOLSO PROFISSIONAL', category: 'COMMISSION', type: 'VARIABLE' },
    { id: '46', name: 'DÉBITOS CAFÉ TERCERIZADO EQUIPE', category: 'COMMISSION', type: 'VARIABLE' },
    { id: '47', name: 'FREE LANCE ESTÉTICA', category: 'COMMISSION', type: 'VARIABLE' },
    { id: '48', name: 'VALE EXTRA RODOLFO', category: 'COMMISSION', type: 'VARIABLE' },
    { id: '49', name: 'VALE EXTRA THAYNÁ', category: 'COMMISSION', type: 'VARIABLE' },
    { id: '50', name: 'VALE EXTRA OTAVIO', category: 'COMMISSION', type: 'VARIABLE' },
    { id: '51', name: 'VALE EXTRA RAFA', category: 'COMMISSION', type: 'VARIABLE' },
    { id: '52', name: 'VALE EXTRA LUCIO', category: 'COMMISSION', type: 'VARIABLE' },
    { id: '53', name: 'BÔNUS ADM', category: 'COMMISSION', type: 'VARIABLE' },
    
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
    { id: '63', name: 'SAECO - café - PILÃO', category: 'PRODUCT_COST', type: 'VARIABLE' },
    { id: '64', name: 'SOFTCLEAN', category: 'PRODUCT_COST', type: 'VARIABLE' },
    { id: '65', name: 'TRUSS', category: 'PRODUCT_COST', type: 'VARIABLE' },
    { id: '66', name: 'A. R. COSMÉTICO', category: 'PRODUCT_COST', type: 'VARIABLE' },
    { id: '67', name: 'JJP', category: 'PRODUCT_COST', type: 'VARIABLE' },
    { id: '68', name: 'SPA DOS PÉS', category: 'PRODUCT_COST', type: 'VARIABLE' },
    { id: '69', name: 'K-PRO', category: 'PRODUCT_COST', type: 'VARIABLE' },
    
    // DESPESAS VARIÁVEIS
    { id: '70', name: 'ROYALTIES 2500,00', category: 'VARIABLE_EXPENSES', type: 'VARIABLE' },
    { id: '71', name: 'TAXA DE CARTÃO', category: 'VARIABLE_EXPENSES', type: 'VARIABLE' },
    { id: '72', name: 'DAS SALÃO', category: 'VARIABLE_EXPENSES', type: 'VARIABLE' },
    { id: '73', name: 'DEVOLUÇÃO CLIENTE', category: 'VARIABLE_EXPENSES', type: 'VARIABLE' },
    { id: '74', name: 'BANCO ITAU PLANO ADAPTA', category: 'VARIABLE_EXPENSES', type: 'VARIABLE' },
    { id: '98', name: 'JUROS E MULTAS', category: 'VARIABLE_EXPENSES', type: 'VARIABLE' },
    
    // SALÁRIOS FIXOS
    { id: '75', name: 'FOLHA DE PAGAMENTO - SALÁRIOS-05', category: 'FIXED_SALARY', type: 'FIXED' },
    { id: '76', name: 'FOLHA DE PAGAMENTO - SALÁRIOS-20', category: 'FIXED_SALARY', type: 'FIXED' },
    { id: '77', name: 'CRISTIANO DE JESUS', category: 'FIXED_SALARY', type: 'FIXED' },
    { id: '78', name: 'REBEKA DE LUCENA', category: 'FIXED_SALARY', type: 'FIXED' },
    { id: '79', name: 'BRUNO GALDINO', category: 'FIXED_SALARY', type: 'FIXED' },
    { id: '80', name: 'FLÁVIA - TEREAPIA WENDY', category: 'FIXED_SALARY', type: 'FIXED' },
    { id: '81', name: 'VA - VALE ALIMENTAÇÃO - REFEIÇÃO - ALELO', category: 'FIXED_SALARY', type: 'FIXED' },
    { id: '82', name: 'VT BEM - VALE TRANSPORTE', category: 'FIXED_SALARY', type: 'FIXED' },
    { id: '83', name: 'RESCISAO', category: 'FIXED_SALARY', type: 'FIXED' },
    { id: '84', name: 'FGTS', category: 'FIXED_SALARY', type: 'FIXED' },
    { id: '85', name: 'FGTS MULTA', category: 'FIXED_SALARY', type: 'FIXED' },
    { id: '86', name: 'MULTA - DCTFWEB - IMPOSTO', category: 'FIXED_SALARY', type: 'FIXED' },
    { id: '87', name: 'FÉRIAS', category: 'FIXED_SALARY', type: 'FIXED' },
    { id: '88', name: 'INSS', category: 'FIXED_SALARY', type: 'FIXED' },
    { id: '89', name: 'INSS - 13 SALÁRIO', category: 'FIXED_SALARY', type: 'FIXED' },
    { id: '90', name: 'SAÚDE PASS', category: 'FIXED_SALARY', type: 'FIXED' },
    { id: '91', name: 'SINDICATO - 10', category: 'FIXED_SALARY', type: 'FIXED' },
    { id: '92', name: 'SINDICATO - 13 SAL', category: 'FIXED_SALARY', type: 'FIXED' },
    { id: '93', name: 'SINDICATO PATRONAL', category: 'FIXED_SALARY', type: 'FIXED' },
    { id: '94', name: 'HOMOLOGAÇÃO DE CONTRATOS - SINDICATO', category: 'FIXED_SALARY', type: 'FIXED' },
    { id: '95', name: '13 - SALÁRIO 1 PARCELA', category: 'FIXED_SALARY', type: 'FIXED' },
    { id: '96', name: '13 - SALÁRIO 2 PARCELA', category: 'FIXED_SALARY', type: 'FIXED' },
    
    // PRÓ-LABORE
    { id: '97', name: 'GESTOR ADMINISTRATIVO - PROLABORE - FABIANA', category: 'PRO_LABORE', type: 'FIXED' },
    { id: '98', name: 'GESTOR ADMINISTRATIVO - PROLABORE - CAIO', category: 'PRO_LABORE', type: 'FIXED' },
  ];

  const defaultSuppliers: Supplier[] = [
    { id: '1', name: 'LED10', taxId: '', email: '', accountId: '27' },
    { id: '2', name: 'VT CLTS', taxId: '', email: '', accountId: '82' },
    { id: '3', name: 'CLEANER BRASIL', taxId: '', email: '', accountId: '27' },
    { id: '4', name: 'MANOBRISTA', taxId: '', email: '', accountId: '19' },
    { id: '5', name: 'FOLHA DE PAGAMENTO', taxId: '', email: '', accountId: '39' },
    { id: '6', name: 'VIVO', taxId: '3641-5557', email: '', accountId: '33' },
    { id: '7', name: 'VIVO INTERNET', taxId: '899927163920', email: '', accountId: '35' },
    { id: '8', name: 'BANCO INTER', taxId: '', email: '', accountId: '6' },
    { id: '9', name: 'SINDICATO - PRÓ BELEZA', taxId: '', email: '', accountId: '91' },
    { id: '10', name: 'PREFEITURA', taxId: '', email: '', accountId: '9' },
    { id: '11', name: 'DORIVAL CESÁRIO', taxId: '98459-0790', email: 'Dorival', accountId: '1' },
    { id: '12', name: 'INTERLUX', taxId: '', email: '', accountId: '27' },
    { id: '13', name: 'CONTABILIDADE REPRECON', taxId: '26.764.986/0001-60', email: 'Wellington', accountId: '8' },
    { id: '14', name: 'CONTBEL', taxId: '', email: 'Kelly (MEI)', accountId: '42' },
    { id: '15', name: 'DAS EQUIPE', taxId: '', email: '', accountId: '43' },
    { id: '16', name: 'DAS SALÃO', taxId: '', email: '', accountId: '72' },
    { id: '17', name: 'FGTS', taxId: '', email: '', accountId: '84' },
    { id: '18', name: 'INSS', taxId: '', email: '', accountId: '88' },
    { id: '19', name: 'ENEL', taxId: '', email: '', accountId: '14' },
    { id: '20', name: 'RGB EMPREED IMOBILIÁRIOS', taxId: '', email: '', accountId: '4' },
    { id: '21', name: 'FRANQUEADORA', taxId: '', email: '', accountId: '25' },
    { id: '22', name: 'BANCO ITAÚ', taxId: '', email: 'IMPERATRIZ', accountId: '6' },
    { id: '23', name: 'SABESP', taxId: '', email: '', accountId: '2' },
    // Advogado
    { id: '24', name: 'Dorival Cesário', taxId: '98459-0790', email: 'Dorival', accountId: '1' },
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
    // Imobiliária
    { id: '30', name: 'Imobiliária', taxId: '94149-2402', email: 'Jeane', accountId: '4' },
    { id: '31', name: 'RGH', taxId: '95819-0547', email: '', accountId: '4' },
    // Lavanderia Interlux
    { id: '32', name: 'Interlux', taxId: '97058-5814', email: 'Vagner (Dono)', accountId: '27' },
    { id: '33', name: 'Interlux', taxId: '97662-9153', email: 'Andressa', accountId: '27' },
    { id: '34', name: 'Interlux', taxId: '98968-3457', email: 'Jessica', accountId: '27' },
    // Lavatórios
    { id: '35', name: 'Ferrante', taxId: '99782-5508', email: 'Wilson', accountId: '21' },
    // Manutenção Led10
    { id: '36', name: 'LED10', taxId: '95477-3448', email: 'Douglas', accountId: '1' },
    { id: '37', name: 'LED10', taxId: '2115-3091', email: 'Suporte', accountId: '1' },
    // Manutenção Geral
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
    // Produtos - Café
    { id: '46', name: 'Café Três Corações', taxId: '98803-5064', email: 'Juliana', accountId: '63' },
    // Produtos - Cleaner
    { id: '47', name: 'Cleaner', taxId: '98142-1467', email: 'Sergio', accountId: '27' },
    // Produtos - Sales
    { id: '48', name: 'Sales', taxId: '2723-3876', email: 'Thamy', accountId: '64' },
    // Produtos - Soft Clean
    { id: '49', name: 'Soft Clean', taxId: '94035-3856', email: '', accountId: '64' },
    // Produtos - GEO
    { id: '50', name: 'GEO', taxId: '94035-3856', email: '', accountId: '56' },
    // Produtos - Loreal/Kerastase
    { id: '51', name: 'Loreal/Kerastase', taxId: '', email: 'Andrea (Chácara Flora)', accountId: '59' },
    { id: '52', name: 'Loreal/Kerastase', taxId: '', email: 'Caio', accountId: '59' },
  ];

  useEffect(() => {
    const safetyTimeout = setTimeout(() => {
      if (loading) setLoading(false);
    }, 5000);

    const unsubscribeAuth = auth.onAuthStateChanged(async (u: any) => {
      setUser(u);
      
      if (u) {
        console.log('👤 Usuário logado:', u.email);
        console.log('🔥 Status Firebase:', isMockMode ? '❌ MODO LOCAL (localStorage) - Dados NÃO são salvos no Firebase!' : '✅ MODO REAL (Firebase Cloud) - Dados sendo salvos no servidor!');
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
                console.log(`✅ ${missing.length} contas pagas padrão adicionadas (modo local)`);
              }
            }

            seededRecurringBillsRef.current = true;
            const { merged } = mergeRecurringBillsForYear(nextBills);
            setBills(validateBills(merged));
          } else if (!seededRecurringBillsRef.current) {
            seededRecurringBillsRef.current = true;
            seededPaidBillsRef.current = true;
            const { merged } = mergeRecurringBillsForYear(defaultPaidBills);
            setBills(validateBills(merged));
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
          console.log(`📥 ${merged.length - bills.length} contas importadas adicionadas`);
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
        console.log('✅ Dados migrados para workspace compartilhado');
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
        setBills(validateBills(merged));
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
      const { merged, added } = mergeRecurringBillsForYear(nextBills);
      if (added.length > 0) {
        const batch = writeBatch(db);
        added.forEach((bill) => {
          batch.set(doc(billsRef, bill.id), bill);
        });
        batch.commit().catch((e) => console.error('Erro ao criar contas recorrentes:', e));
      }
      setBills(validateBills(merged));
      markLoaded();
    });

    const unsubSuppliers = onSnapshot(suppliersRef, (snap) => {
      if (snap.empty && !seededSuppliersRef.current) {
        seededSuppliersRef.current = true;
        const batch = writeBatch(db);
        defaultSuppliers.forEach((sup) => {
          batch.set(doc(suppliersRef, sup.id), sup);
        });
        batch.commit().catch((e) => console.error('Erro ao criar fornecedores padrão:', e));
        setSuppliers(defaultSuppliers);
        markLoaded();
        return;
      }
      const next = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Supplier, 'id'>) }));
      setSuppliers(next);
      markLoaded();
    });

    const unsubAccounts = onSnapshot(accountsRef, (snap) => {
      if (snap.empty && !seededAccountsRef.current) {
        seededAccountsRef.current = true;
        const batch = writeBatch(db);
        defaultAccounts.forEach((acc) => {
          batch.set(doc(accountsRef, acc.id), acc);
        });
        batch.commit().catch((e) => console.error('Erro ao criar contas padrao:', e));
        setAccounts(defaultAccounts);
        markLoaded();
        return;
      }
      const next = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<ChartOfAccount, 'id'>) }));
      setAccounts(next);
      markLoaded();
    });

    const unsubRevenues = onSnapshot(revenuesRef, (snap) => {
      const next = snap.docs.map((d) => d.data() as Revenue);
      setRevenues(next);
      markLoaded();
    });

    const unsubTeam = onSnapshot(teamRef, (snap) => {
      const next = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<TeamMember, 'id'>) }));
      setTeam(next);
      markLoaded();
    });

    const unsubCompany = onSnapshot(companyRef, (snap) => {
      if (snap.exists()) {
        setCompany({ ...defaultCompany, ...(snap.data() as Company) });
      } else if (!seededCompanyRef.current) {
        seededCompanyRef.current = true;
        setDoc(companyRef, defaultCompany).catch((e) => console.error('Erro ao criar empresa:', e));
      }
      markLoaded();
    });

    return () => {
      unsubBills();
      unsubSuppliers();
      unsubAccounts();
      unsubRevenues();
      unsubTeam();
      unsubCompany();
    };
  }, [isMockMode, user]);

  const persistAccounts = async (prev: ChartOfAccount[], next: ChartOfAccount[]) => {
    if (isMockMode || !user) return;
    const accountsRef = getSharedAccountsRef();
    const batch = writeBatch(db);
    const nextIds = new Set(next.map((a) => a.id));
    prev.forEach((a) => {
      if (!nextIds.has(a.id)) batch.delete(doc(accountsRef, a.id));
    });
    next.forEach((a) => batch.set(doc(accountsRef, a.id), a));
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
      console.log('✅ Receitas sincronizadas com Firebase:', next.length, 'itens');
    } catch (e: any) {
      console.error('❌ Erro ao sincronizar receitas:', e.message);
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

  const stripUndefined = <T extends Record<string, any>>(value: T): T => {
    return Object.entries(value).reduce((acc, [key, val]) => {
      if (val !== undefined) acc[key as keyof T] = val;
      return acc;
    }, {} as T);
  };

  const saveBill = async (bill: Bill): Promise<boolean> => {
    if (isMockMode || !user) return false;
    const billsRef = getSharedBillsRef();
    try {
      const payload = stripUndefined(bill);
      await setDoc(doc(billsRef, bill.id), payload, { merge: true });
      console.log('✅ Fatura salva no Firebase:', payload);
      return true;
    } catch (e: any) {
      console.error('❌ Erro ao salvar fatura:', e.message);
      return false;
    }
  };

  const saveSupplier = async (supplier: Supplier) => {
    if (isMockMode || !user) return;
    const suppliersRef = getSharedSuppliersRef();
    try {
      await setDoc(doc(suppliersRef, supplier.id), supplier, { merge: true });
      console.log('✅ Fornecedor salvo no Firebase:', supplier);
    } catch (e: any) {
      console.error('❌ Erro ao salvar fornecedor:', e.message);
    }
  };

  const handleBillSubmit = async (bill: Bill) => {
    const nextBill: Bill = { ...bill, id: bill.id || editingBill?.id || Math.random().toString(36).slice(2, 10) };
    const isNewBill = !editingBill;
    const isRecurringType = (value?: RecurrenceType) => value === 'monthly' || value === 'annual';
    const wasNotRecurring = editingBill && !isRecurringType(editingBill.recurrenceType);
    const isNowRecurring = isRecurringType(nextBill.recurrenceType);
    
    if (isMockMode) {
      setBills((prev) => {
        const exists = prev.some((b) => b.id === nextBill.id);
        let updatedBills = exists ? prev.map((b) => (b.id === nextBill.id ? nextBill : b)) : [...prev, nextBill];
        
        // Se é nova conta recorrente OU se mudou para recorrente, gerar instâncias mensais
        if ((isNewBill || wasNotRecurring) && isNowRecurring) {
          const existingIds = new Set(updatedBills.map(b => b.id));
          const generated = buildRecurringBillsForYear([nextBill], currentYear, 0, existingIds);
          updatedBills = [...updatedBills, ...generated];
          console.log(`✅ Geradas ${generated.length} instâncias mensais para "${nextBill.description}"`);
        }
        
        return updatedBills;
      });
    } else {
      if (!user) {
        alert('Sessao expirada. Faca login novamente para salvar.');
        return;
      }

      const saved = await saveBill(nextBill);
      if (!saved) {
        alert('Nao foi possivel salvar a conta. Verifique sua conexao e tente novamente.');
        return;
      }
      
      // Se é nova conta recorrente OU se mudou para recorrente, gerar instâncias mensais no Firebase
      if ((isNewBill || wasNotRecurring) && isNowRecurring) {
        const existingIds = new Set(bills.map(b => b.id));
        const generated = buildRecurringBillsForYear([nextBill], currentYear, 0, existingIds);
        
        if (generated.length > 0 && user) {
          const billsRef = getSharedBillsRef();
          const batch = writeBatch(db);
          generated.forEach((generatedBill) => {
            const payload = stripUndefined(generatedBill);
            batch.set(doc(billsRef, generatedBill.id), payload);
          });
          await batch.commit().catch((e) => console.error('Erro ao criar instâncias recorrentes:', e));
          console.log(`✅ Geradas ${generated.length} instâncias mensais para "${nextBill.description}"`);
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
    await deleteDoc(doc(billsRef, id));
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

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center gap-6 p-4">
        <Loader2 className="animate-spin text-indigo-500" size={64} />
      </div>
    );
  }

  if (!user) return <Login />;

  const isSuperAdmin = user.email === SUPER_ADMIN_EMAIL;

  const currentUser: TeamMember = {
    id: user.uid,
    name: isSuperAdmin ? 'Fabiana JJVSF' : (user.displayName || 'Usuário'),
    email: user.email || '',
    role: UserRole.ADMIN, // Todos usuários autenticados são ADMIN
    active: true,
    permissions: {
      dashboard: true, bills: true, suppliers: true, accounts: true, team: true, profile: true, dre: true, cashbox: true, 'cashbox-report': true, reconciliation: true, 'bills_reconciliation': true,
      canEditCashBoxStatus: true
    }
  };

  return (
    <Layout currentView={view} setView={setView} user={currentUser} company={company}>
      <main className="flex-1 overflow-y-auto p-4 md:p-8">
        {view === 'dashboard' && currentUser.role === UserRole.ADMIN && (
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
        {view === 'dashboard' && currentUser.role !== UserRole.ADMIN && (
          <div className="flex items-center justify-center h-screen">
            <div className="text-center">
              <h1 className="text-3xl font-bold text-slate-800 mb-4">Acesso Negado</h1>
              <p className="text-slate-600 mb-6">Apenas administradores podem acessar o Dashboard.</p>
              <button 
                onClick={() => setView('bills')}
                className="px-6 py-3 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors"
              >
                Ir para Contas a Pagar
              </button>
            </div>
          </div>
        )}
        {view === 'bills' && (
          <BillList 
            bills={bills}
            suppliers={suppliers}
            accounts={accounts} 
            onEdit={(bill) => {
              setEditingBill(bill);
              setShowBillForm(true);
            }} 
            onDelete={handleDeleteBill}
            onStatusChange={handleBillStatusChange}
            onToggleEstimate={handleToggleEstimate}
            onOpenForm={() => {
              setEditingBill(undefined);
              setShowBillForm(true);
            }}
            userRole={currentUser.role}
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
        {view === 'accounts' && <AccountManagement accounts={accounts} setAccounts={setAccountsWithPersist} canManage={true} />}
        {view === 'dre' && <DRE bills={bills} revenues={revenues} accounts={accounts} setRevenues={setRevenuesWithPersist} />}
        {view === 'cashbox' && <CashBox user={currentUser} onShowReport={() => setView('cashbox-report')} />}
        {view === 'cashbox-report' && <CashBoxReport onBack={() => setView('cashbox')} canEdit={currentUser.permissions?.canEditCashBoxStatus} />}
        {view === 'reconciliation' && <BankReconciliationComponent user={currentUser} />}
        {view === 'team' && <TeamManagement team={team} setTeam={setTeamWithPersist} canManage={true} accounts={accounts} />}
        {view === 'profile' && <CompanyProfile company={company} setCompany={setCompanyWithPersist} canEdit={true} />}
      </main>

      {showBillForm && (
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

      {showSupplierForm && (
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
