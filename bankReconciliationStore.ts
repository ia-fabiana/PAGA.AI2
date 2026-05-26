import { collection, doc, getDocs, setDoc, writeBatch } from 'firebase/firestore';
import { db, isMockMode } from './firebase';
import { BankReconciliation, BankTransaction } from './types';

const SHARED_WORKSPACE_ID = 'paga-ai2-shared';
const STORAGE_KEY = 'pagaai_bank_reconciliations';

export type BankStatementSourceFormat = 'RET' | 'TXT' | 'CSV';

export interface StoredBankReconciliation extends BankReconciliation {
  periodKey: string;
  statementMonth: string;
  version: number;
  isActiveVersion: boolean;
  sourceFormat: BankStatementSourceFormat;
  supersededAt?: string;
  supersededByVersion?: number;
}

export interface MonthlySaveResult {
  monthKey: string;
  status: 'saved' | 'skipped_closed_month';
  statement?: StoredBankReconciliation;
  previousActiveVersion?: number;
  existingActiveStatement?: StoredBankReconciliation;
}

export interface SaveBankReconciliationResult {
  monthlyResults: MonthlySaveResult[];
  savedCount: number;
  skippedCount: number;
}

const sortStatements = (statements: StoredBankReconciliation[]) =>
  [...statements].sort((a, b) => {
    if (a.statementMonth !== b.statementMonth) {
      return b.statementMonth.localeCompare(a.statementMonth);
    }

    if (a.isActiveVersion !== b.isActiveVersion) {
      return a.isActiveVersion ? -1 : 1;
    }

    const dateA = a.uploadedAt || '';
    const dateB = b.uploadedAt || '';
    return dateB.localeCompare(dateA);
  });

const normalizeKeyPart = (value?: string) =>
  (value || 'na')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'na';

const normalizeMatchText = (value?: string) =>
  (value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const normalizeDocument = (value?: string) => (value || '').replace(/\D+/g, '');

const normalizeBankKey = (bankName?: string) => {
  const normalized = (bankName || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\b(csv|txt|pdf|cnab)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return normalizeKeyPart(normalized || bankName);
};

const normalizeAccountKey = (accountNumber?: string) => {
  const digitsOnly = (accountNumber || '').replace(/\D+/g, '');
  return digitsOnly || normalizeKeyPart(accountNumber);
};

type StatementIdentity = Pick<BankReconciliation, 'bankName' | 'accountNumber' | 'startDate'> &
  Partial<Pick<StoredBankReconciliation, 'statementMonth' | 'uploadedAt' | 'version' | 'isActiveVersion'>>;

export const getStatementAccountGroupKey = (statement: Pick<BankReconciliation, 'bankName' | 'accountNumber'>) => {
  const bankKey = normalizeBankKey(statement.bankName);
  const accountKey = normalizeAccountKey(statement.accountNumber);
  return `${bankKey}__${accountKey}`;
};

const getStatementMonth = (statement: StatementIdentity) =>
  statement.statementMonth || getMonthKey(statement.startDate);

const buildCanonicalPeriodKey = (statement: StatementIdentity) =>
  `${getStatementAccountGroupKey(statement)}__${getStatementMonth(statement)}`;

const getStatementsForSamePeriod = (
  statements: StoredBankReconciliation[],
  target: StatementIdentity
) => {
  const targetPeriodKey = buildCanonicalPeriodKey(target);
  return statements.filter(statement => buildCanonicalPeriodKey(statement) === targetPeriodKey);
};

const sortByUploadedAtDesc = (left: StatementIdentity, right: StatementIdentity) => {
  const uploadedDiff = (right.uploadedAt || '').localeCompare(left.uploadedAt || '');
  if (uploadedDiff !== 0) return uploadedDiff;
  return (right.version || 0) - (left.version || 0);
};

const getCurrentActiveStatement = (statements: StoredBankReconciliation[]) =>
  [...statements]
    .filter(statement => statement.isActiveVersion)
    .sort(sortByUploadedAtDesc)[0];

const getStatementStatus = (reconciledTransactions: number, totalTransactions: number): BankReconciliation['status'] => {
  if (reconciledTransactions === 0) return 'pending';
  if (reconciledTransactions === totalTransactions) return 'complete';
  return 'partial';
};

const getAmountMatchKey = (value: number) => `${Math.round((Number.isFinite(value) ? value : 0) * 100)}`;

const getStrictTransactionKey = (transaction: BankTransaction) => {
  const reference = normalizeMatchText(transaction.reference);
  const document = normalizeDocument(transaction.document);
  if (!reference && !document) return '';

  return [
    transaction.date,
    transaction.type,
    getAmountMatchKey(transaction.amount),
    reference || '-',
    document || '-',
  ].join('|');
};

const getLooseTransactionKey = (transaction: BankTransaction) =>
  [
    transaction.date,
    transaction.type,
    getAmountMatchKey(transaction.amount),
    normalizeMatchText(transaction.description),
    normalizeMatchText(transaction.counterparty),
  ].join('|');

const pickReconciledTransactionForCurrent = (
  transaction: BankTransaction,
  byId: Map<string, BankTransaction>,
  byStrictKey: Map<string, BankTransaction[]>,
  byLooseKey: Map<string, BankTransaction[]>
) => {
  const idMatch = byId.get(transaction.id);
  if (idMatch) return idMatch;

  const strictKey = getStrictTransactionKey(transaction);
  if (strictKey) {
    const strictMatch = byStrictKey.get(strictKey)?.[0];
    if (strictMatch) return strictMatch;
  }

  return byLooseKey.get(getLooseTransactionKey(transaction))?.[0];
};

const preserveReconciledTransactions = <T extends BankReconciliation>(
  statement: T,
  historyStatements: StoredBankReconciliation[]
): T => {
  if (!historyStatements.length || !statement.transactions.length) return statement;

  const sourceStatements = [...historyStatements].sort(sortByUploadedAtDesc);
  const byId = new Map<string, BankTransaction>();
  const byStrictKey = new Map<string, BankTransaction[]>();
  const byLooseKey = new Map<string, BankTransaction[]>();

  sourceStatements.forEach((historyStatement) => {
    historyStatement.transactions
      .filter(transaction => transaction.reconciled)
      .forEach((transaction) => {
        if (!byId.has(transaction.id)) {
          byId.set(transaction.id, transaction);
        }

        const strictKey = getStrictTransactionKey(transaction);
        if (strictKey) {
          const current = byStrictKey.get(strictKey) || [];
          byStrictKey.set(strictKey, [...current, transaction]);
        }

        const looseKey = getLooseTransactionKey(transaction);
        const currentLoose = byLooseKey.get(looseKey) || [];
        byLooseKey.set(looseKey, [...currentLoose, transaction]);
      });
  });

  const nextTransactions = statement.transactions.map((transaction) => {
    if (transaction.reconciled) return transaction;

    const sourceTransaction = pickReconciledTransactionForCurrent(
      transaction,
      byId,
      byStrictKey,
      byLooseKey
    );
    if (!sourceTransaction?.reconciled) return transaction;

    return {
      ...transaction,
      reconciled: true,
      reconciledWith: sourceTransaction.reconciledWith,
      reconciledType: sourceTransaction.reconciledType,
      reconciledAt: sourceTransaction.reconciledAt,
      reconciledBy: sourceTransaction.reconciledBy,
    };
  });

  const reconciledTransactions = nextTransactions.filter(transaction => transaction.reconciled).length;
  return {
    ...statement,
    transactions: nextTransactions,
    reconciledTransactions,
    status: getStatementStatus(reconciledTransactions, nextTransactions.length),
  };
};

const getCollectionRef = () =>
  collection(db, 'workspaces', SHARED_WORKSPACE_ID, 'bank_reconciliations');

export const getStatementSourceFormat = (fileName: string): BankStatementSourceFormat =>
  fileName.toLowerCase().endsWith('.ret')
    ? 'RET'
    : fileName.toLowerCase().endsWith('.csv')
      ? 'CSV'
      : 'TXT';

const getMonthKey = (date: string) => date.slice(0, 7);

const getCurrentMonthKey = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
};

const sortTransactionsChronologically = (transactions: BankTransaction[]) =>
  [...transactions].sort((left, right) => {
    const dateDiff = left.date.localeCompare(right.date);
    if (dateDiff !== 0) return dateDiff;
    return left.id.localeCompare(right.id);
  });

const buildTransactionMergeKey = (transaction: BankTransaction) =>
  [
    transaction.date,
    transaction.type,
    getAmountMatchKey(transaction.amount),
    normalizeMatchText(transaction.description),
    normalizeMatchText(transaction.counterparty),
    normalizeDocument(transaction.document),
  ].join('|');

const hasNewTransactionsComparedToCurrent = (
  currentTransactions: BankTransaction[],
  incomingTransactions: BankTransaction[]
) => {
  const currentKeys = new Set(currentTransactions.map(buildTransactionMergeKey));
  return incomingTransactions.some(transaction => !currentKeys.has(buildTransactionMergeKey(transaction)));
};

const mergeTransactionsForClosedMonth = (
  currentTransactions: BankTransaction[],
  incomingTransactions: BankTransaction[]
) => {
  const mergedByKey = new Map<string, BankTransaction>();

  currentTransactions.forEach(transaction => {
    mergedByKey.set(buildTransactionMergeKey(transaction), transaction);
  });

  // Incoming statement wins on duplicates to keep latest metadata.
  incomingTransactions.forEach(transaction => {
    mergedByKey.set(buildTransactionMergeKey(transaction), transaction);
  });

  return sortTransactionsChronologically(Array.from(mergedByKey.values()));
};

const rebuildMonthlyStatement = (
  monthlyStatement: BankReconciliation,
  transactions: BankTransaction[]
): BankReconciliation => {
  const monthKey = getMonthKey(monthlyStatement.startDate);
  const sortedTransactions = sortTransactionsChronologically(transactions);
  const credits = sortedTransactions
    .filter(transaction => transaction.type === 'CREDIT')
    .reduce((sum, transaction) => sum + transaction.amount, 0);
  const debits = sortedTransactions
    .filter(transaction => transaction.type === 'DEBIT')
    .reduce((sum, transaction) => sum + transaction.amount, 0);

  return {
    ...monthlyStatement,
    startDate: `${monthKey}-01`,
    endDate: sortedTransactions[sortedTransactions.length - 1]?.date || `${monthKey}-01`,
    totalTransactions: sortedTransactions.length,
    transactions: sortedTransactions,
    finalBalance: credits - debits,
  };
};

const resolveMonthlyStatementForSave = (
  monthlyStatement: BankReconciliation,
  sameMonthStatements: StoredBankReconciliation[]
) => {
  const monthKey = getMonthKey(monthlyStatement.startDate);
  if (!sameMonthStatements.length || !isClosedMonth(monthKey)) {
    return {
      statementToSave: monthlyStatement,
      skipClosedMonth: false,
    };
  }

  const currentActiveStatement = getCurrentActiveStatement(sameMonthStatements)
    || [...sameMonthStatements].sort(sortByUploadedAtDesc)[0];
  if (!currentActiveStatement) {
    return {
      statementToSave: monthlyStatement,
      skipClosedMonth: false,
    };
  }

  if (!hasNewTransactionsComparedToCurrent(currentActiveStatement.transactions, monthlyStatement.transactions)) {
    return {
      statementToSave: monthlyStatement,
      skipClosedMonth: true,
    };
  }

  const mergedTransactions = mergeTransactionsForClosedMonth(
    currentActiveStatement.transactions,
    monthlyStatement.transactions
  );

  return {
    statementToSave: rebuildMonthlyStatement(monthlyStatement, mergedTransactions),
    skipClosedMonth: false,
  };
};

const buildPeriodKey = (reconciliation: BankReconciliation) => {
  return buildCanonicalPeriodKey(reconciliation);
};

const stripUndefined = <T,>(value: T): T => {
  if (Array.isArray(value)) {
    return value
      .map((item) => stripUndefined(item))
      .filter((item) => item !== undefined) as T;
  }

  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).reduce((acc, [key, val]) => {
      if (val === undefined) return acc;
      const cleaned = stripUndefined(val);
      if (cleaned !== undefined) {
        acc[key] = cleaned;
      }
      return acc;
    }, {} as Record<string, unknown>) as T;
  }

  return value;
};

const readMockStatements = (): StoredBankReconciliation[] => {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const writeMockStatements = (statements: StoredBankReconciliation[]) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(statements));
};

const buildVersionedStatement = (
  reconciliation: BankReconciliation,
  periodKey: string,
  version: number
): StoredBankReconciliation => ({
  ...reconciliation,
  id: `${periodKey}-v${version}`,
  periodKey,
  statementMonth: getMonthKey(reconciliation.startDate),
  version,
  isActiveVersion: true,
  sourceFormat: getStatementSourceFormat(reconciliation.fileName),
});

const splitTransactionsByMonth = (transactions: BankTransaction[]) =>
  transactions.reduce((groups, transaction) => {
    const monthKey = getMonthKey(transaction.date);
    if (!groups[monthKey]) {
      groups[monthKey] = [];
    }

    groups[monthKey].push(transaction);
    return groups;
  }, {} as Record<string, BankTransaction[]>);

const buildMonthlyReconciliations = (reconciliation: BankReconciliation): BankReconciliation[] => {
  const groupedTransactions = splitTransactionsByMonth(reconciliation.transactions);

  return Object.entries(groupedTransactions)
    .map(([monthKey, transactions]) => {
      const sortedTransactions = [...transactions].sort((a, b) => a.date.localeCompare(b.date));
      const credits = sortedTransactions
        .filter(transaction => transaction.type === 'CREDIT')
        .reduce((sum, transaction) => sum + transaction.amount, 0);
      const debits = sortedTransactions
        .filter(transaction => transaction.type === 'DEBIT')
        .reduce((sum, transaction) => sum + transaction.amount, 0);

      return {
        ...reconciliation,
        startDate: `${monthKey}-01`,
        endDate: sortedTransactions[sortedTransactions.length - 1]?.date || `${monthKey}-01`,
        totalTransactions: sortedTransactions.length,
        transactions: sortedTransactions,
        finalBalance: credits - debits,
      };
    })
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
};

const isClosedMonth = (monthKey: string) => monthKey < getCurrentMonthKey();

const buildSaveSummary = (monthlyResults: MonthlySaveResult[]): SaveBankReconciliationResult => ({
  monthlyResults,
  savedCount: monthlyResults.filter(result => result.status === 'saved').length,
  skippedCount: monthlyResults.filter(result => result.status === 'skipped_closed_month').length,
});

const saveMockBankReconciliation = async (
  reconciliation: BankReconciliation
): Promise<SaveBankReconciliationResult> => {
  const monthlyStatements = buildMonthlyReconciliations(reconciliation);
  const allStatements = readMockStatements();
  const results: MonthlySaveResult[] = [];
  let nextStatements = [...allStatements];

  monthlyStatements.forEach(monthlyStatement => {
    const periodKey = buildPeriodKey(monthlyStatement);
    const sameMonthStatements = getStatementsForSamePeriod(nextStatements, monthlyStatement);
    const currentActive = getCurrentActiveStatement(sameMonthStatements);
    const monthKey = getMonthKey(monthlyStatement.startDate);
    const monthlyResolution = resolveMonthlyStatementForSave(monthlyStatement, sameMonthStatements);
    if (monthlyResolution.skipClosedMonth) {
      results.push({
        monthKey,
        status: 'skipped_closed_month',
        existingActiveStatement: currentActive || sameMonthStatements.sort(sortByUploadedAtDesc)[0],
      });
      return;
    }

    const nextVersion = sameMonthStatements.length > 0
      ? Math.max(...sameMonthStatements.map(statement => statement.version)) + 1
      : 1;
    const savedAt = new Date().toISOString();

    nextStatements = nextStatements.map(statement =>
      sameMonthStatements.some(item => item.id === statement.id) && statement.isActiveVersion
        ? {
            ...statement,
            isActiveVersion: false,
            supersededAt: savedAt,
            supersededByVersion: nextVersion,
          }
        : statement
    );

    const statement = buildVersionedStatement(
      preserveReconciledTransactions(
        {
          ...monthlyResolution.statementToSave,
          uploadedAt: savedAt,
        },
        sameMonthStatements
      ),
      periodKey,
      nextVersion
    );

    nextStatements.push(statement);
    results.push({
      monthKey,
      status: 'saved',
      statement,
      previousActiveVersion: currentActive?.version,
    });
  });

  writeMockStatements(sortStatements(nextStatements));
  return buildSaveSummary(results);
};

const saveFirestoreBankReconciliation = async (
  reconciliation: BankReconciliation
): Promise<SaveBankReconciliationResult> => {
  const monthlyStatements = buildMonthlyReconciliations(reconciliation);
  const statementsRef = getCollectionRef();
  const snapshot = await getDocs(statementsRef);
  const allStatements = snapshot.docs.map(item => item.data() as StoredBankReconciliation);
  const results: MonthlySaveResult[] = [];

  if (!db || typeof db !== 'object') {
    for (const monthlyStatement of monthlyStatements) {
      const periodKey = buildPeriodKey(monthlyStatement);
      const sameMonthStatements = getStatementsForSamePeriod(allStatements, monthlyStatement);
      const currentActive = getCurrentActiveStatement(sameMonthStatements);
      const monthKey = getMonthKey(monthlyStatement.startDate);
      const monthlyResolution = resolveMonthlyStatementForSave(monthlyStatement, sameMonthStatements);
      if (monthlyResolution.skipClosedMonth) {
        results.push({
          monthKey,
          status: 'skipped_closed_month',
          existingActiveStatement: currentActive || sameMonthStatements.sort(sortByUploadedAtDesc)[0],
        });
        continue;
      }

      const nextVersion = sameMonthStatements.length > 0
        ? Math.max(...sameMonthStatements.map(statement => statement.version)) + 1
        : 1;
      const savedAt = new Date().toISOString();
      const statement = buildVersionedStatement(
        preserveReconciledTransactions(
          {
            ...monthlyResolution.statementToSave,
            uploadedAt: savedAt,
          },
          sameMonthStatements
        ),
        periodKey,
        nextVersion
      );
      const payload = stripUndefined(statement);

      for (const item of sameMonthStatements.filter(entry => entry.isActiveVersion)) {
        await setDoc(
          doc(statementsRef, item.id),
          {
            isActiveVersion: false,
            supersededAt: savedAt,
            supersededByVersion: nextVersion,
          },
          { merge: true }
        );
      }

      await setDoc(doc(statementsRef, statement.id), payload);
      results.push({
        monthKey,
        status: 'saved',
        statement,
        previousActiveVersion: currentActive?.version,
      });
    }

    return buildSaveSummary(results);
  }

  const batch = writeBatch(db);

  monthlyStatements.forEach(monthlyStatement => {
    const periodKey = buildPeriodKey(monthlyStatement);
    const sameMonthStatements = getStatementsForSamePeriod(allStatements, monthlyStatement);
    const currentActive = getCurrentActiveStatement(sameMonthStatements);
    const monthKey = getMonthKey(monthlyStatement.startDate);
    const monthlyResolution = resolveMonthlyStatementForSave(monthlyStatement, sameMonthStatements);
    if (monthlyResolution.skipClosedMonth) {
      results.push({
        monthKey,
        status: 'skipped_closed_month',
        existingActiveStatement: currentActive || sameMonthStatements.sort(sortByUploadedAtDesc)[0],
      });
      return;
    }

    const nextVersion = sameMonthStatements.length > 0
      ? Math.max(...sameMonthStatements.map(statement => statement.version)) + 1
      : 1;
    const savedAt = new Date().toISOString();
    const statement = buildVersionedStatement(
      preserveReconciledTransactions(
        {
          ...monthlyResolution.statementToSave,
          uploadedAt: savedAt,
        },
        sameMonthStatements
      ),
      periodKey,
      nextVersion
    );

    const payload = stripUndefined(statement);
    sameMonthStatements
      .filter(item => item.isActiveVersion)
      .forEach(item => {
        batch.set(
          doc(statementsRef, item.id),
          {
            isActiveVersion: false,
            supersededAt: savedAt,
            supersededByVersion: nextVersion,
          },
          { merge: true }
        );
      });

    batch.set(doc(statementsRef, statement.id), payload);
    results.push({
      monthKey,
      status: 'saved',
      statement,
      previousActiveVersion: currentActive?.version,
    });
  });

  await batch.commit();
  return buildSaveSummary(results);
};

const resolveVisibleActiveStatements = (
  statements: StoredBankReconciliation[]
): StoredBankReconciliation[] => {
  const groupedByPeriod = statements.reduce((groups, statement) => {
    const periodKey = buildCanonicalPeriodKey(statement);
    if (!groups[periodKey]) {
      groups[periodKey] = [];
    }
    groups[periodKey].push(statement);
    return groups;
  }, {} as Record<string, StoredBankReconciliation[]>);

  return Object.values(groupedByPeriod)
    .map((periodStatements) => {
      const currentActive = getCurrentActiveStatement(periodStatements);
      const fallbackLatest = [...periodStatements].sort(sortByUploadedAtDesc)[0];
      const baseStatement = currentActive || fallbackLatest;
      if (!baseStatement) return null;

      const withPreservedReconciliation = preserveReconciledTransactions(baseStatement, periodStatements);
      return {
        ...withPreservedReconciliation,
        isActiveVersion: true,
      } as StoredBankReconciliation;
    })
    .filter((statement): statement is StoredBankReconciliation => Boolean(statement));
};

export const saveBankReconciliationVersion = async (
  reconciliation: BankReconciliation
): Promise<SaveBankReconciliationResult> => {
  if (!reconciliation.startDate || !reconciliation.endDate) {
    throw new Error('Nao foi possivel identificar o periodo do extrato.');
  }

  return isMockMode
    ? saveMockBankReconciliation(reconciliation)
    : saveFirestoreBankReconciliation(reconciliation);
};

export const listSavedBankReconciliations = async (): Promise<StoredBankReconciliation[]> => {
  if (isMockMode) {
    return sortStatements(resolveVisibleActiveStatements(readMockStatements()));
  }

  const snapshot = await getDocs(getCollectionRef());
  const statements = snapshot.docs.map(item => item.data() as StoredBankReconciliation);
  return sortStatements(resolveVisibleActiveStatements(statements));
};
