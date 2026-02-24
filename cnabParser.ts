import { BankTransaction, BankReconciliation } from './types';

/**
 * Parser para arquivos CNAB 240 do Banco Inter
 * Baseado no layout padrão FEBRABAN
 */

interface CNABHeader {
  bankCode: string;
  companyName: string;
  accountNumber: string;
  startDate: string;
  endDate: string;
}

interface CNABDetail {
  sequenceNumber: number;
  date: string;
  amount: number;
  type: 'C' | 'D'; // Crédito ou Débito
  description: string;
  reference: string;
}

/**
 * Extrai informações do header do CNAB
 */
function parseHeader(line: string): CNABHeader | null {
  if (line.substring(7, 8) !== '0') return null; // Não é linha de header

  const bankCode = line.substring(0, 3);
  const companyName = line.substring(72, 102).trim();
  const accountNumber = line.substring(23, 35).trim();
  
  return {
    bankCode,
    companyName,
    accountNumber,
    startDate: '',
    endDate: ''
  };
}

/**
 * Extrai informações de uma linha de detalhe (transação)
 */
function parseDetail(line: string): CNABDetail | null {
  // Verifica se é linha de detalhe tipo E (segmento E para extrato)
  const recordType = line.substring(7, 8);
  const segmentType = line.substring(13, 14);
  
  if (recordType !== '3' || segmentType !== 'E') return null;

  try {
    // Extrai o número sequencial
    const sequenceNumber = parseInt(line.substring(8, 13));
    
    // Extrai a data (posições podem variar, vou usar o padrão comum)
    // Formato: DDMMAAAA (8 caracteres)
    const dateStr = line.substring(68, 76); // Ajustar conforme layout real
    const day = dateStr.substring(0, 2);
    const month = dateStr.substring(2, 4);
    const year = dateStr.substring(4, 8);
    const date = `${year}-${month}-${day}`;
    
    // Extrai o valor (13 dígitos + 2 decimais = 15 caracteres)
    const amountStr = line.substring(76, 91);
    const amount = parseInt(amountStr) / 100;
    
    // Extrai tipo (C=Crédito, D=Débito)
    const typeChar = line.substring(91, 92);
    const type = typeChar === 'C' ? 'C' : 'D';
    
    // Extrai descrição
    const description = line.substring(105, 135).trim();
    
    // Extrai referência/ID da transação
    const reference = line.substring(135, 160).trim();
    
    return {
      sequenceNumber,
      date,
      amount,
      type,
      description,
      reference
    };
  } catch (error) {
    console.error('Erro ao processar linha de detalhe:', error);
    return null;
  }
}

/**
 * Formata data do formato CNAB para ISO
 */
function formatDate(ddmmyyyy: string): string {
  if (ddmmyyyy.length !== 8) return '';
  const day = ddmmyyyy.substring(0, 2);
  const month = ddmmyyyy.substring(2, 4);
  const year = ddmmyyyy.substring(4, 8);
  return `${year}-${month}-${day}`;
}

/**
 * Parser principal para arquivo CNAB 240 do Banco Inter
 */
export function parseBancoInterCNAB(fileContent: string, fileName: string, uploadedBy: string): BankReconciliation {
  const lines = fileContent.split('\n').filter(line => line.trim().length > 0);
  
  const transactions: BankTransaction[] = [];
  let header: CNABHeader | null = null;
  let minDate = '';
  let maxDate = '';
  
  for (const line of lines) {
    // Tenta fazer parse do header
    if (!header) {
      const parsedHeader = parseHeader(line);
      if (parsedHeader) {
        header = parsedHeader;
        continue;
      }
    }
    
    // Tenta fazer parse das linhas de detalhe
    // No formato do seu extrato, as linhas começam com '0770001300'
    if (line.startsWith('0770001300')) {
      try {
        // Extrai dados específicos do formato do Banco Inter
        const sequenceStr = line.substring(10, 15);
        const sequenceNumber = parseInt(sequenceStr);
        
        // Data: posição 73-80 no formato DDMMAAAA
        const dateStr = line.substring(73, 81);
        const day = dateStr.substring(1, 3);
        const month = dateStr.substring(3, 5);
        const year = dateStr.substring(5, 9);
        const date = `${year}-${month}-${day}`;
        
        // Atualiza datas min/max
        if (!minDate || date < minDate) minDate = date;
        if (!maxDate || date > maxDate) maxDate = date;
        
        // Valor: posição 94-108 (15 dígitos, últimos 2 são decimais)
        const amountStr = line.substring(94, 109);
        const amount = parseInt(amountStr) / 100;
        
        // Tipo: C ou D
        const typeChar = line.substring(109, 110);
        const type: 'CREDIT' | 'DEBIT' = typeChar === 'C' ? 'CREDIT' : 'DEBIT';
        
        // Descrição
        const description = line.substring(110, 135).trim();
        
        // Referência
        const reference = line.substring(135, 160).trim();
        
        // Cria a transação
        const transaction: BankTransaction = {
          id: `bank-${date}-${sequenceNumber}-${reference}`,
          date,
          type,
          amount,
          description,
          reference,
          reconciled: false
        };
        
        transactions.push(transaction);
      } catch (error) {
        console.error('Erro ao processar linha:', line, error);
      }
    }
  }
  
  // Calcula saldos
  const credits = transactions.filter(t => t.type === 'CREDIT').reduce((sum, t) => sum + t.amount, 0);
  const debits = transactions.filter(t => t.type === 'DEBIT').reduce((sum, t) => sum + t.amount, 0);
  
  const reconciliation: BankReconciliation = {
    id: `reconciliation-${Date.now()}`,
    uploadedAt: new Date().toISOString(),
    uploadedBy,
    fileName,
    bankName: 'Banco Inter',
    accountNumber: header?.accountNumber || 'Desconhecida',
    startDate: minDate || '',
    endDate: maxDate || '',
    initialBalance: 0, // Não disponível no extrato simples
    finalBalance: credits - debits,
    totalTransactions: transactions.length,
    reconciledTransactions: 0,
    transactions,
    status: 'pending'
  };
  
  return reconciliation;
}

/**
 * Agrupa transações de crédito por data
 */
export function groupCreditsByDate(transactions: BankTransaction[]): Record<string, BankTransaction[]> {
  const grouped: Record<string, BankTransaction[]> = {};
  
  transactions
    .filter(t => t.type === 'CREDIT')
    .forEach(transaction => {
      if (!grouped[transaction.date]) {
        grouped[transaction.date] = [];
      }
      grouped[transaction.date].push(transaction);
    });
  
  return grouped;
}

/**
 * Calcula total de créditos para uma data específica
 */
export function getTotalCreditsForDate(transactions: BankTransaction[], date: string): number {
  return transactions
    .filter(t => t.type === 'CREDIT' && t.date === date)
    .reduce((sum, t) => sum + t.amount, 0);
}

/**
 * Filtra apenas transações PIX recebidas
 */
export function getPixReceivedTransactions(transactions: BankTransaction[]): BankTransaction[] {
  return transactions.filter(t => 
    t.type === 'CREDIT' && 
    (t.description.includes('PIX RECEBIDO') || t.description.includes('RECEBIMENTO'))
  );
}
/**
 * Extrai apenas transações de DÉBITO
 */
export function getDebitTransactions(transactions: BankTransaction[]): BankTransaction[] {
  return transactions.filter(t => t.type === 'DEBIT').sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
}

/**
 * Calcula total de débitos para uma data específica
 */
export function getTotalDebitsForDate(transactions: BankTransaction[], date: string): number {
  return transactions
    .filter(t => t.type === 'DEBIT' && t.date === date)
    .reduce((sum, t) => sum + t.amount, 0);
}

/**
 * Tenta fazer matching automático entre débitos e Bills
 * Retorna um objeto com score de confiança (0-100) para cada possível match
 */
export function matchDebitWithBills(debit: BankTransaction, bills: any[]): { billId: string; score: number }[] {
  const matches: { billId: string; score: number }[] = [];
  const debitDate = new Date(debit.date);
  const debitAmount = debit.amount;
  
  bills.forEach(bill => {
    let score = 0;
    
    // Match exato de valor (100 pontos)
    if (bill.amount === debitAmount) {
      score += 100;
    } else if (Math.abs(bill.amount - debitAmount) < 0.01) {
      // Match com até 1 centavo de diferença (99 pontos)
      score += 99;
    } else if (Math.abs(bill.amount - debitAmount) < 1) {
      // Match com até R$1 de diferença (50 pontos)
      score += 50;
    }
    
    // Match de data (dentro de ±3 dias = 30 pontos)
    if (score > 0) {
      const billDate = new Date(bill.paidDate || bill.dueDate);
      const daysDiff = Math.abs(Math.floor((debitDate.getTime() - billDate.getTime()) / (1000 * 60 * 60 * 24)));
      
      if (daysDiff === 0) {
        score += 30; // Mesma data
      } else if (daysDiff <= 3) {
        score += 20; // Dentro de 3 dias
      }
    }
    
    // Match de descrição (configuração fuzzy básica)
    if (score > 0 && bill.description) {
      const debitDesc = debit.description.toUpperCase();
      const billDesc = bill.description.toUpperCase();
      
      // Verifica se tem palavras em comum (mínimo 3 caracteres)
      const debitWords = debitDesc.split(/\s+/);
      const billWords = billDesc.split(/\s+/);
      
      let commonWords = 0;
      debitWords.forEach(word => {
        if (word.length >= 3 && billWords.some(bw => bw.includes(word))) {
          commonWords++;
        }
      });
      
      if (commonWords > 0) {
        score += 10; // Tem palavras em comum
      }
    }
    
    if (score > 0) {
      matches.push({ billId: bill.id, score });
    }
  });
  
  // Retorna matches ordenados por score descendente, apenas > 50
  return matches
    .filter(m => m.score > 50)
    .sort((a, b) => b.score - a.score);
}