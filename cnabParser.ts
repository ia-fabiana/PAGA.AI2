import { BankTransaction, BankReconciliation } from './types';
import * as pdfjsLib from 'pdfjs-dist';

// Configure worker via CDN (mais compatÃ­vel com Vite)
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

/**
 * Parser genÃ©rico para mÃºltiplos formatos de extrato bancÃ¡rio
 * Suporta: CNAB 240, TXT, PDF
 */

export enum FileFormat {
  CNAB = 'CNAB',
  TXT = 'TXT',
  CSV = 'CSV',
  PDF = 'PDF',
  UNKNOWN = 'UNKNOWN'
}

/**
 * Detecta o formato do arquivo baseado no conteÃºdo e extensÃ£o
 */
export function detectFileFormat(fileContent: string | ArrayBuffer, fileName: string): FileFormat {
  const ext = fileName.split('.').pop()?.toUpperCase() || '';

  if (ext === 'PDF') {
    return FileFormat.PDF;
  }

  if (ext === 'CSV') {
    return FileFormat.CSV;
  }

  if (ext === 'RET') {
    return FileFormat.CNAB;
  }

  if (ext === 'TXT') {
    if (typeof fileContent === 'string' && fileContent.includes('0770001300')) {
      return FileFormat.CNAB;
    }

    return FileFormat.TXT;
  }

  if (typeof fileContent === 'string') {
    // Se comeÃ§ar com CNAB pattern
    if (fileContent.includes('0770001300')) {
      return FileFormat.CNAB;
    }

    // Tenta detectar por conteÃºdo
    if (fileContent.includes('Data Lan') || fileContent.includes(';')) {
      return FileFormat.CSV;
    }

    if (fileContent.includes('|') || fileContent.includes('\t')) {
      return FileFormat.TXT;
    }

    if (fileContent.includes('PIX') && fileContent.includes('RECEBIDO')) {
      return FileFormat.CNAB;
    }
  }

  return FileFormat.UNKNOWN;
}

/**
 * Parser para arquivos CNAB 240 do Banco Inter
 * Baseado no layout padrÃ£o FEBRABAN
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
  type: 'C' | 'D'; // CrÃ©dito ou DÃ©bito
  description: string;
  reference: string;
}

function isValidIsoDateParts(year: string, month: string, day: string): boolean {
  if (!/^\d{4}$/.test(year) || !/^\d{2}$/.test(month) || !/^\d{2}$/.test(day)) {
    return false;
  }

  const yearNumber = Number(year);
  const monthNumber = Number(month);
  const dayNumber = Number(day);
  if (monthNumber < 1 || monthNumber > 12 || dayNumber < 1 || dayNumber > 31) {
    return false;
  }

  const candidate = new Date(yearNumber, monthNumber - 1, dayNumber);
  return (
    candidate.getFullYear() === yearNumber &&
    candidate.getMonth() === monthNumber - 1 &&
    candidate.getDate() === dayNumber
  );
}

/**
 * Extrai informaÃ§Ãµes do header do CNAB
 */
function parseHeader(line: string): CNABHeader | null {
  if (line.substring(7, 8) !== '0') return null; // NÃ£o Ã© linha de header

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
 * Extrai informaÃ§Ãµes de uma linha de detalhe (transaÃ§Ã£o)
 */
function parseDetail(line: string): CNABDetail | null {
  // Verifica se Ã© linha de detalhe tipo E (segmento E para extrato)
  const recordType = line.substring(7, 8);
  const segmentType = line.substring(13, 14);
  
  if (recordType !== '3' || segmentType !== 'E') return null;

  try {
    // Extrai o nÃºmero sequencial
    const sequenceNumber = parseInt(line.substring(8, 13));
    if (!Number.isFinite(sequenceNumber)) return null;
    
    // Extrai a data (posiÃ§Ãµes podem variar, vou usar o padrÃ£o comum)
    // Formato: DDMMAAAA (8 caracteres)
    const dateStr = line.substring(68, 76); // Ajustar conforme layout real
    if (!/^\d{8}$/.test(dateStr)) return null;
    const day = dateStr.substring(0, 2);
    const month = dateStr.substring(2, 4);
    const year = dateStr.substring(4, 8);
    if (!isValidIsoDateParts(year, month, day)) return null;
    const date = `${year}-${month}-${day}`;
    
    // Extrai o valor (13 dÃ­gitos + 2 decimais = 15 caracteres)
    const amountStr = line.substring(76, 91);
    if (!/^\d+$/.test(amountStr)) return null;
    const amount = parseInt(amountStr) / 100;
    if (!Number.isFinite(amount) || amount <= 0) return null;
    
    // Extrai tipo (C=CrÃ©dito, D=DÃ©bito)
    const typeChar = line.substring(91, 92);
    if (typeChar !== 'C' && typeChar !== 'D') return null;
    const type = typeChar === 'C' ? 'C' : 'D';
    
    // Extrai descriÃ§Ã£o
    const description = line.substring(105, 135).trim();
    
    // Extrai referÃªncia/ID da transaÃ§Ã£o
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
  const lines = fileContent
    .split(/\r?\n/)
    .map(line => line.replace(/\r/g, ''))
    .filter(line => line.trim().length > 0);
  
  console.log('ðŸ¦ CNAB - Total de linhas:', lines.length);
  console.log('ðŸ¦ CNAB - Primeira linha:', lines[0]?.substring(0, 50));
  
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
    
    const standardDetail = parseDetail(line);
    if (standardDetail) {
      if (!minDate || standardDetail.date < minDate) minDate = standardDetail.date;
      if (!maxDate || standardDetail.date > maxDate) maxDate = standardDetail.date;

      transactions.push({
        id: `bank-${standardDetail.date}-${standardDetail.sequenceNumber}-${standardDetail.reference}`,
        date: standardDetail.date,
        type: standardDetail.type === 'C' ? 'CREDIT' : 'DEBIT',
        amount: standardDetail.amount,
        description: standardDetail.description || 'Sem descriÃ§Ã£o',
        reference: standardDetail.reference,
        reconciled: false
      });
      continue;
    }

    // Tenta fazer parse das linhas de detalhe
    // No formato do seu extrato, as linhas comeÃ§am com '0770001300'
    if (line.startsWith('0770001300')) {
      try {
        // Extrai dados especÃ­ficos do formato do Banco Inter
        const sequenceStr = line.substring(10, 15);
        const sequenceNumber = parseInt(sequenceStr);
        
        // Encontra a posiÃ§Ã£o do padrÃ£o de data (DDMMAAAA seguido do valor)
        // Exemplo: S0201202602012026000000000005000000C
        // A data real Ã© a segunda (02012026 = 02/01/2026)
        const datePattern = line.match(/S\d{8}(\d{8})/);
        let date = '';
        if (datePattern) {
          const dateStr = datePattern[1]; // 02012026
          const day = dateStr.substring(0, 2);
          const month = dateStr.substring(2, 4);
          const year = dateStr.substring(4, 8);
          date = `${year}-${month}-${day}`;
        }
        
        if (!date) {
          console.log('âš ï¸ Data nÃ£o encontrada na linha:', line.substring(0, 100));
          continue;
        }
        
        // Atualiza datas min/max
        if (!minDate || date < minDate) minDate = date;
        if (!maxDate || date > maxDate) maxDate = date;
        
        // Valor: alguns arquivos vÃªm com 15, 16 ou 17 dÃ­gitos antes do tipo
        const valuePattern = line.match(/S\d{8}\d{8}(\d{15,17})([CD])?/);
        let amount = 0;
        if (valuePattern) {
          amount = parseInt(valuePattern[1]) / 100;
        }
        
        // DescriÃ§Ã£o: vem depois do cÃ³digo do banco (geralmente apÃ³s 7 dÃ­gitos)
        const descPattern = line.match(/[CD]\d{7}(.{25})/);
        const description = descPattern ? descPattern[1].trim() : 'Sem descriÃ§Ã£o';

        // Tipo: tenta encontrar apÃ³s o valor, depois por posiÃ§Ã£o fixa e por fim por texto
        const rawTypeLabel = `${valuePattern?.[2] || ''} ${line.substring(91, 92) || ''} ${description}`.trim();
        const type = parseTransactionType(rawTypeLabel || description, amount);
        
        // ReferÃªncia
        const reference = line.substring(135, 160).trim();
        
        // Cria a transaÃ§Ã£o
        const transaction: BankTransaction = {
          id: `bank-${date}-${sequenceNumber}-${reference}`,
          date,
          type,
          amount: Math.abs(amount),
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
  
  console.log('ðŸ¦ CNAB - Total de transaÃ§Ãµes encontradas:', transactions.length);
  console.log('ðŸ¦ CNAB - DistribuiÃ§Ã£o:', {
    creditos: transactions.filter(t => t.type === 'CREDIT').length,
    debitos: transactions.filter(t => t.type === 'DEBIT').length
  });
  console.log('ðŸ¦ CNAB - Primeiras 5 transaÃ§Ãµes:', transactions.slice(0, 5).map(t => ({
    date: t.date,
    type: t.type,
    amount: t.amount,
    description: t.description.substring(0, 30)
  })));
  
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
    initialBalance: 0, // NÃ£o disponÃ­vel no extrato simples
    finalBalance: credits - debits,
    totalTransactions: transactions.length,
    reconciledTransactions: 0,
    transactions,
    status: 'pending'
  };
  
  return reconciliation;
}

/**
 * Agrupa transaÃ§Ãµes de crÃ©dito por data
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
 * Calcula total de crÃ©ditos para uma data especÃ­fica
 */
export function getTotalCreditsForDate(transactions: BankTransaction[], date: string): number {
  return transactions
    .filter(t => t.type === 'CREDIT' && t.date === date)
    .reduce((sum, t) => sum + t.amount, 0);
}

/**
 * Filtra apenas transaÃ§Ãµes PIX recebidas
 */
export function getPixReceivedTransactions(transactions: BankTransaction[]): BankTransaction[] {
  return transactions.filter(t => 
    t.type === 'CREDIT' && 
    (t.description.includes('PIX RECEBIDO') || t.description.includes('RECEBIMENTO'))
  );
}
/**
 * Extrai apenas transaÃ§Ãµes de DÃ‰BITO
 */
export function getDebitTransactions(transactions: BankTransaction[]): BankTransaction[] {
  return transactions.filter(t => t.type === 'DEBIT').sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
}

/**
 * Calcula total de dÃ©bitos para uma data especÃ­fica
 */
export function getTotalDebitsForDate(transactions: BankTransaction[], date: string): number {
  return transactions
    .filter(t => t.type === 'DEBIT' && t.date === date)
    .reduce((sum, t) => sum + t.amount, 0);
}

/**
 * Tenta fazer matching automÃ¡tico entre dÃ©bitos e Bills
 * Retorna um objeto com score de confianÃ§a (0-100) para cada possÃ­vel match
 */
export function matchDebitWithBills(debit: BankTransaction, bills: any[]): { billId: string; score: number }[] {
  const matches: { billId: string; score: number }[] = [];
  const debitDate = new Date(debit.date);
  const debitAmount = debit.amount;
  
  bills.forEach(bill => {
    let score = 0;
    let scoreBreakdown = { amount: 0, date: 0, description: 0 };
    
    // Usa paidAmount se disponÃ­vel, senÃ£o usa amount
    const billAmount = bill.paidAmount || bill.amount;
    const amountDiff = Math.abs(billAmount - debitAmount);
    
    // Match de valor - mais flexÃ­vel
    if (amountDiff < 0.01) {
      // Match exato ou quase exato (atÃ© 1 centavo)
      score += 100;
      scoreBreakdown.amount = 100;
    } else if (amountDiff < 1) {
      // AtÃ© R$1 de diferenÃ§a
      score += 80;
      scoreBreakdown.amount = 80;
    } else if (amountDiff < 5) {
      // AtÃ© R$5 de diferenÃ§a
      score += 60;
      scoreBreakdown.amount = 60;
    } else if (amountDiff < 10) {
      // AtÃ© R$10 de diferenÃ§a
      score += 40;
      scoreBreakdown.amount = 40;
    } else if (amountDiff < 50) {
      // AtÃ© R$50 de diferenÃ§a (para contas maiores)
      score += 20;
      scoreBreakdown.amount = 20;
    }
    
    // Match de data - MUITO flexÃ­vel (atÃ© 30 dias)
    if (score > 0) {
      const billDate = new Date(bill.paidDate || bill.dueDate);
      const daysDiff = Math.abs(Math.floor((debitDate.getTime() - billDate.getTime()) / (1000 * 60 * 60 * 24)));
      
      if (daysDiff === 0) {
        score += 30; // Mesma data
        scoreBreakdown.date = 30;
      } else if (daysDiff <= 3) {
        score += 25; // Dentro de 3 dias
        scoreBreakdown.date = 25;
      } else if (daysDiff <= 7) {
        score += 20; // Dentro de 7 dias
        scoreBreakdown.date = 20;
      } else if (daysDiff <= 15) {
        score += 15; // Dentro de 15 dias
        scoreBreakdown.date = 15;
      } else if (daysDiff <= 30) {
        score += 10; // Dentro de 30 dias (muito flexÃ­vel)
        scoreBreakdown.date = 10;
      }
    }
    
    // Match de descriÃ§Ã£o (configuraÃ§Ã£o fuzzy bÃ¡sica)
    if (score > 0 && bill.description) {
      const debitDesc = debit.description.toUpperCase();
      const billDesc = bill.description.toUpperCase();
      
      // Verifica se tem palavras em comum (mÃ­nimo 3 caracteres)
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
        scoreBreakdown.description = 10;
      }
    }
    
    // Log detalhado para debugging
    if (score > 0 && score < 60) {
      console.log(`âš ï¸ MATCH BAIXO (${score} pts) - DÃ©bito: R$${debitAmount.toFixed(2)} em ${debit.date} vs Bill: R$${billAmount.toFixed(2)} venc ${bill.dueDate} pago ${bill.paidDate || 'N/A'}`);
      console.log(`   Breakdown: valor=${scoreBreakdown.amount}, data=${scoreBreakdown.date}, desc=${scoreBreakdown.description} | Diff: R$${amountDiff.toFixed(2)}`);
    }
    
    if (score > 0) {
      matches.push({ billId: bill.id, score });
    }
  });
  
  // Retorna matches ordenados por score descendente, apenas >= 30 (threshold muito baixo para capturar mais)
  const validMatches = matches.filter(m => m.score >= 30);
  
  if (matches.length > 0 && validMatches.length === 0) {
    console.log(`ðŸ” DÃ©bito R$${debitAmount.toFixed(2)} em ${debit.date} teve ${matches.length} matches mas todos abaixo de 30 pts`);
    console.log(`   Melhores scores: ${matches.slice(0, 3).map(m => m.score).join(', ')}`);
  }
  
  return validMatches.sort((a, b) => b.score - a.score);
}

function normalizeTransactionTypeLabel(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function parseTransactionType(typeLabel: string, amount: number): 'CREDIT' | 'DEBIT' {
  const normalizedType = normalizeTransactionTypeLabel(typeLabel);

  if (
    normalizedType === 'C' ||
    normalizedType === '+' ||
    normalizedType.includes('CREDITO') ||
    normalizedType.includes('CREDITO') ||
    normalizedType.includes('RECEBIDO') ||
    normalizedType.includes('RECEBIMENTO') ||
    normalizedType.includes('ENTRADA')
  ) {
    return 'CREDIT';
  }

  if (
    normalizedType === 'D' ||
    normalizedType === '-' ||
    normalizedType.includes('DEBITO') ||
    normalizedType.includes('ENVIADO') ||
    normalizedType.includes('PAGAMENTO') ||
    normalizedType.includes('SAIDA') ||
    normalizedType.includes('TARIFA') ||
    normalizedType.includes('TRANSFER')
  ) {
    return 'DEBIT';
  }

  return amount < 0 ? 'DEBIT' : 'CREDIT';
}

function normalizeHeaderLabel(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function isLikelyTxtHeader(parts: string[]): boolean {
  const normalized = parts.map(normalizeHeaderLabel);
  return (
    normalized.some((part) => part.includes('data')) &&
    normalized.some((part) => part.includes('valor')) &&
    normalized.some((part) =>
      part.includes('descricao') ||
      part.includes('historico') ||
      part.includes('operacao')
    )
  );
}

function buildHeaderMap(parts: string[]) {
  const normalizedParts = parts.map(normalizeHeaderLabel);
  const findIndex = (terms: string[], options?: { exclude?: string[] }) =>
    normalizedParts.findIndex((part) => {
      if (options?.exclude?.some(term => part.includes(term))) {
        return false;
      }

      return terms.some((term) => part.includes(term));
    });

  const date = findIndex(['data']);
  const description = findIndex(['descricao', 'historico', 'operacao'], { exclude: ['data'] });

  return {
    date,
    description: description >= 0 ? description : findIndex(['lancamento'], { exclude: ['data'] }),
    type: findIndex(['tipo', 'natureza']),
    amount: findIndex(['valor', 'montante']),
    counterparty: findIndex(['favorecido', 'fornecedor', 'beneficiario', 'cliente', 'nome']),
    document: findIndex(['cpf', 'cnpj', 'documento']),
    reference: findIndex(['referencia', 'controle', 'protocolo', 'id', 'nsu', 'autenticacao']),
  };
}

function parseTxtDate(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';

  if (trimmed.includes('/')) {
    const [day, month, year] = trimmed.split('/');
    if (day && month && year) {
      return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }
  }

  if (trimmed.includes('-')) {
    const parts = trimmed.split('-');
    if (parts.length === 3 && parts[0].length === 2) {
      return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
    }
    if (parts.length === 3 && parts[0].length === 4) {
      return trimmed;
    }
  }

  return '';
}

function extractDocumentFromText(value: string): string | undefined {
  const match = value.match(/\d{2,3}\.?\d{3}\.?\d{3}[\/-]?\d{2,4}|\d{3}\.?\d{3}\.?\d{3}-?\d{2}/);
  return match?.[0];
}

function extractReferenceFromText(value: string): string | undefined {
  const match = value.match(/[A-Z0-9]{8,}/i);
  return match?.[0];
}

/**
 * Parser para TXT simples (extrato em formato de texto puro)
 * Formato esperado: Data | DescriÃ§Ã£o | Tipo (C/D) | Valor
 * Exemplo: 25/01/2026 | PIX RECEBIDO | C | 1000.00
 */
export function parseTextExtract(fileContent: string, fileName: string, uploadedBy: string): BankReconciliation {
  const lines = fileContent.split('\n').filter(line => line.trim().length > 0);
  const transactions: BankTransaction[] = [];
  let minDate = '';
  let maxDate = '';
  let headerMap: ReturnType<typeof buildHeaderMap> | null = null;

  lines.forEach((line, index) => {
    try {
      const parts = line.includes('|')
        ? line.split('|').map(p => p.trim())
        : line.split('\t').map(p => p.trim());

      if (parts.length < 4) return;
      if (line.includes('---')) return;

      if (isLikelyTxtHeader(parts)) {
        headerMap = buildHeaderMap(parts);
        return;
      }

      const dateIndex = headerMap?.date ?? 0;
      const amountIndex = headerMap?.amount ?? 3;
      const typeIndex = headerMap?.type ?? 2;
      const descriptionIndex = headerMap?.description ?? 1;
      const counterpartyIndex = headerMap?.counterparty ?? -1;
      const documentIndex = headerMap?.document ?? -1;
      const referenceIndex = headerMap?.reference ?? -1;

      const dateStr = parts[dateIndex] || parts[0] || '';
      const amountCell = parts[amountIndex] || parts.find(part => /\d+[.,]\d{2}/.test(part)) || '';
      const typeLabel = parts[typeIndex] || '';
      const descriptionCell = parts[descriptionIndex] || '';
      const counterpartyCell = counterpartyIndex >= 0 ? parts[counterpartyIndex] || '' : '';
      const documentCell = documentIndex >= 0 ? parts[documentIndex] || '' : '';
      const referenceCell = referenceIndex >= 0 ? parts[referenceIndex] || '' : '';
      const amount = parseBrazilianAmount(amountCell);

      let date = parseTxtDate(dateStr);
      if (!date) {
        date = parseTxtDate(parts.find(part => /(\d{2}\/\d{2}\/\d{4})|(\d{4}-\d{2}-\d{2})/.test(part)) || '');
      }

      if (!date) return;
      if (!Number.isFinite(amount) || amount === 0) return;

      const textParts = parts.filter((part, partIndex) =>
        part &&
        partIndex !== dateIndex &&
        partIndex !== amountIndex &&
        partIndex !== typeIndex
      );

      const description = descriptionCell || textParts[0] || 'Sem descrição';
      const counterparty = counterpartyCell || (
        textParts.find((part) => {
          const normalized = normalizeHeaderLabel(part);
          return normalized.length > 3 && normalized !== normalizeHeaderLabel(description);
        }) || ''
      );
      const document = documentCell || extractDocumentFromText(parts.join(' '));
      const reference = referenceCell || extractReferenceFromText(parts.join(' ')) || `${index}`;
      const type = parseTransactionType(`${typeLabel} ${description} ${counterparty}`, amount);

      if (!minDate || date < minDate) minDate = date;
      if (!maxDate || date > maxDate) maxDate = date;

      const transaction: BankTransaction = {
        id: `txt-${date}-${index}-${description}`,
        date,
        type,
        amount: Math.abs(amount),
        description,
        counterparty: counterparty || undefined,
        reference,
        document: document || undefined,
        reconciled: false
      };

      transactions.push(transaction);
    } catch (error) {
      console.error('Erro ao processar linha TXT:', line, error);
    }
  });

  const credits = transactions.filter(t => t.type === 'CREDIT').reduce((sum, t) => sum + t.amount, 0);
  const debits = transactions.filter(t => t.type === 'DEBIT').reduce((sum, t) => sum + t.amount, 0);

  const reconciliation: BankReconciliation = {
    id: `reconciliation-${Date.now()}`,
    uploadedAt: new Date().toISOString(),
    uploadedBy,
    fileName,
    bankName: 'Banco Inter (TXT)',
    accountNumber: 'Desconhecida',
    startDate: minDate || '',
    endDate: maxDate || '',
    initialBalance: 0,
    finalBalance: credits - debits,
    totalTransactions: transactions.length,
    reconciledTransactions: 0,
    transactions,
    status: 'pending'
  };

  return reconciliation;
}

export function parseCsvExtract(fileContent: string, fileName: string, uploadedBy: string): BankReconciliation {
  const lines = fileContent
    .split(/\r?\n/)
    .map(line => line.replace(/^\uFEFF/, '').trim())
    .filter(line => line.length > 0);

  const splitCsvLine = (line: string, delimiter: string): string[] => {
    const cells: string[] = [];
    let current = '';
    let insideQuotes = false;

    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];
      const nextChar = line[index + 1];

      if (char === '"') {
        if (insideQuotes && nextChar === '"') {
          current += '"';
          index += 1;
        } else {
          insideQuotes = !insideQuotes;
        }
        continue;
      }

      if (!insideQuotes && char === delimiter) {
        cells.push(current.trim().replace(/^"|"$/g, ''));
        current = '';
        continue;
      }

      current += char;
    }

    cells.push(current.trim().replace(/^"|"$/g, ''));
    return cells;
  };

  const countDelimiter = (line: string, delimiter: string): number => {
    let count = 0;
    let insideQuotes = false;

    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];
      const nextChar = line[index + 1];

      if (char === '"') {
        if (insideQuotes && nextChar === '"') {
          index += 1;
        } else {
          insideQuotes = !insideQuotes;
        }
        continue;
      }

      if (!insideQuotes && char === delimiter) {
        count += 1;
      }
    }

    return count;
  };

  const detectDelimiter = (): string => {
    const candidates = [';', ',', '\t', '|'];
    const sampleLines = lines.slice(0, 10);
    let bestDelimiter = ';';
    let bestScore = -1;

    candidates.forEach((candidate) => {
      const score = sampleLines.reduce((sum, line) => sum + countDelimiter(line, candidate), 0);
      if (score > bestScore) {
        bestScore = score;
        bestDelimiter = candidate;
      }
    });

    return bestDelimiter;
  };

  const delimiter = detectDelimiter();
  const amountPattern = /-?\d{1,3}(?:\.\d{3})*,\d{2}|-?\d+[.,]\d{2}/;
  const findAmountIndex = (parts: string[]) => parts.findIndex(part => amountPattern.test(part));
  const findDateIndex = (parts: string[]) => parts.findIndex(part => /^(\d{2}\/\d{2}\/\d{4}|\d{4}-\d{2}-\d{2}|\d{2}-\d{2}-\d{4})$/.test(part));

  const transactions: BankTransaction[] = [];
  let accountNumber = 'Desconhecida';
  let minDate = '';
  let maxDate = '';
  let initialBalance = 0;
  let headerMap: ReturnType<typeof buildHeaderMap> | null = null;

  lines.forEach((line, index) => {
    try {
      const parts = splitCsvLine(line, delimiter).map(part => part.trim()).filter(part => part.length > 0);
      if (parts.length === 0) return;

      const firstCell = normalizeHeaderLabel(parts[0]);

      if (firstCell === 'conta') {
        accountNumber = parts[1] || accountNumber;
        return;
      }

      if (firstCell === 'saldo') {
        const balanceCell = parts.find(part => amountPattern.test(part)) || parts[1] || '0';
        initialBalance = parseBrazilianAmount(balanceCell);
        return;
      }

      if (
        firstCell.includes('extrato conta corrente') ||
        firstCell === 'periodo' ||
        firstCell === 'per iodo' ||
        firstCell === 'periodo de' ||
        line.startsWith('Extrato Conta Corrente')
      ) {
        return;
      }

      if (isLikelyTxtHeader(parts)) {
        headerMap = buildHeaderMap(parts);
        return;
      }

      if (parts.every(part => normalizeHeaderLabel(part).length > 0 && !amountPattern.test(part)) && findDateIndex(parts) === -1) {
        return;
      }

      const resolveIndex = (mappedIndex: number | undefined, fallbackIndex: number): number =>
        typeof mappedIndex === 'number' && mappedIndex >= 0 ? mappedIndex : fallbackIndex;

      const dateIndex = resolveIndex(headerMap?.date, findDateIndex(parts));
      const amountIndex = resolveIndex(headerMap?.amount, findAmountIndex(parts));
      const typeIndex = resolveIndex(headerMap?.type, parts.findIndex(part => ['c', 'd', 'credito', 'debito'].includes(normalizeHeaderLabel(part))));
      const descriptionIndex = resolveIndex(
        headerMap?.description,
        parts.findIndex((part, partIndex) => partIndex !== dateIndex && partIndex !== amountIndex && partIndex !== typeIndex && !amountPattern.test(part))
      );
      const counterpartyIndex = resolveIndex(
        headerMap?.counterparty,
        parts.findIndex((part, partIndex) => partIndex !== dateIndex && partIndex !== amountIndex && partIndex !== typeIndex && partIndex !== descriptionIndex && normalizeHeaderLabel(part).length > 2)
      );
      const documentIndex = resolveIndex(
        headerMap?.document,
        parts.findIndex(part => /\d{11,14}|\d{3}\.\d{3}\.\d{3}-\d{2}|\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/.test(part))
      );
      const referenceIndex = resolveIndex(
        headerMap?.reference,
        parts.findIndex((part, partIndex) => partIndex !== dateIndex && partIndex !== amountIndex && /^[A-Z0-9-]*\d[A-Z0-9-]{5,}$/i.test(part))
      );

      const rawDate = dateIndex >= 0 ? parts[dateIndex] || '' : '';
      const rawAmount = amountIndex >= 0 ? parts[amountIndex] || '' : '';
      const rawType = typeIndex >= 0 ? parts[typeIndex] || '' : '';
      const date = parseTxtDate(rawDate);
      const amount = parseBrazilianAmount(rawAmount);

      if (!date || !Number.isFinite(amount) || amount === 0) return;

      const fallbackTextParts = parts.filter((part, partIndex) =>
        partIndex !== dateIndex &&
        partIndex !== amountIndex &&
        partIndex !== typeIndex
      );

      const history = descriptionIndex >= 0 ? parts[descriptionIndex] || '' : fallbackTextParts[0] || 'Sem histórico';
      const counterparty = counterpartyIndex >= 0 ? parts[counterpartyIndex] || '' : fallbackTextParts.find(part => part !== history) || '';
      const document = documentIndex >= 0 ? parts[documentIndex] || '' : extractDocumentFromText(parts.join(' '));
      const extractedReference = extractReferenceFromText(parts.join(' '));
      const reference = referenceIndex >= 0
        ? parts[referenceIndex] || ''
        : (extractedReference && /\d/.test(extractedReference) ? extractedReference : `${index}`);
      const type = parseTransactionType(`${rawType} ${history} ${counterparty}`, amount);

      if (!minDate || date < minDate) minDate = date;
      if (!maxDate || date > maxDate) maxDate = date;

      transactions.push({
        id: `csv-${date}-${index}-${history}`,
        date,
        type,
        amount: Math.abs(amount),
        description: history,
        counterparty: counterparty || undefined,
        reference,
        document: document || undefined,
        reconciled: false
      });
    } catch (error) {
      console.error('Erro ao processar linha CSV:', line, error);
    }
  });

  const credits = transactions.filter(t => t.type === 'CREDIT').reduce((sum, t) => sum + t.amount, 0);
  const debits = transactions.filter(t => t.type === 'DEBIT').reduce((sum, t) => sum + t.amount, 0);

  return {
    id: `reconciliation-${Date.now()}`,
    uploadedAt: new Date().toISOString(),
    uploadedBy,
    fileName,
    bankName: 'Banco Inter (CSV)',
    accountNumber,
    startDate: minDate || '',
    endDate: maxDate || '',
    initialBalance,
    finalBalance: credits - debits,
    totalTransactions: transactions.length,
    reconciledTransactions: 0,
    transactions,
    status: 'pending'
  };
}
/**
 * Parser para PDF (placeholder - requer biblioteca PDF)
 * Por enquanto retorna erro sugestivo
 */
function parseBrazilianAmount(value: string): number {
  const cleaned = value
    .replace(/[R$\s]/g, '')
    .replace(/\./g, '')
    .replace(',', '.')
    .replace(/[^0-9.-]/g, '');

  return parseFloat(cleaned);
}

function extractPdfDateRange(lines: string[]): { startDate: string; endDate: string; yearFallback?: string } {
  const dateRangeRegex = /(\d{2}\/\d{2}\/\d{4}).*(\d{2}\/\d{2}\/\d{4})/;

  for (const line of lines) {
    const match = line.match(dateRangeRegex);
    if (match) {
      const [start, end] = [match[1], match[2]];
      const startParts = start.split('/');
      const endParts = end.split('/');
      return {
        startDate: `${startParts[2]}-${startParts[1]}-${startParts[0]}`,
        endDate: `${endParts[2]}-${endParts[1]}-${endParts[0]}`,
        yearFallback: startParts[2]
      };
    }
  }

  return { startDate: '', endDate: '' };
}

function normalizePdfLine(line: string): string {
  return line.replace(/\s+/g, ' ').trim();
}

function shouldSkipPdfLine(line: string): boolean {
  const upper = line.toUpperCase();
  const blacklist = [
    'EXTRATO',
    'PERIODO',
    'PERÃODO',
    'SALDO',
    'TOTAL',
    'AGENCIA',
    'AGÃŠNCIA',
    'CONTA',
    'BANCO',
    'CLIENTE',
    'DATA',
    'HISTORICO',
    'HISTÃ“RICO',
    'VALOR'
  ];

  return blacklist.some(term => upper.includes(term));
}

async function extractPdfLines(fileContent: ArrayBuffer): Promise<string[]> {
  const loadingTask = pdfjsLib.getDocument({ data: fileContent });
  const pdf = await loadingTask.promise;
  const allLines: string[] = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum += 1) {
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();
    const lineMap = new Map<number, { y: number; parts: { x: number; str: string }[] }>();

    textContent.items.forEach((item: any) => {
      if (!item || typeof item.str !== 'string') return;
      const str = item.str.trim();
      if (!str) return;

      const transform = item.transform as number[];
      const x = transform[4];
      const y = transform[5];
      const roundedY = Math.round(y * 2) / 2;
      const entry = lineMap.get(roundedY) || { y: roundedY, parts: [] };
      entry.parts.push({ x, str });
      lineMap.set(roundedY, entry);
    });

    const pageLines = Array.from(lineMap.values())
      .sort((a, b) => b.y - a.y)
      .map(line =>
        line.parts
          .sort((a, b) => a.x - b.x)
          .map(part => part.str)
          .join(' ')
      )
      .map(normalizePdfLine)
      .filter(Boolean);

    allLines.push(...pageLines);
  }

  return allLines;
}

export async function parsePdfExtract(fileContent: ArrayBuffer, fileName: string, uploadedBy: string): Promise<BankReconciliation> {
  const lines = await extractPdfLines(fileContent);
  console.log('ðŸ“„ PDF - Total de linhas extraÃ­das:', lines.length);
  console.log('ðŸ“„ PDF - Primeiras 20 linhas:', lines.slice(0, 20));
  
  const { startDate, endDate, yearFallback } = extractPdfDateRange(lines);
  console.log('ðŸ“… PerÃ­odo detectado:', { startDate, endDate, yearFallback });
  
  const transactions: BankTransaction[] = [];
  let minDate = '';
  let maxDate = '';
  const amountRegex = /-?\d{1,3}(?:\.\d{3})*,\d{2}|-?\d+\.\d{2}/g;

  lines
    .map(normalizePdfLine)
    .filter(line => line.length > 0)
    .forEach((line, index) => {
      if (shouldSkipPdfLine(line)) return;

      const dateMatch = line.match(/\b\d{2}\/\d{2}\/\d{4}\b|\b\d{2}\/\d{2}\b/);
      if (!dateMatch) return;

      const rawDate = dateMatch[0];
      let date = '';
      if (rawDate.length === 10) {
        const [day, month, year] = rawDate.split('/');
        date = `${year}-${month}-${day}`;
      } else if (yearFallback) {
        const [day, month] = rawDate.split('/');
        date = `${yearFallback}-${month}-${day}`;
      }

      if (!date) return;

      const amountMatches = Array.from(line.matchAll(amountRegex));
      if (amountMatches.length === 0) return;

      const amountMatch = amountMatches.length > 1
        ? amountMatches[amountMatches.length - 2]
        : amountMatches[0];

      const amount = parseBrazilianAmount(amountMatch[0]);
      if (!Number.isFinite(amount) || amount === 0) return;

      const upper = line.toUpperCase();
      let type: 'CREDIT' | 'DEBIT' = 'CREDIT';
      if (amountMatch[0].trim().startsWith('-')) {
        type = 'DEBIT';
      } else if (upper.includes('DEBITO') || upper.includes('DÃ‰BITO') || upper.includes('PAGAMENTO') || upper.includes('SAIDA') || upper.includes('SAÃDA') || upper.includes('TARIFA') || upper.includes('PIX ENVIADO') || upper.includes('TRANSFER')) {
        type = 'DEBIT';
      } else if (upper.includes('CREDITO') || upper.includes('CRÃ‰DITO') || upper.includes('RECEB') || upper.includes('ENTRADA') || upper.includes('PIX RECEBIDO')) {
        type = 'CREDIT';
      }

      let description = line;
      description = description.replace(rawDate, '').trim();
      description = description.replace(amountRegex, '').trim();
      description = description.replace(/\bC\b|\bD\b|\bCREDITO\b|\bCRÃ‰DITO\b|\bDEBITO\b|\bDÃ‰BITO\b/gi, '').trim();
      description = normalizePdfLine(description);

      if (!description) return;

      if (!minDate || date < minDate) minDate = date;
      if (!maxDate || date > maxDate) maxDate = date;

      console.log('âœ… TransaÃ§Ã£o encontrada:', { date, type, amount, description: description.substring(0, 50) });

      transactions.push({
        id: `pdf-${date}-${index}-${description}`,
        date,
        type,
        amount: Math.abs(amount),
        description,
        reference: `${index}`,
        reconciled: false
      });
    });

  console.log('ðŸ’° Total de transaÃ§Ãµes encontradas:', transactions.length);

  const credits = transactions.filter(t => t.type === 'CREDIT').reduce((sum, t) => sum + t.amount, 0);
  const debits = transactions.filter(t => t.type === 'DEBIT').reduce((sum, t) => sum + t.amount, 0);

  return {
    id: `reconciliation-${Date.now()}`,
    uploadedAt: new Date().toISOString(),
    uploadedBy,
    fileName,
    bankName: 'Banco Inter (PDF)',
    accountNumber: 'Desconhecida',
    startDate: minDate || startDate || '',
    endDate: maxDate || endDate || '',
    initialBalance: 0,
    finalBalance: credits - debits,
    totalTransactions: transactions.length,
    reconciledTransactions: 0,
    transactions,
    status: 'pending'
  };
}

/**
 * Parser universal - detecta e rota para o formato correto
 */
export async function parseUniversalBankExtract(
  fileContent: string | ArrayBuffer,
  fileName: string,
  uploadedBy: string
): Promise<BankReconciliation> {
  const format = detectFileFormat(fileContent, fileName);
  
  console.log('ðŸ” Formato detectado:', format, 'para arquivo:', fileName);
  console.log('ðŸ” Tipo de conteÃºdo:', typeof fileContent);
  
  switch (format) {
    case FileFormat.CNAB:
      if (typeof fileContent !== 'string') {
        throw new Error('Conteudo invalido para CNAB.');
      }
      {
        const cnabResult = parseBancoInterCNAB(fileContent, fileName, uploadedBy);
        if (cnabResult.transactions.length > 0 || !fileName.toLowerCase().endsWith('.txt')) {
          return cnabResult;
        }

        return parseTextExtract(fileContent, fileName, uploadedBy);
      }
    case FileFormat.TXT:
      if (typeof fileContent !== 'string') {
        throw new Error('Conteudo invalido para TXT.');
      }
      return parseTextExtract(fileContent, fileName, uploadedBy);
    case FileFormat.CSV:
      if (typeof fileContent !== 'string') {
        throw new Error('Conteudo invalido para CSV.');
      }
      return parseCsvExtract(fileContent, fileName, uploadedBy);
    case FileFormat.PDF:
      if (typeof fileContent === 'string') {
        throw new Error('Conteudo invalido para PDF.');
      }
      return parsePdfExtract(fileContent, fileName, uploadedBy);
    default:
      // Tenta CNAB por default
      if (typeof fileContent !== 'string') {
        return parsePdfExtract(fileContent, fileName, uploadedBy);
      }

      try {
        const cnabResult = parseBancoInterCNAB(fileContent, fileName, uploadedBy);
        return cnabResult.transactions.length > 0
          ? cnabResult
          : parseTextExtract(fileContent, fileName, uploadedBy);
      } catch {
        return parseTextExtract(fileContent, fileName, uploadedBy);
      }
  }
}


