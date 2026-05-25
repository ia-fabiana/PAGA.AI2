
import React from 'react';
import { Download, LayoutDashboard, Receipt, Users, ShieldCheck, Building2, Menu, X, LogOut, ListTree, FilePieChart, Shield, DollarSign, Landmark } from 'lucide-react';
import { TeamMember, Company } from './types';
import { auth } from './firebase';

interface LayoutProps {
  children: React.ReactNode;
  currentView: string;
  setView: (view: any) => void;
  user: TeamMember;
  company: Company;
}

export const Layout: React.FC<LayoutProps> = ({ children, currentView, setView, user, company }) => {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = React.useState(false);
  const [installPrompt, setInstallPrompt] = React.useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = React.useState(false);

  React.useEffect(() => {
    const updateInstalledState = () => {
      const standaloneByDisplayMode = window.matchMedia('(display-mode: standalone)').matches;
      const standaloneByNavigator = (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
      setIsInstalled(standaloneByDisplayMode || standaloneByNavigator);
    };

    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
      updateInstalledState();
    };

    const handleAppInstalled = () => {
      setInstallPrompt(null);
      setIsInstalled(true);
    };

    updateInstalledState();
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const handleInstallApp = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice.outcome === 'accepted') {
      setInstallPrompt(null);
      setIsInstalled(true);
    }
  };

  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, permission: 'dashboard' },
    { id: 'dre', label: 'DRE Gerencial', icon: FilePieChart, permission: 'dre' },
    { id: 'cashbox', label: 'Caixa', icon: DollarSign, permission: 'cashbox' },
    { id: 'reconciliation', label: 'Extrato Bancário', icon: Landmark, permission: 'reconciliation' },
    { id: 'bills', label: 'Contas a Pagar', icon: Receipt, permission: 'bills' },
    { id: 'suppliers', label: 'Fornecedores', icon: Users, permission: 'suppliers' },
    { id: 'accounts', label: 'Centro de Custo', icon: ListTree, permission: 'accounts' },
    { id: 'team', label: 'Equipe', icon: ShieldCheck, permission: 'team' },
    { id: 'profile', label: 'Empresa', icon: Building2, permission: 'profile' },
  ].filter(item => {
    if (!user.permissions) return true;
    
    // Dashboard: apenas ADMIN pode ver
    if (item.id === 'dashboard') {
      return user.role === 'ADMIN' && user.permissions[item.permission as keyof typeof user.permissions];
    }

    // Compatibilidade: exibe Extrato se qualquer permissão de conciliacao estiver ativa
    if (item.id === 'reconciliation') {
      return Boolean(user.permissions.reconciliation || user.permissions.bills_reconciliation);
    }
    
    return user.permissions[item.permission as keyof typeof user.permissions];
  });

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden">
      <aside className="hidden md:flex flex-col w-64 bg-white border-r border-slate-200 shadow-sm">
        <div className="p-4 flex items-center">
          <img src="/logo.png" alt="PAGA.AI" className="h-12 w-12 rounded-xl object-contain shadow-md" />
          <span className="ml-3 text-xl font-black tracking-tight text-slate-800">PAGA.AI</span>
        </div>
        
        <nav className="flex-1 px-4 py-4 space-y-1 overflow-y-auto">
          {navItems.map(item => (
            <button
              key={item.id}
              onClick={() => setView(item.id)}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 group ${
                currentView === item.id 
                ? 'bg-indigo-50 text-indigo-700 font-bold' 
                : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'
              }`}
            >
              <item.icon size={20} className={currentView === item.id ? 'text-indigo-600' : 'text-slate-400 group-hover:text-slate-600'} />
              <span className="text-sm">{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="p-4 border-t border-slate-100 bg-slate-50 space-y-4">
          {/* Status do App */}
          <div className="bg-white p-3 rounded-2xl border border-slate-200 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Shield size={12} className="text-indigo-600" />
                <span className="text-xs font-black text-slate-400 uppercase tracking-widest">Segurança</span>
              </div>
            </div>
            <div className="flex items-center gap-2 text-xs font-black text-indigo-600 bg-indigo-50 px-2 py-1 rounded-lg">
              {user.email === 'fabianajjvsf@gmail.com' ? 'ACESSO: SUPER ADMIN' : 'ACESSO: PADRÃO'}
            </div>
          </div>

          {!isInstalled && installPrompt && (
            <button
              onClick={() => void handleInstallApp()}
              className="w-full flex items-center justify-center gap-2 rounded-2xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm font-black text-indigo-700 transition-colors hover:bg-indigo-100"
            >
              <Download size={16} /> Instalar App
            </button>
          )}

          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold border-2 border-white shadow-sm ${user.email === 'fabianajjvsf@gmail.com' ? 'bg-indigo-900 text-white' : 'bg-slate-800 text-white'}`}>
              {user.name.charAt(0)}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-slate-800 truncate">{user.name}</p>
              <p className="text-xs text-indigo-600 font-black bg-indigo-50 px-1.5 py-0.5 rounded w-fit">
                {user.role}
              </p>
            </div>
          </div>
          <button 
            onClick={() => auth.signOut()}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 text-xs font-bold text-rose-500 hover:bg-rose-50 rounded-xl transition-colors border border-rose-100"
          >
            <LogOut size={14} /> Sair com Segurança
          </button>
        </div>
      </aside>

      <div className="flex flex-col flex-1 w-full min-w-0 overflow-hidden">
        <header className="md:hidden flex items-center justify-between p-4 bg-white border-b border-slate-200">
          <div className="flex items-center gap-2">
            <img src="/logo.png" alt="PAGA.AI" className="h-8 w-8 rounded-lg object-contain" />
            <span className="font-bold">PAGA.AI</span>
          </div>
          <div className="flex items-center gap-2">
            {!isInstalled && installPrompt && (
              <button
                onClick={() => void handleInstallApp()}
                className="rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs font-black text-indigo-700"
              >
                Instalar
              </button>
            )}
            <button onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}>
              {isMobileMenuOpen ? <X /> : <Menu />}
            </button>
          </div>
        </header>
        {children}
      </div>
    </div>
  );
};
