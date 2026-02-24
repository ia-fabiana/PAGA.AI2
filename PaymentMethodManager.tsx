import React, { useState, useEffect } from 'react';
import { db } from './firebase';
import { collection, getDocs, setDoc, doc, deleteDoc, updateDoc } from 'firebase/firestore';
import { PaymentMethod } from './types';
import { Plus, Edit2, Trash2, X, Save, Eye, EyeOff, GripVertical } from 'lucide-react';

interface PaymentMethodManagerProps {
  isOpen: boolean;
  onClose: () => void;
}

export const PaymentMethodManager: React.FC<PaymentMethodManagerProps> = ({ isOpen, onClose }) => {
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [newMethodName, setNewMethodName] = useState('');
  const [loading, setLoading] = useState(false);
  const [draggedId, setDraggedId] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      loadMethods();
    }
  }, [isOpen]);

  const loadMethods = async () => {
    setLoading(true);
    try {
      const querySnapshot = await getDocs(collection(db, 'paymentMethods'));
      const data = querySnapshot.docs
        .map(doc => ({ ...doc.data(), id: doc.id } as PaymentMethod))
        .sort((a, b) => a.order - b.order);
      setMethods(data);
    } catch (err) {
      console.error('Erro ao carregar formas de pagamento:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleAddMethod = async () => {
    if (!newMethodName.trim()) return;

    try {
      const order = methods.length > 0 ? Math.max(...methods.map(m => m.order)) + 1 : 0;
      const id = new Date().getTime().toString();
      const newMethod: PaymentMethod = {
        id,
        name: newMethodName,
        order,
        enabled: true,
        createdAt: new Date().toISOString(),
      };

      await setDoc(doc(db, 'paymentMethods', id), newMethod);
      setMethods(prev => [...prev, newMethod].sort((a, b) => a.order - b.order));
      setNewMethodName('');
    } catch (err) {
      console.error('Erro ao adicionar forma de pagamento:', err);
    }
  };

  const handleToggleEnabled = async (id: string, currentEnabled: boolean) => {
    try {
      await updateDoc(doc(db, 'paymentMethods', id), {
        enabled: !currentEnabled,
        updatedAt: new Date().toISOString(),
      });
      setMethods(prev =>
        prev.map(m => m.id === id ? { ...m, enabled: !m.enabled } : m)
      );
    } catch (err) {
      console.error('Erro ao atualizar forma de pagamento:', err);
    }
  };

  const handleEditName = async (id: string, newName: string) => {
    if (!newName.trim()) return;

    try {
      await updateDoc(doc(db, 'paymentMethods', id), {
        name: newName,
        updatedAt: new Date().toISOString(),
      });
      setMethods(prev =>
        prev.map(m => m.id === id ? { ...m, name: newName } : m)
      );
      setEditingId(null);
      setEditingName('');
    } catch (err) {
      console.error('Erro ao atualizar nome:', err);
    }
  };

  const handleDeleteMethod = async (id: string) => {
    if (!confirm('Deseja realmente remover esta forma de pagamento?')) return;

    try {
      await deleteDoc(doc(db, 'paymentMethods', id));
      setMethods(prev => prev.filter(m => m.id !== id));
    } catch (err) {
      console.error('Erro ao deletar forma de pagamento:', err);
    }
  };

  const handleReorderMethods = async (fromIndex: number, toIndex: number) => {
    const newMethods = [...methods];
    const [movedMethod] = newMethods.splice(fromIndex, 1);
    newMethods.splice(toIndex, 0, movedMethod);

    // Atualizar orders
    const updatedMethods = newMethods.map((m, idx) => ({ ...m, order: idx }));
    setMethods(updatedMethods);

    // Persistir no Firestore
    for (const method of updatedMethods) {
      try {
        await updateDoc(doc(db, 'paymentMethods', method.id), {
          order: method.order,
          updatedAt: new Date().toISOString(),
        });
      } catch (err) {
        console.error('Erro ao atualizar ordem:', err);
      }
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="p-6 border-b border-slate-200 flex justify-between items-center sticky top-0 bg-white z-10">
          <h2 className="text-2xl font-black text-slate-800">Formas de Pagamento</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">
            <X size={24} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Add New Method */}
          <div className="flex gap-2">
            <input
              type="text"
              value={newMethodName}
              onChange={(e) => setNewMethodName(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleAddMethod()}
              placeholder="Nome da forma de pagamento..."
              className="flex-1 px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <button
              onClick={handleAddMethod}
              disabled={!newMethodName.trim()}
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg font-bold hover:bg-indigo-700 disabled:bg-gray-300 transition-colors flex items-center gap-2"
            >
              <Plus size={18} /> Adicionar
            </button>
          </div>

          {/* Methods List */}
          {loading ? (
            <div className="text-center py-8 text-slate-500">Carregando...</div>
          ) : methods.length === 0 ? (
            <div className="text-center py-8 text-slate-500">Nenhuma forma de pagamento cadastrada</div>
          ) : (
            <div className="space-y-3">
              {methods.map((method, index) => (
                <div
                  key={method.id}
                  draggable
                  onDragStart={() => setDraggedId(method.id)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const draggedIndex = methods.findIndex(m => m.id === draggedId);
                    if (draggedIndex !== index) {
                      handleReorderMethods(draggedIndex, index);
                    }
                    setDraggedId(null);
                  }}
                  className={`p-4 border-2 rounded-xl transition-all ${
                    draggedId === method.id
                      ? 'opacity-50 border-indigo-400 bg-indigo-50'
                      : method.enabled
                      ? 'border-slate-200 bg-white hover:border-indigo-300'
                      : 'border-red-200 bg-red-50'
                  } ${method.enabled ? 'cursor-grab' : 'cursor-not-allowed'}`}
                >
                  <div className="flex items-center gap-4">
                    {/* Drag Handle */}
                    <div className={`${method.enabled ? 'text-slate-400 cursor-grab' : 'text-slate-200 cursor-not-allowed'}`}>
                      <GripVertical size={20} />
                    </div>

                    {/* Name */}
                    {editingId === method.id ? (
                      <input
                        type="text"
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        className="flex-1 px-3 py-1 border border-indigo-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        autoFocus
                      />
                    ) : (
                      <div className="flex-1">
                        <p className={`font-bold ${method.enabled ? 'text-slate-800' : 'text-red-600'}`}>
                          {method.name}
                        </p>
                        <p className="text-xs text-slate-500">
                          Ordem: {index + 1}
                        </p>
                      </div>
                    )}

                    {/* Actions */}
                    <div className="flex items-center gap-2">
                      {editingId === method.id ? (
                        <>
                          <button
                            onClick={() => handleEditName(method.id, editingName)}
                            className="p-2 bg-green-100 text-green-600 rounded-lg hover:bg-green-200 transition-colors"
                            title="Salvar"
                          >
                            <Save size={18} />
                          </button>
                          <button
                            onClick={() => {
                              setEditingId(null);
                              setEditingName('');
                            }}
                            className="p-2 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200 transition-colors"
                            title="Cancelar"
                          >
                            <X size={18} />
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() => {
                              setEditingId(method.id);
                              setEditingName(method.name);
                            }}
                            className="p-2 bg-blue-100 text-blue-600 rounded-lg hover:bg-blue-200 transition-colors"
                            title="Editar"
                          >
                            <Edit2 size={18} />
                          </button>
                          <button
                            onClick={() => handleToggleEnabled(method.id, method.enabled)}
                            className={`p-2 rounded-lg transition-colors ${
                              method.enabled
                                ? 'bg-green-100 text-green-600 hover:bg-green-200'
                                : 'bg-red-100 text-red-600 hover:bg-red-200'
                            }`}
                            title={method.enabled ? 'Desabilitar' : 'Habilitar'}
                          >
                            {method.enabled ? <Eye size={18} /> : <EyeOff size={18} />}
                          </button>
                          <button
                            onClick={() => handleDeleteMethod(method.id)}
                            className="p-2 bg-red-100 text-red-600 rounded-lg hover:bg-red-200 transition-colors"
                            title="Remover"
                          >
                            <Trash2 size={18} />
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Status Badge */}
                  <div className="mt-2 flex items-center gap-2">
                    {method.enabled ? (
                      <span className="inline-flex items-center gap-1 px-3 py-1 bg-green-100 text-green-700 rounded-full text-xs font-bold">
                        <Eye size={14} /> Habilitado
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-3 py-1 bg-red-100 text-red-700 rounded-full text-xs font-bold">
                        <EyeOff size={14} /> Desabilitado
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Drag Info */}
          {methods.length > 1 && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-700">
              💡 <strong>Dica:</strong> Arraste as formas de pagamento para reordenar a exibição no caixa.
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-slate-200 flex justify-end gap-3 sticky bottom-0 bg-white">
          <button
            onClick={onClose}
            className="px-4 py-2 border border-slate-200 text-slate-700 rounded-lg font-bold hover:bg-slate-50 transition-colors"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
};
