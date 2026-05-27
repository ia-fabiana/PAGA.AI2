import React, { useRef, useState } from 'react';
import { Upload, X, CheckCircle, AlertCircle } from 'lucide-react';

interface Props {
  onComplete?: (count: number) => void;
}

const ESTABLISHMENT_ID = import.meta.env.VITE_TRINKS_ESTABLISHMENT_ID as string;
const IMPORT_SECRET = 'paga2026import';

function parseBrFloat(s: string): number {
  if (!s) return 0;
  return parseFloat(s.replace(/\./g, '').replace(',', '.')) || 0;
}

function parseDate(s: string): string | null {
  const parts = s.trim().split('/');
  if (parts.length !== 3) return null;
  const [d, m, y] = parts;
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

async function sha1Slice8(str: string): Promise<string> {
  // Use latin1 byte encoding (charCodeAt low byte) to match Node.js latin1 file reads.
  const data = Uint8Array.from(str, c => c.charCodeAt(0) & 0xFF);
  const buf = await crypto.subtle.digest('SHA-1', data);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 8);
}

async function rowToTransaction(row: string[]): Promise<Record<string, unknown> | null> {
  if (row.length < 24) return null;
  if (row[2] !== 'Pagamento') return null;

  const dateAtend = parseDate(row[0]);
  if (!dateAtend) return null;

  const dataPag = row[1].trim();
  const datePag = parseDate(dataPag.split(' ')[0]) || dateAtend;

  const clientId = row[3].trim();
  const clientName = row[4].trim();
  const total = parseBrFloat(row[23]);
  if (total === 0) return null;

  const credito = parseBrFloat(row[16]);
  const debito = parseBrFloat(row[17]);
  const dinheiro = parseBrFloat(row[18]);
  const prePago = parseBrFloat(row[19]);
  const outros = parseBrFloat(row[20]);

  const formasPagamentos: { nome: string; valor: number; parcelas: number }[] = [];
  if (credito > 0) formasPagamentos.push({ nome: 'Crédito', valor: credito, parcelas: 1 });
  if (debito > 0) formasPagamentos.push({ nome: 'Débito', valor: debito, parcelas: 1 });
  if (dinheiro > 0) formasPagamentos.push({ nome: 'Dinheiro', valor: dinheiro, parcelas: 1 });
  if (prePago > 0) formasPagamentos.push({ nome: 'Pré-Pago', valor: prePago, parcelas: 1 });
  if (outros > 0) formasPagamentos.push({ nome: 'Outros', valor: outros, parcelas: 1 });

  // Use only datePag (date part, not timestamp) so docId is stable across different CSV exports.
  const hash = await sha1Slice8(`${dateAtend}_${datePag}_${clientId}_${total.toFixed(2)}`);
  const docId = `trinks_${ESTABLISHMENT_ID}_csv_${hash}`;

  return {
    _docId: docId,
    id: 0,
    dataHora: dataPag,
    dataReferencia: `${dateAtend}T00:00:00`,
    descontos: parseBrFloat(row[14]),
    troco: parseBrFloat(row[21]),
    totalPagar: total,
    cliente: { id: parseInt(clientId) || 0, nome: clientName },
    formasPagamentos,
    servicos: [],
    produtos: [],
    pacotes: [],
    date: datePag,
    syncedAt: new Date().toISOString(),
    estabelecimentoId: ESTABLISHMENT_ID,
    importSource: 'csv',
  };
}

async function parseCsvContent(content: string): Promise<Record<string, unknown>[]> {
  const lines = content.split('\n');
  const headerIdx = lines.findIndex(l => l.includes('Data de Atendimento'));
  if (headerIdx === -1) throw new Error('Cabeçalho "Data de Atendimento" não encontrado. Verifique se é o arquivo correto.');

  const transactions: Record<string, unknown>[] = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const row = line.split(';').map(c => c.replace(/^"|"$/g, ''));
    const t = await rowToTransaction(row);
    if (t) transactions.push(t);
  }
  return transactions;
}

export const TrinksUpload: React.FC<Props> = ({ onComplete }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<'idle' | 'parsing' | 'uploading' | 'done' | 'error'>('idle');
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState('');

  const handleFile = async (file: File) => {
    setStatus('parsing');
    setMessage('Lendo arquivo...');
    setProgress(0);

    try {
      const content = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error);
        reader.readAsText(file, 'ISO-8859-1');
      });

      setMessage('Processando linhas...');
      const transactions = await parseCsvContent(content);

      if (transactions.length === 0) {
        setStatus('error');
        setMessage('Nenhuma transação de Pagamento encontrada no arquivo.');
        return;
      }

      setStatus('uploading');
      const BATCH = 100;
      let saved = 0;

      for (let i = 0; i < transactions.length; i += BATCH) {
        const batch = transactions.slice(i, i + BATCH);
        const res = await fetch('/api/import-trinks-transactions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': IMPORT_SECRET },
          body: JSON.stringify({ transactions: batch }),
        });
        if (!res.ok) throw new Error(`Erro ${res.status}: ${await res.text()}`);
        const result = await res.json();
        saved += result.saved || 0;
        setProgress(Math.round(((i + batch.length) / transactions.length) * 100));
        setMessage(`${saved} de ${transactions.length} salvas...`);
      }

      setStatus('done');
      setMessage(`${saved} transações importadas!`);
      onComplete?.(saved);
    } catch (err: unknown) {
      setStatus('error');
      setMessage(err instanceof Error ? err.message : String(err));
    }
  };

  const reset = () => { setStatus('idle'); setMessage(''); setProgress(0); };

  return (
    <div className="flex items-center gap-2">
      <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; }} />

      {status === 'idle' && (
        <button
          onClick={() => fileInputRef.current?.click()}
          className="flex items-center gap-1.5 text-xs font-bold px-3 py-2 rounded-xl uppercase transition-all hover:opacity-80"
          style={{ backgroundColor: '#ecfdf5', color: '#059669' }}
        >
          <Upload size={13} />
          Importar CSV
        </button>
      )}

      {status === 'parsing' && (
        <span className="text-xs text-slate-400 animate-pulse">Processando...</span>
      )}

      {status === 'uploading' && (
        <div className="flex items-center gap-2">
          <div className="w-24 h-1.5 bg-slate-100 rounded-full overflow-hidden">
            <div className="h-full bg-emerald-400 rounded-full transition-all duration-300" style={{ width: `${progress}%` }} />
          </div>
          <span className="text-xs text-slate-500">{message}</span>
        </div>
      )}

      {status === 'done' && (
        <div className="flex items-center gap-1.5">
          <CheckCircle size={13} className="text-emerald-500" />
          <span className="text-xs font-bold text-emerald-600">{message}</span>
          <button onClick={reset} className="text-slate-300 hover:text-slate-500 ml-1"><X size={12} /></button>
        </div>
      )}

      {status === 'error' && (
        <div className="flex items-center gap-1.5 max-w-xs">
          <AlertCircle size={13} className="text-red-400 shrink-0" />
          <span className="text-xs text-red-500 truncate">{message}</span>
          <button onClick={reset} className="text-slate-300 hover:text-slate-500 ml-1 shrink-0"><X size={12} /></button>
        </div>
      )}
    </div>
  );
};
