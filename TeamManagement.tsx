
import React, { useState } from 'react';
import { TeamMember, UserRole, ModulePermissions, ChartOfAccount } from './types';
import { 
  UserPlus, Shield, Mail, Phone, Trash2, CheckCircle, XCircle, Edit2, 
  LayoutDashboard, Receipt, Users, ListTree, Building2, 
  UserCog, Check, ShieldCheck, ToggleLeft, ToggleRight, Sparkles, Lock, Unlock, Calendar, DollarSign, FilePieChart, Landmark, CreditCard
} from 'lucide-react';

interface TeamManagementProps {
  team: TeamMember[];
  setTeam: React.Dispatch<React.SetStateAction<TeamMember[]>>;
  canManage: boolean;
  accounts?: ChartOfAccount[];
  onResyncAccess?: () => Promise<void>;
}

export const TeamManagement: React.FC<TeamManagementProps> = ({ team, setTeam, canManage, accounts = [], onResyncAccess }) => {
  const buildViewerPermissions = (): ModulePermissions => ({
    dashboard: 'none',
    bills: 'viewer',
    suppliers: 'none',
    accounts: 'none',
    team: 'none',
    profile: 'none',
    dre: 'none',
    cashbox: 'none',
    reconciliation: 'none',
    'bills_reconciliation': 'none',
    canEditBillDate: false,
    canCreateSupplier: false,
    canEditCashBoxStatus: false,
    canLaunchCaixa: false,
  });

  const buildEditorPermissions = (): ModulePermissions => ({
    dashboard: 'none',
    bills: 'editor',
    suppliers: 'editor',
    accounts: 'none',
    team: 'none',
    profile: 'none',
    dre: 'editor',
    cashbox: 'editor',
    reconciliation: 'none',
    'bills_reconciliation': 'none',
    canEditBillDate: false,
    canCreateSupplier: false,
    canEditCashBoxStatus: false,
    canLaunchCaixa: false,
  });

  const buildAdminPermissions = (): ModulePermissions => ({
    dashboard: 'editor',
    bills: 'editor',
    suppliers: 'editor',
    accounts: 'editor',
    team: 'editor',
    profile: 'editor',
    dre: 'editor',
    cashbox: 'editor',
    reconciliation: 'editor',
    'bills_reconciliation': 'editor',
    canEditBillDate: true,
    canCreateSupplier: true,
    canEditCashBoxStatus: true,
    canLaunchCaixa: true,
  });

  const getDefaultPermissionsForRole = (role: UserRole): ModulePermissions => {
    if (role === UserRole.ADMIN) return buildAdminPermissions();
    if (role === UserRole.EDITOR) return buildEditorPermissions();
    return buildViewerPermissions();
  };

  const applyRolePermissions = (role: UserRole, permissions?: ModulePermissions): ModulePermissions => {
    if (role === UserRole.ADMIN) return buildAdminPermissions();
    if (role === UserRole.EDITOR) return buildEditorPermissions();
    return buildViewerPermissions();
  };

  const roleOptions = [
    { id: UserRole.ADMIN,  label: 'Administrador', description: 'Acesso total. Todos os módulos liberados automaticamente.' },
    { id: UserRole.EDITOR, label: 'Editor',         description: 'Padrão: Contas, Fornecedores, DRE e Receitas. Personalize os tiles abaixo.' },
    { id: UserRole.VIEWER, label: 'Visualizador',   description: 'Padrão: somente Contas (leitura). Personalize os tiles abaixo.' },
  ];

  const [isAdding, setIsAdding] = useState(false);
  const [isResyncingAccess, setIsResyncingAccess] = useState(false);
  const [expandedCategoryMember, setExpandedCategoryMember] = useState<string | null>(null);
  const [editingMemberId, setEditingMemberId] = useState<string | null>(null);
  const [editMemberDraft, setEditMemberDraft] = useState<{ name: string; email: string; phone: string; role: UserRole }>({ name: '', email: '', phone: '', role: UserRole.VIEWER });
  const [newMember, setNewMember] = useState({ 
    name: '', 
    email: '', 
    phone: '',
    role: UserRole.VIEWER,
    permissions: buildViewerPermissions()
  });

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMember.name || !newMember.email) return;
    const member: TeamMember = {
      ...newMember,
      id: Math.random().toString(36).substr(2, 9),
      active: true,
      categoryPermissions: [],
      inviteSent: false
    };
    setTeam(prev => [...prev, member]);
    setIsAdding(false);
    setNewMember({ 
      name: '', 
      email: '', 
      phone: '',
      role: UserRole.VIEWER,
      permissions: buildViewerPermissions()
    });
  };

  const sendInvite = (id: string) => {
    if (!canManage) return;
    setTeam(prev => prev.map(m => {
      if (m.id === id) {
        // Aqui você pode adicionar a lógica de envio de e-mail no futuro
        alert(`Convite enviado para ${m.email}!\n\nO colaborador receberá um e-mail com instruções de acesso.`);
        return {
          ...m,
          inviteSent: true,
          inviteSentDate: new Date().toISOString()
        };
      }
      return m;
    }));
  };

  const removeMember = (id: string) => {
    if (!canManage) return;
    if (confirm('Deseja realmente remover este membro da equipe?')) {
      setTeam(prev => prev.filter(m => m.id !== id));
    }
  };

  const capabilityIds = ['canEditBillDate', 'canCreateSupplier', 'canEditCashBoxStatus', 'canLaunchCaixa'];

  const cycleModuleAccess = (current: any): any => {
    if (current === 'none' || current === false || current === undefined) return 'viewer';
    if (current === 'viewer') return 'editor';
    return 'none';
  };

  const togglePermission = (id: string, module: keyof ModulePermissions) => {
    if (!canManage) return;
    setTeam(prev => prev.map(m => {
      if (m.id === id) {
        const current = m.permissions[module];
        const next = capabilityIds.includes(module as string)
          ? !current
          : cycleModuleAccess(current);
        return { ...m, permissions: { ...m.permissions, [module]: next } };
      }
      return m;
    }));
  };

  const toggleStatus = (id: string) => {
    if (!canManage) return;
    setTeam(prev => prev.map(m => m.id === id ? { ...m, active: !m.active } : m));
  };

  const toggleCategoryPermission = (memberId: string, categoryId: string) => {
    if (!canManage) return;
    setTeam(prev => prev.map(m => {
      if (m.id === memberId) {
        const categories = m.categoryPermissions || [];
        const hasPermission = categories.includes(categoryId);
        return {
          ...m,
          categoryPermissions: hasPermission 
            ? categories.filter(c => c !== categoryId)
            : [...categories, categoryId]
        };
      }
      return m;
    }));
  };

  const startEditingMember = (member: TeamMember) => {
    if (!canManage) return;
    setEditingMemberId(member.id);
    setEditMemberDraft({
      name: member.name || '',
      email: member.email || '',
      phone: member.phone || '',
      role: member.role || UserRole.VIEWER,
    });
  };

  const cancelEditingMember = () => {
    setEditingMemberId(null);
    setEditMemberDraft({ name: '', email: '', phone: '', role: UserRole.VIEWER });
  };

  const saveEditingMember = () => {
    if (!editingMemberId || !canManage) return;
    const name = editMemberDraft.name.trim();
    const email = editMemberDraft.email.trim();
    const phone = editMemberDraft.phone.trim();
    const role = editMemberDraft.role;
    if (!name || !email) {
      alert('Nome e e-mail sao obrigatorios.');
      return;
    }
    setTeam((prev) =>
      prev.map((member) => {
        if (member.id !== editingMemberId) return member;
        const roleChanged = member.role !== role;
        return {
          ...member,
          name,
          email,
          phone: phone || undefined,
          role,
          // só reseta permissões se o papel mudou; senão preserva os tiles customizados
          permissions: roleChanged ? getDefaultPermissionsForRole(role) : member.permissions,
        };
      })
    );
    cancelEditingMember();
  };

  const handleResyncAccess = async () => {
    if (!canManage || !onResyncAccess || isResyncingAccess) return;
    setIsResyncingAccess(true);
    try {
      await onResyncAccess();
      alert('Indice de acesso do Firebase sincronizado com sucesso.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Falha ao sincronizar o indice de acesso.';
      alert(message);
    } finally {
      setIsResyncingAccess(false);
    }
  };

  const modules = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, color: 'blue' },
    { id: 'bills', label: 'Contas', icon: Receipt, color: 'indigo' },
    { id: 'suppliers', label: 'Fornecedores', icon: Users, color: 'emerald' },
    { id: 'accounts', label: 'Centro Custo', icon: ListTree, color: 'purple' },
    { id: 'dre', label: 'DRE', icon: FilePieChart, color: 'pink' },
    { id: 'cashbox', label: 'Receitas', icon: DollarSign, color: 'green' },
    { id: 'reconciliation', label: 'Conciliação Bancária', icon: Landmark, color: 'teal' },
    { id: 'bills_reconciliation', label: 'Conciliação Despesas', icon: CreditCard, color: 'cyan' },
    { id: 'team', label: 'Equipe', icon: UserCog, color: 'orange' },
    { id: 'profile', label: 'Empresa', icon: Building2, color: 'slate' },
    { id: 'canEditBillDate', label: 'Editar Data Lançamento', icon: Calendar, color: 'cyan' },
    { id: 'canCreateSupplier', label: 'Cadastrar Fornecedor', icon: Users, color: 'lime' },
    { id: 'canEditCashBoxStatus', label: 'Editar Status das Receitas', icon: ShieldCheck, color: 'violet' },
    { id: 'canLaunchCaixa', label: 'Lançar Receitas', icon: Edit2, color: 'teal' },
  ];

  const getModuleLevel = (value: any): 'none' | 'viewer' | 'editor' => {
    if (value === true || value === 'editor') return 'editor';
    if (value === 'viewer') return 'viewer';
    return 'none';
  };

  const getColorClasses = (color: string, level: 'none' | 'viewer' | 'editor') => {
    if (level === 'none') return 'bg-slate-50 border-slate-100 text-slate-300 opacity-60 grayscale';
    if (level === 'viewer') return 'bg-amber-50 border-amber-300 text-amber-700 shadow-amber-100';

    const editorThemes: Record<string, string> = {
      blue: 'bg-blue-50 border-blue-200 text-blue-700 shadow-blue-100',
      indigo: 'bg-indigo-50 border-indigo-200 text-indigo-700 shadow-indigo-100',
      emerald: 'bg-emerald-50 border-emerald-200 text-emerald-700 shadow-emerald-100',
      purple: 'bg-purple-50 border-purple-200 text-purple-700 shadow-purple-100',
      orange: 'bg-orange-50 border-orange-200 text-orange-700 shadow-orange-100',
      slate: 'bg-slate-100 border-slate-300 text-slate-700 shadow-slate-100',
      cyan: 'bg-cyan-50 border-cyan-200 text-cyan-700 shadow-cyan-100',
      lime: 'bg-lime-50 border-lime-200 text-lime-700 shadow-lime-100',
      green: 'bg-green-50 border-green-200 text-green-700 shadow-green-100',
      pink: 'bg-pink-50 border-pink-200 text-pink-700 shadow-pink-100',
      teal: 'bg-teal-50 border-teal-200 text-teal-700 shadow-teal-100',
    };
    return editorThemes[color] || editorThemes.indigo;
  };

  const getIconBg = (color: string, level: 'none' | 'viewer' | 'editor') => {
    if (level === 'none') return 'bg-slate-200 text-slate-400';
    if (level === 'viewer') return 'bg-amber-500 text-white';
    const editorThemes: Record<string, string> = {
      blue: 'bg-blue-600 text-white',
      indigo: 'bg-indigo-600 text-white',
      emerald: 'bg-emerald-600 text-white',
      purple: 'bg-purple-600 text-white',
      orange: 'bg-orange-600 text-white',
      slate: 'bg-slate-700 text-white',
      cyan: 'bg-cyan-600 text-white',
      lime: 'bg-lime-600 text-white',
      green: 'bg-green-600 text-white',
      pink: 'bg-pink-600 text-white',
      teal: 'bg-teal-600 text-white',
    };
    return editorThemes[color] || editorThemes.indigo;
  };

  const getLevelLabel = (value: any, isCapab: boolean): string => {
    if (isCapab) return value ? 'Liberado' : 'Bloqueado';
    const level = getModuleLevel(value);
    if (level === 'editor') return 'Editor';
    if (level === 'viewer') return 'Visualizador';
    return 'Bloqueado';
  };

  return (
    <div className="space-y-8 pb-12">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black text-slate-800 tracking-tight flex items-center gap-2">
            Gestão de Equipe <Sparkles className="text-indigo-500" size={24} />
          </h1>
          <p className="text-slate-500 font-medium">Controle granular de acessos e módulos individuais.</p>
        </div>
        {canManage && (
          <div className="flex flex-col sm:flex-row gap-3">
            <button
              onClick={handleResyncAccess}
              disabled={!onResyncAccess || isResyncingAccess}
              className="flex items-center gap-2 px-6 py-4 bg-slate-800 rounded-2xl text-white hover:bg-slate-900 transition-all font-bold shadow-xl shadow-slate-200 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <ShieldCheck size={20} /> {isResyncingAccess ? 'Sincronizando...' : 'Resincronizar Acessos'}
            </button>
            <button 
              onClick={() => setIsAdding(true)}
              className="flex items-center gap-2 px-6 py-4 bg-indigo-600 rounded-2xl text-white hover:bg-indigo-700 transition-all font-bold shadow-xl shadow-indigo-100 active:scale-95"
            >
              <UserPlus size={20} /> Convidar Colaborador
            </button>
          </div>
        )}
      </div>

      {isAdding && (
        <div className="bg-white p-8 rounded-3xl border-2 border-indigo-100 shadow-2xl animate-in fade-in zoom-in duration-300">
          <div className="flex items-center justify-between mb-8">
            <h3 className="text-xl font-bold text-slate-800">Novo Acesso Individual</h3>
            <button onClick={() => setIsAdding(false)} className="p-2 bg-slate-100 text-slate-400 hover:text-slate-600 rounded-full transition-colors"><XCircle size={24} /></button>
          </div>
          <form onSubmit={handleAdd} className="space-y-8">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-xs font-black text-slate-400 uppercase ml-1">Nome do Usuário</label>
                <input 
                  className="w-full px-5 py-4 bg-slate-50 border border-slate-200 rounded-2xl outline-none focus:ring-2 focus:ring-indigo-500 transition-all font-medium" 
                  placeholder="Ex: Carlos Oliveira" 
                  value={newMember.name} 
                  onChange={e => setNewMember({...newMember, name: e.target.value})} 
                  required 
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-black text-slate-400 uppercase ml-1">E-mail de Acesso</label>
                <input 
                  className="w-full px-5 py-4 bg-slate-50 border border-slate-200 rounded-2xl outline-none focus:ring-2 focus:ring-indigo-500 transition-all font-medium" 
                  placeholder="carlos@paga.ai" 
                  type="email" 
                  value={newMember.email} 
                  onChange={e => setNewMember({...newMember, email: e.target.value})} 
                  required 
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <label className="text-xs font-black text-slate-400 uppercase ml-1">Telefone / WhatsApp</label>
                <input
                  className="w-full px-5 py-4 bg-slate-50 border border-slate-200 rounded-2xl outline-none focus:ring-2 focus:ring-indigo-500 transition-all font-medium"
                  placeholder="Ex: 11999998888"
                  type="tel"
                  value={newMember.phone}
                  onChange={e => setNewMember({ ...newMember, phone: e.target.value })}
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <label className="text-xs font-black text-slate-400 uppercase ml-1">Perfil de Acesso</label>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {roleOptions.map((roleOption) => {
                    const isSelected = newMember.role === roleOption.id;
                    return (
                      <button
                        key={roleOption.id}
                        type="button"
                        onClick={() => setNewMember((prev) => ({
                          ...prev,
                          role: roleOption.id,
                          permissions: applyRolePermissions(roleOption.id, prev.permissions),
                        }))}
                        className={`rounded-2xl border px-4 py-4 text-left transition-all ${
                          isSelected ? 'border-indigo-500 bg-indigo-50 text-indigo-700 shadow-sm' : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300'
                        }`}
                      >
                        <div className="text-sm font-black uppercase tracking-tight">{roleOption.label}</div>
                        <div className="mt-1 text-xs font-medium">{roleOption.description}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <p className="text-xs font-black text-slate-400 uppercase ml-1">Módulos que este usuário poderá acessar:</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
                {modules.map(mod => {
                  const raw = newMember.permissions[mod.id as keyof ModulePermissions];
                  const isCapab = capabilityIds.includes(mod.id);
                  const level = isCapab ? (raw ? 'editor' : 'none') : getModuleLevel(raw);
                  return (
                    <button
                      key={mod.id}
                      type="button"
                      onClick={() => {
                        const current = newMember.permissions[mod.id as keyof ModulePermissions];
                        const next = isCapab ? !current : cycleModuleAccess(current);
                        setNewMember({ ...newMember, permissions: { ...newMember.permissions, [mod.id]: next } });
                      }}
                      className={`flex flex-col items-center justify-center gap-3 p-5 rounded-[2rem] border-2 transition-all group relative ${
                        level === 'none'
                          ? 'bg-white border-slate-100 text-slate-300 hover:border-slate-200'
                          : level === 'viewer'
                          ? 'bg-amber-50 border-amber-400 text-amber-700 shadow-lg shadow-amber-50 -translate-y-1'
                          : 'bg-indigo-50 border-indigo-600 text-indigo-700 shadow-lg shadow-indigo-50 -translate-y-1'
                      }`}
                    >
                      <div className={`p-3 rounded-2xl transition-all ${level === 'none' ? 'bg-slate-100 text-slate-400' : level === 'viewer' ? 'bg-amber-500 text-white' : 'bg-indigo-600 text-white'}`}>
                        <mod.icon size={24} />
                      </div>
                      <span className="text-xs font-black uppercase tracking-tighter">{mod.label}</span>
                      <span className="text-[9px] font-bold uppercase opacity-70">{getLevelLabel(raw, isCapab)}</span>
                      {level !== 'none' && (
                        <div className={`absolute top-2 right-2 w-2 h-2 rounded-full animate-pulse ${level === 'viewer' ? 'bg-amber-500' : 'bg-indigo-500'}`}></div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex gap-4 items-center">
              <div className="flex-1 bg-amber-50 border-2 border-amber-200 rounded-2xl p-4">
                <div className="flex gap-3">
                  <div className="text-amber-600 flex-shrink-0">
                    <Mail size={24} />
                  </div>
                  <div>
                    <p className="text-sm font-black text-amber-800 mb-1">💡 Dica Importante</p>
                    <p className="text-xs text-amber-700 font-medium">Os dados serão salvos, mas o convite só será enviado quando você clicar no botão "Enviar Convite" depois.</p>
                  </div>
                </div>
              </div>
            </div>
            <button type="submit" className="w-full bg-indigo-600 text-white rounded-2xl font-black py-5 hover:bg-indigo-700 transition-all shadow-xl shadow-indigo-100">
              💾 Salvar Dados do Colaborador
            </button>
          </form>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
        {team.map(member => (
          <div key={member.id} className={`bg-white p-8 rounded-[2.5rem] border-2 ${member.active ? 'border-slate-100' : 'border-slate-50 opacity-60'} shadow-sm hover:shadow-2xl transition-all duration-500 group relative overflow-hidden`}>
            {/* Header do Card */}
            <div className="flex flex-col sm:flex-row items-center sm:items-start gap-6 mb-8">
              <div className={`w-24 h-24 ${member.active ? 'bg-gradient-to-br from-indigo-500 to-blue-600' : 'bg-slate-300'} text-white rounded-[2rem] flex items-center justify-center font-black text-4xl shadow-2xl shadow-indigo-100 transform -rotate-3 group-hover:rotate-0 transition-transform duration-500`}>
                {member.name.charAt(0)}
              </div>
              <div className="flex-1 text-center sm:text-left">
                <h3 className="font-black text-slate-800 text-2xl tracking-tight mb-1">{member.name}</h3>
                <div className="flex items-center justify-center sm:justify-start gap-2 text-sm font-bold text-slate-400">
                  <Mail size={14} /> {member.email}
                </div>
                {member.phone && (
                  <div className="mt-2 flex items-center justify-center sm:justify-start gap-2 text-sm font-bold text-slate-400">
                    <Phone size={14} /> {member.phone}
                  </div>
                )}
                <div className="mt-4 flex flex-wrap justify-center sm:justify-start gap-2">
                  <span className={`px-4 py-1.5 rounded-full text-xs font-black uppercase tracking-widest ${member.active ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-100 text-slate-400'}`}>
                    {member.active ? 'Acesso Ativo' : 'Acesso Bloqueado'}
                  </span>
                  <span className={`px-4 py-1.5 rounded-full text-xs font-black uppercase tracking-widest flex items-center gap-1.5 ${
                    member.role === UserRole.ADMIN
                      ? 'bg-amber-100 text-amber-600'
                      : member.role === UserRole.EDITOR
                        ? 'bg-sky-100 text-sky-600'
                        : 'bg-slate-100 text-slate-500'
                  }`}>
                    <Shield size={12} />
                    {member.role === UserRole.ADMIN ? 'Administrador' : member.role === UserRole.EDITOR ? 'Editor' : 'Visualizador'}
                  </span>
                  {member.inviteSent ? (
                    <span className="bg-blue-100 text-blue-600 px-4 py-1.5 rounded-full text-xs font-black uppercase tracking-widest flex items-center gap-1.5">
                      <CheckCircle size={12} /> Convite Enviado
                    </span>
                  ) : (
                    <span className="bg-orange-100 text-orange-600 px-4 py-1.5 rounded-full text-xs font-black uppercase tracking-widest flex items-center gap-1.5 animate-pulse">
                      <Mail size={12} /> Aguardando Convite
                    </span>
                  )}
                </div>
              </div>
              
              {canManage && (
                <div className="flex sm:flex-col gap-2">
                  <button 
                    onClick={() => startEditingMember(member)}
                    className="p-4 text-violet-600 bg-violet-50 hover:bg-violet-100 rounded-2xl transition-all shadow-sm active:scale-90"
                    title="Editar dados do colaborador"
                  >
                    <Edit2 size={24} />
                  </button>
                  {!member.inviteSent && (
                    <button 
                      onClick={() => sendInvite(member.id)} 
                      className="p-4 text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-2xl transition-all shadow-sm active:scale-90 relative group/invite"
                      title="Enviar Convite por E-mail"
                    >
                      <Mail size={24} />
                      <span className="absolute -top-1 -right-1 w-3 h-3 bg-orange-500 rounded-full animate-pulse"></span>
                    </button>
                  )}
                  <button 
                    onClick={() => toggleStatus(member.id)} 
                    className={`p-4 rounded-2xl transition-all shadow-sm active:scale-90 ${member.active ? 'text-emerald-500 bg-emerald-50 hover:bg-emerald-100' : 'text-slate-400 bg-slate-50 hover:bg-slate-100'}`}
                    title={member.active ? "Desativar Usuário" : "Ativar Usuário"}
                  >
                    <ShieldCheck size={24} />
                  </button>
                  <button 
                    onClick={() => removeMember(member.id)} 
                    className="p-4 text-rose-500 bg-rose-50 hover:bg-rose-100 rounded-2xl transition-all shadow-sm active:scale-90"
                    title="Remover permanentemente"
                  >
                    <Trash2 size={24} />
                  </button>
                </div>
              )}
            </div>

            {editingMemberId === member.id && (
              <div className="mb-6 rounded-2xl border border-violet-200 bg-violet-50 p-4">
                <p className="mb-3 text-xs font-black uppercase tracking-wider text-violet-600">Editar dados do colaborador</p>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                  <input
                    className="rounded-xl border border-violet-200 bg-white px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-violet-500"
                    value={editMemberDraft.name}
                    onChange={(e) => setEditMemberDraft((prev) => ({ ...prev, name: e.target.value }))}
                    placeholder="Nome"
                  />
                  <input
                    className="rounded-xl border border-violet-200 bg-white px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-violet-500"
                    type="email"
                    value={editMemberDraft.email}
                    onChange={(e) => setEditMemberDraft((prev) => ({ ...prev, email: e.target.value }))}
                    placeholder="E-mail"
                  />
                  <input
                    className="rounded-xl border border-violet-200 bg-white px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-violet-500"
                    type="tel"
                    value={editMemberDraft.phone}
                    onChange={(e) => setEditMemberDraft((prev) => ({ ...prev, phone: e.target.value }))}
                    placeholder="Telefone / WhatsApp"
                  />
                  <select
                    className="rounded-xl border border-violet-200 bg-white px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-violet-500"
                    value={editMemberDraft.role}
                    onChange={(e) => setEditMemberDraft((prev) => ({ ...prev, role: e.target.value as UserRole }))}
                  >
                    {roleOptions.map((roleOption) => (
                      <option key={roleOption.id} value={roleOption.id}>
                        {roleOption.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="mt-3 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={cancelEditingMember}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={saveEditingMember}
                    className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-violet-700"
                  >
                    Salvar
                  </button>
                </div>
              </div>
            )}

            {/* Grid de Permissões Redesenhado */}
            <div className="space-y-4">
              <div className="flex items-center gap-3 mb-2">
                <div className="h-px flex-1 bg-slate-100"></div>
                <span className="text-xs font-black text-slate-300 uppercase tracking-widest px-2">Módulos Disponíveis</span>
                <div className="h-px flex-1 bg-slate-100"></div>
              </div>
              {canManage && member.active && (
                <p className="text-xs text-slate-400 text-center -mt-2 mb-2">
                  Clique em cada módulo para liberar ou bloquear individualmente.
                  {member.role !== UserRole.ADMIN && (
                    <span className="ml-1 text-indigo-400 font-semibold">
                      Papel atual: <strong>{member.role === UserRole.EDITOR ? 'Editor' : 'Visualizador'}</strong>
                      {' '}— para redefinir aos defaults do papel, altere e salve o perfil.
                    </span>
                  )}
                </p>
              )}
              
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                {modules.map(mod => {
                  const raw = member.permissions?.[mod.id as keyof ModulePermissions];
                  const isCapab = capabilityIds.includes(mod.id);
                  const level = isCapab ? (raw ? 'editor' : 'none') : getModuleLevel(raw);
                  return (
                    <button
                      key={mod.id}
                      onClick={() => togglePermission(member.id, mod.id as keyof ModulePermissions)}
                      disabled={!canManage || !member.active}
                      className={`relative flex flex-col items-center gap-3 p-6 rounded-[2rem] border-2 transition-all group/mod active:scale-95 ${
                        getColorClasses(mod.color, level)
                      } ${level !== 'none' ? 'shadow-lg -translate-y-1' : ''} ${!canManage && 'cursor-default'}`}
                    >
                      {/* LED Status */}
                      <div className={`absolute top-4 right-4 w-2 h-2 rounded-full shadow-sm ${
                        level === 'editor' ? 'bg-current animate-pulse' : level === 'viewer' ? 'bg-amber-400 animate-pulse' : 'bg-slate-200'
                      }`}></div>

                      <div className={`p-4 rounded-2xl transition-all ${getIconBg(mod.color, level)} shadow-inner`}>
                        <mod.icon size={24} />
                      </div>

                      <div className="text-center overflow-hidden w-full">
                        <span className={`text-xs font-black uppercase tracking-tight block truncate ${level !== 'none' ? 'text-current' : 'text-slate-400'}`}>
                          {mod.label}
                        </span>
                        <span className={`text-[8px] font-black uppercase opacity-60 tracking-tighter ${level !== 'none' ? 'text-current' : 'text-slate-300'}`}>
                          {getLevelLabel(raw, isCapab)}
                        </span>
                      </div>

                      {level !== 'none' && (
                        <div className="absolute -bottom-1 -right-1 bg-white text-current rounded-full p-1.5 border-2 border-current shadow-sm scale-110">
                          {level === 'viewer' ? <span className="text-[8px] font-black text-amber-600">V</span> : <Check size={10} strokeWidth={4} />}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Seção de Permissões de Categorias */}
            {getModuleLevel(member.permissions?.accounts) !== 'none' && accounts.length > 0 && (
              <div className="mt-8 space-y-4">
                <button
                  onClick={() => setExpandedCategoryMember(expandedCategoryMember === member.id ? null : member.id)}
                  className="w-full flex items-center justify-between p-4 bg-purple-50 hover:bg-purple-100 border border-purple-200 rounded-2xl transition-all group/btn"
                  disabled={!canManage || !member.active}
                >
                  <div className="flex items-center gap-3">
                    <Lock size={18} className="text-purple-600" />
                    <span className="text-sm font-black text-purple-700 uppercase tracking-tight">Categorias do Centro de Custo</span>
                  </div>
                  <span className={`text-purple-600 transition-transform ${expandedCategoryMember === member.id ? 'rotate-180' : ''}`}>
                    ▼
                  </span>
                </button>

                {expandedCategoryMember === member.id && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-4 bg-slate-50 rounded-2xl border border-slate-200">
                    {accounts.map(account => {
                      const hasAccess = member.categoryPermissions?.includes(account.id);
                      return (
                        <button
                          key={account.id}
                          onClick={() => toggleCategoryPermission(member.id, account.id)}
                          disabled={!canManage || !member.active || getModuleLevel(member.permissions?.accounts) === 'none'}
                          className={`flex items-center gap-3 p-3 rounded-lg transition-all text-left font-bold text-sm ${
                            hasAccess
                              ? 'bg-purple-100 text-purple-700 border border-purple-300'
                              : 'bg-white text-slate-600 border border-slate-200 hover:border-slate-300'
                          } ${(!canManage || !member.active) ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                        >
                          <div className={`w-5 h-5 rounded border-2 flex items-center justify-center font-black text-xs transition-all ${
                            hasAccess
                              ? 'bg-purple-600 border-purple-600 text-white'
                              : 'border-slate-300 bg-white'
                          }`}>
                            {hasAccess && '✓'}
                          </div>
                          <span className="flex-1 truncate">{account.name}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Rodapé do Card */}
            <div className="mt-8 pt-6 border-t border-slate-50 flex items-center justify-between">
              <span className="text-xs font-black text-slate-300 uppercase tracking-widest">Acesso Granular</span>
              <div className="flex -space-x-1">
                {modules.filter(m => {
                  const raw = member.permissions?.[m.id as keyof ModulePermissions];
                  const isCapab = capabilityIds.includes(m.id);
                  return isCapab ? Boolean(raw) : getModuleLevel(raw) !== 'none';
                }).map(m => {
                  const raw = member.permissions?.[m.id as keyof ModulePermissions];
                  const isCapab = capabilityIds.includes(m.id);
                  const level = isCapab ? 'editor' : getModuleLevel(raw);
                  return (
                    <div key={m.id} title={`${m.label}: ${getLevelLabel(raw, isCapab)}`} className={`w-6 h-6 rounded-full border-2 border-white flex items-center justify-center ${getIconBg(m.color, level)}`}>
                      <m.icon size={10} />
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
