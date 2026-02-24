import React, { useState, useEffect } from 'react';
import { db } from './firebase';
import { collection, getDocs, query, orderBy, setDoc, doc, addDoc, updateDoc } from 'firebase/firestore';
import { CashBoxData, PaymentMethod } from './types';
import { FileDown, Plus, Edit2, ArrowLeft } from 'lucide-react';
import jsPDF from 'jspdf';
import 'jspdf/dist/jspdf.umd.min.js';
import autoTable from 'jspdf-autotable';

interface CashBoxReportProps {
  onBack: () => void;
  canEdit?: boolean;
}

export const CashBoxReport: React.FC<CashBoxReportProps> = ({ onBack, canEdit = false }) => {
  const [entries, setEntries] = useState<CashBoxData[]>([]);
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth());
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [editingDate, setEditingDate] = useState<string | null>(null);
  const [editingValues, setEditingValues] = useState<Record<string, number>>({});
  const [editingStatuses, setEditingStatuses] = useState<Record<string, string>>({});

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      // Carregar dados de caixa
      const cashboxQuery = query(collection(db, 'cashbox'), orderBy('date', 'asc'));
      const cashboxSnapshot = await getDocs(cashboxQuery);
      setEntries(cashboxSnapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as CashBoxData)));

      // Carregar formas de pagamento
      const methodsQuery = query(collection(db, 'paymentMethods'), orderBy('order', 'asc'));
      const methodsSnapshot = await getDocs(methodsQuery);
      const enabledMethods = methodsSnapshot.docs
        .map(doc => ({ ...doc.data(), id: doc.id } as PaymentMethod))
        .filter(m => m.enabled);
      setMethods(enabledMethods);
    } catch (err) {
      console.error('Erro ao carregar dados:', err);
    } finally {
      setLoading(false);
    }
  };

  const getDaysInMonth = (year: number, month: number) => {
    return new Date(year, month + 1, 0).getDate();
  };

  const isWeekendOrHoliday = (date: Date) => {
    const day = date.getDay();
    return day === 0 || day === 1; // Domingo ou Segunda
  };

  const getDayOfWeek = (date: Date): string => {
    const days = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB'];
    return days[date.getDay()];
  };

  const formatValue = (value: number) => {
    return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  };

  const getEntryForDate = (date: Date) => {
    const dateStr = date.toISOString().split('T')[0];
    return entries.find(e => e.date === dateStr);
  };

  const handleSaveEntry = async (dateStr: string) => {
    try {
      // Dynamically build values for each method
      const updateData: any = {
        date: dateStr,
        isWeekendOrHoliday: isWeekendOrHoliday(new Date(dateStr)),
        status: 'pending',
        observations: '',
      };

      let grandTotal = 0;
      const methodStatuses: Record<string, 'ok' | 'pending' | 'warning' | 'error' | 'sem_movimento'> = {};

      // Build fields for each payment method
      methods.forEach(m => {
        const fieldKey = `${m.name.toLowerCase()}Total`;
        const value = editingValues[`${m.id}-value`] || 0;
        updateData[fieldKey] = value;
        grandTotal += value;

        // Add status for this method
        const status = editingStatuses[`${dateStr}-${m.id}`] || 'pending';
        methodStatuses[m.id] = (status as 'ok' | 'pending' | 'warning' | 'error' | 'sem_movimento');
      });

      updateData.grandTotal = grandTotal;
      updateData.methodStatuses = methodStatuses;
      updateData.createdBy = 'system';
      updateData.createdAt = new Date().toISOString();

      // Save or update in Firestore
      const existingEntry = entries.find(e => e.date === dateStr);
      
      if (existingEntry) {
        // Update existing - preserve the id and keep creation info
        await updateDoc(doc(db, 'cashbox', existingEntry.id), updateData);
        setEntries(prev => prev.map(e => e.date === dateStr ? { ...e, ...updateData } : e));
      } else {
        // Add new
        const newEntry = { id: `${dateStr}-${new Date().getTime()}`, ...updateData };
        const docRef = await addDoc(collection(db, 'cashbox'), updateData);
        setEntries(prev => [...prev, { ...newEntry, id: docRef.id }]);
      }

      // Reset editing state
      setEditingDate(null);
      setEditingValues({});
      setEditingStatuses({});
    } catch (err) {
      console.error('Erro ao salvar:', err);
      alert('Erro ao salvar entrada');
    }
  };

  const getValueForMethod = (entry: CashBoxData | undefined, method: PaymentMethod) => {
    if (!entry) return 0;
    const key = `${method.name.toLowerCase()}Total` as keyof CashBoxData;
    return (entry[key] as number) || 0;
  };

  const getStatusForMethod = (entry: CashBoxData | undefined, method: PaymentMethod): string => {
    if (!entry || !entry.methodStatuses) return 'pending';
    return entry.methodStatuses[method.id] || 'pending';
  };

  const getStatusColor = (status: string): string => {
    switch (status) {
      case 'ok': return 'bg-green-100 text-green-800 border-green-300';
      case 'pending': return 'bg-orange-100 text-orange-800 border-orange-300';
      case 'warning': return 'bg-yellow-100 text-yellow-800 border-yellow-300';
      case 'error': return 'bg-red-100 text-red-800 border-red-300';
      case 'sem_movimento': return 'bg-gray-200 text-gray-800 border-gray-400';
      default: return 'bg-gray-100 text-gray-800 border-gray-300';
    }
  };

  const getStatusLabel = (status: string): string => {
    switch (status) {
      case 'ok': return '✓ OK';
      case 'pending': return '⏳ PENDENTE';
      case 'warning': return '⚠ AVISO';
      case 'error': return '✗ ERRO';
      case 'sem_movimento': return '⊘ SEM MOV.';
      default: return '?';
    }
  };

  const generatePDF = () => {
    const pdfDoc = new jsPDF();
    const daysInMonth = getDaysInMonth(selectedYear, selectedMonth);
    const monthName = new Date(selectedYear, selectedMonth).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }).toUpperCase();

    // Title
    pdfDoc.setFontSize(14);
    pdfDoc.text(`CONFERÊNCIA DE CAIXAS - VILA LEOPOLDINA`, 14, 15);
    pdfDoc.setFontSize(10);
    pdfDoc.text(`${monthName}`, 14, 22);

    // Prepare table data
    const tableData: any[] = [];
    let totalsByMethod: Record<string, number> = {};
    methods.forEach((m, idx) => {
      totalsByMethod[idx] = 0;
    });
    let grandTotal = 0;

    // Add rows for each day
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(selectedYear, selectedMonth, day);
      const entry = getEntryForDate(date);
      const dayName = getDayOfWeek(date);

      const row = [
        `${dayName} ${String(day).padStart(2, '0')}/${String(selectedMonth + 1).padStart(2, '0')}`,
        ...methods.map((m, idx) => {
          const value = getValueForMethod(entry, m);
          totalsByMethod[idx] += value;
          grandTotal += value;
          return value > 0 ? value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '';
        }),
        entry ? entry.grandTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : ''
      ];

      tableData.push(row);
    }

    // Add totals row
    const totalsRow = [
      'SOMA',
      ...methods.map((_, idx) => totalsByMethod[idx].toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })),
      grandTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    ];
    tableData.push(totalsRow);

    // Create table
    (pdfDoc as any).autoTable({
      head: [[
        'Data',
        ...methods.map(m => m.name),
        'SOMA'
      ]],
      body: tableData,
      startY: 28,
      styles: { fontSize: 9, cellPadding: 3 },
      headStyles: { fillColor: [31, 41, 55], textColor: [255, 255, 255], fontStyle: 'bold' },
      bodyStyles: { textColor: [0, 0, 0] },
      footStyles: { fillColor: [31, 41, 55], textColor: [255, 255, 255], fontStyle: 'bold' },
    });

    // Save
    pdfDoc.save(`Caixa_${monthName.replace(/\s+/g, '_')}.pdf`);
  };

  const daysInMonth = getDaysInMonth(selectedYear, selectedMonth);
  const monthName = new Date(selectedYear, selectedMonth).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }).toUpperCase();

  // Calculate totals
  let totalsByMethod: Record<string, number> = {};
  methods.forEach(m => {
    totalsByMethod[m.id] = 0;
  });
  let grandTotal = 0;

  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(selectedYear, selectedMonth, day);
    const entry = getEntryForDate(date);
    methods.forEach(m => {
      const value = getValueForMethod(entry, m);
      totalsByMethod[m.id] += value;
      grandTotal += value;
    });
  }

  return (
    <div className="flex flex-col flex-1 bg-slate-50 p-6 overflow-y-auto">
      <div className="max-w-7xl mx-auto w-full space-y-6">
        {/* Header */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
          <div className="flex justify-between items-center">
            <div>
              <div className="flex items-center gap-3">
                <button
                  onClick={onBack}
                  className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
                  title="Voltar"
                >
                  <ArrowLeft size={24} className="text-slate-600" />
                </button>
                <div>
                  <h1 className="text-3xl font-black text-slate-800">CONFERÊNCIA DE CAIXAS</h1>
                  <p className="text-sm text-slate-500 mt-1">Vila Leopoldina</p>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <select
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(parseInt(e.target.value))}
                className="px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {Array.from({ length: 12 }, (_, i) => (
                  <option key={i} value={i}>
                    {new Date(2024, i).toLocaleDateString('pt-BR', { month: 'long' })}
                  </option>
                ))}
              </select>
              <select
                value={selectedYear}
                onChange={(e) => setSelectedYear(parseInt(e.target.value))}
                className="px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {Array.from({ length: 5 }, (_, i) => {
                  const year = new Date().getFullYear() - 2 + i;
                  return (
                    <option key={year} value={year}>
                      {year}
                    </option>
                  );
                })}
              </select>
            </div>
          </div>
        </div>

        {/* Table */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            {loading ? (
              <div className="text-center py-8">Carregando...</div>
            ) : (
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-slate-800 text-white">
                  <th className="border border-slate-300 px-4 py-3 text-sm font-bold text-center min-w-24">DATA</th>
                  {methods.map(method => (
                    <th key={method.id} className="border border-slate-300 px-4 py-3 text-sm font-bold text-center min-w-28">
                      {method.name}
                    </th>
                  ))}
                  <th className="border border-slate-300 px-4 py-3 text-sm font-bold text-center min-w-28 bg-yellow-400 text-slate-800">SOMA</th>
                  <th className="border border-slate-300 px-4 py-3 text-sm font-bold text-center min-w-16">AÇÕES</th>
                </tr>
                </thead>
                <tbody>
                  {Array.from({ length: daysInMonth }, (_, i) => {
                    const day = i + 1;
                    const date = new Date(selectedYear, selectedMonth, day);
                    const dateStr = date.toISOString().split('T')[0];
                    const entry = getEntryForDate(date);
                    const isWeekend = isWeekendOrHoliday(date);
                    const isEditing = editingDate === dateStr;
                    const dayTotal = isEditing 
                      ? methods.reduce((sum, m) => sum + (editingValues[`${m.id}-value`] || 0), 0)
                      : (entry?.grandTotal || 0);

                    return (
                      <tr
                        key={day}
                        className={`${isWeekend ? 'bg-yellow-100' : 'bg-white hover:bg-slate-50'} transition-colors`}
                      >
                        <td className={`border border-slate-300 px-4 py-3 font-bold text-center ${isWeekend ? 'bg-yellow-200' : ''}`}>
                          <div className="flex flex-col items-center gap-1">
                            <span className="text-xs font-semibold text-slate-600">{getDayOfWeek(date)}</span>
                            <span>{String(day).padStart(2, '0')}/{String(selectedMonth + 1).padStart(2, '0')}</span>
                          </div>
                        </td>
                        {methods.map(method => {
                          const methodStatus = getStatusForMethod(entry, method);
                          const isEditingThisRow = editingDate === dateStr;
                          return (
                            <td key={method.id} className="border border-slate-300 px-2 py-2 text-right text-sm">
                              <div className="flex flex-col gap-1 items-end">
                                {/* Status Badge */}
                                {isEditingThisRow && canEdit ? (
                                  <select
                                    value={editingStatuses[`${dateStr}-${method.id}`] || methodStatus}
                                    onChange={(e) => setEditingStatuses(prev => ({
                                      ...prev,
                                      [`${dateStr}-${method.id}`]: e.target.value
                                    }))}
                                    className="px-2 py-1 text-xs bg-white border-2 border-indigo-400 rounded focus:outline-none focus:ring-2 focus:ring-indigo-300"
                                  >
                                    <option value="ok">✓ OK</option>
                                    <option value="pending">⏳ PENDENTE</option>
                                    <option value="warning">⚠ AVISO</option>
                                    <option value="error">✗ ERRO</option>
                                    <option value="sem_movimento">⊘ SEM MOV.</option>
                                  </select>
                                ) : (
                                  <span 
                                    className={`px-2 py-1 text-xs font-bold rounded border ${canEdit ? 'cursor-pointer hover:opacity-80' : 'cursor-not-allowed opacity-70'} transition-opacity ${getStatusColor(methodStatus)}`}
                                    onClick={() => {
                                      if (canEdit) {
                                        setEditingDate(dateStr);
                                        const vals: Record<string, number> = {};
                                        const statuses: Record<string, string> = {};
                                        methods.forEach(m => {
                                          vals[`${m.id}-value`] = getValueForMethod(entry, m);
                                          statuses[`${dateStr}-${m.id}`] = getStatusForMethod(entry, m);
                                        });
                                        setEditingValues(vals);
                                        setEditingStatuses(statuses);
                                      }
                                    }}
                                    title={canEdit ? "Clique para editar" : "Sem permissão para editar status"}
                                  >
                                    {getStatusLabel(methodStatus)}
                                  </span>
                                )}
                                
                                {/* Value */}
                                {isEditing ? (
                                  <input
                                    autoFocus
                                    type="number"
                                    step="0.01"
                                    value={editingValues[`${method.id}-value`] || 0}
                                    onChange={(e) => setEditingValues(prev => ({
                                      ...prev,
                                      [`${method.id}-value`]: parseFloat(e.target.value) || 0
                                    }))}
                                    className="w-full px-2 py-1 border-2 border-indigo-500 rounded text-right text-xs font-bold focus:outline-none focus:ring-2 focus:ring-indigo-300"
                                  />
                                ) : (
                                  <span 
                                    onClick={() => {
                                      setEditingDate(dateStr);
                                      const vals: Record<string, number> = {};
                                      const statuses: Record<string, string> = {};
                                      methods.forEach(m => {
                                        vals[`${m.id}-value`] = getValueForMethod(entry, m);
                                        statuses[`${dateStr}-${m.id}`] = getStatusForMethod(entry, m);
                                      });
                                      setEditingValues(vals);
                                      setEditingStatuses(statuses);
                                    }}
                                    className="font-semibold cursor-pointer hover:bg-blue-100 hover:text-blue-800 px-2 py-1 rounded transition-colors"
                                    title="Clique para editar"
                                  >
                                    {formatValue(getValueForMethod(entry, method))}
                                  </span>
                                )}
                              </div>
                            </td>
                          );
                        })}
                        <td className="border border-slate-300 px-4 py-3 text-right font-bold text-sm bg-yellow-50">
                          {formatValue(dayTotal)}
                        </td>
                        <td className="border border-slate-300 px-4 py-3 text-center">
                          {editingDate === dateStr ? (
                            <div className="flex gap-1 justify-center flex-wrap">
                              <button
                                onClick={() => handleSaveEntry(dateStr)}
                                className="px-3 py-1 bg-green-600 text-white text-xs font-bold rounded hover:bg-green-700 transition-colors"
                                title="Salvar alterações"
                              >
                                ✓ Salvar
                              </button>
                              <button
                                onClick={() => {
                                  setEditingDate(null);
                                  setEditingValues({});
                                  setEditingStatuses({});
                                }}
                                className="px-3 py-1 bg-red-600 text-white text-xs font-bold rounded hover:bg-red-700 transition-colors"
                                title="Cancelar edição"
                              >
                                ✕ Cancelar
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => {
                                if (!canEdit) return;
                                setEditingDate(dateStr);
                                const vals: Record<string, number> = {};
                                const statuses: Record<string, string> = {};
                                methods.forEach(m => {
                                  vals[`${m.id}-value`] = getValueForMethod(entry, m);
                                  statuses[`${dateStr}-${m.id}`] = getStatusForMethod(entry, m);
                                });
                                setEditingValues(vals);
                                setEditingStatuses(statuses);
                              }}
                              disabled={!canEdit}
                              className={`px-3 py-1 bg-blue-600 text-white text-xs font-bold rounded flex items-center gap-1 mx-auto transition-colors ${canEdit ? 'hover:bg-blue-700 cursor-pointer' : 'opacity-50 cursor-not-allowed'}`}
                              title={canEdit ? "Editar valores deste dia" : "Sem permissão para editar"}
                            >
                              <Edit2 size={14} /> Editar
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-800 text-white font-bold">
                    <td className="border border-slate-300 px-4 py-3 text-center">SOMA</td>
                    {methods.map(method => (
                      <td key={method.id} className="border border-slate-300 px-4 py-3 text-right text-sm">
                        {formatValue(totalsByMethod[method.id])}
                      </td>
                    ))}
                    <td className="border border-slate-300 px-4 py-3 text-right text-sm bg-yellow-400 text-slate-800 font-black">
                      {formatValue(grandTotal)}
                    </td>
                    <td className="border border-slate-300 px-4 py-3"></td>
                  </tr>
                </tfoot>
              </table>
            )}
          </div>
        </div>

        {/* Legend */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
          <div className="flex gap-6 items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 bg-yellow-100 border border-yellow-300 rounded"></div>
              <span className="text-sm text-slate-700">Domingo/Segunda (não trabalhados)</span>
            </div>
            <button
              onClick={generatePDF}
              className="px-6 py-2 bg-red-600 text-white rounded-lg font-bold hover:bg-red-700 transition-colors flex items-center gap-2"
              title="Baixar relatório em PDF"
            >
              <FileDown size={20} /> Baixar PDF
            </button>
          </div>
          <p className="text-xs text-slate-600 mt-3">
            Relatório gerado: {new Date().toLocaleDateString('pt-BR')}
          </p>
        </div>
      </div>
    </div>
  );
};
