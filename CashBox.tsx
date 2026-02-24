import React, { useState, useEffect } from 'react';
import { db } from './firebase';
import { collection, getDocs, query, where, orderBy, setDoc, doc, updateDoc } from 'firebase/firestore';
import { CashBoxData, TeamMember, PaymentMethod } from './types';
import { AlertCircle, CheckCircle, AlertTriangle, Eye, Edit2, Save, X, Settings, BarChart3 } from 'lucide-react';
import { PaymentMethodManager } from './PaymentMethodManager';

interface CashBoxProps {
  user: TeamMember;
  onShowReport?: () => void;
}

export const CashBox: React.FC<CashBoxProps> = ({ user, onShowReport }) => {
  const currentDate = new Date();
  const [entries, setEntries] = useState<CashBoxData[]>([]);
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [selectedMonth, setSelectedMonth] = useState(currentDate.getMonth() + 1); // 1-12
  const [selectedYear, setSelectedYear] = useState(currentDate.getFullYear());
  const [editingEntry, setEditingEntry] = useState<CashBoxData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [previousDayFilled, setPreviousDayFilled] = useState(false);
  const [showMethodManager, setShowMethodManager] = useState(false);
  const [editingInformedTotal, setEditingInformedTotal] = useState<string | null>(null);
  const [tempInformedValue, setTempInformedValue] = useState<number>(0);

  // Get weekends and holidays
  const isWeekendOrHoliday = (dateStr: string) => {
    const date = new Date(dateStr);
    const day = date.getDay();
    return day === 0 || day === 1; // Domingo ou Segunda (ou pode adicionar feriados)
  };

  // Format date without timezone issues
  const formatDate = (dateStr: string) => {
    const [year, month, day] = dateStr.split('-');
    return `${day}/${month}/${year}`;
  };

  // Get previous day
  const getPreviousDay = (dateStr: string) => {
    const date = new Date(dateStr);
    date.setDate(date.getDate() - 1);
    return date.toISOString().split('T')[0];
  };

  // Load entries
  useEffect(() => {
    loadEntries();
    loadMethods();
    checkPreviousDayFilled();
  }, [selectedMonth, selectedYear]);

  const loadMethods = async () => {
    try {
      const q = query(collection(db, 'paymentMethods'), orderBy('order', 'asc'));
      const snapshot = await getDocs(q);
      const enabledMethods = snapshot.docs
        .map(doc => ({ ...doc.data(), id: doc.id } as PaymentMethod))
        .filter(m => m.enabled);
      setMethods(enabledMethods);
    } catch (err) {
      console.error('Erro ao carregar formas de pagamento:', err);
      // Usar defaults se não conseguir carregar
      setMethods([
        { id: '1', name: 'DIN', order: 0, enabled: true },
        { id: '2', name: 'REDE', order: 1, enabled: true },
        { id: '3', name: 'FROG', order: 2, enabled: true },
        { id: '4', name: 'PAG SEG', order: 3, enabled: true },
        { id: '5', name: 'INTER', order: 4, enabled: true },
      ]);
    }
  };

  const loadEntries = async () => {
    setLoading(true);
    try {
      const q = query(collection(db, 'cashbox'), orderBy('date', 'asc'));
      const snapshot = await getDocs(q);
      const allEntries = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as CashBoxData));
      
      // Filter entries by selected month and year
      const filtered = allEntries.filter(entry => {
        const [year, month] = entry.date.split('-');
        return parseInt(year) === selectedYear && parseInt(month) === selectedMonth;
      });
      
      setEntries(filtered);
    } catch (err) {
      setError('Erro ao carregar caixa');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const checkPreviousDayFilled = async () => {
    if (user.role === 'VIEWER') {
      const prevDay = getPreviousDay(selectedDate);
      const q = query(collection(db, 'cashbox'), where('date', '==', prevDay));
      const snapshot = await getDocs(q);
      setPreviousDayFilled(snapshot.size > 0);
    }
  };

  // Check if user can edit
  const canEdit = user.role === 'ADMIN' || (user.role !== 'VIEWER' && previousDayFilled);

  // Get status color
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'ok':
        return 'bg-green-100 text-green-700 border-green-300';
      case 'warning':
        return 'bg-orange-100 text-orange-700 border-orange-300';
      case 'error':
        return 'bg-red-100 text-red-700 border-red-300';
      default:
        return 'bg-gray-100 text-gray-700 border-gray-300';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'ok':
        return <CheckCircle size={16} />;
      case 'warning':
        return <AlertTriangle size={16} />;
      case 'error':
        return <AlertCircle size={16} />;
      default:
        return null;
    }
  };

  // Handle save
  const handleSave = async (entry: CashBoxData) => {
    try {
      const docRef = doc(db, 'cashbox', entry.id || new Date().getTime().toString());
      await setDoc(docRef, {
        date: entry.date,
        dinTotal: entry.dinTotal,
        redeTotal: entry.redeTotal,
        frogTotal: entry.frogTotal,
        pagSegTotal: entry.pagSegTotal,
        interTotal: entry.interTotal,
        grandTotal: entry.grandTotal,
        informedTotal: entry.informedTotal || 0,
        status: entry.status,
        observations: entry.observations,
        createdBy: entry.createdBy || user.email,
        createdAt: entry.createdAt || new Date().toISOString(),
        validatedBy: user.role === 'ADMIN' ? user.email : entry.validatedBy,
        validatedAt: user.role === 'ADMIN' ? new Date().toISOString() : entry.validatedAt,
        isWeekendOrHoliday: entry.isWeekendOrHoliday,
      });

      await loadEntries();
      setEditingEntry(null);
      setError('');
    } catch (err) {
      setError('Erro ao salvar caixa');
      console.error(err);
    }
  };

  const handleSaveInformedTotal = async (entryId: string, informedTotal: number) => {
    try {
      const entry = entries.find(e => e.id === entryId);
      if (!entry) return;

      const docRef = doc(db, 'cashbox', entryId);
      await updateDoc(docRef, {
        informedTotal: informedTotal,
      });

      await loadEntries();
      setEditingInformedTotal(null);
    } catch (err) {
      console.error('Erro ao salvar valor:', err);
    }
  };

  const handleNewEntry = () => {
    const newEntry: CashBoxData = {
      id: '',
      date: selectedDate,
      dinTotal: 0,
      redeTotal: 0,
      frogTotal: 0,
      pagSegTotal: 0,
      interTotal: 0,
      grandTotal: 0,
      informedTotal: 0,
      status: 'pending',
      observations: '',
      createdBy: user.email,
      createdAt: new Date().toISOString(),
      isWeekendOrHoliday: isWeekendOrHoliday(selectedDate),
    };
    setEditingEntry(newEntry);
  };

  const getRowStyle = (entry: CashBoxData) => {
    if (entry.isWeekendOrHoliday) {
      return 'bg-yellow-100';
    }
    return '';
  };

  return (
    <div className="flex flex-col flex-1 bg-slate-50 p-6 overflow-y-auto">
      <div className="max-w-7xl mx-auto w-full space-y-6">
        {/* Header */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-3xl font-black text-slate-800">CAIXA</h1>
              <p className="text-sm text-slate-500 mt-1">Controle de movimentação diária de caixa</p>
              <p className="text-sm font-bold text-indigo-600 mt-2">
                PERÍODO: {new Date(selectedYear, selectedMonth - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }).toUpperCase()}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <select
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(parseInt(e.target.value))}
                className="px-4 py-2 border border-slate-200 rounded-lg font-medium text-slate-700"
              >
                <option value={1}>Janeiro</option>
                <option value={2}>Fevereiro</option>
                <option value={3}>Março</option>
                <option value={4}>Abril</option>
                <option value={5}>Maio</option>
                <option value={6}>Junho</option>
                <option value={7}>Julho</option>
                <option value={8}>Agosto</option>
                <option value={9}>Setembro</option>
                <option value={10}>Outubro</option>
                <option value={11}>Novembro</option>
                <option value={12}>Dezembro</option>
              </select>
              <select
                value={selectedYear}
                onChange={(e) => setSelectedYear(parseInt(e.target.value))}
                className="px-4 py-2 border border-slate-200 rounded-lg font-medium text-slate-700"
              >
                {Array.from({ length: 10 }, (_, i) => selectedYear - 5 + i).map(year => (
                  <option key={year} value={year}>{year}</option>
                ))}
              </select>
              <button
                onClick={onShowReport}
                className="p-2 bg-blue-100 text-blue-600 rounded-lg hover:bg-blue-200 transition-colors"
                title="Ver relatório mensal"
              >
                <BarChart3 size={20} />
              </button>
              {user.role === 'ADMIN' && (
                <button
                  onClick={() => setShowMethodManager(true)}
                  className="p-2 bg-slate-100 text-slate-600 rounded-lg hover:bg-slate-200 transition-colors"
                  title="Gerenciar formas de pagamento"
                >
                  <Settings size={20} />
                </button>
              )}
            </div>
          </div>

          {/* Warnings */}
          {user.role !== 'ADMIN' && !previousDayFilled && (
            <div className="mt-4 p-4 bg-orange-50 border border-orange-200 rounded-lg flex items-center gap-3 text-orange-700">
              <AlertTriangle size={20} />
              <span className="text-sm font-semibold">O caixa do dia anterior precisa estar preenchido para você interagir com o sistema.</span>
            </div>
          )}

          {/* Status Indicator */}
          {editingEntry && (
            <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <p className="text-sm font-semibold text-blue-700">Editando: {editingEntry.date}</p>
            </div>
          )}
        </div>

        {/* Error Message */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 text-sm">
            {error}
          </div>
        )}

        {/* Legend */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
          <h3 className="text-sm font-bold text-slate-800 mb-4">LEGENDA</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 bg-yellow-100 border border-yellow-300 rounded"></div>
              <span className="text-slate-700">Domingo/Segunda</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle size={16} className="text-green-600" />
              <span className="text-slate-700">OK</span>
            </div>
            <div className="flex items-center gap-2">
              <AlertTriangle size={16} className="text-orange-600" />
              <span className="text-slate-700">Atenção</span>
            </div>
            <div className="flex items-center gap-2">
              <AlertCircle size={16} className="text-red-600" />
              <span className="text-slate-700">Divergência</span>
            </div>
          </div>
        </div>

        {/* Main Table */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-slate-800 text-white">
                  <th className="px-6 py-4 text-left text-sm font-bold">Data</th>
                  {methods.map(method => (
                    <th key={method.id} className="px-6 py-4 text-center text-sm font-bold">{method.name}</th>
                  ))}
                  <th className="px-6 py-4 text-center text-sm font-bold">SOMA</th>
                  <th className="px-6 py-4 text-center text-sm font-bold">TOTAL CAIXA</th>
                  <th className="px-6 py-4 text-center text-sm font-bold">DIFERENÇA</th>
                  <th className="px-6 py-4 text-center text-sm font-bold">Status</th>
                  <th className="px-6 py-4 text-center text-sm font-bold">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {entries.map((entry) => (
                  <tr key={entry.id} className={`${getRowStyle(entry)} hover:bg-slate-50 transition-colors`}>
                    <td className="px-6 py-4 text-sm font-semibold text-slate-700">
                      <div className="flex items-center gap-2">
                        <span>{formatDate(entry.date)}</span>
                        {entry.isWeekendOrHoliday && (
                          <span className="px-2 py-1 bg-yellow-100 text-yellow-800 text-xs font-bold rounded border border-yellow-300">
                            📅 Feriado/FDS
                          </span>
                        )}
                      </div>
                    </td>
                    {methods.map(method => {
                      const methodKey = `${method.name.toLowerCase()}Total` as keyof CashBoxData;
                      const methodValue = entry[methodKey] as number || 0;
                      const isInter = method.name === 'INTER';
                      const hasBankData = isInter && entry.interReconciled;
                      
                      return (
                        <td 
                          key={method.id} 
                          className={`px-6 py-4 text-center text-sm ${hasBankData ? 'bg-blue-50' : ''}`}
                          title={hasBankData ? `🏦 Importado do extrato bancário (${entry.interBankTransactions?.length || 0} transações)` : ''}
                        >
                          <div className="flex items-center justify-center gap-2">
                            <span>{methodValue.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>
                            {hasBankData && (
                              <span className="text-blue-600" title="Conciliado com banco">🏦</span>
                            )}
                          </div>
                        </td>
                      );
                    })}
                    <td className="px-6 py-4 text-center text-sm font-bold text-slate-800">
                      {entry.grandTotal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                    </td>
                    <td 
                      className={`px-6 py-4 text-center text-sm font-bold ${
                        canEdit ? 'text-blue-700 cursor-pointer hover:bg-blue-50' : 'text-blue-700'
                      }`}
                      onClick={() => {
                        if (canEdit) {
                          setEditingInformedTotal(entry.id);
                          setTempInformedValue(entry.informedTotal || 0);
                        }
                      }}
                      title={canEdit ? "Clique para editar o valor total do caixa" : ""}
                    >
                      {editingInformedTotal === entry.id ? (
                        <input
                          type="number"
                          step="0.01"
                          value={tempInformedValue}
                          onChange={(e) => setTempInformedValue(parseFloat(e.target.value) || 0)}
                          onBlur={() => {
                            handleSaveInformedTotal(entry.id, tempInformedValue);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              handleSaveInformedTotal(entry.id, tempInformedValue);
                            }
                            if (e.key === 'Escape') {
                              setEditingInformedTotal(null);
                            }
                          }}
                          autoFocus
                          className="w-full px-2 py-1 text-center font-bold text-blue-700 border-2 border-blue-400 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      ) : (
                        <div className="flex items-center justify-center gap-1">
                          <span>
                            {(entry.informedTotal || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                          </span>
                          {canEdit && (
                            <Edit2 size={12} className="opacity-50" />
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4 text-center text-sm font-bold">
                      {(() => {
                        const diff = (entry.informedTotal || 0) - entry.grandTotal;
                        const color = diff === 0 ? 'text-green-700' : diff > 0 ? 'text-blue-700' : 'text-red-700';
                        return (
                          <span className={color}>
                            {diff.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                          </span>
                        );
                      })()}
                    </td>
                    <td className="px-6 py-4 text-center">
                      <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold border ${getStatusColor(entry.status)}`}>
                        {getStatusIcon(entry.status)}
                        {entry.status === 'ok' ? 'OK' : entry.status === 'warning' ? 'Atenção' : entry.status === 'error' ? 'Divergência' : 'Pendente'}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-center">
                      <button
                        onClick={() => setEditingEntry(entry)}
                        disabled={!canEdit}
                        className="p-2 hover:bg-indigo-100 rounded-lg text-indigo-600 disabled:text-gray-300 disabled:cursor-not-allowed transition-colors"
                      >
                        {user.role === 'ADMIN' ? <Edit2 size={16} /> : <Eye size={16} />}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* New Entry Button */}
        {canEdit && (
          <button
            onClick={handleNewEntry}
            className="px-6 py-3 bg-indigo-600 text-white rounded-lg font-bold hover:bg-indigo-700 transition-colors"
          >
            + Novo Lançamento
          </button>
        )}

        {/* Edit Modal */}
        {editingEntry && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
              <div className="p-6 border-b border-slate-200 flex justify-between items-center sticky top-0 bg-white">
                <h2 className="text-2xl font-bold text-slate-800">Editar Caixa - {formatDate(editingEntry.date)}</h2>
                <button onClick={() => setEditingEntry(null)} className="text-slate-400 hover:text-slate-600">
                  <X size={24} />
                </button>
              </div>

              <div className="p-6 space-y-4">
                {/* Financial Fields */}
                <div className="grid grid-cols-2 gap-4">
                  {methods.map((method) => (
                    <div key={method.id}>
                      <label className="block text-sm font-bold text-slate-700 mb-2">{method.name}</label>
                      <input
                        type="number"
                        step="0.01"
                        value={editingEntry[`${method.name.toLowerCase()}Total` as keyof CashBoxData] || 0}
                        onChange={(e) => {
                          const newEntry = { ...editingEntry };
                          newEntry[`${method.name.toLowerCase()}Total` as keyof CashBoxData] = parseFloat(e.target.value) || 0;
                          newEntry.grandTotal = methods.reduce((sum, m) => {
                            return sum + (newEntry[`${m.name.toLowerCase()}Total` as keyof CashBoxData] as number || 0);
                          }, 0);
                          setEditingEntry(newEntry);
                        }}
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg"
                      />
                    </div>
                  ))}
                </div>

                {/* Grand Total */}
                <div className="bg-slate-800 text-white p-4 rounded-lg">
                  <p className="text-sm font-semibold mb-1">SOMA TOTAL</p>
                  <p className="text-2xl font-black">
                    {editingEntry.grandTotal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                  </p>
                </div>

                {/* Valor Total do Caixa */}
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-2">VALOR TOTAL DO CAIXA</label>
                  <input
                    type="number"
                    step="0.01"
                    value={editingEntry.informedTotal || 0}
                    onChange={(e) =>
                      setEditingEntry({
                        ...editingEntry,
                        informedTotal: parseFloat(e.target.value) || 0,
                      })
                    }
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-lg font-bold"
                    placeholder="Digite o valor total do caixa físico"
                  />
                </div>

                {/* Diferença */}
                {editingEntry.informedTotal !== undefined && editingEntry.informedTotal > 0 && (
                  <div className={`p-4 rounded-lg border-2 ${
                    (editingEntry.informedTotal - editingEntry.grandTotal) === 0 
                      ? 'bg-green-50 border-green-300' 
                      : (editingEntry.informedTotal - editingEntry.grandTotal) > 0
                      ? 'bg-blue-50 border-blue-300'
                      : 'bg-red-50 border-red-300'
                  }`}>
                    <p className="text-sm font-semibold mb-1">DIFERENÇA</p>
                    <p className={`text-2xl font-black ${
                      (editingEntry.informedTotal - editingEntry.grandTotal) === 0 
                        ? 'text-green-700' 
                        : (editingEntry.informedTotal - editingEntry.grandTotal) > 0
                        ? 'text-blue-700'
                        : 'text-red-700'
                    }`}>
                      {(editingEntry.informedTotal - editingEntry.grandTotal).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                    </p>
                    <p className="text-xs mt-1 text-slate-600">
                      {(editingEntry.informedTotal - editingEntry.grandTotal) === 0 
                        ? '✓ Caixa confere!' 
                        : (editingEntry.informedTotal - editingEntry.grandTotal) > 0
                        ? '↑ Sobra de caixa'
                        : '↓ Falta no caixa'}
                    </p>
                  </div>
                )}

                {/* Status (ADM only) */}
                {user.role === 'ADMIN' && (
                  <div>
                    <label className="block text-sm font-bold text-slate-700 mb-2">Status</label>
                    <select
                      value={editingEntry.status}
                      onChange={(e) =>
                        setEditingEntry({
                          ...editingEntry,
                          status: e.target.value as any,
                        })
                      }
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg"
                    >
                      <option value="pending">Pendente</option>
                      <option value="ok">OK</option>
                      <option value="warning">Atenção</option>
                      <option value="error">Divergência</option>
                    </select>
                  </div>
                )}

                {/* Weekend/Holiday Marker */}
                <div className="flex items-center p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                  <input
                    type="checkbox"
                    id="isWeekendOrHoliday"
                    checked={editingEntry.isWeekendOrHoliday || false}
                    onChange={(e) =>
                      setEditingEntry({
                        ...editingEntry,
                        isWeekendOrHoliday: e.target.checked,
                      })
                    }
                    className="w-5 h-5 text-yellow-600 border-yellow-300 rounded focus:ring-yellow-500"
                  />
                  <label htmlFor="isWeekendOrHoliday" className="ml-3 text-sm font-bold text-yellow-800 cursor-pointer">
                    📅 Marcar como Sábado/Domingo/Feriado (sem movimento esperado)
                  </label>
                </div>

                {/* Observations */}
                <div>
                  <label className="block text-sm font-bold text-slate-700 mb-2">Observações</label>
                  <textarea
                    value={editingEntry.observations || ''}
                    onChange={(e) =>
                      setEditingEntry({
                        ...editingEntry,
                        observations: e.target.value,
                      })
                    }
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg h-24"
                    placeholder="Digite observações sobre o caixa..."
                  />
                </div>

                {/* Validation Info (if exists) */}
                {editingEntry.validatedBy && (
                  <div className="bg-green-50 p-3 rounded-lg border border-green-200">
                    <p className="text-xs text-green-700">
                      <strong>Validado por:</strong> {editingEntry.validatedBy}
                      <br />
                      <strong>Em:</strong> {new Date(editingEntry.validatedAt || '').toLocaleString('pt-BR')}
                    </p>
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="p-6 border-t border-slate-200 flex gap-3 justify-end sticky bottom-0 bg-white">
                <button
                  onClick={() => setEditingEntry(null)}
                  className="px-4 py-2 border border-slate-200 text-slate-700 rounded-lg font-bold hover:bg-slate-50 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={() => handleSave(editingEntry)}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg font-bold hover:bg-indigo-700 transition-colors flex items-center gap-2"
                >
                  <Save size={16} /> Salvar {user.role === 'ADMIN' ? '& Validar' : ''}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Payment Method Manager Modal */}
        <PaymentMethodManager isOpen={showMethodManager} onClose={() => {
          setShowMethodManager(false);
          loadMethods();
        }} />
      </div>
    </div>
  );
};
