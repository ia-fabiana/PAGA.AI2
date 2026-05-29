import { BankTransaction, Bill, BillBankMatch } from './types';

const PAYMENT_TOLERANCE = 0.01;

const normalizeText = (value?: string) =>
  (value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const hasText = (value?: string) => normalizeText(value).length > 0;

const isLooseTextMatch = (left?: string, right?: string) => {
  const normalizedLeft = normalizeText(left);
  const normalizedRight = normalizeText(right);

  if (!normalizedLeft || !normalizedRight) {
    return !normalizedLeft && !normalizedRight;
  }

  return (
    normalizedLeft === normalizedRight ||
    normalizedLeft.includes(normalizedRight) ||
    normalizedRight.includes(normalizedLeft)
  );
};

export const getBillBankMatches = (bill: Bill) => {
  if (bill.bankMatches?.length) return bill.bankMatches;

  const hasLegacyBankData = Boolean(
    bill.paymentSource === 'bank' ||
    bill.paymentBankTransactionId ||
    bill.paymentBankReference ||
    bill.paymentBankDescription ||
    bill.paymentBankDocument
  );

  if (!hasLegacyBankData) return [];

  return [{
    transactionId: bill.paymentBankTransactionId || `legacy-bank-${bill.id}`,
    date: bill.paidDate || bill.dueDate,
    amount: Number.isFinite(bill.paidAmount) ? bill.paidAmount : bill.amount,
    reference: bill.paymentBankReference,
    description: bill.paymentBankDescription,
    document: bill.paymentBankDocument,
  }];
};

export const getBillBankPaidAmount = (bill: Bill) =>
  getBillBankMatches(bill).reduce((sum, match) => sum + (Number.isFinite(match.amount) ? match.amount : 0), 0);

export const getBillLastBankPaymentDate = (bill: Bill) => {
  const dates = getBillBankMatches(bill).map((match) => match.date).filter(Boolean).sort();
  return dates.length > 0 ? dates[dates.length - 1] : undefined;
};

export const getBillPaymentSource = (bill: Bill) =>
  getBillBankMatches(bill).length > 0
    ? 'bank'
    : bill.paymentSource || (bill.paidDate || bill.paidAmount !== undefined ? 'manual' : undefined);

export const isBillFullyPaid = (bill: Bill) =>
  getBillBankMatches(bill).length > 0
    ? getBillBankPaidAmount(bill) >= bill.amount - PAYMENT_TOLERANCE
    : bill.paymentSource === 'caixa_pequeno' || bill.status === 'Pago' || Boolean(bill.paidDate);

export const isBillPartiallyPaid = (bill: Bill) => {
  const bankPaidAmount = getBillBankPaidAmount(bill);
  return bankPaidAmount > PAYMENT_TOLERANCE && bankPaidAmount < bill.amount - PAYMENT_TOLERANCE;
};

export const getBillDisplayPaidAmount = (bill: Bill) =>
  getBillBankMatches(bill).length > 0 ? getBillBankPaidAmount(bill) : bill.paidAmount;

export const getBillDisplayPaidDate = (bill: Bill) =>
  getBillBankMatches(bill).length > 0 ? getBillLastBankPaymentDate(bill) : bill.paidDate;

export const getBillOutstandingAmount = (bill: Bill) => {
  const paidAmount = getBillDisplayPaidAmount(bill) || 0;
  return Math.max(bill.amount - paidAmount, 0);
};

export const getBillDisplayInterestAmount = (bill: Bill) => {
  if (getBillBankMatches(bill).length > 0) {
    const paidAmount = getBillBankPaidAmount(bill);
    return paidAmount >= bill.amount - PAYMENT_TOLERANCE ? paidAmount - bill.amount : undefined;
  }
  return bill.interestAmount;
};

export const doesBankMatchTransaction = (match: BillBankMatch, transaction: BankTransaction) => {
  if (match.transactionId === transaction.id) return true;

  const sameDate = match.date === transaction.date;
  const sameAmount = Math.abs(match.amount - transaction.amount) < PAYMENT_TOLERANCE;
  if (!sameDate || !sameAmount) return false;

  const matchReference = normalizeText(match.reference);
  const transactionReference = normalizeText(transaction.reference);
  const matchDocument = normalizeText(match.document);
  const transactionDocument = normalizeText(transaction.document);
  const exactReferenceMatch = Boolean(matchReference && transactionReference && matchReference === transactionReference);
  const exactDocumentMatch = Boolean(matchDocument && transactionDocument && matchDocument === transactionDocument);
  if (exactReferenceMatch || exactDocumentMatch) return true;

  const sameDescription = isLooseTextMatch(match.description, transaction.description);
  const matchCounterparty = normalizeText(match.counterparty);
  const transactionCounterparty = normalizeText(transaction.counterparty);
  const sameCounterparty =
    !matchCounterparty && !transactionCounterparty
      ? true
      : isLooseTextMatch(match.counterparty, transaction.counterparty);

  if (sameDescription && sameCounterparty) return true;

  const hasReferenceConflict =
    hasText(match.reference) &&
    hasText(transaction.reference) &&
    !exactReferenceMatch;
  const hasDocumentConflict =
    hasText(match.document) &&
    hasText(transaction.document) &&
    !exactDocumentMatch;

  if (hasReferenceConflict && hasDocumentConflict) {
    return false;
  }

  if (!hasReferenceConflict && !hasDocumentConflict && (sameDescription || sameCounterparty)) {
    return true;
  }

  return !hasReferenceConflict && !hasDocumentConflict && !hasText(match.description) && !hasText(transaction.description);
};

export const doesBillMatchTransaction = (bill: Bill, transaction: BankTransaction) =>
  getBillBankMatches(bill).some((match) => doesBankMatchTransaction(match, transaction));
