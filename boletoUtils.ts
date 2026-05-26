import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { BoletoExtractionSource } from './types';

if (typeof window !== 'undefined' && !GlobalWorkerOptions.workerSrc) {
  GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
}

const boletoCandidateRegex = /(?:\d[\s.-]*){44,60}/g;

export const normalizeBoletoCode = (value: string) => value.replace(/\D/g, '');

export const formatBoletoCode = (value?: string) => {
  const digits = normalizeBoletoCode(value || '');
  if (!digits) return '';
  return digits.replace(/(\d{5})(?=\d)/g, '$1 ').trim();
};

export const getBoletoBarcodeValue = (value?: string) => {
  const digits = normalizeBoletoCode(value || '');
  if (!digits) return '';
  if (digits.length === 44) return digits;
  if (digits.length === 47) {
    return `${digits.slice(0, 4)}${digits.slice(32, 33)}${digits.slice(33)}${digits.slice(4, 9)}${digits.slice(10, 20)}${digits.slice(21, 31)}`;
  }
  if (digits.length === 48) {
    return `${digits.slice(0, 11)}${digits.slice(12, 23)}${digits.slice(24, 35)}${digits.slice(36, 47)}`;
  }
  return '';
};

const interleaved2of5Patterns: Record<string, string> = {
  '0': 'nnwwn',
  '1': 'wnnnw',
  '2': 'nwnnw',
  '3': 'wwnnn',
  '4': 'nnwnw',
  '5': 'wnwnn',
  '6': 'nwwnn',
  '7': 'nnnww',
  '8': 'wnnwn',
  '9': 'nwnwn',
};

const buildInterleaved2of5Widths = (value: string) => {
  const digits = value.length % 2 === 0 ? value : `0${value}`;
  const widths: number[] = [1, 1, 1, 1];

  for (let index = 0; index < digits.length; index += 2) {
    const left = interleaved2of5Patterns[digits[index]];
    const right = interleaved2of5Patterns[digits[index + 1]];

    if (!left || !right) return [];

    for (let pairIndex = 0; pairIndex < 5; pairIndex += 1) {
      widths.push(left[pairIndex] === 'w' ? 3 : 1);
      widths.push(right[pairIndex] === 'w' ? 3 : 1);
    }
  }

  widths.push(3, 1, 1);
  return widths;
};

export const getBoletoBarcodeDataUrl = (value?: string) => {
  const barcodeValue = getBoletoBarcodeValue(value);
  if (!barcodeValue || typeof document === 'undefined') return '';

  const widths = buildInterleaved2of5Widths(barcodeValue);
  if (!widths.length) return '';

  const quietZone = 12;
  const unit = 2;
  const height = 72;
  const totalWidth = widths.reduce((sum, item) => sum + item, 0) * unit + quietZone * 2;
  const canvas = document.createElement('canvas');
  canvas.width = totalWidth;
  canvas.height = height;

  const context = canvas.getContext('2d');
  if (!context) return '';

  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#111827';

  let cursor = quietZone;
  widths.forEach((width, index) => {
    const finalWidth = width * unit;
    if (index % 2 === 0) {
      context.fillRect(cursor, 0, finalWidth, height);
    }
    cursor += finalWidth;
  });

  return canvas.toDataURL('image/png');
};

const looksLikeBoletoCandidate = (digits: string) => {
  if (!/^\d+$/.test(digits)) return false;
  if (digits.length === 48) return digits.startsWith('8');
  if (digits.length === 47) return true;
  if (digits.length === 44) return true;
  return false;
};

const getBoletoCandidateScore = (digits: string) => {
  if (digits.length === 48 && digits.startsWith('8')) return 400;
  if (digits.length === 47 && !digits.startsWith('8')) return 300;
  if (digits.length === 44 && digits.startsWith('8')) return 250;
  if (digits.length === 44) return 200;
  if (digits.length === 47) return 150;
  return 0;
};

const expandBoletoCandidates = (digits: string) => {
  const unique = new Set<string>();
  const collected: string[] = [];
  const lengths = [48, 47, 44];

  const push = (candidate: string) => {
    if (!looksLikeBoletoCandidate(candidate) || unique.has(candidate)) return;
    unique.add(candidate);
    collected.push(candidate);
  };

  push(digits);

  lengths.forEach((size) => {
    if (digits.length < size) return;
    for (let start = 0; start <= digits.length - size; start += 1) {
      push(digits.slice(start, start + size));
    }
  });

  return collected.sort((left, right) => getBoletoCandidateScore(right) - getBoletoCandidateScore(left));
};

const findBoletoCandidate = (text: string) => {
  const matches = text.match(boletoCandidateRegex) || [];
  const candidates = matches.flatMap((match) => expandBoletoCandidates(normalizeBoletoCode(match)));

  return candidates[0];
};

const extractTextFromPdf = async (file: File) => {
  const buffer = await file.arrayBuffer();
  const pdf = await getDocument({ data: buffer }).promise;
  const pages = await Promise.all(
    Array.from({ length: pdf.numPages }, async (_, index) => {
      const page = await pdf.getPage(index + 1);
      const content = await page.getTextContent();
      return content.items
        .map((item) => ('str' in item ? item.str : ''))
        .join(' ');
    })
  );

  return pages.join(' ');
};

export const extractBoletoDataFromFile = async (file: File): Promise<{
  boletoLine?: string;
  source?: BoletoExtractionSource;
  error?: string;
}> => {
  const fromName = findBoletoCandidate(file.name);
  if (fromName) {
    return { boletoLine: fromName, source: 'filename' };
  }

  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  if (!isPdf) {
    return { error: 'Extração automática disponível apenas para PDF textual. Para imagem, preencha manualmente.' };
  }

  try {
    const text = await extractTextFromPdf(file);
    const fromPdf = findBoletoCandidate(text);
    if (fromPdf) {
      return { boletoLine: fromPdf, source: 'pdf_text' };
    }

    return { error: 'Não encontrei a linha digitável no PDF. Você pode preencher manualmente.' };
  } catch (error) {
    console.error('Erro ao extrair boleto do PDF:', error);
    return { error: 'Não foi possível ler o PDF para extração automática.' };
  }
};
