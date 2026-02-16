import React, { useState, useMemo } from 'react';
import { Revenue } from './types';
import { Plus, Trash2, Edit2, TrendingUp } from 'lucide-react';

interface RevenueListProps {
  revenues: Revenue[];
  onAdd: (revenue: Omit<Revenue, 'id'>) => void;
  onEdit: (id: string, revenue: Omit<Revenue, 'id'>) => void;
  onDelete: (id: string) => void;
}

export const RevenueList: React.FC<RevenueListProps> = ({ revenues, onAdd, onEdit, onDelete }) => {
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState({ date: '', amount: '', description: '' });

  const visibleRevenues = useMemo(() => revenues.filter(r => !r.isEstimate), [revenues]);

  const sortedRevenues = useMemo(() => {
    return [...visibleRevenues].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [visibleRevenues]);

  const monthlyTotal = useMemo(() => {
    const now = new Date();
    return visibleRevenues
      .filter(r => {
        const d = new Date(r.date);
        return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
      })
      .reduce((sum, r) => sum + r.amount, 0);
  }, [visibleRevenues]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.date || !formData.amount) {
      alert('Preencha data e valor');
      return;
    }

    const revenue = {
      date: formData.date,
      amount: parseFloat(formData.amount),
      description: formData.description || '',
      isEstimate: false
    };

    if (editingId) {
      onEdit(editingId, revenue);
    } else {
      onAdd(revenue);
    }

    setFormData({ date: '', amount: '', description: '' });
    setEditingId(null);
    setShowForm(false);
  };

  const handleEdit = (revenue: Revenue) => {
    setEditingId(revenue.id);
    setFormData({
      date: revenue.date,
      amount: revenue.amount.toString(),
      description: revenue.description || ''
    });
    setShowForm(true);
  };

  const fmt = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-black text-slate-800 tracking-tight uppercase flex items-center gap-3">
            <TrendingUp size={32} className="text-emerald-600" />
            Receitas
          </h1>
          <p className="text-slate-500 font-bold uppercase text-xs tracking-widest mt-1">Registre aqui o faturamento diário</p>
        </div>
        <button
          onClick={() => {
            setShowForm(!showForm);
            setEditingId(null);
            setFormData({ date: '', amount: '', description: '' });
          }}
          className="px-4 py-3 bg-emerald-600 text-white rounded-xl font-bold hover:bg-emerald-700 transition-colors flex items-center gap-2"
        >
          <Plus size={20} /> Nova Receita
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="bg-white p-6 rounded-2xl border-2 border-emerald-200 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-2">Data</label>
              <input
                type="date"
                value={formData.date}
                onChange={e => setFormData({ ...formData, date: e.target.value })}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-2">Valor (R$)</label>
              <input
                type="number"
                step="0.01"
                value={formData.amount}
                onChange={e => setFormData({ ...formData, amount: e.target.value })}
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none"
                placeholder="0.00"
              />
            </div>
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-2">Descrição (opcional)</label>
              <input
                type="text"
                value={formData.description}
                onChange={e => setFormData({ ...formData, description: e.target.value })}
                placeholder="Ex: Serviços prestados"
                className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none"
              />
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={() => {
                setShowForm(false);
                setEditingId(null);
                setFormData({ date: '', amount: '', description: '' });
              }}
              className="px-4 py-2 border border-slate-300 rounded-lg text-slate-600 font-bold hover:bg-slate-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-emerald-600 text-white rounded-lg font-bold hover:bg-emerald-700"
            >
              {editingId ? 'Atualizar' : 'Registrar'}
            </button>
          </div>
        </form>
      )}

      <div className="bg-emerald-50 p-6 rounded-2xl border-2 border-emerald-200">
        <p className="text-sm text-emerald-700 font-bold uppercase">Faturamento de {new Date().toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}</p>
        <h2 className="text-3xl font-black text-emerald-600 mt-2">{fmt(monthlyTotal)}</h2>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-lg overflow-hidden">
        <table className="w-full">
          <thead className="bg-slate-900 text-white">
            <tr>
              <th className="px-6 py-4 text-left text-sm font-black uppercase">Data</th>
              <th className="px-6 py-4 text-left text-sm font-black uppercase">Descrição</th>
              <th className="px-6 py-4 text-right text-sm font-black uppercase">Valor</th>
              <th className="px-6 py-4 text-right text-sm font-black uppercase">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {sortedRevenues.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-6 py-8 text-center text-slate-400 text-sm">
                  Nenhuma receita registrada ainda
                </td>
              </tr>
            ) : (
              sortedRevenues.map((revenue, idx) => (
                <tr key={idx} className="hover:bg-slate-50 transition-colors group">
                  <td className="px-6 py-4 text-sm font-semibold text-slate-800">
                    {new Date(revenue.date).toLocaleDateString('pt-BR')}
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-600">
                    {revenue.description || '—'}
                  </td>
                  <td className="px-6 py-4 text-right text-sm font-bold text-emerald-600">
                    {fmt(revenue.amount)}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => handleEdit(revenue)}
                        className="p-2 text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                      >
                        <Edit2 size={18} />
                      </button>
                      <button
                        onClick={() => onDelete(revenue.id)}
                        className="p-2 text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
