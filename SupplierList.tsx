
import React from 'react';
import { Supplier, ChartOfAccount, UserRole } from './types';
import { Plus, Search, Edit2, Trash2, Mail, Hash, ListTree, Phone, Users } from 'lucide-react';
import { theme } from './theme';

interface SupplierListProps {
  suppliers: Supplier[];
  accounts: ChartOfAccount[];
  onEdit: (s: Supplier) => void;
  onDelete: (id: string) => void;
  onOpenForm: () => void;
  userRole: UserRole;
}

export const SupplierList: React.FC<SupplierListProps> = ({ suppliers, accounts, onEdit, onDelete, onOpenForm, userRole }) => {
  const [search, setSearch] = React.useState('');

  const filteredSuppliers = suppliers.filter(s => 
    s.name.toLowerCase().includes(search.toLowerCase()) || 
    s.taxId.includes(search)
  ).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

  const canEdit = userRole !== UserRole.VIEWER;
  const canDelete = userRole === UserRole.ADMIN;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: theme.colors.neutral.black }}>Fornecedores</h1>
          <p className="text-slate-500">Cadastre e gerencie os parceiros do seu negócio.</p>
        </div>
        {canEdit && (
          <button 
            onClick={onOpenForm}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-white hover:shadow-lg hover:-translate-y-0.5 transition-all font-medium shadow-md"
            style={{ backgroundColor: theme.colors.primary.purple }}
          >
            <Plus size={18} /> Novo Fornecedor
          </button>
        )}
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
        <input 
          type="text" 
          placeholder="Buscar fornecedor..."
          className="w-full pl-10 pr-4 py-3 bg-white border border-slate-200 rounded-xl shadow-sm outline-none"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredSuppliers.map(supplier => {
          const account = accounts.find(a => a.id === supplier.accountId);
          return (
            <div key={supplier.id} className="bg-white p-6 rounded-[20px] border border-slate-100 shadow-[0_10px_15px_-3px_rgba(0,0,0,0.04)] hover:shadow-[0_20px_25px_-5px_rgba(0,0,0,0.1)] hover:-translate-y-1 transition-all group relative overflow-hidden">
              <div className="flex items-start justify-between mb-4">
                <div className="w-12 h-12 rounded-xl flex items-center justify-center font-bold text-lg" style={{ backgroundColor: '#EDE9FE', color: theme.colors.primary.purple }}>
                  {supplier.name.charAt(0).toUpperCase()}
                </div>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  {canEdit && <button onClick={() => onEdit(supplier)} className="p-2 hover:bg-purple-50 rounded-lg" style={{ color: theme.colors.primary.purple }}><Edit2 size={16} /></button>}
                  {canDelete && <button onClick={() => onDelete(supplier.id)} className="p-2 hover:bg-rose-50 rounded-lg text-rose-600"><Trash2 size={16} /></button>}
                </div>
              </div>
              
              <h3 className="font-bold text-lg mb-4 truncate" style={{ color: theme.colors.neutral.black }} title={supplier.name}>
                {supplier.name.toUpperCase()}
              </h3>
              
              <div className="space-y-3">
                {supplier.taxId && (
                  <div className="flex items-center gap-2 text-sm text-slate-500">
                    <Hash size={14} /> <span>{supplier.taxId}</span>
                  </div>
                )}
                {supplier.phone && (
                  <div className="flex items-center gap-2 text-sm text-slate-500">
                    <Phone size={14} /> <span>{supplier.phone}</span>
                  </div>
                )}
                {supplier.contactPerson && (
                  <div className="flex items-center gap-2 text-sm text-slate-500">
                    <Users size={14} /> <span className="truncate">{supplier.contactPerson}</span>
                  </div>
                )}
                {supplier.email && (
                  <div className="flex items-center gap-2 text-sm text-slate-500">
                    <Mail size={14} /> <span className="truncate">{supplier.email}</span>
                  </div>
                )}
                <div className="flex items-center gap-2 text-sm text-slate-500">
                  <ListTree size={14} style={{ color: theme.colors.primary.purple }} />
                  <span className="px-2 py-0.5 rounded text-xs font-bold uppercase truncate" style={{ backgroundColor: '#EDE9FE', color: theme.colors.primary.purple }}>
                    {account?.name || 'Não atribuído'}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {filteredSuppliers.length === 0 && (
        <div className="text-center py-20 bg-slate-50/50 rounded-3xl border-2 border-dashed border-slate-200">
          <p className="text-slate-400">Nenhum fornecedor cadastrado.</p>
        </div>
      )}
    </div>
  );
};
