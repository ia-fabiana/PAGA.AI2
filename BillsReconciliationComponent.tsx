import React, { useState, useEffect } from 'react';
import { Upload, X, CheckCircle, AlertCircle, Loader, Download } from 'lucide-react';
import { TeamMember, Bill, BillReconciliationMatch, BillsReconciliation } from './types';
import { parseUniversalBankExtract, getDebitTransactions, matchDebitWithBills } from './cnabParser';

interface BillsReconciliationComponentProps {
  user: TeamMember;
  bills: Bill[];
}

interface MatchUI extends BillReconciliationMatch {
  billDescription?: string;
  billAmount?: number;
  billDueDate?: string;
}

export const BillsReconciliationComponent: React.FC<BillsReconciliationComponentProps> = ({ user, bills }) => {
  const [isLoading, setIsLoading] = useState(false);
  const [debitTransactions, setDebitTransactions] = useState<any[]>([]);
  const [matches, setMatches] = useState<MatchUI[]>([]);
  const [uploadedAt, setUploadedAt] = useState('');
  const [fileName, setFileName] = useState('');
  const [totalDebits, setTotalDebits] = useState(0);
  const [totalMatched, setTotalMatched] = useState(0);
  const [expandedMatch, setExpandedMatch] = useState<string | null>(null);

  // Filtra apenas Bills com status PAID
  const paidBills = bills.filter(b => b.status === 'Pago');

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsLoading(true);
    try {
      const isPdf = file.name.toLowerCase().endsWith('.pdf');
      const fileContent = isPdf ? await file.arrayBuffer() : await file.text();
      setFileName(file.name);
      setUploadedAt(new Date().toISOString());

      // Parse universal - detecta e rota para o formato correto
      const reconciliation = await parseUniversalBankExtract(fileContent, file.name, user.email);

      // Extrai apenas débitos
      const debits = getDebitTransactions(reconciliation.transactions);
      setDebitTransactions(debits);
      setTotalDebits(debits.length);

      // Faz matching automático
      const autoMatches: MatchUI[] = [];
      const paidBillIds = new Set<string>();

      debits.forEach((debit) => {
        const billMatches = matchDebitWithBills(debit, paidBills);
        
        if (billMatches.length > 0) {
          // Melhor match automático
          const bestMatch = billMatches[0];
          const matchedBill = paidBills.find(b => b.id === bestMatch.billId);
          
          if (matchedBill && bestMatch.score > 80) {
            // Score alto = auto-confirmar
            autoMatches.push({
              id: `match-${debit.id}-${bestMatch.billId}`,
              bankTransaction: debit,
              billId: bestMatch.billId,
              matchType: 'auto',
              matchScore: bestMatch.score,
              confirmedAt: new Date().toISOString(),
              confirmedBy: user.email,
              billDescription: matchedBill.description,
              billAmount: matchedBill.amount,
              billDueDate: matchedBill.dueDate
            });
            paidBillIds.add(bestMatch.billId);
          } else if (matchedBill) {
            // Score moderado = permitir validação manual
            autoMatches.push({
              id: `match-${debit.id}-${bestMatch.billId}`,
              bankTransaction: debit,
              billId: bestMatch.billId,
              matchType: 'manual',
              matchScore: bestMatch.score,
              billDescription: matchedBill.description,
              billAmount: matchedBill.amount,
              billDueDate: matchedBill.dueDate
            });
          }
        }

        // Débitos sem match
        if (!autoMatches.some(m => m.bankTransaction.id === debit.id)) {
          autoMatches.push({
            id: `match-${debit.id}-unmatched`,
            bankTransaction: debit,
            matchType: 'none',
            matchScore: 0,
            notes: 'Débito sem Bill correspondente'
          });
        }
      });

      setMatches(autoMatches);
      setTotalMatched(autoMatches.filter(m => m.billId).length);
    } catch (error) {
      console.error('Erro ao fazer upload:', error);
      alert('Erro ao fazer upload do arquivo. Verifique o formato.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleConfirmMatch = (matchId: string, billId?: string) => {
    setMatches(matches.map(m => 
      m.id === matchId 
        ? { ...m, matchType: billId ? 'manual' : 'none', confirmedAt: new Date().toISOString(), confirmedBy: user.email, billId }
        : m
    ));
  };

  const handleRejectMatch = (matchId: string) => {
    setMatches(matches.map(m => 
      m.id === matchId 
        ? { ...m, matchType: 'none', billId: undefined, confirmedAt: new Date().toISOString(), confirmedBy: user.email, notes: 'Rejeitado pelo usuário' }
        : m
    ));
  };

  const handleSaveReconciliation = async () => {
    if (matches.length === 0) {
      alert('Nenhuma transação para salvar');
      return;
    }

    setIsLoading(true);
    try {
      // Aqui você salvaria no Firebase
      // Por enquanto, apenas loga no console
      const reconciliation: BillsReconciliation = {
        id: `bills-reconciliation-${Date.now()}`,
        uploadedAt,
        uploadedBy: user.email,
        fileName,
        bankName: 'Banco Inter',
        accountNumber: 'XXXX',
        startDate: debitTransactions[0]?.date || '',
        endDate: debitTransactions[debitTransactions.length - 1]?.date || '',
        debitTransactions,
        matches,
        totalDebits,
        totalMatched: matches.filter(m => m.billId).length,
        status: totalMatched === totalDebits ? 'complete' : 'partial'
      };

      console.log('💾 Reconciliação salva:', reconciliation);
      alert('✅ Reconciliação de despesas salva com sucesso!');
      
      // Reset
      setMatches([]);
      setDebitTransactions([]);
      setFileName('');
      setUploadedAt('');
    } catch (error) {
      console.error('Erro ao salvar:', error);
      alert('Erro ao salvar reconciliação');
    } finally {
      setIsLoading(false);
    }
  };

  // Agrupa matches por data
  const matchesByDate = debitTransactions.reduce((acc: Record<string, MatchUI[]>, debit) => {
    const date = debit.date;
    if (!acc[date]) acc[date] = [];
    const match = matches.find(m => m.bankTransaction.id === debit.id);
    if (match) acc[date].push(match);
    return acc;
  }, {} as Record<string, MatchUI[]>);

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="mb-8">
        <h1 className="text-4xl font-black text-slate-800 mb-2">🏦 Conciliação de Despesas</h1>
        <p className="text-slate-500">Valide débitos do extrato bancário contra contas a pagar</p>
      </div>

      {/* Upload Section */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8 mb-8">
        <label className="flex flex-col items-center justify-center gap-4 cursor-pointer group">
          <div className="w-16 h-16 rounded-2xl bg-indigo-50 flex items-center justify-center group-hover:bg-indigo-100 transition-colors">
            <Upload size={32} className="text-indigo-600" />
          </div>
          <div className="text-center">
            <p className="text-lg font-bold text-slate-800">Clique para fazer upload do extrato</p>
            <p className="text-sm text-slate-500">Arquivo .RET, .TXT ou .PDF (Banco Inter CNAB 240)</p>
          </div>
          <input
            type="file"
            accept=".ret,.txt,.pdf"
            onChange={handleFileUpload}
            disabled={isLoading}
            className="hidden"
          />
        </label>
      </div>

      {/* Status Section */}
      {uploadedAt && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 mb-8">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-slate-50 rounded-xl p-4">
              <p className="text-sm text-slate-500 mb-1">Arquivo</p>
              <p className="text-lg font-bold text-slate-800">{fileName}</p>
            </div>
            <div className="bg-slate-50 rounded-xl p-4">
              <p className="text-sm text-slate-500 mb-1">Total de Débitos</p>
              <p className="text-lg font-bold text-slate-800">{totalDebits}</p>
            </div>
            <div className="bg-slate-50 rounded-xl p-4">
              <p className="text-sm text-slate-500 mb-1">Matched</p>
              <p className="text-lg font-bold text-emerald-600">{totalMatched} / {totalDebits}</p>
            </div>
          </div>
        </div>
      )}

      {/* Matches Section */}
      {matches.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 mb-8">
          <h2 className="text-2xl font-bold text-slate-800 mb-6">Transações do Extrato</h2>

          {Object.entries(matchesByDate)
            .sort(([dateA], [dateB]) => dateB.localeCompare(dateA))
            .map(([date, dateMatches]: [string, MatchUI[]]) => (
              <div key={date} className="mb-6">
                <div className="flex items-center gap-2 mb-4 pb-2 border-b border-slate-100">
                  <span className="text-sm font-bold text-slate-400 uppercase">
                    {new Date(date).toLocaleDateString('pt-BR')}
                  </span>
                </div>

                <div className="space-y-3">
                  {dateMatches.map((match) => (
                    <div
                      key={match.id}
                      className={`border rounded-xl p-4 transition-all ${
                        match.matchType === 'auto'
                          ? 'bg-emerald-50 border-emerald-200'
                          : match.matchType === 'manual'
                          ? 'bg-blue-50 border-blue-200'
                          : 'bg-slate-50 border-slate-200'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2">
                            {match.matchType === 'auto' && (
                              <CheckCircle size={18} className="text-emerald-600" />
                            )}
                            {match.matchType === 'manual' && (
                              <AlertCircle size={18} className="text-blue-600" />
                            )}
                            {match.matchType === 'none' && (
                              <X size={18} className="text-slate-400" />
                            )}
                            <span className="font-bold text-slate-800">
                              {match.bankTransaction.description}
                            </span>
                          </div>

                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <p className="text-xs text-slate-500 mb-1">Débito</p>
                              <p className="text-lg font-bold text-slate-800">
                                R$ {match.bankTransaction.amount.toFixed(2)}
                              </p>
                            </div>
                            {match.billId && (
                              <div>
                                <p className="text-xs text-slate-500 mb-1">Bill Compatível</p>
                                <p className="text-lg font-bold text-slate-800">
                                  R$ {match.billAmount?.toFixed(2)}
                                </p>
                              </div>
                            )}
                          </div>

                          {match.billDescription && (
                            <p className="text-sm text-slate-600 mt-2">
                              📋 {match.billDescription}
                            </p>
                          )}

                          {match.matchScore && (
                            <div className="mt-2 flex items-center gap-2">
                              <div className="w-24 bg-slate-200 rounded-full h-2">
                                <div
                                  className={`h-2 rounded-full transition-all ${
                                    match.matchScore > 80
                                      ? 'bg-emerald-500'
                                      : 'bg-blue-500'
                                  }`}
                                  style={{ width: `${Math.min(match.matchScore, 100)}%` }}
                                />
                              </div>
                              <span className="text-xs font-bold text-slate-600">
                                {match.matchScore}%
                              </span>
                            </div>
                          )}
                        </div>

                        {match.matchType !== 'auto' && (
                          <div className="flex gap-2">
                            <button
                              onClick={() => handleConfirmMatch(match.id, paidBills[0]?.id)}
                              className="px-3 py-1 bg-emerald-600 text-white rounded-lg text-sm font-bold hover:bg-emerald-700 transition-colors"
                            >
                              ✓
                            </button>
                            <button
                              onClick={() => handleRejectMatch(match.id)}
                              className="px-3 py-1 bg-slate-300 text-slate-700 rounded-lg text-sm font-bold hover:bg-slate-400 transition-colors"
                            >
                              ✕
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
        </div>
      )}

      {/* Action Buttons */}
      {matches.length > 0 && (
        <div className="flex gap-3 justify-center">
          <button
            onClick={handleSaveReconciliation}
            disabled={isLoading}
            className="flex items-center gap-2 px-6 py-3 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 transition-colors disabled:opacity-50"
          >
            {isLoading ? <Loader size={20} className="animate-spin" /> : <Download size={20} />}
            {isLoading ? 'Salvando...' : 'Salvar Reconciliação'}
          </button>
        </div>
      )}

      {/* Empty State */}
      {matches.length === 0 && uploadedAt === '' && (
        <div className="text-center py-12">
          <AlertCircle size={48} className="mx-auto text-slate-300 mb-4" />
          <p className="text-slate-500">Nenhum arquivo carregado</p>
        </div>
      )}
    </div>
  );
};
