import React, { useEffect, useState } from 'react';
import { BankReconciliation, BankTransaction, Bill, BillStatus, ChartOfAccount, Supplier, TeamMember } from './types';
import { parseUniversalBankExtract } from './cnabParser';
import { Upload, CheckCircle, AlertCircle, Calendar, DollarSign, FileText, TrendingDown, TrendingUp, Filter, Search, Save, X, Trash2, PlusCircle, Layers } from 'lucide-react';
import { theme } from './theme';
import { getStatementAccountGroupKey, listSavedBankReconciliations, saveBankReconciliationVersion, StoredBankReconciliation } from './bankReconciliationStore';
import { doesBillMatchTransaction, getBillDisplayPaidAmount, getBillOutstandingAmount, isBillFullyPaid, isBillPartiallyPaid } from './billPaymentUtils';

const CURRENT_STATEMENT_STORAGE_KEY = 'pagaai_bank_statement_current';

interface BankReconciliationProps {
  user: TeamMember;
  bills: Bill[];
  suppliers: Supplier[];
  accounts: ChartOfAccount[];
  onReconcileBill: (transaction: BankTransaction, bill: Bill) => Promise<void> | void;
  onReconcileMultiple: (transactions: BankTransaction[], bill: Bill) => Promise<void>;
  onReopenReconciliation: (transaction: BankTransaction, bill: Bill) => Promise<void> | void;
  onCreateBillFromTransaction: (transaction: BankTransaction, accountId: string) => Promise<Bill> | Bill;
  onQuickCreateBillFromTransaction: (transaction: BankTransaction, supplierId: string, accountId: string) => Promise<Bill>;
  onBulkDeleteBillsByDateRange: (startDate: string, endDate: string) => Promise<number>;
}

type MatchSuggestion = {
  bill: Bill;
  score: number;
  supplierName: string;
};

export const BankReconciliationComponent: React.FC<BankReconciliationProps> = ({
  user,
  bills,
  suppliers,
  accounts,
  onReconcileBill,
  onReconcileMultiple,
  onReopenReconciliation,
  onCreateBillFromTransaction,
  onQuickCreateBillFromTransaction,
  onBulkDeleteBillsByDateRange,
}) => {
  const [reconciliation, setReconciliation] = useState<BankReconciliation | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadingSavedStatements, setLoadingSavedStatements] = useState(false);
  const [reconcilingTransactionId, setReconcilingTransactionId] = useState<string | null>(null);
  const [creatingBillTransactionId, setCreatingBillTransactionId] = useState<string | null>(null);
  const [expandedTransactionId, setExpandedTransactionId] = useState<string | null>(null);
  const [selectedBillByTransaction, setSelectedBillByTransaction] = useState<Record<string, string>>({});
  const [selectedAccountByTransaction, setSelectedAccountByTransaction] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isCurrentStatementSaved, setIsCurrentStatementSaved] = useState(false);
  const [savedStatements, setSavedStatements] = useState<StoredBankReconciliation[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState<'ALL' | 'CREDIT' | 'DEBIT'>('ALL');
  const [periodGrouping, setPeriodGrouping] = useState<'none' | 'day' | 'month'>('month');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [minAmountFilter, setMinAmountFilter] = useState('');
  const [maxAmountFilter, setMaxAmountFilter] = useState('');
  const [quickCreatingBillId, setQuickCreatingBillId] = useState<string | null>(null);
  const [bulkDeleteStartDate, setBulkDeleteStartDate] = useState('2026-01-01');
  const [bulkDeleteEndDate, setBulkDeleteEndDate] = useState('2026-03-31');
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);

  // ── Seleção múltipla para conciliação em grupo ──────────────────────────────
  const [selectedTxIds, setSelectedTxIds] = useState<Set<string>>(new Set());
  const [groupModalOpen, setGroupModalOpen] = useState(false);
  const [groupBillId, setGroupBillId] = useState('');
  const [groupBillSearch, setGroupBillSearch] = useState('');
  const [groupReconciling, setGroupReconciling] = useState(false);

  const normalizeText = (value?: string) =>
    (value || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  const getSupplierName = (supplierId: string) => suppliers.find((supplier) => supplier.id === supplierId)?.name || '';
  const getAccountName = (accountId: string) => accounts.find((account) => account.id === accountId)?.name || '';

  const isTransactionSelectable = (tx: BankTransaction) =>
    tx.type === 'DEBIT' && !tx.reconciled && !tx.reconciledWith;

  const toggleTxSelection = (id: string) =>
    setSelectedTxIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const handleGroupReconcile = async () => {
    const selectedTxs = (reconciliation?.transactions ?? []).filter((tx) => selectedTxIds.has(tx.id));
    const bill = bills.find((b) => b.id === groupBillId);
    if (!bill || selectedTxs.length === 0) return;
    setGroupReconciling(true);
    setError('');
    try {
      await onReconcileMultiple(selectedTxs, bill);
      selectedTxs.forEach((tx) => markTransactionAsReconciled(tx, bill));
      setSelectedTxIds(new Set());
      setGroupModalOpen(false);
      setGroupBillId('');
      setGroupBillSearch('');
      const total = selectedTxs.reduce((s, tx) => s + tx.amount, 0);
      setSuccess(`${selectedTxs.length} lançamento(s) vinculados a "${bill.description}" — total R$ ${fmt(total)}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao conciliar grupo.');
    } finally {
      setGroupReconciling(false);
    }
  };

  const findSupplierForTransaction = (transaction: BankTransaction) => {
    const transactionText = normalizeText(transaction.counterparty || transaction.description);
    if (!transactionText) return undefined;

    return suppliers.find((supplier) => {
      const supplierText = normalizeText(supplier.name);
      return supplierText === transactionText || transactionText.includes(supplierText) || supplierText.includes(transactionText);
    });
  };

  const getComputedBillStatus = (bill: Bill): BillStatus => {
    if (isBillFullyPaid(bill)) return BillStatus.PAID;
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    const dueDate = new Date(`${bill.dueDate}T12:00:00`);
    if (!Number.isNaN(dueDate.getTime()) && dueDate < today) return BillStatus.OVERDUE;
    return BillStatus.PENDING;
  };

  const availableBills = bills
    .filter((bill) => !isBillFullyPaid(bill))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  const findReconciledBill = (transaction: BankTransaction) => {
    if (transaction.reconciledWith) {
      const directlyLinkedBill = bills.find((bill) => bill.id === transaction.reconciledWith);
      if (directlyLinkedBill) {
        if (transaction.reconciled && transaction.reconciledType === 'bill') return directlyLinkedBill;
        if (doesBillMatchTransaction(directlyLinkedBill, transaction)) return directlyLinkedBill;
      }
    }

    return bills.find((bill) => doesBillMatchTransaction(bill, transaction));
  };

  const getStatementStatus = (
    reconciledTransactions: number,
    totalTransactions: number
  ): BankReconciliation['status'] => {
    if (reconciledTransactions === 0) return 'pending';
    if (reconciledTransactions === totalTransactions) return 'complete';
    return 'partial';
  };

  const hydrateStatementWithBillMatches = <T extends BankReconciliation>(statement: T): T => {
    const nextTransactions = statement.transactions.map((transaction) => {
      const matchedBill = findReconciledBill(transaction);
      if (matchedBill) {
        if (transaction.reconciled && transaction.reconciledWith === matchedBill.id && transaction.reconciledType === 'bill') {
          return transaction;
        }

        return {
          ...transaction,
          reconciled: true,
          reconciledWith: matchedBill.id,
          reconciledType: 'bill' as const,
        };
      }

      if (!transaction.reconciled && !transaction.reconciledWith && !transaction.reconciledType) {
        return transaction;
      }

      // Preserva conciliacoes previamente salvas quando o bill correspondente nao estiver no estado atual.
      return transaction;
    });

    const reconciledTransactions = nextTransactions.filter((item) => item.reconciled).length;
    const status = getStatementStatus(reconciledTransactions, nextTransactions.length);
    const changed =
      reconciledTransactions !== statement.reconciledTransactions ||
      status !== statement.status ||
      nextTransactions.some((transaction, index) => transaction !== statement.transactions[index]);

    if (!changed) return statement;

    return {
      ...statement,
      transactions: nextTransactions,
      reconciledTransactions,
      status,
    };
  };

  useEffect(() => {
    setReconciliation((current) => (current ? hydrateStatementWithBillMatches(current) : current));
  }, [bills, reconciliation?.id]);

  const getDateDiffInDays = (a: string, b: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(a) || !/^\d{4}-\d{2}-\d{2}$/.test(b)) return Number.POSITIVE_INFINITY;
    const first = new Date(`${a}T12:00:00`).getTime();
    const second = new Date(`${b}T12:00:00`).getTime();
    return Math.abs(Math.round((first - second) / (1000 * 60 * 60 * 24)));
  };

  const scoreBillMatch = (transaction: BankTransaction, bill: Bill) => {
    let score = 0;
    const targetAmount = getBillOutstandingAmount(bill) || bill.amount;
    const amountDiff = Math.abs(transaction.amount - targetAmount);
    const supplierName = normalizeText(getSupplierName(bill.supplierId));
    const billDescription = normalizeText(bill.description);
    const transactionDescription = normalizeText(`${transaction.description} ${transaction.counterparty || ''}`);
    const transactionDocument = normalizeText(transaction.document);
    const supplierDocument = normalizeText(suppliers.find((supplier) => supplier.id === bill.supplierId)?.taxId);

    if (amountDiff < 0.01) score += 60;
    else if (amountDiff <= 1) score += 35;
    else if (amountDiff <= 5) score += 20;

    const dateDiff = getDateDiffInDays(transaction.date, bill.dueDate);
    if (dateDiff <= 2) score += 25;
    else if (dateDiff <= 7) score += 15;
    else if (dateDiff <= 15) score += 8;

    if (supplierName && transactionDescription.includes(supplierName)) score += 30;
    if (supplierDocument && transactionDocument && transactionDocument.includes(supplierDocument)) score += 35;

    const descriptionTokens = Array.from(
      new Set(
        billDescription
          .split(' ')
          .filter((token) => token.length >= 4)
      )
    );
    const overlap = descriptionTokens.filter((token) => transactionDescription.includes(token)).length;
    score += Math.min(overlap * 6, 24);

    return score;
  };

  const getSuggestedBills = (transaction: BankTransaction): MatchSuggestion[] =>
    availableBills
      .map((bill) => ({
        bill,
        score: scoreBillMatch(transaction, bill),
        supplierName: getSupplierName(bill.supplierId),
      }))
      .filter((suggestion) => suggestion.score > 0)
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return a.bill.dueDate.localeCompare(b.bill.dueDate);
      })
      .slice(0, 5);

  const markTransactionAsReconciled = (transaction: BankTransaction, bill: Bill) => {
    setReconciliation((current) => {
      if (!current) return current;

      const nextTransactions = current.transactions.map((item) =>
        item.id === transaction.id
          ? {
              ...item,
              reconciled: true,
              reconciledWith: bill.id,
              reconciledType: 'bill' as const,
              reconciledAt: new Date().toISOString(),
              reconciledBy: user.email,
            }
          : item
      );

      const reconciledTransactions = nextTransactions.filter((item) => item.reconciled).length;
      return {
        ...current,
        transactions: nextTransactions,
        reconciledTransactions,
        status:
          reconciledTransactions === 0
            ? 'pending'
            : reconciledTransactions === nextTransactions.length
              ? 'complete'
              : 'partial',
      };
    });
  };

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const lowerName = file.name.toLowerCase();
    const isSupported =
      lowerName.endsWith('.ret') ||
      lowerName.endsWith('.txt') ||
      lowerName.endsWith('.csv') ||
      lowerName.endsWith('.pdf');
    if (!isSupported) {
      setSelectedFile(null);
      setError('Suba o extrato em .RET, .TXT, .CSV ou .PDF para continuar a conciliacao.');
      return;
    }

    setSelectedFile(file);
    setError('');
    setSuccess('');
    setIsCurrentStatementSaved(false);
  };

  const handleUpload = async () => {
    if (!selectedFile) {
      setError('Selecione um arquivo primeiro.');
      return;
    }

    setLoading(true);
    setError('');
    setSuccess('');

    try {
      const isPdf = selectedFile.name.toLowerCase().endsWith('.pdf');
      const fileContent = isPdf ? await selectedFile.arrayBuffer() : await selectedFile.text();
      const parsed = await parseUniversalBankExtract(fileContent, selectedFile.name, user.email);

      applyStatementToScreen(parsed);
      setIsCurrentStatementSaved(false);
      setSuccess(`Extrato processado com ${parsed.totalTransactions} transacoes. Agora siga o passo 3 para salvar a versao atualizada.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao processar arquivo. Verifique se o extrato esta em .RET, .TXT, .CSV ou .PDF.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const applyStatementToScreen = (statement: BankReconciliation) => {
    const hydratedStatement = hydrateStatementWithBillMatches(statement);

    setReconciliation(hydratedStatement);
    setStartDate(hydratedStatement.startDate);
    setEndDate(hydratedStatement.endDate);
    setExpandedTransactionId(null);
    setSelectedBillByTransaction({});

    try {
      localStorage.setItem(CURRENT_STATEMENT_STORAGE_KEY, JSON.stringify(hydratedStatement));
    } catch (err) {
      console.error('Nao foi possivel manter o extrato atual em cache local.', err);
    }
  };

  const applySavedStatementGroupToScreen = (statementGroup: {
    combinedStatement: StoredBankReconciliation;
  }) => {
    applyStatementToScreen(statementGroup.combinedStatement);
    setSelectedFile(null);
    setIsCurrentStatementSaved(true);
  };

  const loadSavedStatements = async () => {
    setLoadingSavedStatements(true);
    try {
      const statements = await listSavedBankReconciliations();
      setSavedStatements(statements);
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingSavedStatements(false);
    }
  };

  useEffect(() => {
    loadSavedStatements();
  }, []);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(CURRENT_STATEMENT_STORAGE_KEY);
      if (!raw) return;
      const cachedStatement = JSON.parse(raw) as BankReconciliation;
      if (!cachedStatement?.transactions?.length) return;
      applyStatementToScreen(cachedStatement);
      setIsCurrentStatementSaved(true);
    } catch (err) {
      console.error('Nao foi possivel restaurar o extrato atual do cache local.', err);
    }
  }, []);

  useEffect(() => {
    if (!reconciliation) return;

    try {
      localStorage.setItem(CURRENT_STATEMENT_STORAGE_KEY, JSON.stringify(reconciliation));
    } catch (err) {
      console.error('Nao foi possivel sincronizar o extrato atual no cache local.', err);
    }
  }, [reconciliation]);

  const handleSaveStatement = async () => {
    if (!reconciliation) {
      setError('Processe um extrato antes de salvar.');
      return;
    }

    setSaving(true);
    setError('');
    setSuccess('');

    try {
      const saved = await saveBankReconciliationVersion(reconciliation);
      const savedMonths = saved.monthlyResults
        .filter(result => result.status === 'saved')
        .map(result => formatMonthKeyLabel(result.monthKey));
      const skippedMonths = saved.monthlyResults
        .filter(result => result.status === 'skipped_closed_month')
        .map(result => formatMonthKeyLabel(result.monthKey));

      setIsCurrentStatementSaved(saved.savedCount > 0 || saved.skippedCount > 0);
      setSelectedFile(null);
      await loadSavedStatements();

      if (saved.savedCount > 0 && saved.skippedCount > 0) {
        setSuccess(
          `Extrato salvo por competencia mensal. Meses atualizados: ${savedMonths.join(', ')}. Meses mantidos por estarem encerrados: ${skippedMonths.join(', ')}.`
        );
      } else if (saved.savedCount > 0) {
        setSuccess(`Extrato salvo por competencia mensal: ${savedMonths.join(', ')}.`);
      } else if (saved.skippedCount > 0) {
        setSuccess(`Nenhum mes foi sobrescrito. Meses encerrados mantidos: ${skippedMonths.join(', ')}.`);
      } else {
        setSuccess('Nenhum mes elegivel para salvamento foi encontrado neste arquivo.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nao foi possivel salvar o extrato.');
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  const fmt = (value: number) =>
    Number.isFinite(value)
      ? value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
      : 'R$ 0,00';

  const formatDate = (dateStr: string) => {
    if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return '-';
    const [year, month, day] = dateStr.split('-');
    return `${day}/${month}/${year}`;
  };

  const formatMonthLabel = (dateStr: string) => {
    if (!/^\d{4}-\d{2}$/.test(dateStr)) return 'Periodo invalido';
    const [year, month] = dateStr.split('-');
    const monthDate = new Date(Number(year), Number(month) - 1, 1);
    if (Number.isNaN(monthDate.getTime())) return 'Periodo invalido';
    return monthDate.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  };

  const formatMonthKeyLabel = (monthKey: string) => formatMonthLabel(monthKey);

  const isValidIsoDate = (dateStr: string) => /^\d{4}-\d{2}-\d{2}$/.test(dateStr);
  const getStatementGroupKey = (statement: StoredBankReconciliation) => getStatementAccountGroupKey(statement);

  const parseAmountFilter = (value: string) => {
    if (!value.trim()) return null;
    const normalized = value.replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, '');
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const minAmount = parseAmountFilter(minAmountFilter);
  const maxAmount = parseAmountFilter(maxAmountFilter);

  const filteredTransactions = reconciliation?.transactions
    .filter(transaction => {
      const normalizedSearch = searchTerm.toLowerCase();
      const matchesSearch =
        transaction.description.toLowerCase().includes(normalizedSearch) ||
        transaction.counterparty?.toLowerCase().includes(normalizedSearch) ||
        transaction.reference?.toLowerCase().includes(normalizedSearch);
      const matchesType = typeFilter === 'ALL' || transaction.type === typeFilter;
      const matchesDate = (!startDate || transaction.date >= startDate) && (!endDate || transaction.date <= endDate);
      const matchesMinAmount = minAmount === null || transaction.amount >= minAmount;
      const matchesMaxAmount = maxAmount === null || transaction.amount <= maxAmount;
      return matchesSearch && matchesType && matchesDate && matchesMinAmount && matchesMaxAmount;
    })
    .sort((a, b) => b.date.localeCompare(a.date)) || [];

  const totalCredits = filteredTransactions
    .filter(transaction => transaction.type === 'CREDIT')
    .reduce((sum, transaction) => sum + (Number.isFinite(transaction.amount) ? transaction.amount : 0), 0);
  const totalDebits = filteredTransactions
    .filter(transaction => transaction.type === 'DEBIT')
    .reduce((sum, transaction) => sum + (Number.isFinite(transaction.amount) ? transaction.amount : 0), 0);
  const balance = totalCredits - totalDebits;

  const groupedTransactions = filteredTransactions.reduce((groups, transaction) => {
    const dateKey = isValidIsoDate(transaction.date) ? transaction.date : 'sem-data';
    const key = periodGrouping === 'day'
      ? dateKey
      : (dateKey === 'sem-data' ? dateKey : dateKey.slice(0, 7));
    const existingGroup = groups[key] || {
      key,
      label: key === 'sem-data'
        ? 'Sem data valida'
        : (periodGrouping === 'day' ? formatDate(transaction.date) : formatMonthLabel(dateKey.slice(0, 7))),
      transactions: [],
      credits: 0,
      debits: 0,
    };

    existingGroup.transactions.push(transaction);
    if (transaction.type === 'CREDIT') {
      existingGroup.credits += Number.isFinite(transaction.amount) ? transaction.amount : 0;
    } else {
      existingGroup.debits += Number.isFinite(transaction.amount) ? transaction.amount : 0;
    }

    groups[key] = existingGroup;
    return groups;
  }, {} as Record<string, { key: string; label: string; transactions: typeof filteredTransactions; credits: number; debits: number }>);

  const groupedTransactionList = Object.values(groupedTransactions)
    .map(group => ({
      ...group,
      balance: group.credits - group.debits,
      transactions: group.transactions.sort((a, b) => b.date.localeCompare(a.date)),
    }))
    .sort((a, b) => b.key.localeCompare(a.key));

  const savedStatementGroups = Object.values(
    savedStatements.reduce((groups, statement) => {
      const groupKey = getStatementGroupKey(statement);
      if (!groups[groupKey]) {
        groups[groupKey] = [];
      }
      groups[groupKey].push(statement);
      return groups;
    }, {} as Record<string, StoredBankReconciliation[]>)
  ).map((statements) => {
    const hydratedStatements = statements.map((statement) => hydrateStatementWithBillMatches(statement));
    const statementsByMonth = [...hydratedStatements].sort((a, b) => a.startDate.localeCompare(b.startDate));
    const latestStatement = [...hydratedStatements].sort((a, b) => {
      const uploadedDiff = (b.uploadedAt || '').localeCompare(a.uploadedAt || '');
      return uploadedDiff !== 0 ? uploadedDiff : b.endDate.localeCompare(a.endDate);
    })[0];
    const firstStatement = statementsByMonth[0];
    const lastStatement = statementsByMonth[statementsByMonth.length - 1];
    const combinedTransactions = statementsByMonth
      .flatMap((statement) => statement.transactions)
      .sort((a, b) => a.date.localeCompare(b.date));
    const reconciledTransactions = combinedTransactions.filter((transaction) => transaction.reconciled).length;
    const combinedStatement: StoredBankReconciliation = {
      ...latestStatement,
      id: `${getStatementGroupKey(latestStatement)}__ativo`,
      periodKey: `${getStatementGroupKey(latestStatement)}__ativo`,
      statementMonth: lastStatement.statementMonth,
      startDate: firstStatement.startDate,
      endDate: lastStatement.endDate,
      initialBalance: firstStatement.initialBalance,
      finalBalance: lastStatement.finalBalance,
      totalTransactions: combinedTransactions.length,
      reconciledTransactions,
      transactions: combinedTransactions,
      status:
        reconciledTransactions === 0
          ? 'pending'
          : reconciledTransactions === combinedTransactions.length
            ? 'complete'
            : 'partial',
    };

    return {
      groupKey: getStatementGroupKey(latestStatement),
      latestStatement,
      statements: statementsByMonth,
      combinedStatement,
    };
  }).sort((a, b) => {
    const uploadedDiff = (b.latestStatement.uploadedAt || '').localeCompare(a.latestStatement.uploadedAt || '');
    return uploadedDiff !== 0 ? uploadedDiff : b.latestStatement.endDate.localeCompare(a.latestStatement.endDate);
  });

  const latestSavedStatementGroup = savedStatementGroups[0] || null;

  useEffect(() => {
    if (!latestSavedStatementGroup) return;
    if (selectedFile) return;

    const latestSavedId = latestSavedStatementGroup.combinedStatement.id;
    const currentId = reconciliation?.id;
    const shouldAutoOpen = !currentId || isCurrentStatementSaved;

    if (shouldAutoOpen && currentId !== latestSavedId) {
      applySavedStatementGroupToScreen(latestSavedStatementGroup);
    }
  }, [latestSavedStatementGroup, selectedFile, reconciliation?.id, isCurrentStatementSaved]);

  const openTransactionPanel = (transaction: BankTransaction) => {
    const suggestions = getSuggestedBills(transaction);
    const matchedSupplier = findSupplierForTransaction(transaction);
    setExpandedTransactionId((current) => (current === transaction.id ? null : transaction.id));
    setSelectedBillByTransaction((current) => ({
      ...current,
      [transaction.id]: current[transaction.id] || suggestions[0]?.bill.id || availableBills[0]?.id || '',
    }));
    setSelectedAccountByTransaction((current) => ({
      ...current,
      [transaction.id]:
        current[transaction.id] ||
        suggestions[0]?.bill.accountId ||
        matchedSupplier?.accountId ||
        accounts[0]?.id ||
        '',
    }));
  };

  const handleReconcileTransaction = async (transaction: BankTransaction) => {
    const selectedBillId = selectedBillByTransaction[transaction.id];
    const bill = availableBills.find((item) => item.id === selectedBillId);
    if (!bill) {
      setError('Selecione uma conta para conciliar este debito.');
      return;
    }

    setReconcilingTransactionId(transaction.id);
    setError('');
    setSuccess('');

    try {
      const currentPaidAmount = getBillDisplayPaidAmount(bill) || 0;
      const nextPaidAmount = currentPaidAmount + transaction.amount;
      const nextOutstandingAmount = Math.max(bill.amount - nextPaidAmount, 0);
      const willFullyPay = nextOutstandingAmount < 0.01;

      await onReconcileBill(transaction, bill);
      markTransactionAsReconciled(transaction, bill);
      setExpandedTransactionId(null);
      setSuccess(
        willFullyPay
          ? `Debito conciliado com sucesso. A conta "${bill.description}" foi quitada com o banco em ${formatDate(transaction.date)}.`
          : `Debito conciliado com sucesso. A conta "${bill.description}" ficou parcial. Ainda faltam ${fmt(nextOutstandingAmount)}.`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nao foi possivel conciliar a transacao com a conta selecionada.');
      console.error(err);
    } finally {
      setReconcilingTransactionId(null);
    }
  };

  const handleCreateBillTransaction = async (transaction: BankTransaction) => {
    const selectedAccountId = selectedAccountByTransaction[transaction.id];
    if (!selectedAccountId) {
      setError('Selecione o centro de custo antes de criar a conta a pagar.');
      return;
    }

    setCreatingBillTransactionId(transaction.id);
    setError('');
    setSuccess('');

    try {
      const createdBill = await onCreateBillFromTransaction(transaction, selectedAccountId);
      markTransactionAsReconciled(transaction, createdBill);
      setExpandedTransactionId(null);
      setSuccess(
        `Conta criada em Contas a Pagar a partir do extrato e ja marcada como paga em ${formatDate(transaction.date)}.`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nao foi possivel criar a conta a partir do extrato.');
      console.error(err);
    } finally {
      setCreatingBillTransactionId(null);
    }
  };

  const handleReopenTransaction = async (transaction: BankTransaction, bill?: Bill) => {
    setReconcilingTransactionId(transaction.id);
    setError('');
    setSuccess('');

    try {
      if (bill) {
        await onReopenReconciliation(transaction, bill);
      }

      setReconciliation((current) => {
        if (!current) return current;

        const nextTransactions = current.transactions.map((item) =>
          item.id === transaction.id
            ? {
                ...item,
                reconciled: false,
                reconciledWith: undefined,
                reconciledType: undefined,
                reconciledAt: undefined,
                reconciledBy: undefined,
              }
            : item
        );

        const reconciledTransactions = nextTransactions.filter((item) => item.reconciled).length;
        return {
          ...current,
          transactions: nextTransactions,
          reconciledTransactions,
          status:
            reconciledTransactions === 0
              ? 'pending'
              : reconciledTransactions === nextTransactions.length
                ? 'complete'
                : 'partial',
        };
      });

      setExpandedTransactionId(transaction.id);
      setSelectedBillByTransaction((current) => ({
        ...current,
        [transaction.id]: bill?.id || current[transaction.id] || '',
      }));
      setSuccess(
        bill
          ? `Conciliacao reaberta para o lancamento ${fmt(transaction.amount)}. Agora voce pode ajustar e conciliar novamente.`
          : `O vinculo salvo deste lancamento foi limpo. Agora voce pode conciliar novamente.`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nao foi possivel reabrir a conciliacao desta transacao.');
      console.error(err);
    } finally {
      setReconcilingTransactionId(null);
    }
  };

  const handleQuickCreateBill = async (transaction: BankTransaction) => {
    const matchedSupplier = findSupplierForTransaction(transaction);
    const supplierId = matchedSupplier?.id || '';
    const accountId = matchedSupplier?.accountId || '';

    setQuickCreatingBillId(transaction.id);
    setError('');
    setSuccess('');

    try {
      const createdBill = await onQuickCreateBillFromTransaction(transaction, supplierId, accountId);
      markTransactionAsReconciled(transaction, createdBill);
      setSuccess(
        matchedSupplier
          ? `Conta criada como paga. Fornecedor "${matchedSupplier.name}" identificado automaticamente.`
          : `Conta criada como paga. Fornecedor nao identificado — edite para preencher o fornecedor e centro de custo.`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nao foi possivel criar a conta a partir do extrato.');
    } finally {
      setQuickCreatingBillId(null);
    }
  };

  const handleBulkDelete = async () => {
    if (!bulkDeleteConfirm) {
      setBulkDeleteConfirm(true);
      return;
    }
    setBulkDeleting(true);
    setError('');
    setSuccess('');
    try {
      const count = await onBulkDeleteBillsByDateRange(bulkDeleteStartDate, bulkDeleteEndDate);
      setBulkDeleteConfirm(false);
      setSuccess(`${count} conta(s) excluida(s) com sucesso no periodo de ${formatDate(bulkDeleteStartDate)} a ${formatDate(bulkDeleteEndDate)}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao excluir contas. Tente novamente.');
      setBulkDeleteConfirm(false);
    } finally {
      setBulkDeleting(false);
    }
  };

  const renderTransactionRows = (transactions: BankTransaction[]) =>
    transactions.map((transaction) => {
      const reconciledBill = findReconciledBill(transaction);
      const hasSavedBillLink =
        transaction.type === 'DEBIT' &&
        transaction.reconciled &&
        transaction.reconciledType === 'bill' &&
        !reconciledBill;
      const suggestions = transaction.type === 'DEBIT' ? getSuggestedBills(transaction) : [];
      const isExpanded = expandedTransactionId === transaction.id;
      const selectedBillId = selectedBillByTransaction[transaction.id] || '';
      const selectedBill = availableBills.find((item) => item.id === selectedBillId);

      const selectable = isTransactionSelectable(transaction);
      const isSelected = selectedTxIds.has(transaction.id);

      return (
        <React.Fragment key={transaction.id}>
          <tr className={`hover:bg-slate-50 transition-colors ${isSelected ? 'bg-indigo-50' : ''}`}>
            <td className="px-2 py-3 w-8">
              {selectable && (
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => toggleTxSelection(transaction.id)}
                  className="w-4 h-4 rounded accent-indigo-600 cursor-pointer"
                />
              )}
            </td>
            <td className="px-4 py-3 text-sm whitespace-nowrap text-slate-700 font-semibold">
              {formatDate(transaction.date)}
            </td>
            <td className="px-4 py-3 text-sm">
              <p className="font-semibold text-slate-800">{transaction.description}</p>
              {transaction.counterparty && (
                <p className="text-xs text-indigo-700 mt-0.5 font-semibold">
                  Favorecido/Fornecedor: {transaction.counterparty}
                </p>
              )}
              {transaction.reference && (
                <p className="text-xs text-slate-500 mt-0.5">Ref: {transaction.reference}</p>
              )}
              {transaction.document && (
                <p className="text-xs text-slate-400 mt-0.5">Doc: {transaction.document}</p>
              )}
            </td>
            <td className="px-4 py-3 text-center">
              {transaction.type === 'CREDIT' ? (
                <span className="inline-flex items-center gap-1 text-xs font-bold text-green-700 bg-green-100 px-3 py-1 rounded-full">
                  <TrendingUp size={12} /> Credito
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-xs font-bold text-red-700 bg-red-100 px-3 py-1 rounded-full">
                  <TrendingDown size={12} /> Debito
                </span>
              )}
            </td>
            <td className={`px-4 py-3 text-right text-sm font-black ${transaction.type === 'CREDIT' ? 'text-green-600' : 'text-red-600'}`}>
              {transaction.type === 'CREDIT' ? '+' : '-'} {fmt(transaction.amount)}
            </td>
            <td className="px-4 py-3 text-right align-top">
              {transaction.type !== 'DEBIT' ? (
                <span className="text-xs font-semibold text-slate-400">Nao aplicavel</span>
              ) : reconciledBill ? (
                <div className="inline-flex flex-col items-end gap-1">
                  {isBillPartiallyPaid(reconciledBill) ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-700">
                      <CheckCircle size={12} /> Parcial
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-700">
                      <CheckCircle size={12} /> Conciliado
                    </span>
                  )}
                  <span className="text-[11px] text-slate-500 max-w-[220px] text-right">
                    {reconciledBill.description}
                  </span>
                  {isBillPartiallyPaid(reconciledBill) && (
                    <span className="text-[11px] text-amber-700 max-w-[220px] text-right font-semibold">
                      Falta {fmt(getBillOutstandingAmount(reconciledBill))}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => handleReopenTransaction(transaction, reconciledBill)}
                    disabled={reconcilingTransactionId === transaction.id}
                    className="mt-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-[11px] font-bold text-amber-700 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {reconcilingTransactionId === transaction.id ? 'Reabrindo...' : 'Reabrir conciliacao'}
                  </button>
                </div>
              ) : hasSavedBillLink ? (
                <div className="inline-flex flex-col items-end gap-1">
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-700">
                    <CheckCircle size={12} /> Conciliado
                  </span>
                  <span className="text-[11px] text-slate-500 max-w-[220px] text-right">
                    Conta vinculada nao encontrada. Reabra para conciliar novamente.
                  </span>
                  <button
                    type="button"
                    onClick={() => handleReopenTransaction(transaction)}
                    disabled={reconcilingTransactionId === transaction.id}
                    className="mt-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-[11px] font-bold text-amber-700 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {reconcilingTransactionId === transaction.id ? 'Reabrindo...' : 'Reabrir conciliacao'}
                  </button>
                </div>
              ) : (
                <div className="inline-flex flex-col items-end gap-1.5">
                  <button
                    onClick={() => handleQuickCreateBill(transaction)}
                    disabled={quickCreatingBillId === transaction.id}
                    className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
                  >
                    <PlusCircle size={12} />
                    {quickCreatingBillId === transaction.id ? 'Criando...' : 'Criar Conta'}
                  </button>
                  <button
                    onClick={() => openTransactionPanel(transaction)}
                    className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-bold text-indigo-700 hover:bg-indigo-100"
                  >
                    {isExpanded ? 'Fechar' : 'Conciliar conta'}
                  </button>
                </div>
              )}
            </td>
          </tr>

          {transaction.type === 'DEBIT' && isExpanded && !reconciledBill && (
            <tr className="bg-slate-50/70">
              <td colSpan={6} className="px-4 py-4">
                <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-4">
                  <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                    <div>
                      <p className="text-sm font-bold text-slate-800">Conciliar este debito com Contas a Pagar</p>
                      <p className="text-xs text-slate-500">
                        Sugestoes por valor, data de vencimento, nome do fornecedor e favorecido do extrato.
                      </p>
                    </div>
                    <div className="text-sm font-black text-red-600">{fmt(transaction.amount)}</div>
                  </div>

                  {suggestions.length > 0 && (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      {suggestions.slice(0, 3).map((suggestion) => (
                        <button
                          key={suggestion.bill.id}
                          type="button"
                          onClick={() =>
                            setSelectedBillByTransaction((current) => ({
                              ...current,
                              [transaction.id]: suggestion.bill.id,
                            }))
                          }
                          className={`rounded-xl border px-3 py-3 text-left transition-all ${
                            selectedBillId === suggestion.bill.id
                              ? 'border-indigo-300 bg-indigo-50'
                              : 'border-slate-200 bg-white hover:border-slate-300'
                          }`}
                        >
                          <p className="text-xs font-bold uppercase text-slate-400">Sugestao {suggestion.score}%</p>
                          <p className="mt-1 text-sm font-bold text-slate-800">{suggestion.supplierName || 'Fornecedor nao identificado'}</p>
                          <p className="text-sm text-slate-600">{suggestion.bill.description}</p>
                          {transaction.counterparty && (
                            <p className="text-xs text-indigo-700 mt-1">Extrato: {transaction.counterparty}</p>
                          )}
                          <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
                            <span>Venc. {formatDate(suggestion.bill.dueDate)}</span>
                            <span>{fmt(getBillOutstandingAmount(suggestion.bill) || suggestion.bill.amount)}</span>
                          </div>
                          {isBillPartiallyPaid(suggestion.bill) && (
                            <p className="mt-2 text-xs font-semibold text-amber-700">
                              Parcial: pago {fmt(getBillDisplayPaidAmount(suggestion.bill) || 0)} de {fmt(suggestion.bill.amount)}
                            </p>
                          )}
                        </button>
                      ))}
                    </div>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3 items-end">
                    <div>
                      <label className="block text-xs font-bold uppercase text-slate-400 mb-2">
                        Selecionar conta
                      </label>
                      <select
                        value={selectedBillId}
                        onChange={(event) =>
                          setSelectedBillByTransaction((current) => ({
                            ...current,
                            [transaction.id]: event.target.value,
                          }))
                        }
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      >
                        <option value="">Selecione uma conta em aberto</option>
                        {availableBills.map((bill) => (
                          <option key={bill.id} value={bill.id}>
                            {formatDate(bill.dueDate)} | {getSupplierName(bill.supplierId) || 'Fornecedor'} | {bill.description} | aberto {fmt(getBillOutstandingAmount(bill) || bill.amount)}
                          </option>
                        ))}
                      </select>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleReconcileTransaction(transaction)}
                      disabled={!selectedBillId || reconcilingTransactionId === transaction.id}
                      className="rounded-xl px-4 py-2.5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
                      style={{ backgroundColor: theme.colors.primary.purple }}
                    >
                      {reconcilingTransactionId === transaction.id ? 'Conciliando...' : 'Confirmar conciliacao'}
                    </button>
                  </div>

                  {selectedBill && (
                    <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                        <div>
                          <p className="text-sm font-bold text-slate-800">{selectedBill.description}</p>
                          <p className="text-xs text-slate-500">
                            {getSupplierName(selectedBill.supplierId) || 'Fornecedor'} • vencimento {formatDate(selectedBill.dueDate)}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          {isBillPartiallyPaid(selectedBill) && (
                            <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-700">
                              Parcial
                            </span>
                          )}
                          {!isBillPartiallyPaid(selectedBill) && (
                            <span className="rounded-full bg-slate-200 px-3 py-1 text-xs font-bold text-slate-700">
                              Em aberto
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
                        <div>
                          <p className="text-[11px] font-bold uppercase text-slate-400">Valor previsto</p>
                          <p className="text-sm font-black text-slate-800">{fmt(selectedBill.amount)}</p>
                        </div>
                        <div>
                          <p className="text-[11px] font-bold uppercase text-slate-400">Ja pago</p>
                          <p className="text-sm font-black text-emerald-600">{fmt(getBillDisplayPaidAmount(selectedBill) || 0)}</p>
                        </div>
                        <div>
                          <p className="text-[11px] font-bold uppercase text-slate-400">Saldo restante</p>
                          <p className="text-sm font-black text-amber-700">{fmt(getBillOutstandingAmount(selectedBill) || selectedBill.amount)}</p>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/80 px-4 py-4 space-y-3">
                    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                      <div>
                        <p className="text-sm font-bold text-slate-800">Nao encontrou a conta?</p>
                        <p className="text-xs text-slate-500">
                          Crie esta despesa diretamente em Contas a Pagar usando o proprio lancamento do banco.
                        </p>
                      </div>
                      <span className="text-xs font-semibold text-slate-500">
                        Vai nascer como paga pelo banco
                      </span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3 items-end">
                      <div>
                        <label className="block text-xs font-bold uppercase text-slate-400 mb-2">
                          Centro de custo da nova conta
                        </label>
                        <select
                          value={selectedAccountByTransaction[transaction.id] || ''}
                          onChange={(event) =>
                            setSelectedAccountByTransaction((current) => ({
                              ...current,
                              [transaction.id]: event.target.value,
                            }))
                          }
                          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                        >
                          <option value="">Selecione um centro de custo</option>
                          {accounts.map((account) => (
                            <option key={account.id} value={account.id}>
                              {account.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleCreateBillTransaction(transaction)}
                        disabled={!selectedAccountByTransaction[transaction.id] || creatingBillTransactionId === transaction.id}
                        className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-bold text-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {creatingBillTransactionId === transaction.id ? 'Criando...' : 'Criar em Contas a Pagar'}
                      </button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                      <div className="rounded-lg bg-white border border-slate-200 px-3 py-2">
                        <p className="font-bold text-slate-400 uppercase">Descricao</p>
                        <p className="mt-1 font-semibold text-slate-700">
                          {transaction.counterparty || transaction.description}
                        </p>
                      </div>
                      <div className="rounded-lg bg-white border border-slate-200 px-3 py-2">
                        <p className="font-bold text-slate-400 uppercase">Conta sugerida</p>
                        <p className="mt-1 font-semibold text-slate-700">
                          {getAccountName(selectedAccountByTransaction[transaction.id] || '') || 'Nao selecionado'}
                        </p>
                      </div>
                      <div className="rounded-lg bg-white border border-slate-200 px-3 py-2">
                        <p className="font-bold text-slate-400 uppercase">Valor pago</p>
                        <p className="mt-1 font-semibold text-emerald-600">{fmt(transaction.amount)}</p>
                      </div>
                    </div>
                  </div>

                  {suggestions.length === 0 && (
                    <div className="rounded-lg border border-dashed border-slate-200 px-4 py-3 text-sm text-slate-500">
                      Nenhuma sugestao forte encontrada. Voce ainda pode escolher manualmente a conta em aberto.
                    </div>
                  )}
                </div>
              </td>
            </tr>
          )}
        </React.Fragment>
      );
    });

  const selectedTxList = (reconciliation?.transactions ?? []).filter((tx) => selectedTxIds.has(tx.id));
  const selectedTotal = selectedTxList.reduce((s, tx) => s + tx.amount, 0);

  const groupBillCandidates = availableBills
    .filter((b) =>
      groupBillSearch
        ? normalizeText(b.description).includes(normalizeText(groupBillSearch)) ||
          normalizeText(getSupplierName(b.supplierId)).includes(normalizeText(groupBillSearch))
        : true
    )
    .sort((a, b) => Math.abs(a.amount - selectedTotal) - Math.abs(b.amount - selectedTotal));

  if (!user.permissions?.reconciliation) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <AlertCircle size={48} className="mx-auto text-amber-500 mb-4" />
          <p className="text-slate-600 font-bold">Voce nao tem permissao para acessar o Extrato Bancario</p>
          <p className="text-slate-400 text-sm mt-2">Entre em contato com o administrador</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-12">

      {/* ── Modal de conciliação em grupo ─────────────────────────────────────── */}
      {groupModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50">
              <div className="flex items-center gap-2">
                <Layers size={18} className="text-indigo-600" />
                <h2 className="font-black text-slate-800">Conciliar {selectedTxList.length} lançamento(s) com conta</h2>
              </div>
              <button onClick={() => setGroupModalOpen(false)} className="text-slate-400 hover:text-slate-700">
                <X size={20} />
              </button>
            </div>

            <div className="px-6 py-4 space-y-4 max-h-[70vh] overflow-y-auto">
              <div className="rounded-xl bg-indigo-50 border border-indigo-200 p-3 space-y-1">
                <p className="text-xs font-bold text-indigo-600 uppercase tracking-widest mb-2">Lançamentos selecionados</p>
                {selectedTxList.map((tx) => (
                  <div key={tx.id} className="flex justify-between text-sm">
                    <span className="text-slate-700 truncate max-w-[260px]">{tx.counterparty || tx.description}</span>
                    <span className="font-bold text-red-600 ml-2 shrink-0">- {fmt(tx.amount)}</span>
                  </div>
                ))}
                <div className="flex justify-between text-sm font-black pt-2 border-t border-indigo-200 mt-2">
                  <span className="text-slate-800">Total</span>
                  <span className="text-red-700">- {fmt(selectedTotal)}</span>
                </div>
              </div>

              <div>
                <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2">Escolha a conta a pagar</p>
                <input
                  type="text"
                  placeholder="Buscar por descrição ou fornecedor..."
                  value={groupBillSearch}
                  onChange={(e) => setGroupBillSearch(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 mb-3"
                />
                <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
                  {groupBillCandidates.slice(0, 20).map((bill) => {
                    const diff = Math.abs(bill.amount - selectedTotal);
                    const match = diff < 0.01;
                    const close = diff <= bill.amount * 0.05;
                    return (
                      <button
                        key={bill.id}
                        type="button"
                        onClick={() => setGroupBillId(bill.id)}
                        className={`w-full text-left rounded-xl border px-3 py-2.5 transition-all ${
                          groupBillId === bill.id
                            ? 'border-indigo-400 bg-indigo-50'
                            : match
                            ? 'border-emerald-300 bg-emerald-50 hover:bg-emerald-100'
                            : 'border-slate-200 bg-white hover:border-slate-300'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-sm font-bold text-slate-800 truncate">{bill.description}</p>
                            <p className="text-xs text-slate-500">{getSupplierName(bill.supplierId) || 'Sem fornecedor'} · vence {formatDate(bill.dueDate)}</p>
                          </div>
                          <div className="shrink-0 text-right">
                            <p className={`text-sm font-black ${match ? 'text-emerald-700' : 'text-slate-700'}`}>{fmt(bill.amount)}</p>
                            {match && <span className="text-[10px] font-bold text-emerald-600 bg-emerald-100 px-1.5 py-0.5 rounded-full">✓ bate</span>}
                            {!match && close && <span className="text-[10px] font-bold text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded-full">~próximo</span>}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                  {groupBillCandidates.length === 0 && (
                    <p className="text-sm text-slate-400 text-center py-4">Nenhuma conta encontrada.</p>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-200 bg-slate-50">
              <button
                onClick={() => { setGroupModalOpen(false); setGroupBillId(''); setGroupBillSearch(''); }}
                className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 font-bold text-sm hover:bg-slate-100"
              >
                Cancelar
              </button>
              <button
                onClick={handleGroupReconcile}
                disabled={!groupBillId || groupReconciling}
                className="px-5 py-2 rounded-xl bg-indigo-600 text-white font-bold text-sm hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                <CheckCircle size={16} />
                {groupReconciling ? 'Conciliando...' : 'Confirmar Conciliação'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Barra de seleção múltipla ─────────────────────────────────────────── */}
      {selectedTxIds.size > 0 && (
        <div className="sticky top-0 z-20 flex items-center justify-between gap-4 rounded-2xl border border-indigo-300 bg-indigo-600 px-5 py-3 shadow-lg text-white">
          <div className="flex items-center gap-3">
            <Layers size={18} />
            <span className="font-black text-sm">
              {selectedTxIds.size} lançamento(s) selecionado(s) · <span className="text-indigo-200">- {fmt(selectedTotal)}</span>
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSelectedTxIds(new Set())}
              className="px-3 py-1.5 rounded-lg border border-indigo-400 text-indigo-100 text-xs font-bold hover:bg-indigo-700"
            >
              Limpar seleção
            </button>
            <button
              onClick={() => { setGroupBillId(''); setGroupBillSearch(''); setGroupModalOpen(true); }}
              className="px-4 py-1.5 rounded-lg bg-white text-indigo-700 text-xs font-black hover:bg-indigo-50 flex items-center gap-1.5"
            >
              <CheckCircle size={14} /> Conciliar com conta ▶
            </button>
          </div>
        </div>
      )}

      <div>
        <h1 className="text-4xl font-black tracking-tight" style={{ color: theme.colors.neutral.black }}>
          Extrato Bancario
        </h1>
        <p className="text-slate-600 font-semibold text-sm mt-1">
          Suba o extrato em .RET, .TXT, .CSV ou .PDF e siga os passos 1, 2 e 3 para atualizar o extrato do banco.
        </p>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
        <h2 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
          <Upload size={20} style={{ color: theme.colors.primary.purple }} />
          Importar Extrato
        </h2>

        <div className="space-y-4">
          <div className="border-2 border-dashed border-slate-300 rounded-xl p-6 text-center hover:border-indigo-400 transition-colors">
            <input
              type="file"
              accept=".ret,.txt,.csv,.pdf"
              onChange={handleFileSelect}
              className="hidden"
              id="file-upload"
            />
            <label htmlFor="file-upload" className="cursor-pointer">
              <FileText size={40} className="mx-auto text-slate-400 mb-3" />
              <p className="text-slate-700 font-semibold mb-1">
                {selectedFile ? `1. Arquivo selecionado: ${selectedFile.name}` : '1. Clique para selecionar o extrato'}
              </p>
              <p className="text-slate-400 text-xs">
                Aceita .RET, .TXT, .CSV e .PDF. Para conciliacao, CSV e PDF costumam trazer mais detalhe do favorecido.
              </p>
            </label>
          </div>

          <p className="text-xs text-slate-500">
            Meses encerrados nao sobrescrevem. O mes atual pode ser atualizado sem mexer nos meses anteriores.
          </p>

          {selectedFile && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <button
                onClick={handleUpload}
                disabled={loading}
                className="w-full text-white rounded-xl font-bold py-3 transition-all shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ backgroundColor: theme.colors.primary.purple }}
              >
                {loading ? '2. Processando...' : '2. Processar Extrato'}
              </button>

              <button
                onClick={handleSaveStatement}
                disabled={!reconciliation || saving || loading || isCurrentStatementSaved}
                className="w-full rounded-xl font-bold py-3 transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed border border-slate-200 bg-white text-slate-700 flex items-center justify-center gap-2"
              >
                <Save size={18} />
                {saving ? '3. Salvando...' : isCurrentStatementSaved ? '3. Extrato Salvo' : '3. Salvar Extrato'}
              </button>
            </div>
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

      <div className="bg-white rounded-2xl border border-amber-200 shadow-sm p-6">
        <h2 className="text-lg font-bold text-slate-800 mb-1 flex items-center gap-2">
          <Trash2 size={20} className="text-amber-600" />
          Limpar Lancamentos por Periodo
        </h2>
        <p className="text-sm text-slate-500 mb-4">
          Exclui contas a pagar com vencimento no intervalo selecionado. Use antes de reimportar lancamentos do extrato bancario.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-3 items-end">
          <div>
            <label className="block text-xs font-bold uppercase text-slate-400 mb-1">Data inicio</label>
            <input
              type="date"
              value={bulkDeleteStartDate}
              onChange={(e) => { setBulkDeleteStartDate(e.target.value); setBulkDeleteConfirm(false); }}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
            />
          </div>
          <div>
            <label className="block text-xs font-bold uppercase text-slate-400 mb-1">Data fim</label>
            <input
              type="date"
              value={bulkDeleteEndDate}
              onChange={(e) => { setBulkDeleteEndDate(e.target.value); setBulkDeleteConfirm(false); }}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
            />
          </div>
          <button
            onClick={handleBulkDelete}
            disabled={bulkDeleting || !bulkDeleteStartDate || !bulkDeleteEndDate}
            className={`rounded-xl px-4 py-2.5 text-sm font-bold disabled:opacity-50 disabled:cursor-not-allowed transition-colors ${
              bulkDeleteConfirm
                ? 'bg-red-600 text-white hover:bg-red-700'
                : 'border border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100'
            }`}
          >
            {bulkDeleting ? 'Excluindo...' : bulkDeleteConfirm ? 'Confirmar exclusao' : 'Excluir contas'}
          </button>
        </div>
        {bulkDeleteConfirm && (
          <div className="mt-3 rounded-lg bg-red-50 border border-red-200 p-3 flex items-start gap-2">
            <AlertCircle size={16} className="text-red-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-red-800 text-sm font-bold">Confirme a exclusao</p>
              <p className="text-red-700 text-xs mt-0.5">
                Todas as contas a pagar com vencimento entre {formatDate(bulkDeleteStartDate)} e {formatDate(bulkDeleteEndDate)} serao marcadas como excluidas. Esta acao nao pode ser desfeita. Clique novamente para confirmar.
              </p>
              <button onClick={() => setBulkDeleteConfirm(false)} className="mt-1 text-xs text-red-600 underline">
                Cancelar
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
        <div className="flex items-center justify-between gap-4 mb-4">
          <div>
            <h2 className="text-lg font-bold text-slate-800">Ultimo Extrato Salvo</h2>
            <p className="text-sm text-slate-500">Mostramos apenas o extrato ativo mais recente, sem exibir versoes antigas.</p>
          </div>
          <button
            onClick={loadSavedStatements}
            disabled={loadingSavedStatements}
            className="px-4 py-2 rounded-xl border border-slate-200 bg-white text-slate-700 font-semibold text-sm disabled:opacity-50"
          >
            {loadingSavedStatements ? 'Atualizando...' : 'Atualizar lista'}
          </button>
        </div>

        {!latestSavedStatementGroup ? (
          <div className="rounded-xl border border-dashed border-slate-200 px-4 py-6 text-sm text-slate-500 text-center">
            Nenhum extrato salvo ainda.
          </div>
        ) : (
          <div className="rounded-xl border border-slate-200 p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="font-bold text-slate-800">{latestSavedStatementGroup.latestStatement.fileName}</p>
                <span className="text-xs font-bold px-2 py-1 rounded-full bg-green-100 text-green-700">
                  Versao ativa
                </span>
                <span className="text-xs font-bold px-2 py-1 rounded-full bg-indigo-50 text-indigo-700">
                  v{latestSavedStatementGroup.latestStatement.version}
                </span>
              </div>
              <p className="text-sm text-slate-500">
                Periodo: {formatDate(latestSavedStatementGroup.combinedStatement.startDate)} ate {formatDate(latestSavedStatementGroup.combinedStatement.endDate)}
              </p>
              <p className="text-sm text-slate-500">
                Competencias ativas: {latestSavedStatementGroup.statements.length}
              </p>
              <p className="text-sm text-slate-500">
                Ultima competencia: {formatMonthKeyLabel(latestSavedStatementGroup.latestStatement.statementMonth)}
              </p>
              <p className="text-xs text-slate-400">
                Salvo em {new Date(latestSavedStatementGroup.latestStatement.uploadedAt).toLocaleString('pt-BR')}
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  applySavedStatementGroupToScreen(latestSavedStatementGroup);
                  setSuccess(
                    `Extrato salvo reaberto com ${latestSavedStatementGroup.statements.length} competencia(s) ativas.`
                  );
                  setError('');
                }}
                className="px-4 py-2 rounded-xl border border-slate-200 bg-white text-slate-700 font-semibold text-sm"
              >
                Abrir extrato salvo
              </button>
            </div>
          </div>
        )}
      </div>

      {reconciliation && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
              <div className="flex items-center gap-2 mb-2">
                <Calendar size={16} className="text-indigo-600" />
                <p className="text-xs font-bold text-slate-500 uppercase">Periodo</p>
              </div>
              <p className="text-sm font-bold text-slate-800">
                {formatDate(reconciliation.startDate)} ate {formatDate(reconciliation.endDate)}
              </p>
            </div>

            <div className="bg-white p-4 rounded-xl border border-green-200 shadow-sm">
              <div className="flex items-center gap-2 mb-2">
                <TrendingUp size={16} className="text-green-600" />
                <p className="text-xs font-bold text-slate-500 uppercase">Total Creditos</p>
              </div>
              <p className="text-lg font-black text-green-600">{fmt(totalCredits)}</p>
            </div>

            <div className="bg-white p-4 rounded-xl border border-red-200 shadow-sm">
              <div className="flex items-center gap-2 mb-2">
                <TrendingDown size={16} className="text-red-600" />
                <p className="text-xs font-bold text-slate-500 uppercase">Total Debitos</p>
              </div>
              <p className="text-lg font-black text-red-600">{fmt(totalDebits)}</p>
            </div>

            <div className="bg-white p-4 rounded-xl border border-blue-200 shadow-sm">
              <div className="flex items-center gap-2 mb-2">
                <DollarSign size={16} className="text-blue-600" />
                <p className="text-xs font-bold text-slate-500 uppercase">Saldo Periodo</p>
              </div>
              <p className={`text-lg font-black ${balance >= 0 ? 'text-blue-600' : 'text-red-600'}`}>
                {fmt(balance)}
              </p>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
            <div className="flex items-center gap-2 mb-4">
              <Filter size={18} style={{ color: theme.colors.primary.purple }} />
              <h3 className="font-bold text-slate-800">Filtros</h3>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-7 gap-4">
              <div className="relative">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Buscar por descricao..."
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
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
                onChange={(event) => setTypeFilter(event.target.value as 'ALL' | 'CREDIT' | 'DEBIT')}
                className="px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="ALL">Todos os tipos</option>
                <option value="CREDIT">Apenas creditos</option>
                <option value="DEBIT">Apenas debitos</option>
              </select>

              <select
                value={periodGrouping}
                onChange={(event) => setPeriodGrouping(event.target.value as 'none' | 'day' | 'month')}
                className="px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="month">Quebrar por mes</option>
                <option value="day">Quebrar por dia</option>
                <option value="none">Lista unica</option>
              </select>

              <input
                type="text"
                inputMode="decimal"
                placeholder="Valor min."
                value={minAmountFilter}
                onChange={(event) => setMinAmountFilter(event.target.value)}
                className="px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />

              <input
                type="text"
                inputMode="decimal"
                placeholder="Valor max."
                value={maxAmountFilter}
                onChange={(event) => setMaxAmountFilter(event.target.value)}
                className="px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />

              <input
                type="date"
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
                className="px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />

              <input
                type="date"
                value={endDate}
                onChange={(event) => setEndDate(event.target.value)}
                className="px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <div className="flex items-center gap-4 mt-3 text-xs text-slate-600">
              <span>{filteredTransactions.length} transacoes encontradas</span>
              <span>{periodGrouping === 'none' ? 'Sem quebra por periodo' : `${groupedTransactionList.length} periodos exibidos`}</span>
              <span>{availableBills.length} contas em aberto disponiveis para conciliacao</span>
              {(searchTerm || typeFilter !== 'ALL' || minAmountFilter || maxAmountFilter || startDate !== reconciliation.startDate || endDate !== reconciliation.endDate) && (
                <button
                  onClick={() => {
                    setSearchTerm('');
                    setTypeFilter('ALL');
                    setMinAmountFilter('');
                    setMaxAmountFilter('');
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

          <div className="space-y-4">
            {filteredTransactions.length === 0 && (
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-12 text-center">
                <FileText size={48} className="mx-auto text-slate-300 mb-3" />
                <p className="text-slate-500 font-semibold">Nenhuma transacao encontrada</p>
                <p className="text-sm text-slate-400 mt-1">Ajuste os filtros para ver mais resultados</p>
              </div>
            )}

            {periodGrouping === 'none' && filteredTransactions.length > 0 && (
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
                  <table className="w-full">
                    <thead className="bg-slate-100 sticky top-0 z-10">
                      <tr>
                        <th className="px-2 py-3 w-8"></th>
                        <th className="px-4 py-3 text-left text-xs font-bold text-slate-600 uppercase">Data</th>
                        <th className="px-4 py-3 text-left text-xs font-bold text-slate-600 uppercase">Descricao</th>
                        <th className="px-4 py-3 text-center text-xs font-bold text-slate-600 uppercase">Tipo</th>
                        <th className="px-4 py-3 text-right text-xs font-bold text-slate-600 uppercase">Valor</th>
                        <th className="px-4 py-3 text-right text-xs font-bold text-slate-600 uppercase">Conciliacao</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">{renderTransactionRows(filteredTransactions)}</tbody>
                  </table>
                </div>

                <div className="border-t-2 border-slate-200 bg-slate-50 p-4">
                  <div className="grid grid-cols-3 gap-4 text-sm">
                    <div className="text-center">
                      <p className="text-xs text-slate-500 font-bold uppercase mb-1">Creditos</p>
                      <p className="text-lg font-black text-green-600">{fmt(totalCredits)}</p>
                    </div>
                    <div className="text-center">
                      <p className="text-xs text-slate-500 font-bold uppercase mb-1">Debitos</p>
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
              </div>
            )}

            {periodGrouping !== 'none' && groupedTransactionList.map(group => (
              <div key={group.key} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="border-b border-slate-200 bg-slate-50 px-4 py-3 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                  <div>
                    <p className="text-sm font-black text-slate-800 uppercase">{group.label}</p>
                    <p className="text-xs text-slate-500">{group.transactions.length} transacoes neste periodo</p>
                  </div>
                  <div className="grid grid-cols-3 gap-3 text-xs md:text-sm">
                    <div className="rounded-lg bg-green-50 px-3 py-2 text-center">
                      <p className="font-bold text-slate-500 uppercase">Creditos</p>
                      <p className="font-black text-green-600">{fmt(group.credits)}</p>
                    </div>
                    <div className="rounded-lg bg-red-50 px-3 py-2 text-center">
                      <p className="font-bold text-slate-500 uppercase">Debitos</p>
                      <p className="font-black text-red-600">{fmt(group.debits)}</p>
                    </div>
                    <div className="rounded-lg bg-blue-50 px-3 py-2 text-center">
                      <p className="font-bold text-slate-500 uppercase">Saldo</p>
                      <p className={`font-black ${group.balance >= 0 ? 'text-blue-600' : 'text-red-600'}`}>{fmt(group.balance)}</p>
                    </div>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-slate-100">
                      <tr>
                        <th className="px-2 py-3 w-8"></th>
                        <th className="px-4 py-3 text-left text-xs font-bold text-slate-600 uppercase">Data</th>
                        <th className="px-4 py-3 text-left text-xs font-bold text-slate-600 uppercase">Descricao</th>
                        <th className="px-4 py-3 text-center text-xs font-bold text-slate-600 uppercase">Tipo</th>
                        <th className="px-4 py-3 text-right text-xs font-bold text-slate-600 uppercase">Valor</th>
                        <th className="px-4 py-3 text-right text-xs font-bold text-slate-600 uppercase">Conciliacao</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">{renderTransactionRows(group.transactions)}</tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
};
