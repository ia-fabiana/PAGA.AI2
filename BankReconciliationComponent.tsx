import React, { useState } from 'react';
import { BankReconciliation, BankTransaction, TeamMember } from './types';
import { parseUniversalBankExtract } from './cnabParser';
import { Upload, CheckCircle, AlertCircle, Calendar, DollarSign, FileText, TrendingDown, TrendingUp, Filter, Search, Download, X } from 'lucide-react';
import { theme } from './theme';

interface BankReconciliationProps {
  user: TeamMember;
}

export const BankReconciliationComponent: React.FC<BankReconciliationProps> = ({ user }) => {
  const [reconciliation, setReconciliation] = useState<BankReconciliation | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  
  // Filtros
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState<'ALL' | 'CREDIT' | 'DEBIT'>('ALL');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

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
      const isPdf = selectedFile.name.toLowerCase().endsWith('.pdf');
      const fileContent = isPdf ? await selectedFile.arrayBuffer() : await selectedFile.text();
      const parsed = await parseUniversalBankExtract(fileContent, selectedFile.name, user.email);
      setReconciliation(parsed);
      setSuccess(`✅ Extrato processado! ${parsed.totalTransactions} transações encontradas.`);
      
      // Define filtro de datas automaticamente
      setStartDate(parsed.startDate);
      setEndDate(parsed.endDate);
    } catch (err) {
      setError('Erro ao processar arquivo. Verifique se é um extrato válido do Banco Inter.');
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

  // Filtra transações
  const filteredTransactions = reconciliation?.transactions.filter(t => {
    const matchesSearch = t.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         t.reference.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesType = typeFilter === 'ALL' || t.type === typeFilter;
    const matchesDate = (!startDate || t.date >= startDate) && (!endDate || t.date <= endDate);
    return matchesSearch && matchesType && matchesDate;
  }).sort((a, b) => b.date.localeCompare(a.date)) || [];

  // Calcula totais filtrados
  const totalCredits = filteredTransactions.filter(t => t.type === 'CREDIT').reduce((sum, t) => sum + t.amount, 0);
  const totalDebits = filteredTransactions.filter(t => t.type === 'DEBIT').reduce((sum, t) => sum + t.amount, 0);
  const balance = totalCredits - totalDebits;

  if (!user.permissions?.reconciliation) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <AlertCircle size={48} className="mx-auto text-amber-500 mb-4" />
          <p className="text-slate-600 font-bold">Você não tem permissão para acessar o Extrato Bancário</p>
          <p className="text-slate-400 text-sm mt-2">Entre em contato com o administrador</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div>
        <h1 className="text-4xl font-black tracking-tight" style={{ color: theme.colors.neutral.black }}>
          Extrato Bancário
        </h1>
        <p className="text-slate-600 font-semibold text-sm mt-1">Visualização completa de movimentações bancárias</p>
      </div>

      {/* Upload Section */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
        <h2 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
          <Upload size={20} style={{ color: theme.colors.primary.purple }} />
          Importar Extrato
        </h2>

        <div className="space-y-4">
          <div className="border-2 border-dashed border-slate-300 rounded-xl p-6 text-center hover:border-indigo-400 transition-colors">
            <input
              type="file"
              accept=".ret,.txt,.pdf"
              onChange={handleFileSelect}
              className="hidden"
              id="file-upload"
            />
            <label htmlFor="file-upload" className="cursor-pointer">
              <FileText size={40} className="mx-auto text-slate-400 mb-3" />
              <p className="text-slate-700 font-semibold mb-1">
                {selectedFile ? selectedFile.name : 'Clique para selecionar o arquivo'}
              </p>
              <p className="text-slate-400 text-xs">
                Formatos: .RET, .TXT, .PDF (CNAB 240 - Banco Inter)
              </p>
            </label>
          </div>

          {selectedFile && (
            <button
              onClick={handleUpload}
              disabled={loading}
              className="w-full text-white rounded-xl font-bold py-3 transition-all shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ backgroundColor: theme.colors.primary.purple }}
            >
              {loading ? 'Processando...' : '📤 Processar Extrato'}
            </button>
          )}

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-start gap-2">
              <AlertCircle className="text-red-600 flex-shrink-0" size={18} />
              <p className="text-red-800 text-sm font-semibold">{error}</p>
            </div>
          )}

          {success && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-3 flex items-start gap-2">
              <CheckCircle className="text-green-600 flex-shrink-0" size={18} />
              <p className="text-green-800 text-sm font-semibold">{success}</p>
            </div>
          )}
        </div>
      </div>

      {/* Extrato Completo */}
      {reconciliation && (
        <>
          {/* Resumo Geral */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
              <div className="flex items-center gap-2 mb-2">
                <Calendar size={16} className="text-indigo-600" />
                <p className="text-xs font-bold text-slate-500 uppercase">Período</p>
              </div>
              <p className="text-sm font-bold text-slate-800">
                {formatDate(reconciliation.startDate)} até {formatDate(reconciliation.endDate)}
              </p>
            </div>

            <div className="bg-white p-4 rounded-xl border border-green-200 shadow-sm">
              <div className="flex items-center gap-2 mb-2">
                <TrendingUp size={16} className="text-green-600" />
                <p className="text-xs font-bold text-slate-500 uppercase">Total Créditos</p>
              </div>
              <p className="text-lg font-black text-green-600">{fmt(totalCredits)}</p>
            </div>

            <div className="bg-white p-4 rounded-xl border border-red-200 shadow-sm">
              <div className="flex items-center gap-2 mb-2">
                <TrendingDown size={16} className="text-red-600" />
                <p className="text-xs font-bold text-slate-500 uppercase">Total Débitos</p>
              </div>
              <p className="text-lg font-black text-red-600">{fmt(totalDebits)}</p>
            </div>

            <div className="bg-white p-4 rounded-xl border border-blue-200 shadow-sm">
              <div className="flex items-center gap-2 mb-2">
                <DollarSign size={16} className="text-blue-600" />
                <p className="text-xs font-bold text-slate-500 uppercase">Saldo Período</p>
              </div>
              <p className={`text-lg font-black ${balance >= 0 ? 'text-blue-600' : 'text-red-600'}`}>
                {fmt(balance)}
              </p>
            </div>
          </div>

          {/* Filtros */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
            <div className="flex items-center gap-2 mb-4">
              <Filter size={18} style={{ color: theme.colors.primary.purple }} />
              <h3 className="font-bold text-slate-800">Filtros</h3>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="relative">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Buscar por descrição..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                {searchTerm && (
                  <button
                    onClick={() => setSearchTerm('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    <X size={16} />
                  </button>
                )}
              </div>

              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value as any)}
                className="px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="ALL">Todos os tipos</option>
                <option value="CREDIT">Apenas Créditos</option>
                <option value="DEBIT">Apenas Débitos</option>
              </select>

              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />

              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <div className="flex items-center gap-4 mt-3 text-xs text-slate-600">
              <span>{filteredTransactions.length} transações encontradas</span>
              {(searchTerm || typeFilter !== 'ALL') && (
                <button
                  onClick={() => {
                    setSearchTerm('');
                    setTypeFilter('ALL');
                    setStartDate(reconciliation.startDate);
                    setEndDate(reconciliation.endDate);
                  }}
                  className="text-indigo-600 hover:text-indigo-700 font-semibold"
                >
                  Limpar filtros
                </button>
              )}
            </div>
          </div>

          {/* Lista de Transações */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
              <table className="w-full">
                <thead className="bg-slate-100 sticky top-0 z-10">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-bold text-slate-600 uppercase">Data</th>
                    <th className="px-4 py-3 text-left text-xs font-bold text-slate-600 uppercase">Descrição</th>
                    <th className="px-4 py-3 text-center text-xs font-bold text-slate-600 uppercase">Tipo</th>
                    <th className="px-4 py-3 text-right text-xs font-bold text-slate-600 uppercase">Valor</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredTransactions.map((transaction, idx) => (
                    <tr key={idx} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3 text-sm whitespace-nowrap text-slate-700 font-semibold">
                        {formatDate(transaction.date)}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <p className="font-semibold text-slate-800">{transaction.description}</p>
                        {transaction.reference && (
                          <p className="text-xs text-slate-500 mt-0.5">Ref: {transaction.reference}</p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {transaction.type === 'CREDIT' ? (
                          <span className="inline-flex items-center gap-1 text-xs font-bold text-green-700 bg-green-100 px-3 py-1 rounded-full">
                            <TrendingUp size={12} /> Crédito
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs font-bold text-red-700 bg-red-100 px-3 py-1 rounded-full">
                            <TrendingDown size={12} /> Débito
                          </span>
                        )}
                      </td>
                      <td className={`px-4 py-3 text-right text-sm font-black ${transaction.type === 'CREDIT' ? 'text-green-600' : 'text-red-600'}`}>
                        {transaction.type === 'CREDIT' ? '+' : '-'} {fmt(transaction.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {filteredTransactions.length === 0 && (
                <div className="p-12 text-center">
                  <FileText size={48} className="mx-auto text-slate-300 mb-3" />
                  <p className="text-slate-500 font-semibold">Nenhuma transação encontrada</p>
                  <p className="text-sm text-slate-400 mt-1">Ajuste os filtros para ver mais resultados</p>
                </div>
              )}
            </div>

            {/* Totalizador fixo no rodapé */}
            {filteredTransactions.length > 0 && (
              <div className="border-t-2 border-slate-200 bg-slate-50 p-4">
                <div className="grid grid-cols-3 gap-4 text-sm">
                  <div className="text-center">
                    <p className="text-xs text-slate-500 font-bold uppercase mb-1">Créditos</p>
                    <p className="text-lg font-black text-green-600">{fmt(totalCredits)}</p>
                  </div>
                  <div className="text-center">
                    <p className="text-xs text-slate-500 font-bold uppercase mb-1">Débitos</p>
                    <p className="text-lg font-black text-red-600">{fmt(totalDebits)}</p>
                  </div>
                  <div className="text-center">
                    <p className="text-xs text-slate-500 font-bold uppercase mb-1">Saldo</p>
                    <p className={`text-lg font-black ${balance >= 0 ? 'text-blue-600' : 'text-red-600'}`}>
                      {fmt(balance)}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};
