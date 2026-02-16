
import React from 'react';
import { Supplier, ChartOfAccount, UserRole } from './types';
import { Plus, Search, Edit2, Trash2, Mail, Hash, ListTree } from 'lucide-react';

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
  );

  const canEdit = userRole !== UserRole.VIEWER;
  const canDelete = userRole === UserRole.ADMIN;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Fornecedores</h1>
          <p className="text-slate-500">Cadastre e gerencie os parceiros do seu negócio.</p>
        </div>
        {canEdit && (
          <button 
            onClick={onOpenForm}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 rounded-xl text-white hover:bg-indigo-700 transition-colors font-medium shadow-md"
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
          className="w-full pl-10 pr-4 py-3 bg-white border border-slate-200 rounded-xl shadow-sm focus:ring-2 focus:ring-indigo-500 outline-none"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredSuppliers.map(supplier => {
          const account = accounts.find(a => a.id === supplier.accountId);
          return (
            <div key={supplier.id} className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow group relative overflow-hidden">
              <div className="flex items-start justify-between mb-4">
                <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-xl flex items-center justify-center font-bold text-lg">
                  {supplier.name.charAt(0)}
                </div>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  {canEdit && <button onClick={() => onEdit(supplier)} className="p-2 hover:bg-slate-100 rounded-lg text-slate-600"><Edit2 size={16} /></button>}
                  {canDelete && <button onClick={() => onDelete(supplier.id)} className="p-2 hover:bg-rose-50 rounded-lg text-rose-600"><Trash2 size={16} /></button>}
                </div>
              </div>
              
              <h3 className="font-bold text-slate-800 text-lg mb-4 truncate" title={supplier.name}>{supplier.name}</h3>
              
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm text-slate-500">
                  <Hash size={14} /> <span>{supplier.taxId}</span>
                </div>
                <div className="flex items-center gap-2 text-sm text-slate-500">
                  <Mail size={14} /> <span className="truncate">{supplier.email}</span>
                </div>
                <div className="flex items-center gap-2 text-sm text-slate-500">
                  <ListTree size={14} className="text-indigo-600" />
                  <span className="bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded text-xs font-bold uppercase truncate">
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
