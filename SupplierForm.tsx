
import React, { useState } from 'react';
import { Supplier, ChartOfAccount } from './types';
import { X, User, ShieldCheck, Mail, ListTree } from 'lucide-react';

interface SupplierFormProps {
  accounts: ChartOfAccount[];
  onClose: () => void;
  onSubmit: (s: Supplier) => void;
  initialData?: Supplier;
}

export const SupplierForm: React.FC<SupplierFormProps> = ({ accounts, onClose, onSubmit, initialData }) => {
  const [formData, setFormData] = useState<Partial<Supplier>>(initialData || {
    name: '',
    taxId: '',
    email: '',
    accountId: accounts[0]?.id || ''
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name || !formData.taxId || !formData.accountId) {
      alert('Preencha os campos obrigatórios');
      return;
    }
    onSubmit(formData as Supplier);
  };

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-lg rounded-3xl shadow-2xl animate-in zoom-in duration-300">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <h2 className="text-xl font-bold text-slate-800">{initialData ? 'Editar Fornecedor' : 'Novo Fornecedor'}</h2>
          <button onClick={onClose} className="p-2 hover:bg-slate-50 rounded-full text-slate-400">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1 flex items-center gap-1">
              <User size={14} /> Nome / Razão Social
            </label>
            <input 
              required
              className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none"
              placeholder="Ex: Amazon Web Services Inc."
              value={formData.name}
              onChange={e => setFormData({ ...formData, name: e.target.value })}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1 flex items-center gap-1">
              <ShieldCheck size={14} /> CNPJ / CPF
            </label>
            <input 
              required
              className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none"
              placeholder="00.000.000/0000-00"
              value={formData.taxId}
              onChange={e => setFormData({ ...formData, taxId: e.target.value })}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1 flex items-center gap-1">
              <Mail size={14} /> Email de Contato
            </label>
            <input 
              type="email"
              className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none"
              placeholder="billing@fornecedor.com"
              value={formData.email}
              onChange={e => setFormData({ ...formData, email: e.target.value })}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1 flex items-center gap-1">
              <ListTree size={14} /> Plano de Contas Sugerido
            </label>
            <select 
              required
              className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none appearance-none"
              value={formData.accountId}
              onChange={e => setFormData({ ...formData, accountId: e.target.value })}
            >
              <option value="">Selecione...</option>
              {accounts.map(acc => (
                <option key={acc.id} value={acc.id}>{acc.name}</option>
              ))}
            </select>
          </div>

          <div className="pt-4 flex gap-3">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-3 border border-slate-200 rounded-xl text-slate-600 font-medium hover:bg-slate-50">Cancelar</button>
            <button type="submit" className="flex-1 px-4 py-3 bg-indigo-600 rounded-xl text-white font-bold hover:bg-indigo-700 shadow-lg">Salvar Fornecedor</button>
          </div>
        </form>
      </div>
    </div>
  );
};
