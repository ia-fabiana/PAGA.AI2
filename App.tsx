
import React, { useState, useEffect } from 'react';
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
import { Login } from './Login';
import { auth, db, isMockMode } from './firebase';
import { Bill, Supplier, BillStatus, UserRole, TeamMember, Company, ChartOfAccount, Revenue } from './types';
import { Loader2 } from 'lucide-react';

const App: React.FC = () => {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'dashboard' | 'bills' | 'suppliers' | 'team' | 'profile' | 'accounts' | 'dre'>('dashboard');
  
  const [bills, setBills] = useState<Bill[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [accounts, setAccounts] = useState<ChartOfAccount[]>([]);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [revenues, setRevenues] = useState<Revenue[]>([]);
  const [company, setCompany] = useState<Company>({
    name: 'Unidade Vila Leopoldina', taxId: '', email: '', phone: '', address: ''
  });

  const SUPER_ADMIN_EMAIL = 'fabianajjvsf@gmail.com';

  const defaultAccounts: ChartOfAccount[] = [
    { id: '1', name: 'KEUNE', category: 'PRODUCT_COST', type: 'VARIABLE' },
    { id: '2', name: 'WELLA', category: 'PRODUCT_COST', type: 'VARIABLE' },
    { id: '3', name: 'SOFTCLEAN', category: 'PRODUCT_COST', type: 'VARIABLE' },
    { id: '4', name: 'COMISSÃO MANICURE', category: 'COMMISSION', type: 'VARIABLE' },
    { id: '5', name: 'VALE EXTRA', category: 'COMMISSION', type: 'VARIABLE' },
    { id: '6', name: 'ALUGUEL 8000', category: 'FIXED_EXPENSES', type: 'FIXED' },
    { id: '7', name: 'ENERGIA - ELETROPAULO', category: 'FIXED_EXPENSES', type: 'FIXED' },
    { id: '8', name: 'ÁGUA - SABESP', category: 'FIXED_EXPENSES', type: 'FIXED' },
    { id: '9', name: 'PRÓ-LABORE FABIANA', category: 'PRO_LABORE', type: 'FIXED' },
    { id: '10', name: 'SALÁRIOS EQUIPE', category: 'FIXED_SALARY', type: 'FIXED' },
  ];

  useEffect(() => {
    const safetyTimeout = setTimeout(() => {
      if (loading) setLoading(false);
    }, 5000);

    const unsubscribeAuth = auth.onAuthStateChanged(async (u: any) => {
      setUser(u);
      
      if (isMockMode) {
        try {
          const savedBills = localStorage.getItem('pagaai_bills');
          const savedSuppliers = localStorage.getItem('pagaai_suppliers');
          const savedAccounts = localStorage.getItem('pagaai_accounts');
          const savedRevenues = localStorage.getItem('pagaai_revenues');
          
          if (savedBills) setBills(JSON.parse(savedBills));
          if (savedSuppliers) setSuppliers(JSON.parse(savedSuppliers));
          if (savedAccounts) {
            setAccounts(JSON.parse(savedAccounts));
          } else {
            setAccounts(defaultAccounts);
          }
          if (savedRevenues) setRevenues(JSON.parse(savedRevenues));
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

  useEffect(() => {
    if (isMockMode && user) {
      localStorage.setItem('pagaai_bills', JSON.stringify(bills));
      localStorage.setItem('pagaai_suppliers', JSON.stringify(suppliers));
      localStorage.setItem('pagaai_accounts', JSON.stringify(accounts));
      localStorage.setItem('pagaai_revenues', JSON.stringify(revenues));
      localStorage.setItem('pagaai_company', JSON.stringify(company));
    }
  }, [bills, suppliers, accounts, revenues, company, user]);

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
    role: isSuperAdmin ? UserRole.ADMIN : UserRole.VIEWER,
    active: true,
    permissions: {
      dashboard: true, bills: true, suppliers: true, accounts: true, team: true, profile: true, dre: true
    }
  };

  return (
    <Layout currentView={view} setView={setView} user={currentUser} company={company}>
      <main className="flex-1 overflow-y-auto p-4 md:p-8">
        {view === 'dashboard' && <Dashboard bills={bills} suppliers={suppliers} accounts={accounts} onEditBill={()=>{}} onStatusChange={(id, status) => setBills(bills.map(b => b.id === id ? {...b, status} : b))} />}
        {view === 'bills' && (
          <BillList 
            bills={bills} suppliers={suppliers} accounts={accounts} 
            onEdit={()=>{}} 
            onDelete={(id) => setBills(bills.filter(b => b.id !== id))}
            onStatusChange={(id, status) => setBills(bills.map(b => b.id === id ? {...b, status} : b))}
            onOpenForm={() => {}}
            userRole={currentUser.role}
          />
        )}
        {view === 'suppliers' && <SupplierList suppliers={suppliers} accounts={accounts} onEdit={()=>{}} onDelete={(id) => setSuppliers(suppliers.filter(s => s.id !== id))} onOpenForm={()=>{}} userRole={currentUser.role} />}
        {view === 'accounts' && <AccountManagement accounts={accounts} setAccounts={setAccounts as any} canManage={true} />}
        {view === 'dre' && <DRE bills={bills} revenues={revenues} accounts={accounts} setRevenues={setRevenues} />}
        {view === 'team' && <TeamManagement team={team} setTeam={setTeam as any} canManage={true} />}
        {view === 'profile' && <CompanyProfile company={company} setCompany={setCompany} canEdit={true} />}
      </main>
    </Layout>
  );
};

export default App;
