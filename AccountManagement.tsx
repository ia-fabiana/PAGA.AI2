
import React, { useState } from 'react';
import { ChartOfAccount, AccountType, DreCategory } from '../types';
import { 
  Plus, Edit2, Trash2, X, Save, Search, 
  CheckCircle, Settings2, PieChart
} from 'lucide-react';

interface AccountManagementProps {
  accounts: ChartOfAccount[];
  setAccounts: React.Dispatch<React.SetStateAction<ChartOfAccount[]>>;
  canManage: boolean;
}

export const AccountManagement: React.FC<AccountManagementProps> = ({ accounts, setAccounts, canManage }) => {
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<{name: string, description: string, type: AccountType, category: DreCategory}>({ 
    name: '', 
    description: '', 
    type: 'FIXED',
    category: 'FIXED_EXPENSES'
  });
  const [searchTerm, setSearchTerm] = useState('');

  const categories: { id: DreCategory, label: string, desc: string }[] = [
    { id: 'PRODUCT_COST', label: '2. PRODUTOS (Aba)', desc: 'Keune, Wella, Luvas, etc' },
    { id: 'COMMISSION', label: '1. COMISSÕES (Aba)', desc: 'Manicure, Extra, Repasse' },
    { id: 'FIXED_SALARY', label: '3. SALÁRIO FIXO (Aba)', desc: 'Folha de Pagamento fixa' },
    { id: 'FIXED_EXPENSES', label: '5. DESP. FIXAS (Aba)', desc: 'Aluguel, Luz, Internet' },
    { id: 'VARIABLE_EXPENSES', label: 'DESP. VARIÁVEIS (Aba)', desc: 'Manutenção, Marketing' },
    { id: 'PRO_LABORE', label: 'PRO-LABORE (Aba)', desc: 'Retirada dos Sócios' },
  ];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name) return;

    if (editingId) {
      setAccounts(prev => prev.map(a => a.id === editingId ? { ...a, ...formData } : a));
    } else {
      setAccounts(prev => [...prev, { id: Math.random().toString(36).substr(2, 9), ...formData }]);
    }

    setIsAdding(false);
    setEditingId(null);
    setFormData({ name: '', description: '', type: 'FIXED', category: 'FIXED_EXPENSES' });
  };

  // Fix: Defined the missing handleDelete function
  const handleDelete = (id: string) => {
    if (!canManage) return;
    if (window.confirm('Deseja realmente excluir esta categoria? Isso pode afetar contas vinculadas.')) {
      setAccounts(prev => prev.filter(a => a.id !== id));
    }
  };

  const filteredAccounts = accounts.filter(acc => 
    acc.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-800 flex items-center gap-2">
            Plano de Contas por Tela
            <Settings2 size={24} className="text-indigo-600" />
          </h1>
          <p className="text-slate-500 font-medium">Cada categoria abaixo representa uma "Aba" da sua planilha comercial.</p>
        </div>
        {canManage && !isAdding && (
          <button 
            onClick={() => { setIsAdding(true); setEditingId(null); }}
            className="flex items-center gap-2 px-6 py-3 bg-indigo-600 rounded-2xl text-white hover:bg-indigo-700 transition-all font-black text-sm shadow-xl"
          >
            <Plus size={20} /> Nova Categoria
          </button>
        )}
      </div>

      {isAdding && (
        <div className="bg-white p-8 rounded-3xl border-2 border-indigo-100 shadow-2xl animate-in zoom-in">
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-4">
                <label className="text-xs font-black text-slate-400 uppercase">Nome da Categoria</label>
                <input 
                  className="w-full px-5 py-4 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none font-bold" 
                  placeholder="Ex: KEUNE" 
                  value={formData.name} 
                  onChange={e => setFormData({...formData, name: e.target.value})} 
                />
              </div>
              <div className="space-y-4">
                <label className="text-xs font-black text-slate-400 uppercase">Vínculo com Tela (Aba)</label>
                <select 
                  className="w-full px-5 py-4 bg-slate-50 border border-slate-200 rounded-2xl outline-none"
                  value={formData.category}
                  onChange={e => setFormData({...formData, category: e.target.value as DreCategory})}
                >
                  {categories.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
              </div>
            </div>
            <div className="flex gap-3">
               <button type="button" onClick={() => setIsAdding(false)} className="flex-1 py-4 border border-slate-200 rounded-2xl font-bold">Cancelar</button>
               <button type="submit" className="flex-1 py-4 bg-indigo-600 text-white rounded-2xl font-black shadow-lg">Salvar na Estrutura</button>
            </div>
          </form>
        </div>
      )}

      <div className="bg-white rounded-[2.5rem] border border-slate-200 shadow-sm overflow-hidden">
        <table className="w-full text-left">
          <thead className="bg-slate-50 text-[10px] font-black text-slate-400 uppercase tracking-widest">
            <tr>
              <th className="px-8 py-5">Item (Categoria)</th>
              <th className="px-8 py-5">Aba Destino</th>
              <th className="px-8 py-5 text-right">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filteredAccounts.map(acc => (
              <tr key={acc.id} className="hover:bg-slate-50 group transition-colors">
                <td className="px-8 py-5 font-bold text-slate-800 uppercase text-xs">{acc.name}</td>
                <td className="px-8 py-5">
                   <span className="bg-indigo-50 text-indigo-700 px-3 py-1 rounded-full text-[10px] font-black uppercase">
                     {categories.find(c => c.id === acc.category)?.label || acc.category}
                   </span>
                </td>
                <td className="px-8 py-5 text-right opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => handleDelete(acc.id)} className="text-rose-500 hover:bg-rose-50 p-2 rounded-xl"><Trash2 size={16}/></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
