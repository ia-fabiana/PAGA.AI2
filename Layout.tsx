
import React from 'react';
import { LayoutDashboard, Receipt, Users, ShieldCheck, Building2, Menu, X, Wallet, LogOut, ListTree, FilePieChart, Github, Zap, Shield } from 'lucide-react';
import { TeamMember, Company } from '../types';
import { auth } from '../firebase';

interface LayoutProps {
  children: React.ReactNode;
  currentView: string;
  setView: (view: any) => void;
  user: TeamMember;
  company: Company;
}

export const Layout: React.FC<LayoutProps> = ({ children, currentView, setView, user, company }) => {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = React.useState(false);

  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, permission: 'dashboard' },
    { id: 'dre', label: 'DRE Gerencial', icon: FilePieChart, permission: 'dre' },
    { id: 'bills', label: 'Contas a Pagar', icon: Receipt, permission: 'bills' },
    { id: 'suppliers', label: 'Fornecedores', icon: Users, permission: 'suppliers' },
    { id: 'accounts', label: 'Plano de Contas', icon: ListTree, permission: 'accounts' },
    { id: 'team', label: 'Equipe', icon: ShieldCheck, permission: 'team' },
    { id: 'profile', label: 'Empresa', icon: Building2, permission: 'profile' },
  ].filter(item => {
    if (!user.permissions) return true;
    return user.permissions[item.permission as keyof typeof user.permissions];
  });

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden">
      <aside className="hidden md:flex flex-col w-64 bg-white border-r border-slate-200 shadow-sm">
        <div className="p-6 flex items-center gap-3">
          <div className="p-2 bg-indigo-600 rounded-lg text-white shadow-lg shadow-indigo-100">
            <Wallet size={24} />
          </div>
          <span className="text-xl font-black tracking-tight text-slate-800">PAGA.AI</span>
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
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Segurança</span>
              </div>
            </div>
            <div className="flex items-center gap-2 text-[9px] font-black text-indigo-600 bg-indigo-50 px-2 py-1 rounded-lg">
              {user.email === 'fabianajjvsf@gmail.com' ? 'ACESSO: SUPER ADMIN' : 'ACESSO: PADRÃO'}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold border-2 border-white shadow-sm ${user.email === 'fabianajjvsf@gmail.com' ? 'bg-indigo-900 text-white' : 'bg-slate-800 text-white'}`}>
              {user.name.charAt(0)}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-slate-800 truncate">{user.name}</p>
              <p className="text-[10px] text-indigo-600 font-black bg-indigo-50 px-1.5 py-0.5 rounded w-fit">
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
            <Wallet className="text-indigo-600" />
            <span className="font-bold">PAGA.AI</span>
          </div>
          <button onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}>
            {isMobileMenuOpen ? <X /> : <Menu />}
          </button>
        </header>
        {children}
      </div>
    </div>
  );
};
