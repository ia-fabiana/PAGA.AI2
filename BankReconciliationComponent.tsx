import React, { useState, useEffect } from 'react';
import { BankReconciliation, BankTransaction, CashBoxData, TeamMember } from './types';
import { parseBancoInterCNAB, groupCreditsByDate, getTotalCreditsForDate } from './cnabParser';
import { db } from './firebase';
import { collection, getDocs, query, where, updateDoc, doc } from 'firebase/firestore';
import { Upload, CheckCircle, AlertCircle, Calendar, DollarSign, FileText, Download, TrendingUp, ArrowRight } from 'lucide-react';

interface BankReconciliationProps {
  user: TeamMember;
}

export const BankReconciliationComponent: React.FC<BankReconciliationProps> = ({ user }) => {
  const [reconciliation, setReconciliation] = useState<BankReconciliation | null>(null);
  const [cashBoxEntries, setCashBoxEntries] = useState<CashBoxData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  useEffect(() => {
    loadCashBoxEntries();
  }, []);

  const loadCashBoxEntries = async () => {
    try {
      const q = query(collection(db, 'cashbox'));
      const snapshot = await getDocs(q);
      const entries = snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as CashBoxData));
      setCashBoxEntries(entries);
    } catch (err) {
      console.error('Erro ao carregar caixa:', err);
    }
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      setError('');
    }
  };

  const handleUpload = async () => {
    if (!selectedFile) {
      setError('Selecione um arquivo primeiro');
      return;
    }

    setLoading(true);
    setError('');
    setSuccess('');

    try {
      const text = await selectedFile.text();
      const parsed = parseBancoInterCNAB(text, selectedFile.name, user.email);
      setReconciliation(parsed);
      setSuccess(`Extrato processado! ${parsed.totalTransactions} transações encontradas.`);
    } catch (err) {
      setError('Erro ao processar arquivo. Verifique se é um extrato válido do Banco Inter.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleAutoReconcile = async () => {
    if (!reconciliation) return;

    setLoading(true);
    setError('');
    setSuccess('');

    try {
      const creditsByDate = groupCreditsByDate(reconciliation.transactions);
      let reconciledCount = 0;
      let updatedCount = 0;

      for (const [date, transactions] of Object.entries(creditsByDate)) {
        // Encontra entrada do caixa para esta data
        const cashBoxEntry = cashBoxEntries.find(e => e.date === date);
        
        if (cashBoxEntry) {
          // Calcula total de créditos (PIX recebidos)
          const totalCredits = transactions.reduce((sum, t) => sum + t.amount, 0);
          
          // Atualiza entrada do caixa com dados bancários
          const docRef = doc(db, 'cashbox', cashBoxEntry.id);
          await updateDoc(docRef, {
            interBankTotal: totalCredits,
            interBankTransactions: transactions,
            interReconciled: true,
            interReconciledAt: new Date().toISOString(),
            interReconciledBy: user.email,
            interTotal: totalCredits // Atualiza o valor do INTER automaticamente
          });
          
          updatedCount++;
          reconciledCount += transactions.length;
        }
      }

      // Recarrega entradas do caixa
      await loadCashBoxEntries();

      setSuccess(`✅ Conciliação automática concluída! ${updatedCount} dias atualizados com ${reconciledCount} transações.`);
      
      // Atualiza status da reconciliação
      setReconciliation({
        ...reconciliation,
        reconciledTransactions: reconciledCount,
        status: reconciledCount === reconciliation.totalTransactions ? 'complete' : 'partial'
      });
    } catch (err) {
      setError('Erro ao conciliar automaticamente');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const fmt = (value: number) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  const formatDate = (dateStr: string) => {
    const [year, month, day] = dateStr.split('-');
    return `${day}/${month}/${year}`;
  };

  if (!user.permissions?.reconciliation) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <AlertCircle size={48} className="mx-auto text-amber-500 mb-4" />
          <p className="text-slate-600 font-bold">Você não tem permissão para acessar a Conciliação Bancária</p>
          <p className="text-slate-400 text-sm mt-2">Entre em contato com o administrador</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8 pb-12">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-black text-slate-800 tracking-tight flex items-center gap-3">
          🏦 Conciliação Bancária
        </h1>
        <p className="text-slate-500 font-medium mt-1">Importação e validação automática de extratos do Banco Inter</p>
      </div>

      {/* Upload Section */}
      <div className="bg-white rounded-3xl border-2 border-slate-100 shadow-lg p-8">
        <h2 className="text-xl font-black text-slate-800 mb-6 flex items-center gap-2">
          <Upload size={24} className="text-indigo-600" />
          Importar Extrato Bancário
        </h2>

        <div className="space-y-6">
          <div className="border-2 border-dashed border-slate-300 rounded-2xl p-8 text-center hover:border-indigo-400 transition-colors">
            <input
              type="file"
              accept=".ret,.txt"
              onChange={handleFileSelect}
              className="hidden"
              id="file-upload"
            />
            <label htmlFor="file-upload" className="cursor-pointer">
              <FileText size={48} className="mx-auto text-slate-400 mb-4" />
              <p className="text-slate-700 font-bold mb-2">
                {selectedFile ? selectedFile.name : 'Clique para selecionar o arquivo'}
              </p>
              <p className="text-slate-400 text-sm">
                Formatos aceitos: .RET, .TXT (CNAB 240 - Banco Inter)
              </p>
            </label>
          </div>

          {selectedFile && (
            <button
              onClick={handleUpload}
              disabled={loading}
              className="w-full bg-indigo-600 text-white rounded-2xl font-black py-4 hover:bg-indigo-700 transition-all shadow-xl shadow-indigo-100 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Processando...' : '📤 Processar Extrato'}
            </button>
          )}

          {error && (
            <div className="bg-red-50 border-2 border-red-200 rounded-xl p-4 flex items-start gap-3">
              <AlertCircle className="text-red-600 flex-shrink-0" size={20} />
              <p className="text-red-800 text-sm font-semibold">{error}</p>
            </div>
          )}

          {success && (
            <div className="bg-green-50 border-2 border-green-200 rounded-xl p-4 flex items-start gap-3">
              <CheckCircle className="text-green-600 flex-shrink-0" size={20} />
              <p className="text-green-800 text-sm font-semibold">{success}</p>
            </div>
          )}
        </div>
      </div>

      {/* Reconciliation Summary */}
      {reconciliation && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <div className="bg-white p-6 rounded-2xl border-2 border-slate-100 shadow-lg">
              <div className="flex items-center gap-3 mb-2">
                <Calendar className="text-indigo-600" size={20} />
                <p className="text-xs font-black text-slate-400 uppercase">Período</p>
              </div>
              <p className="text-lg font-black text-slate-800">
                {formatDate(reconciliation.startDate)} - {formatDate(reconciliation.endDate)}
              </p>
            </div>

            <div className="bg-white p-6 rounded-2xl border-2 border-slate-100 shadow-lg">
              <div className="flex items-center gap-3 mb-2">
                <FileText className="text-emerald-600" size={20} />
                <p className="text-xs font-black text-slate-400 uppercase">Transações</p>
              </div>
              <p className="text-2xl font-black text-slate-800">{reconciliation.totalTransactions}</p>
            </div>

            <div className="bg-white p-6 rounded-2xl border-2 border-slate-100 shadow-lg">
              <div className="flex items-center gap-3 mb-2">
                <CheckCircle className="text-green-600" size={20} />
                <p className="text-xs font-black text-slate-400 uppercase">Conciliadas</p>
              </div>
              <p className="text-2xl font-black text-slate-800">{reconciliation.reconciledTransactions}</p>
            </div>

            <div className="bg-white p-6 rounded-2xl border-2 border-slate-100 shadow-lg">
              <div className="flex items-center gap-3 mb-2">
                <DollarSign className="text-blue-600" size={20} />
                <p className="text-xs font-black text-slate-400 uppercase">Saldo</p>
              </div>
              <p className="text-xl font-black text-slate-800">{fmt(reconciliation.finalBalance)}</p>
            </div>
          </div>

          {/* Auto Reconcile Button */}
          <div className="bg-gradient-to-r from-indigo-50 to-blue-50 rounded-2xl border-2 border-indigo-200 p-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-black text-slate-800 mb-2">🤖 Conciliação Automática</h3>
                <p className="text-slate-600 text-sm">
                  Atualiza automaticamente o campo "INTER" do Caixa com os valores do extrato bancário
                </p>
              </div>
              <button
                onClick={handleAutoReconcile}
                disabled={loading}
                className="px-8 py-4 bg-indigo-600 text-white rounded-2xl font-black hover:bg-indigo-700 transition-all shadow-xl shadow-indigo-100 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                <TrendingUp size={20} />
                Conciliar Agora
              </button>
            </div>
          </div>

          {/* Transactions by Date */}
          <div className="bg-white rounded-3xl border-2 border-slate-100 shadow-lg p-8">
            <h2 className="text-xl font-black text-slate-800 mb-6">📊 Recebimentos por Data</h2>
            
            <div className="space-y-4">
              {Object.entries(groupCreditsByDate(reconciliation.transactions))
                .sort(([a], [b]) => b.localeCompare(a))
                .map(([date, transactions]) => {
                  const total = transactions.reduce((sum, t) => sum + t.amount, 0);
                  const cashBoxEntry = cashBoxEntries.find(e => e.date === date);
                  
                  return (
                    <div key={date} className="border-2 border-slate-100 rounded-xl p-6 hover:border-indigo-200 transition-colors">
                      <div className="flex items-center justify-between mb-4">
                        <div>
                          <h3 className="text-lg font-black text-slate-800">{formatDate(date)}</h3>
                          <p className="text-sm text-slate-500">{transactions.length} transações</p>
                        </div>
                        <div className="text-right">
                          <p className="text-2xl font-black text-emerald-600">{fmt(total)}</p>
                          {cashBoxEntry?.interReconciled && (
                            <span className="inline-flex items-center gap-1 text-xs font-bold text-green-700 bg-green-100 px-3 py-1 rounded-full mt-2">
                              <CheckCircle size={12} /> Conciliado
                            </span>
                          )}
                        </div>
                      </div>
                      
                      <div className="space-y-2">
                        {transactions.map((transaction, idx) => (
                          <div key={idx} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                            <div>
                              <p className="text-sm font-bold text-slate-700">{transaction.description}</p>
                              <p className="text-xs text-slate-500">Ref: {transaction.reference}</p>
                            </div>
                            <p className="text-sm font-black text-slate-800">{fmt(transaction.amount)}</p>
                          </div>
                        ))}
                      </div>

                      {cashBoxEntry && (
                        <div className="mt-4 pt-4 border-t border-slate-200 flex items-center justify-between">
                          <div className="flex items-center gap-2 text-sm">
                            <ArrowRight size={16} className="text-indigo-600" />
                            <span className="font-bold text-slate-700">Caixa registrado:</span>
                            <span className="font-black text-slate-800">{fmt(cashBoxEntry.interTotal)}</span>
                          </div>
                          {cashBoxEntry.interBankTotal && Math.abs(cashBoxEntry.interBankTotal - cashBoxEntry.interTotal) > 0.01 && (
                            <span className="text-xs font-bold text-amber-700 bg-amber-100 px-3 py-1 rounded-full">
                              ⚠️ Divergência: {fmt(Math.abs(cashBoxEntry.interBankTotal - cashBoxEntry.interTotal))}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          </div>
        </>
      )}
    </div>
  );
};
