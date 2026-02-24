
import React, { useState, useEffect } from 'react';
import { Bill, Supplier, BillStatus, RecurrenceType, ChartOfAccount } from './types';
import { X, Calendar, DollarSign, Repeat, Layers, Check, ListTree, Plus, Trash2, User } from 'lucide-react';

interface BillFormProps {
  suppliers: Supplier[];
  accounts: ChartOfAccount[];
  onClose: () => void;
  onSubmit: (bill: Bill) => void;
  initialData?: Bill;
  userEmail?: string;
  canEditBillDate?: boolean;
}

export const BillForm: React.FC<BillFormProps> = ({ suppliers, accounts, onClose, onSubmit, initialData, userEmail, canEditBillDate }) => {
  const [formData, setFormData] = useState<Partial<Bill>>(initialData || {
    description: '',
    amount: 0,
    supplierId: suppliers[0]?.id || '',
    dueDate: new Date().toISOString().split('T')[0],
    paidDate: undefined,
    paidAmount: undefined,
    interestAmount: undefined,
    status: BillStatus.PENDING,
    recurrenceType: 'none',
    accountId: accounts[0]?.id || '',
    totalInstallments: 1,
    selectedMonths: [],
    specificDues: [{ date: new Date().toISOString().split('T')[0], amount: 0 }],
    launchedBy: initialData?.launchedBy || userEmail || ''
  });

  const months = [
    'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun',
    'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'
  ];

  const toggleMonth = (index: number) => {
    const current = formData.selectedMonths || [];
    if (current.includes(index)) {
      setFormData({ ...formData, selectedMonths: current.filter(m => m !== index) });
    } else {
      setFormData({ ...formData, selectedMonths: [...current, index] });
    }
  };

  const addSpecificDue = () => {
    const current = formData.specificDues || [];
    setFormData({
      ...formData,
      specificDues: [...current, { date: new Date().toISOString().split('T')[0], amount: 0 }]
    });
  };

  const removeSpecificDue = (index: number) => {
    const current = formData.specificDues || [];
    if (current.length <= 1) return;
    setFormData({
      ...formData,
      specificDues: current.filter((_, i) => i !== index)
    });
  };

  const updateSpecificDue = (index: number, field: 'date' | 'amount', value: string | number) => {
    const current = formData.specificDues || [];
    const updated = current.map((item, i) => {
      if (i === index) return { ...item, [field]: value };
      return item;
    });
    setFormData({ ...formData, specificDues: updated });
  };

  const parseCurrencyInput = (value: string) => {
    const normalized = value.replace(/\./g, '').replace(',', '.');
    const parsed = Number(normalized);
    return Number.isNaN(parsed) ? 0 : parsed;
  };

  const handleSubmit = (e?: React.SyntheticEvent) => {
    e?.preventDefault?.();
    if (!formData.description || !formData.supplierId || !formData.accountId) {
      alert('Preencha os campos obrigatórios');
      return;
    }

    if (formData.recurrenceType === 'specific') {
      const invalid = formData.specificDues?.some(d => !d.date || d.amount <= 0);
      if (invalid) {
        alert('Todos os vencimentos devem ter data e valor maior que zero.');
        return;
      }
    } else {
      if (!formData.amount || !formData.dueDate) {
        alert('Preencha o valor e a data de vencimento.');
        return;
      }
    }

    if (formData.recurrenceType === 'custom' && (!formData.selectedMonths || formData.selectedMonths.length === 0)) {
      alert('Selecione pelo menos um mês de vencimento para recorrência personalizada');
      return;
    }

    const normalizedBill: Bill = { ...formData } as Bill;
    if (!normalizedBill.paidDate) {
      normalizedBill.status = BillStatus.PENDING;
      normalizedBill.paidAmount = undefined;
      normalizedBill.interestAmount = undefined;
    }

    onSubmit(normalizedBill);
  };

  const totalAmountSpecific = (formData.specificDues || []).reduce((sum, d) => sum + d.amount, 0);

  const isPaid = formData.status === BillStatus.PAID || Boolean(formData.paidDate);
  const sortedSuppliers = [...suppliers].sort((a, b) => a.name.localeCompare(b.name));
  const sortedAccounts = [...accounts].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-lg rounded-3xl shadow-2xl animate-in zoom-in duration-300 overflow-hidden flex flex-col max-h-[90vh]">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-white sticky top-0 z-10">
          <h2 className="text-xl font-bold text-slate-800">{initialData ? 'Editar Conta' : 'Nova Conta a Pagar'}</h2>
          <button onClick={onClose} className="p-2 hover:bg-slate-50 rounded-full text-slate-400">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto flex-1" noValidate>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Descrição</label>
            <input 
              required
              className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:outline-none transition-all"
              placeholder="Ex: Nota Fiscal 1234 - Reforma"
              value={formData.description}
              onChange={e => setFormData({ ...formData, description: e.target.value })}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Fornecedor</label>
              <select 
                required
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:outline-none appearance-none"
                value={formData.supplierId}
                onChange={e => setFormData({ ...formData, supplierId: e.target.value })}
              >
                <option value="">Selecione...</option>
                {sortedSuppliers.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1 flex items-center gap-1">
                <ListTree size={14} /> Centro de Custo
              </label>
              <select 
                required
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:outline-none appearance-none"
                value={formData.accountId}
                onChange={e => setFormData({ ...formData, accountId: e.target.value })}
              >
                <option value="">Selecione...</option>
                {sortedAccounts.map(acc => (
                  <option key={acc.id} value={acc.id}>{acc.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1 flex items-center gap-1">
                <User size={14} /> Lançado Por
              </label>
              <div className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-600 text-sm font-medium">
                {formData.launchedBy || userEmail || 'N/A'}
              </div>
            </div>
            <div></div>
          </div>

          <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-3">
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Configuração de Vencimentos</p>
            <div className="grid grid-cols-1 gap-2">
              <label className={`flex items-center gap-3 p-3 rounded-xl border-2 transition-all cursor-pointer ${formData.recurrenceType === 'none' ? 'bg-white border-indigo-500 shadow-sm' : 'bg-slate-100/50 border-transparent hover:border-slate-300'}`}>
                <input type="radio" name="recurrence" className="hidden" onChange={() => setFormData({...formData, recurrenceType: 'none'})} checked={formData.recurrenceType === 'none'} />
                <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${formData.recurrenceType === 'none' ? 'border-indigo-500' : 'border-slate-300'}`}>
                  {formData.recurrenceType === 'none' && <div className="w-2 h-2 rounded-full bg-indigo-500"></div>}
                </div>
                <div className="flex-1 text-sm font-bold text-slate-800">Pagamento Único</div>
              </label>

              <label className={`flex items-center gap-3 p-3 rounded-xl border-2 transition-all cursor-pointer ${formData.recurrenceType === 'specific' ? 'bg-white border-indigo-500 shadow-sm' : 'bg-slate-100/50 border-transparent hover:border-slate-300'}`}>
                <input type="radio" name="recurrence" className="hidden" onChange={() => setFormData({...formData, recurrenceType: 'specific'})} checked={formData.recurrenceType === 'specific'} />
                <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${formData.recurrenceType === 'specific' ? 'border-indigo-500' : 'border-slate-300'}`}>
                  {formData.recurrenceType === 'specific' && <div className="w-2 h-2 rounded-full bg-indigo-500"></div>}
                </div>
                <div className="flex-1 text-sm font-bold text-slate-800">Vários Vencimentos (Manuais)</div>
                <Layers size={16} className="text-indigo-500" />
              </label>

              <label className={`flex items-center gap-3 p-3 rounded-xl border-2 transition-all cursor-pointer ${formData.recurrenceType === 'monthly' ? 'bg-white border-indigo-500 shadow-sm' : 'bg-slate-100/50 border-transparent hover:border-slate-300'}`}>
                <input
                  type="radio"
                  name="recurrence"
                  className="hidden"
                  onChange={() => setFormData({
                    ...formData,
                    recurrenceType: 'monthly',
                    totalInstallments: 12,
                    status: BillStatus.PENDING,
                    paidDate: undefined,
                    paidAmount: undefined,
                    interestAmount: undefined
                  })}
                  checked={formData.recurrenceType === 'monthly'}
                />
                <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${formData.recurrenceType === 'monthly' ? 'border-indigo-500' : 'border-slate-300'}`}>
                  {formData.recurrenceType === 'monthly' && <div className="w-2 h-2 rounded-full bg-indigo-500"></div>}
                </div>
                <div className="flex-1 text-sm font-bold text-slate-800">Recorrência Mensal Fixa</div>
                <Repeat size={16} className="text-indigo-500" />
              </label>
            </div>

            {formData.recurrenceType !== 'specific' && (
              <div className="space-y-3 pt-2 animate-in slide-in-from-top-2">
                {formData.recurrenceType === 'monthly' ? (
                  // Interface amigável para recorrência mensal (estilo Google Agenda)
                  <div className="space-y-4 p-4 bg-white rounded-xl border-2 border-indigo-100">
                    <div className="flex items-center gap-2 text-indigo-600 font-bold">
                      <Repeat size={16} />
                      <span className="text-sm">Configurar Recorrência Mensal</span>
                    </div>
                    
                    <div>
                      <label className="block text-xs font-bold text-slate-500 mb-2">
                        Todo dia do mês
                      </label>
                      <select
                        className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none"
                        value={formData.dueDate ? new Date(formData.dueDate + 'T12:00:00').getDate() : 1}
                        onChange={e => {
                          const day = parseInt(e.target.value);
                          const today = new Date();
                          const year = today.getFullYear();
                          const month = today.getMonth();
                          const newDate = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                          setFormData({ ...formData, dueDate: newDate });
                        }}
                      >
                        {Array.from({ length: 31 }, (_, i) => i + 1).map(day => (
                          <option key={day} value={day}>Dia {day}</option>
                        ))}
                      </select>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-bold text-slate-500 mb-2">
                          <DollarSign size={12} className="inline" /> Valor
                        </label>
                        <input 
                          type="text" 
                          inputMode="decimal"
                          className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none"
                          value={formData.amount}
                          onChange={e => setFormData({ ...formData, amount: parseCurrencyInput(e.target.value) })}
                          placeholder="0,00"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-slate-500 mb-2">
                          Quantos meses
                        </label>
                        <input 
                          type="number" 
                          min="1"
                          max="24"
                          className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none"
                          value={formData.totalInstallments || 12}
                          onChange={e => setFormData({ ...formData, totalInstallments: parseInt(e.target.value) || 12 })}
                          placeholder="12"
                        />
                      </div>
                    </div>

                    <div className="p-3 bg-indigo-50 rounded-xl border border-indigo-100">
                      <p className="text-xs text-indigo-700 font-semibold">
                        📅 Resumo: Todo dia <strong>{formData.dueDate ? new Date(formData.dueDate + 'T12:00:00').getDate() : 1}</strong> de cada mês, 
                        por <strong>{formData.totalInstallments || 12}</strong> meses, 
                        no valor de <strong>{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(formData.amount || 0)}</strong>
                      </p>
                    </div>
                    
                    <label className="flex items-center gap-3 p-3 bg-amber-50 border-2 border-amber-200 rounded-xl cursor-pointer hover:bg-amber-100 transition-colors">
                      <input 
                        type="checkbox" 
                        className="w-4 h-4 rounded border-2 border-amber-400 accent-amber-500"
                        checked={formData.isEstimate || false}
                        onChange={e => setFormData({ ...formData, isEstimate: e.target.checked })}
                      />
                      <div className="flex-1">
                        <span className="text-sm font-semibold text-amber-900">Valor é uma estimativa</span>
                        <span className="text-xs text-amber-700 block">Marca este valor como estimado até ter o valor correto</span>
                      </div>
                    </label>
                  </div>
                ) : (
                  // Interface tradicional para pagamento único
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-slate-500 mb-1 flex items-center gap-1">
                        <DollarSign size={12} /> Valor
                      </label>
                      <input 
                        type="text" inputMode="decimal" className="w-full px-4 py-2 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none"
                        value={formData.amount}
                        onChange={e => setFormData({ ...formData, amount: parseCurrencyInput(e.target.value) })}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-500 mb-1 flex items-center gap-1">
                        <Calendar size={12} /> Vencimento
                        {!canEditBillDate && initialData && <span className="text-rose-500 text-xs">(Sem Permissão)</span>}
                      </label>
                      <input 
                        type="date" className="w-full px-4 py-2 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none disabled:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                        disabled={!canEditBillDate && initialData}
                        value={formData.dueDate}
                        onChange={e => setFormData({ ...formData, dueDate: e.target.value })}
                      />
                    </div>
                  </div>
                )}
                
                {formData.recurrenceType !== 'monthly' && (
                  <label className="flex items-center gap-3 p-3 bg-amber-50 border-2 border-amber-200 rounded-xl cursor-pointer hover:bg-amber-100 transition-colors">
                    <input 
                      type="checkbox" 
                      className="w-4 h-4 rounded border-2 border-amber-400 accent-amber-500"
                      checked={formData.isEstimate || false}
                      onChange={e => setFormData({ ...formData, isEstimate: e.target.checked })}
                    />
                    <div className="flex-1">
                      <span className="text-sm font-semibold text-amber-900">Valor é uma estimativa</span>
                      <span className="text-xs text-amber-700 block">Marca este valor como estimado até ter o valor correto</span>
                    </div>
                  </label>
                )}
              </div>
            )}

            {formData.recurrenceType === 'specific' && (
              <div className="pt-2 space-y-3 animate-in slide-in-from-top-2">
                <div className="space-y-2">
                  {formData.specificDues?.map((due, idx) => (
                    <div key={idx} className="flex items-center gap-2 p-3 bg-white border border-slate-200 rounded-xl group animate-in slide-in-from-right-2">
                      <div className="flex-1">
                        <label className="text-xs font-bold text-slate-400 uppercase">Vencimento {idx + 1}</label>
                        <input 
                          type="date" className="w-full text-sm outline-none bg-transparent"
                          value={due.date}
                          onChange={e => updateSpecificDue(idx, 'date', e.target.value)}
                        />
                      </div>
                      <div className="w-24">
                        <label className="text-xs font-bold text-slate-400 uppercase">Valor</label>
                        <input 
                          type="text" inputMode="decimal" className="w-full text-sm outline-none bg-transparent font-bold text-indigo-700"
                          value={due.amount}
                          onChange={e => updateSpecificDue(idx, 'amount', parseCurrencyInput(e.target.value))}
                        />
                      </div>
                      <button 
                        type="button" onClick={() => removeSpecificDue(idx)}
                        className="p-2 text-slate-300 hover:text-rose-500 transition-colors"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
                </div>
                
                <button 
                  type="button" onClick={addSpecificDue}
                  className="w-full py-2 border-2 border-dashed border-slate-200 rounded-xl text-slate-400 hover:border-indigo-300 hover:text-indigo-500 transition-all flex items-center justify-center gap-2 font-medium text-sm"
                >
                  <Plus size={16} /> Adicionar Vencimento
                </button>

                <div className="flex items-center justify-between p-3 bg-indigo-600 text-white rounded-xl shadow-lg shadow-indigo-100">
                  <span className="text-xs font-bold uppercase">Total da Nota</span>
                  <span className="text-lg font-bold">
                    {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(totalAmountSpecific)}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Informações de Pagamento */}
          <div className="p-4 bg-emerald-50 rounded-2xl border border-emerald-200 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-bold text-emerald-700 uppercase tracking-wider flex items-center gap-2">
                <Check size={14} /> Informações de Pagamento
              </p>
              <label className="flex items-center gap-2 text-xs font-bold text-slate-600">
                <input
                  type="checkbox"
                  className="w-4 h-4 rounded border-2 border-emerald-400 accent-emerald-500"
                  checked={isPaid}
                  onChange={(e) => {
                    if (!e.target.checked) {
                      setFormData({
                        ...formData,
                        status: BillStatus.PENDING,
                        paidDate: undefined,
                        paidAmount: undefined,
                        interestAmount: undefined
                      });
                      return;
                    }
                    setFormData({ ...formData, status: BillStatus.PAID });
                  }}
                />
                Conta ja foi paga
              </label>
            </div>

            {isPaid && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1 flex items-center gap-1">
                    <Calendar size={12} /> Data de Pagamento
                  </label>
                  <input 
                    type="date" 
                    className="w-full px-4 py-2 bg-white border border-emerald-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none"
                    value={formData.paidDate || ''}
                    onChange={e => {
                      const paidDate = e.target.value || undefined;
                      const status = paidDate ? BillStatus.PAID : BillStatus.PENDING;
                      setFormData({ ...formData, paidDate, status });
                    }}
                  />
                  <p className="text-xs text-slate-500 mt-1">Preencher marca a conta como paga</p>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1 flex items-center gap-1">
                    <DollarSign size={12} /> Valor Pago
                  </label>
                  <input 
                    type="text" 
                    inputMode="decimal"
                    className="w-full px-4 py-2 bg-white border border-emerald-200 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none"
                    value={formData.paidAmount ?? ''}
                    onChange={e => {
                      const raw = e.target.value.trim();
                      const paidAmount = raw ? parseCurrencyInput(raw) : undefined;
                      const interestAmount = paidAmount !== undefined && formData.amount ? paidAmount - formData.amount : undefined;
                      setFormData({ ...formData, paidAmount, interestAmount });
                    }}
                    placeholder={formData.amount ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(formData.amount) : '0,00'}
                  />
                  <p className="text-xs text-slate-500 mt-1">
                    {formData.paidAmount && formData.amount && formData.paidAmount !== formData.amount ? (
                      <span className={formData.paidAmount > formData.amount ? 'text-rose-600 font-bold' : 'text-emerald-600 font-bold'}>
                        Juros: {formData.paidAmount > formData.amount ? '+' : ''}{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(formData.paidAmount - formData.amount)}
                      </span>
                    ) : 'Com juros/multas ou descontos'}
                  </p>
                </div>
              </div>
            )}
          </div>

          <div className="pt-4 flex gap-3 sticky bottom-0 bg-white pb-2">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-3 border border-slate-200 rounded-xl text-slate-600 font-medium hover:bg-slate-50 transition-colors">Cancelar</button>
            <button type="button" onClick={handleSubmit} className="flex-1 px-4 py-3 bg-indigo-600 rounded-xl text-white font-bold hover:bg-indigo-700 shadow-lg shadow-indigo-200 transition-all">
              {formData.recurrenceType === 'specific' ? 'Lançar Nota Completa' : 'Confirmar Lançamento'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
