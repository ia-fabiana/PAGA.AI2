import { BankTransaction, BankReconciliation } from './types';
import * as pdfjsLib from 'pdfjs-dist';

// Configure worker via CDN (mais compatível com Vite)
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

/**
 * Parser genérico para múltiplos formatos de extrato bancário
 * Suporta: CNAB 240, TXT, PDF
 */

export enum FileFormat {
  CNAB = 'CNAB',
  TXT = 'TXT',
  PDF = 'PDF',
  UNKNOWN = 'UNKNOWN'
}

/**
 * Detecta o formato do arquivo baseado no conteúdo e extensão
 */
export function detectFileFormat(fileContent: string | ArrayBuffer, fileName: string): FileFormat {
  const ext = fileName.split('.').pop()?.toUpperCase() || '';

  if (ext === 'PDF') {
    return FileFormat.PDF;
  }

  if (ext === 'RET' || ext === 'TXT') {
    return FileFormat.CNAB;
  }

  if (typeof fileContent === 'string') {
    // Se começar com CNAB pattern
    if (fileContent.includes('0770001300')) {
      return FileFormat.CNAB;
    }

    // Tenta detectar por conteúdo
    if (fileContent.includes('PIX') && fileContent.includes('RECEBIDO')) {
      return FileFormat.CNAB;
    }
  }

  return FileFormat.UNKNOWN;
}

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
  
  console.log('🏦 CNAB - Total de linhas:', lines.length);
  console.log('🏦 CNAB - Primeira linha:', lines[0]?.substring(0, 50));
  
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
        
        // Encontra a posição do padrão de data (DDMMAAAA seguido do valor)
        // Exemplo: S0201202602012026000000000005000000C
        // A data real é a segunda (02012026 = 02/01/2026)
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
          console.log('⚠️ Data não encontrada na linha:', line.substring(0, 100));
          continue;
        }
        
        // Atualiza datas min/max
        if (!minDate || date < minDate) minDate = date;
        if (!maxDate || date > maxDate) maxDate = date;
        
        // Valor: vem depois da data, 17 dígitos (15 + 2 decimais)
        const valuePattern = line.match(/S\d{8}\d{8}(\d{17})/);
        let amount = 0;
        if (valuePattern) {
          amount = parseInt(valuePattern[1]) / 100;
        }
        
        // Tipo: vem logo depois do valor (C ou D)
        const typePattern = line.match(/S\d{8}\d{8}\d{17}([CD])/);
        const typeChar = typePattern ? typePattern[1] : 'D';
        const type: 'CREDIT' | 'DEBIT' = typeChar === 'C' ? 'CREDIT' : 'DEBIT';
        
        // Descrição: vem depois do código do banco (geralmente após 7 dígitos)
        const descPattern = line.match(/[CD]\d{7}(.{25})/);
        const description = descPattern ? descPattern[1].trim() : 'Sem descrição';
        
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
  
  console.log('🏦 CNAB - Total de transações encontradas:', transactions.length);
  console.log('🏦 CNAB - Distribuição:', {
    creditos: transactions.filter(t => t.type === 'CREDIT').length,
    debitos: transactions.filter(t => t.type === 'DEBIT').length
  });
  console.log('🏦 CNAB - Primeiras 5 transações:', transactions.slice(0, 5).map(t => ({
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
    let scoreBreakdown = { amount: 0, date: 0, description: 0 };
    
    // Usa paidAmount se disponível, senão usa amount
    const billAmount = bill.paidAmount || bill.amount;
    const amountDiff = Math.abs(billAmount - debitAmount);
    
    // Match de valor - mais flexível
    if (amountDiff < 0.01) {
      // Match exato ou quase exato (até 1 centavo)
      score += 100;
      scoreBreakdown.amount = 100;
    } else if (amountDiff < 1) {
      // Até R$1 de diferença
      score += 80;
      scoreBreakdown.amount = 80;
    } else if (amountDiff < 5) {
      // Até R$5 de diferença
      score += 60;
      scoreBreakdown.amount = 60;
    } else if (amountDiff < 10) {
      // Até R$10 de diferença
      score += 40;
      scoreBreakdown.amount = 40;
    } else if (amountDiff < 50) {
      // Até R$50 de diferença (para contas maiores)
      score += 20;
      scoreBreakdown.amount = 20;
    }
    
    // Match de data - MUITO flexível (até 30 dias)
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
        score += 10; // Dentro de 30 dias (muito flexível)
        scoreBreakdown.date = 10;
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
        scoreBreakdown.description = 10;
      }
    }
    
    // Log detalhado para debugging
    if (score > 0 && score < 60) {
      console.log(`⚠️ MATCH BAIXO (${score} pts) - Débito: R$${debitAmount.toFixed(2)} em ${debit.date} vs Bill: R$${billAmount.toFixed(2)} venc ${bill.dueDate} pago ${bill.paidDate || 'N/A'}`);
      console.log(`   Breakdown: valor=${scoreBreakdown.amount}, data=${scoreBreakdown.date}, desc=${scoreBreakdown.description} | Diff: R$${amountDiff.toFixed(2)}`);
    }
    
    if (score > 0) {
      matches.push({ billId: bill.id, score });
    }
  });
  
  // Retorna matches ordenados por score descendente, apenas >= 30 (threshold muito baixo para capturar mais)
  const validMatches = matches.filter(m => m.score >= 30);
  
  if (matches.length > 0 && validMatches.length === 0) {
    console.log(`🔍 Débito R$${debitAmount.toFixed(2)} em ${debit.date} teve ${matches.length} matches mas todos abaixo de 30 pts`);
    console.log(`   Melhores scores: ${matches.slice(0, 3).map(m => m.score).join(', ')}`);
  }
  
  return validMatches.sort((a, b) => b.score - a.score);
}

/**
 * Parser para TXT simples (extrato em formato de texto puro)
 * Formato esperado: Data | Descrição | Tipo (C/D) | Valor
 * Exemplo: 25/01/2026 | PIX RECEBIDO | C | 1000.00
 */
export function parseTextExtract(fileContent: string, fileName: string, uploadedBy: string): BankReconciliation {
  const lines = fileContent.split('\n').filter(line => line.trim().length > 0);
  const transactions: BankTransaction[] = [];
  let minDate = '';
  let maxDate = '';
  
  lines.forEach((line, index) => {
    // Pula header ou linhas com títulos
    if (line.includes('Data') || line.includes('Descrição') || line.includes('Valor') || line.includes('---')) {
      return;
    }
    
    try {
      // Tenta fazer parse de diferentes separadores: | , Tab
      const parts = line.includes('|') 
        ? line.split('|').map(p => p.trim())
        : line.split('\t').map(p => p.trim());
      
      if (parts.length < 4) return;
      
      // Esperado: [data, descrição, tipo, valor, ...]
      const dateStr = parts[0];
      const description = parts[1];
      const typeChar = parts[2].toUpperCase();
      const amountStr = parts[3].replace(/[R$\s,]/g, '').replace('.', '').replace(',', '.');
      
      // Parse da data (DD/MM/YYYY ou DD-MM-YYYY)
      let date = '';
      if (dateStr.includes('/')) {
        const [day, month, year] = dateStr.split('/');
        date = `${year}-${month}-${day}`;
      } else if (dateStr.includes('-')) {
        const parts = dateStr.split('-');
        if (parts.length === 3 && parts[0].length === 2) {
          // DD-MM-YYYY
          date = `${parts[2]}-${parts[1]}-${parts[0]}`;
        } else {
          // YYYY-MM-DD
          date = dateStr;
        }
      }
      
      if (!date) return;
      
      const type: 'CREDIT' | 'DEBIT' = typeChar === 'C' ? 'CREDIT' : 'DEBIT';
      const amount = parseFloat(amountStr) || 0;
      
      if (amount > 0) {
        // Atualiza datas min/max
        if (!minDate || date < minDate) minDate = date;
        if (!maxDate || date > maxDate) maxDate = date;
        
        const transaction: BankTransaction = {
          id: `txt-${date}-${index}-${description}`,
          date,
          type,
          amount,
          description,
          reference: `${index}`,
          reconciled: false
        };
        
        transactions.push(transaction);
      }
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
    'PERÍODO',
    'SALDO',
    'TOTAL',
    'AGENCIA',
    'AGÊNCIA',
    'CONTA',
    'BANCO',
    'CLIENTE',
    'DATA',
    'HISTORICO',
    'HISTÓRICO',
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
  console.log('📄 PDF - Total de linhas extraídas:', lines.length);
  console.log('📄 PDF - Primeiras 20 linhas:', lines.slice(0, 20));
  
  const { startDate, endDate, yearFallback } = extractPdfDateRange(lines);
  console.log('📅 Período detectado:', { startDate, endDate, yearFallback });
  
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
      } else if (upper.includes('DEBITO') || upper.includes('DÉBITO') || upper.includes('PAGAMENTO') || upper.includes('SAIDA') || upper.includes('SAÍDA') || upper.includes('TARIFA') || upper.includes('PIX ENVIADO') || upper.includes('TRANSFER')) {
        type = 'DEBIT';
      } else if (upper.includes('CREDITO') || upper.includes('CRÉDITO') || upper.includes('RECEB') || upper.includes('ENTRADA') || upper.includes('PIX RECEBIDO')) {
        type = 'CREDIT';
      }

      let description = line;
      description = description.replace(rawDate, '').trim();
      description = description.replace(amountRegex, '').trim();
      description = description.replace(/\bC\b|\bD\b|\bCREDITO\b|\bCRÉDITO\b|\bDEBITO\b|\bDÉBITO\b/gi, '').trim();
      description = normalizePdfLine(description);

      if (!description) return;

      if (!minDate || date < minDate) minDate = date;
      if (!maxDate || date > maxDate) maxDate = date;

      console.log('✅ Transação encontrada:', { date, type, amount, description: description.substring(0, 50) });

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

  console.log('💰 Total de transações encontradas:', transactions.length);

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
  
  console.log('🔍 Formato detectado:', format, 'para arquivo:', fileName);
  console.log('🔍 Tipo de conteúdo:', typeof fileContent);
  
  switch (format) {
    case FileFormat.CNAB:
      if (typeof fileContent !== 'string') {
        throw new Error('Conteudo invalido para CNAB.');
      }
      return parseBancoInterCNAB(fileContent, fileName, uploadedBy);
    case FileFormat.TXT:
      if (typeof fileContent !== 'string') {
        throw new Error('Conteudo invalido para TXT.');
      }
      return parseTextExtract(fileContent, fileName, uploadedBy);
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
        return parseBancoInterCNAB(fileContent, fileName, uploadedBy);
      } catch {
        return parseTextExtract(fileContent, fileName, uploadedBy);
      }
  }
}
