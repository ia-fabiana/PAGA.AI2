
import React, { useState } from 'react';
import { Company } from '../types';
import { Save, Building2, MapPin, Phone, Mail, Hash } from 'lucide-react';

interface CompanyProfileProps {
  company: Company;
  setCompany: (c: Company) => void;
  canEdit: boolean;
}

export const CompanyProfile: React.FC<CompanyProfileProps> = ({ company, setCompany, canEdit }) => {
  const [data, setData] = useState<Company>(company);
  const [saved, setSaved] = useState(false);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEdit) return;
    setCompany(data);
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  return (
    <div className="max-w-2xl mx-auto space-y-8 animate-in fade-in duration-500">
      <header className="text-center">
        <div className="inline-flex p-4 bg-indigo-100 text-indigo-600 rounded-3xl mb-4">
          <Building2 size={40} />
        </div>
        <h1 className="text-3xl font-bold text-slate-800">Dados da Empresa</h1>
        <p className="text-slate-500">Informações da sua organização para relatórios e faturamento.</p>
      </header>

      <div className="bg-white p-8 rounded-3xl border border-slate-200 shadow-xl">
        <form onSubmit={handleSave} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="md:col-span-2">
              <label className="block text-sm font-bold text-slate-700 mb-2 flex items-center gap-2">
                <Building2 size={16} className="text-slate-400" /> Razão Social
              </label>
              <input 
                disabled={!canEdit}
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:outline-none disabled:opacity-50"
                value={data.name}
                onChange={e => setData({...data, name: e.target.value})}
              />
            </div>

            <div>
              <label className="block text-sm font-bold text-slate-700 mb-2 flex items-center gap-2">
                <Hash size={16} className="text-slate-400" /> CNPJ / CPF
              </label>
              <input 
                disabled={!canEdit}
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:outline-none disabled:opacity-50"
                value={data.taxId}
                onChange={e => setData({...data, taxId: e.target.value})}
              />
            </div>

            <div>
              <label className="block text-sm font-bold text-slate-700 mb-2 flex items-center gap-2">
                <Phone size={16} className="text-slate-400" /> Telefone
              </label>
              <input 
                disabled={!canEdit}
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:outline-none disabled:opacity-50"
                value={data.phone}
                onChange={e => setData({...data, phone: e.target.value})}
              />
            </div>

            <div className="md:col-span-2">
              <label className="block text-sm font-bold text-slate-700 mb-2 flex items-center gap-2">
                <Mail size={16} className="text-slate-400" /> Email Financeiro
              </label>
              <input 
                disabled={!canEdit}
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:outline-none disabled:opacity-50"
                value={data.email}
                onChange={e => setData({...data, email: e.target.value})}
              />
            </div>

            <div className="md:col-span-2">
              <label className="block text-sm font-bold text-slate-700 mb-2 flex items-center gap-2">
                <MapPin size={16} className="text-slate-400" /> Endereço Completo
              </label>
              <textarea 
                disabled={!canEdit}
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:outline-none disabled:opacity-50 h-24"
                value={data.address}
                onChange={e => setData({...data, address: e.target.value})}
              />
            </div>
          </div>

          {canEdit && (
            <div className="pt-4 flex items-center justify-between">
              {saved && <span className="text-emerald-600 font-bold animate-pulse text-sm">✓ Alterações salvas com sucesso!</span>}
              <button 
                type="submit"
                className="ml-auto flex items-center gap-2 px-8 py-3 bg-indigo-600 rounded-xl text-white font-bold hover:bg-indigo-700 transition-all shadow-lg hover:shadow-indigo-200"
              >
                <Save size={18} /> Salvar Alterações
              </button>
            </div>
          )}
        </form>
      </div>
    </div>
  );
};
