import React, { useState, useEffect, useCallback, useRef } from 'react';
import { db } from './firebase';
import { collection, getDocs, query, where, orderBy, setDoc, doc } from 'firebase/firestore';
import { listSavedBankReconciliations } from './bankReconciliationStore';
import {
  sincronizarTrinks,
  carregarTransacoesSalvas,
  agregarPorDia,
  buscarConsumoApi,
  TotaisDiaTrinks,
  ConsumoApi,
  COLUNA_LABELS,
  TrinksTransacaoSalva,
} from './trinks';
import { CashBoxData, TeamMember } from './types';
import {
  RefreshCw, ChevronDown, ChevronUp, CheckCircle, AlertTriangle, XCircle,
  Download, Edit2, Save, X, Eye, Upload,
} from 'lucide-react';

interface Props {
  user: TeamMember;
  onBack: () => void;
  onShowReport?: () => void;
}

const COLUNAS = ['din', 'rede', 'pagSeg', 'inter', 'frog'] as const;
type Coluna = typeof COLUNAS[number];

function fmt(v: number) {
  return v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function diffStatus(trinks: number, caixa: number): 'ok' | 'aviso' | 'erro' | 'sem_dado' {
  if (caixa === 0 && trinks === 0) return 'ok';
  if (caixa === 0) return 'sem_dado';
  const pct = Math.abs(trinks - caixa) / caixa;
  if (pct < 0.01) return 'ok';
  if (pct < 0.05) return 'aviso';
  return 'erro';
}

function StatusIcon({ status }: { status: ReturnType<typeof diffStatus> }) {
  if (status === 'ok') return <CheckCircle size={14} className="text-green-500" />;
  if (status === 'aviso') return <AlertTriangle size={14} className="text-yellow-500" />;
  if (status === 'erro') return <XCircle size={14} className="text-red-500" />;
  return <AlertTriangle size={14} className="text-slate-400" />;
}

function rowBg(status: ReturnType<typeof diffStatus>) {
  if (status === 'ok') return 'bg-green-50';
  if (status === 'aviso') return 'bg-yellow-50';
  if (status === 'erro') return 'bg-red-50';
  return 'bg-slate-50';
}

export const TrinksReconciliation: React.FC<Props> = ({ user, onBack, onShowReport }) => {
  const currentDate = new Date();
  const [selectedMonth, setSelectedMonth] = useState(currentDate.getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState(currentDate.getFullYear());
  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState({ fetched: 0, total: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [consumo, setConsumo] = useState<ConsumoApi | null>(null);

  const [trinksDias, setTrinksDias] = useState<TotaisDiaTrinks[]>([]);
  const [caixaDias, setCaixaDias] = useState<CashBoxData[]>([]);
  const [expandedDate, setExpandedDate] = useState<string | null>(null);
  const [detalhesTransacoes, setDetalhesTransacoes] = useState<TrinksTransacaoSalva[]>([]);
  const [editingCaixaDate, setEditingCaixaDate] = useState<string | null>(null);
  const [editingCaixaValues, setEditingCaixaValues] = useState<Record<Coluna, string>>({ din: '', rede: '', pagSeg: '', inter: '', frog: '' });
  const [saving, setSaving] = useState(false);

  // Upload de extrato da operadora
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadProvider, setUploadProvider] = useState<Coluna>('rede');
  const [uploadParsed, setUploadParsed] = useState<{ date: string; amount: number }[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [loadingBank, setLoadingBank] = useState(false);
  const uploadRef = useRef<HTMLInputElement>(null);

  const parseRedeCSV = (text: string): { date: string; amount: number }[] => {
    const lines = text.replace(/\r/g, '').split('\n');
    const totals: Record<string, number> = {};
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(';');
      if (cols.length < 4) continue;
      const dateStr = cols[0].trim();
      const status = cols[2].trim().toLowerCase();
      const amountStr = cols[3].trim();
      if (status !== 'aprovada') continue;
      if (!/^\d{2}\/\d{2}\/\d{4}$/.test(dateStr)) continue;
      const [dd, mm, yyyy] = dateStr.split('/');
      const dateISO = `${yyyy}-${mm}-${dd}`;
      const amount = parseFloat(amountStr.replace(/\./g, '').replace(',', '.')) || 0;
      totals[dateISO] = (totals[dateISO] || 0) + amount;
    }
    return Object.entries(totals)
      .map(([date, amount]) => ({ date, amount }))
      .sort((a, b) => a.date.localeCompare(b.date));
  };

  const handleUploadFile = (file: File) => {
    setUploadError('');
    setUploadParsed([]);
    const reader = new FileReader();
    reader.onload = e => {
      const text = (e.target?.result as string) || '';
      let parsed: { date: string; amount: number }[] = [];
      // Por enquanto o parser da Rede serve de base; futuros parsers podem ser adicionados
      parsed = parseRedeCSV(text);
      if (parsed.length === 0) {
        setUploadError('Nenhum lançamento aprovado encontrado. Verifique o arquivo.');
      } else {
        setUploadParsed(parsed);
      }
    };
    reader.readAsText(file, 'UTF-8');
  };

  const loadInterFromBankStatement = async () => {
    setLoadingBank(true);
    setUploadError('');
    setUploadParsed([]);
    try {
      const statements = await listSavedBankReconciliations();
      const monthStatement = statements.find(s => s.statementMonth === mesISO && s.isActiveVersion);
      if (!monthStatement) {
        setUploadError(`Nenhum extrato bancário importado para ${nomesMes[selectedMonth - 1]}/${selectedYear}. Importe primeiro na seção Extrato Bancário.`);
        return;
      }
      const pixCredits = monthStatement.transactions.filter(t =>
        t.type === 'CREDIT' && t.description.toLowerCase().includes('pix')
      );
      if (pixCredits.length === 0) {
        setUploadError('Nenhuma entrada de PIX encontrada no extrato deste mês.');
        return;
      }
      const totals: Record<string, number> = {};
      for (const t of pixCredits) {
        totals[t.date] = (totals[t.date] || 0) + t.amount;
      }
      setUploadParsed(
        Object.entries(totals)
          .map(([date, amount]) => ({ date, amount }))
          .sort((a, b) => a.date.localeCompare(b.date))
      );
    } catch (e) {
      setUploadError('Erro ao carregar extrato bancário.');
      console.error(e);
    } finally {
      setLoadingBank(false);
    }
  };

  const handleConfirmUpload = async () => {
    setUploading(true);
    try {
      for (const { date, amount } of uploadParsed) {
        const existing = caixaByDate[date];
        const docId = existing?.id || `cashbox_${date}`;
        const din    = uploadProvider === 'din'    ? amount : (existing?.dinTotal    || 0);
        const rede   = uploadProvider === 'rede'   ? amount : (existing?.redeTotal   || 0);
        const pagSeg = uploadProvider === 'pagSeg' ? amount : (existing?.pagSegTotal || 0);
        const inter  = uploadProvider === 'inter'  ? amount : (existing?.interTotal  || 0);
        const frog   = uploadProvider === 'frog'   ? amount : (existing?.frogTotal   || 0);
        const grandTotal = din + rede + pagSeg + inter + frog;
        await setDoc(doc(db, 'cashbox', docId), {
          date, dinTotal: din, redeTotal: rede, pagSegTotal: pagSeg,
          interTotal: inter, frogTotal: frog, grandTotal, informedTotal: grandTotal,
          status: 'pending', observations: '',
          createdBy: user.email,
          createdAt: existing?.createdAt || new Date().toISOString(),
          isWeekendOrHoliday: false,
        }, { merge: true });
      }
      setShowUploadModal(false);
      setUploadParsed([]);
      await carregarDados();
    } catch (e) {
      setUploadError('Erro ao importar. Tente novamente.');
      console.error(e);
    } finally {
      setUploading(false);
    }
  };

  const mesISO = `${selectedYear}-${String(selectedMonth).padStart(2, '0')}`;
  const dataInicio = `${mesISO}-01`;
  const ultimoDia = new Date(selectedYear, selectedMonth, 0).getDate();
  const dataFim = `${mesISO}-${String(ultimoDia).padStart(2, '0')}`;

  const carregarConsumo = useCallback(async () => {
    try {
      const data = await buscarConsumoApi();
      setConsumo(data);
    } catch {
      // consumo é informativo — falha silenciosa
    }
  }, []);

  const carregarDados = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [transacoes, cashSnap] = await Promise.all([
        carregarTransacoesSalvas(dataInicio, dataFim),
        getDocs(
          query(collection(db, 'cashbox'), where('date', '>=', dataInicio), where('date', '<=', dataFim), orderBy('date', 'asc')),
        ),
      ]);
      setTrinksDias(agregarPorDia(transacoes));
      setCaixaDias(cashSnap.docs.map(d => ({ ...d.data(), id: d.id } as CashBoxData)));
    } catch (e) {
      setError('Erro ao carregar dados.');
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [dataInicio, dataFim]);

  useEffect(() => {
    carregarDados();
    carregarConsumo();
  }, [carregarDados, carregarConsumo]);

  const handleSync = async () => {
    setSyncing(true);
    setSyncProgress({ fetched: 0, total: 0 });
    setError('');
    setSuccess('');
    try {
      const count = await sincronizarTrinks(dataInicio, dataFim, (f, t) =>
        setSyncProgress({ fetched: f, total: t }),
      );
      setSuccess(`${count} transações sincronizadas do Trinks.`);
      await carregarDados();
      await carregarConsumo();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Erro na sincronização.');
    } finally {
      setSyncing(false);
    }
  };

  const openCaixaEditor = (date: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const cx = caixaByDate[date];
    setEditingCaixaValues({
      din:    String(cx?.dinTotal    ?? ''),
      rede:   String(cx?.redeTotal   ?? ''),
      pagSeg: String(cx?.pagSegTotal ?? ''),
      inter:  String(cx?.interTotal  ?? ''),
      frog:   String(cx?.frogTotal   ?? ''),
    });
    setEditingCaixaDate(date);
  };

  const handleSaveCaixa = async (date: string) => {
    setSaving(true);
    try {
      const din    = parseFloat(editingCaixaValues.din)    || 0;
      const rede   = parseFloat(editingCaixaValues.rede)   || 0;
      const pagSeg = parseFloat(editingCaixaValues.pagSeg) || 0;
      const inter  = parseFloat(editingCaixaValues.inter)  || 0;
      const frog   = parseFloat(editingCaixaValues.frog)   || 0;
      const grandTotal = din + rede + pagSeg + inter + frog;

      const existingEntry = caixaByDate[date];
      const docId = existingEntry?.id || `cashbox_${date}`;

      await setDoc(doc(db, 'cashbox', docId), {
        date,
        dinTotal: din,
        redeTotal: rede,
        pagSegTotal: pagSeg,
        interTotal: inter,
        frogTotal: frog,
        grandTotal,
        informedTotal: grandTotal,
        status: 'pending',
        observations: '',
        createdBy: user.email,
        createdAt: existingEntry?.createdAt || new Date().toISOString(),
        isWeekendOrHoliday: false,
      }, { merge: true });

      setEditingCaixaDate(null);
      await carregarDados();
    } catch (e) {
      setError('Erro ao salvar lançamento.');
      console.error(e);
    } finally {
      setSaving(false);
    }
  };

  const handleExpandDate = async (date: string) => {
    if (expandedDate === date) {
      setExpandedDate(null);
      return;
    }
    setExpandedDate(date);
    const transacoes = await carregarTransacoesSalvas(date, date);
    setDetalhesTransacoes(transacoes);
  };

  // Build a unified list of all dates in the month
  const allDates: string[] = [];
  for (let d = 1; d <= ultimoDia; d++) {
    allDates.push(`${mesISO}-${String(d).padStart(2, '0')}`);
  }

  const trinksByDate: Record<string, TotaisDiaTrinks> = {};
  trinksDias.forEach(t => (trinksByDate[t.date] = t));
  const caixaByDate: Record<string, CashBoxData> = {};
  caixaDias.forEach(c => (caixaByDate[c.date] = c));

  // Column totals
  const totTrinks: Record<string, number> = { din: 0, rede: 0, pagSeg: 0, inter: 0, frog: 0, total: 0 };
  const totCaixa: Record<string, number> = { din: 0, rede: 0, pagSeg: 0, inter: 0, frog: 0, total: 0 };
  trinksDias.forEach(t => {
    COLUNAS.forEach(c => (totTrinks[c] += t[c]));
    totTrinks.total += t.total;
  });
  caixaDias.forEach(c => {
    totCaixa.din += c.dinTotal ?? 0;
    totCaixa.rede += c.redeTotal ?? 0;
    totCaixa.pagSeg += c.pagSegTotal ?? 0;
    totCaixa.inter += c.interTotal ?? 0;
    totCaixa.frog += c.frogTotal ?? 0;
    totCaixa.total += c.grandTotal ?? 0;
  });

  const nomesMes = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

  // extrai usado/limite do ConsumoApiDTO independente dos nomes exatos dos campos
  const consumoUsado = consumo
    ? (consumo.totalRequisicoes ?? consumo.requisicoesMes ?? consumo.usado ?? consumo.total ?? null)
    : null;
  const consumoLimite = consumo
    ? (consumo.limiteRequisicoes ?? consumo.limite ?? consumo.disponivel ?? null)
    : null;
  const consumoPct = consumoUsado != null && consumoLimite != null && consumoLimite > 0
    ? Math.round((consumoUsado / consumoLimite) * 100)
    : null;
  const consumoBadgeColor = consumoPct == null ? 'bg-slate-100 text-slate-500'
    : consumoPct >= 80 ? 'bg-red-100 text-red-700'
    : consumoPct >= 50 ? 'bg-amber-100 text-amber-700'
    : 'bg-emerald-100 text-emerald-700';

  const openPrintPreview = (autoPrint = false) => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    const periodLabel = `${nomesMes[selectedMonth - 1]} ${selectedYear}`;

    const headerCells = COLUNAS.map(col => `
      <th style="border:1px solid #ccc;padding:6px 8px;background:#4338ca;color:white;text-align:right;font-size:10px;">
        ${COLUNA_LABELS[col]}<br><span style="font-weight:400;opacity:.8;">Trinks</span>
      </th>
      <th style="border:1px solid #ccc;padding:6px 8px;background:#1e293b;color:white;text-align:right;font-size:10px;">
        ${COLUNA_LABELS[col]}<br><span style="font-weight:400;opacity:.8;">Receitas</span>
      </th>`).join('');

    const rowsHTML = allDates.map(date => {
      const tr = trinksByDate[date];
      const cx = caixaByDate[date];
      if (!tr && !cx) return '';
      const [, , dd] = date.split('-');
      const totalTrinks = tr?.total ?? 0;
      const totalCaixa = cx?.grandTotal ?? 0;
      const diff = totalTrinks - totalCaixa;
      const diffColor = Math.abs(diff) < 0.01 ? '#15803d' : diff > 0 ? '#dc2626' : '#d97706';

      const colCells = COLUNAS.map(col => {
        const tv = tr?.[col] ?? 0;
        const cv = cx ? (col === 'din' ? cx.dinTotal : col === 'rede' ? cx.redeTotal : col === 'pagSeg' ? cx.pagSegTotal : col === 'inter' ? cx.interTotal : cx.frogTotal) ?? 0 : 0;
        return `
          <td style="border:1px solid #e5e7eb;padding:5px 7px;text-align:right;color:#4338ca;">${tv > 0 ? fmt(tv) : ''}</td>
          <td style="border:1px solid #e5e7eb;padding:5px 7px;text-align:right;color:#374151;">${cv > 0 ? fmt(cv) : ''}</td>`;
      }).join('');

      return `<tr>
        <td style="border:1px solid #e5e7eb;padding:5px 7px;font-weight:600;">${dd}/${String(selectedMonth).padStart(2, '0')}</td>
        ${colCells}
        <td style="border:1px solid #e5e7eb;padding:5px 7px;text-align:right;font-weight:bold;color:#4338ca;">${fmt(totalTrinks)}</td>
        <td style="border:1px solid #e5e7eb;padding:5px 7px;text-align:right;font-weight:bold;">${cx ? fmt(totalCaixa) : ''}</td>
        <td style="border:1px solid #e5e7eb;padding:5px 7px;text-align:right;font-weight:bold;color:${diffColor};">${Math.abs(diff) < 0.01 ? '✓' : `${diff > 0 ? '+' : ''}${fmt(diff)}`}</td>
      </tr>`;
    }).join('');

    const totColCells = COLUNAS.map(col => {
      const t = totTrinks[col];
      const c = col === 'pagSeg' ? totCaixa.pagSeg : totCaixa[col];
      return `
        <td style="border:1px solid #ccc;padding:6px 8px;text-align:right;background:#4338ca;color:white;font-weight:bold;">${fmt(t)}</td>
        <td style="border:1px solid #ccc;padding:6px 8px;text-align:right;background:#1e293b;color:white;font-weight:bold;">${fmt(c)}</td>`;
    }).join('');

    printWindow.document.write(`
      <!DOCTYPE html><html>
      <head>
        <meta charset="UTF-8">
        <title>Receitas — ${periodLabel}</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 20px; color: #1e293b; font-size: 11px; }
          h1 { font-size: 15px; margin: 0 0 3px; font-weight: 900; }
          h2 { font-size: 11px; color: #64748b; margin: 0 0 14px; }
          table { border-collapse: collapse; width: 100%; }
          .actions { display: flex; gap: 10px; margin-top: 16px; justify-content: center; }
          .btn { padding: 8px 22px; border: none; border-radius: 6px; font-size: 13px; font-weight: bold; cursor: pointer; }
          .btn-print { background: #1e293b; color: white; }
          .btn-close { background: #e2e8f0; color: #1e293b; }
          p.footer { font-size: 10px; color: #94a3b8; margin-top: 10px; }
          @media print { .actions { display: none; } }
        </style>
      </head>
      <body>
        <h1>RECEITAS — CONCILIAÇÃO TRINKS vs LANÇAMENTOS</h1>
        <h2>${periodLabel}</h2>
        <table>
          <thead>
            <tr>
              <th style="border:1px solid #ccc;padding:6px 8px;background:#1e293b;color:white;text-align:left;">Data</th>
              ${headerCells}
              <th style="border:1px solid #ccc;padding:6px 8px;background:#4338ca;color:white;text-align:right;">Total Trinks</th>
              <th style="border:1px solid #ccc;padding:6px 8px;background:#1e293b;color:white;text-align:right;">Total Receitas</th>
              <th style="border:1px solid #ccc;padding:6px 8px;background:#1e293b;color:white;text-align:right;">Diferença</th>
            </tr>
          </thead>
          <tbody>${rowsHTML}</tbody>
          <tfoot>
            <tr>
              <td style="border:1px solid #ccc;padding:6px 8px;background:#1e293b;color:white;font-weight:bold;">TOTAL</td>
              ${totColCells}
              <td style="border:1px solid #ccc;padding:6px 8px;text-align:right;background:#4338ca;color:white;font-weight:bold;">${fmt(totTrinks.total)}</td>
              <td style="border:1px solid #ccc;padding:6px 8px;text-align:right;background:#1e293b;color:white;font-weight:bold;">${fmt(totCaixa.total)}</td>
              <td style="border:1px solid #ccc;padding:6px 8px;text-align:right;background:${Math.abs(totTrinks.total - totCaixa.total) < 0.01 ? '#15803d' : '#dc2626'};color:white;font-weight:bold;">
                ${Math.abs(totTrinks.total - totCaixa.total) < 0.01 ? '✓ OK' : `${totTrinks.total > totCaixa.total ? '+' : ''}${fmt(totTrinks.total - totCaixa.total)}`}
              </td>
            </tr>
          </tfoot>
        </table>
        <p class="footer">Relatório gerado em ${new Date().toLocaleDateString('pt-BR')}</p>
        <div class="actions">
          <button class="btn btn-print" onclick="window.print()">🖨️ Imprimir</button>
          <button class="btn btn-close" onclick="window.close()">✕ Fechar</button>
        </div>
        ${autoPrint ? '<script>window.onload=()=>window.print();<\/script>' : ''}
      </body></html>
    `);
    printWindow.document.close();
  };

  return (
    <div className="flex flex-col flex-1 bg-slate-50 p-6 overflow-y-auto">
      <div className="max-w-full mx-auto w-full space-y-6">

        {/* Header */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-3">
              <div>
                <h1 className="text-2xl font-black text-slate-800">RECEITAS</h1>
                <p className="text-sm text-slate-500">Conciliação Trinks vs Lançamentos Manuais</p>
              </div>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <select
                value={selectedMonth}
                onChange={e => setSelectedMonth(Number(e.target.value))}
                className="px-3 py-2 border border-slate-200 rounded-lg text-sm font-medium"
              >
                {nomesMes.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
              </select>
              <select
                value={selectedYear}
                onChange={e => setSelectedYear(Number(e.target.value))}
                className="px-3 py-2 border border-slate-200 rounded-lg text-sm font-medium"
              >
                {Array.from({ length: 6 }, (_, i) => selectedYear - 2 + i).map(y =>
                  <option key={y} value={y}>{y}</option>,
                )}
              </select>
              <button
                onClick={() => { setShowUploadModal(true); setUploadParsed([]); setUploadError(''); }}
                className="flex items-center gap-2 px-3 py-2 bg-emerald-100 text-emerald-700 rounded-lg text-sm font-semibold hover:bg-emerald-200"
              >
                <Upload size={16} /> Upload Extrato
              </button>
              <button
                onClick={() => openPrintPreview(false)}
                className="flex items-center gap-2 px-3 py-2 bg-slate-100 text-slate-700 rounded-lg text-sm font-semibold hover:bg-slate-200"
              >
                <Eye size={16} /> Visualizar
              </button>
              {onShowReport && (
                <button
                  onClick={onShowReport}
                  className="flex items-center gap-2 px-3 py-2 bg-slate-100 text-slate-700 rounded-lg text-sm font-semibold hover:bg-slate-200"
                >
                  Conf. Mensal
                </button>
              )}
              {consumo != null && (
                <div className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold ${consumoBadgeColor}`} title={JSON.stringify(consumo, null, 2)}>
                  <span>API</span>
                  <span>
                    {consumoUsado != null ? consumoUsado : '—'}
                    {consumoLimite != null ? `/${consumoLimite}` : ''}
                    {consumoPct != null ? ` (${consumoPct}%)` : ''}
                  </span>
                </div>
              )}
              {user.role === 'ADMIN' && (
                <button
                  onClick={handleSync}
                  disabled={syncing}
                  className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700 disabled:opacity-60"
                >
                  <RefreshCw size={16} className={syncing ? 'animate-spin' : ''} />
                  {syncing
                    ? syncProgress.total > 0
                      ? `${syncProgress.fetched}/${syncProgress.total}`
                      : 'Buscando...'
                    : 'Sincronizar Trinks'}
                </button>
              )}
            </div>
          </div>

          {error && (
            <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>
          )}
          {success && (
            <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm">{success}</div>
          )}
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {COLUNAS.map(col => {
            const t = totTrinks[col];
            const c = col === 'pagSeg' ? totCaixa.pagSeg : totCaixa[col];
            const diff = t - c;
            const hasDiff = Math.abs(diff) > 0.01;
            return (
              <div key={col} className="bg-white rounded-xl border border-slate-200 p-4">
                <p className="text-xs font-bold text-slate-500 mb-2">{COLUNA_LABELS[col]}</p>
                <p className="text-sm font-bold text-indigo-700">T: R$ {fmt(t)}</p>
                <p className="text-sm font-semibold text-slate-600">C: R$ {fmt(c)}</p>
                {hasDiff && (
                  <p className={`text-xs font-bold mt-1 ${diff > 0 ? 'text-red-500' : 'text-green-600'}`}>
                    {diff > 0 ? '+' : ''}{fmt(diff)}
                  </p>
                )}
              </div>
            );
          })}
        </div>

        {/* Main table */}
        {loading ? (
          <div className="flex justify-center py-12 text-slate-400">Carregando...</div>
        ) : (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-100 border-b border-slate-200">
                    <th className="px-3 py-3 text-left font-bold text-slate-600 w-24">DATA</th>
                    {COLUNAS.map(col => (
                      <React.Fragment key={col}>
                        <th className="px-2 py-3 text-right font-bold text-indigo-600 min-w-[80px]">
                          {COLUNA_LABELS[col]}<br /><span className="text-slate-400 font-normal">Trinks</span>
                        </th>
                        <th className="px-2 py-3 text-right font-bold text-slate-600 min-w-[80px]">
                          {COLUNA_LABELS[col]}<br /><span className="text-slate-400 font-normal">Receitas</span>
                        </th>
                      </React.Fragment>
                    ))}
                    <th className="px-2 py-3 text-right font-bold text-indigo-700 min-w-[90px]">Total Trinks</th>
                    <th className="px-2 py-3 text-right font-bold text-slate-700 min-w-[90px]">Total Receitas</th>
                    <th className="px-2 py-3 text-right font-bold text-slate-600 min-w-[80px]">Diferença</th>
                    <th className="px-2 py-3 text-center w-12"></th>
                  </tr>
                </thead>
                <tbody>
                  {allDates.map(date => {
                    const tr = trinksByDate[date];
                    const cx = caixaByDate[date];
                    if (!tr && !cx) return null;

                    const totalTrinks = tr?.total ?? 0;
                    const totalCaixa = cx?.grandTotal ?? 0;
                    const diff = totalTrinks - totalCaixa;
                    const status = diffStatus(totalTrinks, totalCaixa);
                    const isExpanded = expandedDate === date;

                    const getCaixaVal = (col: Coluna): number => {
                      if (!cx) return 0;
                      if (col === 'din') return cx.dinTotal ?? 0;
                      if (col === 'rede') return cx.redeTotal ?? 0;
                      if (col === 'pagSeg') return cx.pagSegTotal ?? 0;
                      if (col === 'inter') return cx.interTotal ?? 0;
                      if (col === 'frog') return cx.frogTotal ?? 0;
                      return 0;
                    };

                    const [, , dd] = date.split('-');

                    return (
                      <React.Fragment key={date}>
                        <tr
                          className={`border-b border-slate-100 hover:bg-slate-50 cursor-pointer ${rowBg(status)}`}
                          onClick={() => handleExpandDate(date)}
                        >
                          <td className="px-3 py-2 font-semibold text-slate-700">
                            {dd}/{String(selectedMonth).padStart(2, '0')}
                          </td>
                          {COLUNAS.map(col => {
                            const tv = tr?.[col] ?? 0;
                            const cv = getCaixaVal(col);
                            const cs = diffStatus(tv, cv);
                            return (
                              <React.Fragment key={col}>
                                <td className="px-2 py-2 text-right text-indigo-700 font-mono">
                                  {tv > 0 ? fmt(tv) : <span className="text-slate-300">—</span>}
                                </td>
                                <td
                                  className={`px-2 py-2 text-right font-mono cursor-pointer hover:bg-indigo-50 transition-colors ${cs === 'erro' ? 'text-red-600 font-bold' : cs === 'aviso' ? 'text-yellow-700' : 'text-slate-600'}`}
                                  onClick={e => { e.stopPropagation(); openCaixaEditor(date, e); }}
                                  title="Clique para lançar valor"
                                >
                                  {cv > 0 ? fmt(cv) : <span className="text-indigo-300 text-xs font-semibold">＋ lançar</span>}
                                </td>
                              </React.Fragment>
                            );
                          })}
                          <td className="px-2 py-2 text-right font-mono font-bold text-indigo-700">
                            {fmt(totalTrinks)}
                          </td>
                          <td className="px-2 py-2 text-right font-mono font-bold text-slate-700">
                            {cx ? fmt(totalCaixa) : <span className="text-slate-300">—</span>}
                          </td>
                          <td className={`px-2 py-2 text-right font-mono font-bold ${Math.abs(diff) < 0.01 ? 'text-green-600' : diff > 0 ? 'text-red-600' : 'text-orange-600'}`}>
                            {Math.abs(diff) < 0.01 ? '✓' : `${diff > 0 ? '+' : ''}${fmt(diff)}`}
                          </td>
                          <td className="px-2 py-2 text-center">
                            <div className="flex items-center justify-center gap-1">
                              <StatusIcon status={status} />
                              {isExpanded ? <ChevronUp size={12} className="text-slate-400" /> : <ChevronDown size={12} className="text-slate-400" />}
                              {(user.role === 'ADMIN' || user.permissions?.canLaunchCaixa) && (
                                <button
                                  onClick={e => openCaixaEditor(date, e)}
                                  className="ml-1 p-1 rounded hover:bg-indigo-100 text-indigo-500"
                                  title="Lançar valores do caixa"
                                >
                                  <Edit2 size={11} />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>

                        {/* Inline cashbox entry form */}
                        {editingCaixaDate === date && (
                          <tr className="bg-indigo-50 border-b border-indigo-200">
                            <td colSpan={COLUNAS.length * 2 + 4} className="px-4 py-4">
                              <div className="flex flex-wrap items-end gap-4">
                                <span className="text-xs font-black text-indigo-700 self-center whitespace-nowrap">
                                  Receitas {dd}/{String(selectedMonth).padStart(2, '0')}
                                </span>
                                {COLUNAS.map(col => (
                                  <div key={col} className="flex flex-col gap-1">
                                    <label className="text-xs font-bold text-slate-500 uppercase">{COLUNA_LABELS[col]}</label>
                                    <input
                                      type="number"
                                      step="0.01"
                                      min="0"
                                      value={editingCaixaValues[col]}
                                      onChange={e => setEditingCaixaValues(v => ({ ...v, [col]: e.target.value }))}
                                      onKeyDown={e => { if (e.key === 'Enter') handleSaveCaixa(date); if (e.key === 'Escape') setEditingCaixaDate(null); }}
                                      className="w-28 px-2 py-1.5 text-sm border-2 border-indigo-200 rounded-lg text-right font-mono focus:outline-none focus:border-indigo-500"
                                      placeholder="0,00"
                                    />
                                  </div>
                                ))}
                                <div className="flex gap-2 self-end">
                                  <button
                                    onClick={() => handleSaveCaixa(date)}
                                    disabled={saving}
                                    className="flex items-center gap-1 px-4 py-1.5 bg-indigo-600 text-white rounded-lg text-xs font-bold hover:bg-indigo-700 disabled:opacity-60"
                                  >
                                    <Save size={12} /> {saving ? 'Salvando...' : 'Salvar'}
                                  </button>
                                  <button
                                    onClick={() => setEditingCaixaDate(null)}
                                    className="p-1.5 border border-slate-200 text-slate-500 rounded-lg hover:bg-slate-50"
                                  >
                                    <X size={14} />
                                  </button>
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}

                        {/* Expanded: individual transactions */}
                        {isExpanded && (
                          <tr className="bg-white border-b border-slate-200">
                            <td colSpan={COLUNAS.length * 2 + 4} className="p-4">
                              <div className="text-xs font-bold text-slate-600 mb-3">
                                Transações do Trinks — {dd}/{String(selectedMonth).padStart(2, '0')}/{selectedYear}
                                {tr && <span className="ml-2 text-slate-400">({tr.transacoes} atendimentos)</span>}
                              </div>

                              {/* Breakdown by payment method name */}
                              {tr && Object.keys(tr.detalhes).length > 0 && (
                                <div className="mb-4">
                                  <p className="text-xs text-slate-500 font-semibold mb-2">Formas de pagamento (Trinks)</p>
                                  <div className="flex flex-wrap gap-2">
                                    {Object.entries(tr.detalhes).map(([nome, valor]) => (
                                      <span key={nome} className="px-2 py-1 bg-indigo-50 text-indigo-700 rounded text-xs font-mono">
                                        {nome}: R$ {fmt(valor)}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {/* Individual transactions */}
                              {detalhesTransacoes.filter(t => t.date === date).length > 0 && (
                                <div className="overflow-x-auto">
                                  <table className="w-full text-xs border border-slate-200 rounded-lg overflow-hidden">
                                    <thead>
                                      <tr className="bg-slate-50">
                                        <th className="px-3 py-2 text-left text-slate-500">Hora</th>
                                        <th className="px-3 py-2 text-left text-slate-500">Cliente</th>
                                        <th className="px-3 py-2 text-left text-slate-500">Serviços/Produtos</th>
                                        <th className="px-3 py-2 text-left text-slate-500">Pagamento</th>
                                        <th className="px-3 py-2 text-right text-slate-500">Total</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {detalhesTransacoes
                                        .filter(t => t.date === date)
                                        .sort((a, b) => a.dataHora.localeCompare(b.dataHora))
                                        .map(t => (
                                          <tr key={t.id} className="border-t border-slate-100 hover:bg-slate-50">
                                            <td className="px-3 py-2 text-slate-500 font-mono">
                                              {t.dataHora.split('T')[1]?.slice(0, 5)}
                                            </td>
                                            <td className="px-3 py-2 text-slate-700">
                                              {t.cliente?.nome ?? '—'}
                                            </td>
                                            <td className="px-3 py-2 text-slate-600">
                                              {[
                                                ...(t.servicos || []).map(s => s.nome),
                                                ...(t.produtos || []).map(p => p.nome),
                                              ].join(', ') || '—'}
                                            </td>
                                            <td className="px-3 py-2">
                                              <div className="flex flex-col gap-0.5">
                                                {(t.formasPagamentos || []).map((fp, i) => (
                                                  <span key={i} className="text-indigo-600">
                                                    {fp.nome}: R$ {fmt(fp.valor)}
                                                  </span>
                                                ))}
                                                {(t.formasPagamentos || []).length === 0 && (
                                                  <span className="text-slate-400">Sem pagamento</span>
                                                )}
                                              </div>
                                            </td>
                                            <td className="px-3 py-2 text-right font-mono font-bold text-slate-800">
                                              R$ {fmt(t.totalPagar ?? 0)}
                                            </td>
                                          </tr>
                                        ))}
                                    </tbody>
                                  </table>
                                </div>
                              )}

                              {!tr && (
                                <p className="text-slate-400 text-xs">Nenhum dado do Trinks para esta data. Sincronize primeiro.</p>
                              )}
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>

                {/* Totals footer */}
                <tfoot>
                  <tr className="bg-slate-100 border-t-2 border-slate-300 font-bold">
                    <td className="px-3 py-3 text-slate-700">TOTAL</td>
                    {COLUNAS.map(col => {
                      const t = totTrinks[col];
                      const c = col === 'pagSeg' ? totCaixa.pagSeg : totCaixa[col];
                      return (
                        <React.Fragment key={col}>
                          <td className="px-2 py-3 text-right font-mono text-indigo-700">{fmt(t)}</td>
                          <td className="px-2 py-3 text-right font-mono text-slate-700">{fmt(c)}</td>
                        </React.Fragment>
                      );
                    })}
                    <td className="px-2 py-3 text-right font-mono text-indigo-700">{fmt(totTrinks.total)}</td>
                    <td className="px-2 py-3 text-right font-mono text-slate-700">{fmt(totCaixa.total)}</td>
                    <td className={`px-2 py-3 text-right font-mono ${Math.abs(totTrinks.total - totCaixa.total) < 0.01 ? 'text-green-600' : 'text-red-600'}`}>
                      {Math.abs(totTrinks.total - totCaixa.total) < 0.01
                        ? '✓ OK'
                        : `${totTrinks.total - totCaixa.total > 0 ? '+' : ''}${fmt(totTrinks.total - totCaixa.total)}`}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )}

        {/* Modal upload extrato */}
        {showUploadModal && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-6">
              <h2 className="text-lg font-black text-slate-800 mb-1">Upload Extrato da Operadora</h2>
              <p className="text-xs text-slate-400 mb-5">Importe o relatório de vendas e os valores serão preenchidos automaticamente por dia.</p>

              <div className="mb-4">
                <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Operadora</label>
                <select
                  value={uploadProvider}
                  onChange={e => { setUploadProvider(e.target.value as Coluna); setUploadParsed([]); setUploadError(''); }}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                >
                  <option value="rede">REDE</option>
                  <option value="pagSeg">PAG SEG</option>
                  <option value="inter">INTER</option>
                  <option value="frog">FROG</option>
                  <option value="din">DIN</option>
                </select>
              </div>

              <div className="mb-4">
                {uploadProvider === 'inter' ? (
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Fonte dos dados</label>
                    <button
                      onClick={loadInterFromBankStatement}
                      disabled={loadingBank}
                      className="flex items-center gap-2 px-4 py-3 border-2 border-indigo-200 bg-indigo-50 rounded-xl text-sm text-indigo-700 font-semibold hover:bg-indigo-100 transition-colors w-full justify-center disabled:opacity-60"
                    >
                      🏦 {loadingBank ? 'Carregando extrato...' : 'Carregar PIX do Extrato Bancário'}
                    </button>
                    <p className="text-xs text-slate-400 mt-2">Busca automaticamente as entradas de PIX do extrato Inter já importado neste mês.</p>
                  </div>
                ) : (
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Arquivo CSV</label>
                    <input
                      ref={uploadRef}
                      type="file"
                      accept=".csv,text/csv"
                      className="hidden"
                      onChange={e => { const f = e.target.files?.[0]; if (f) handleUploadFile(f); e.target.value = ''; }}
                    />
                    <button
                      onClick={() => uploadRef.current?.click()}
                      className="flex items-center gap-2 px-4 py-3 border-2 border-dashed border-slate-300 rounded-xl text-sm text-slate-500 hover:border-indigo-400 hover:text-indigo-600 transition-colors w-full justify-center"
                    >
                      <Upload size={16} /> Selecionar arquivo CSV
                    </button>
                  </div>
                )}
                {uploadError && <p className="text-xs text-red-500 font-medium mt-2">{uploadError}</p>}
              </div>

              {uploadParsed.length > 0 && (
                <div className="mb-5">
                  <p className="text-xs font-bold text-slate-500 uppercase mb-2">
                    {uploadParsed.length} dia(s) — total R$ {fmt(uploadParsed.reduce((s, r) => s + r.amount, 0))}
                  </p>
                  <div className="max-h-44 overflow-y-auto border border-slate-100 rounded-xl divide-y divide-slate-50">
                    {uploadParsed.map(row => {
                      const [yyyy, mm, dd] = row.date.split('-');
                      return (
                        <div key={row.date} className="flex justify-between px-3 py-2 text-xs">
                          <span className="font-semibold text-slate-600">{dd}/{mm}/{yyyy}</span>
                          <span className="font-bold text-indigo-700">R$ {fmt(row.amount)}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="flex gap-3 justify-end">
                <button
                  onClick={() => { setShowUploadModal(false); setUploadParsed([]); }}
                  className="px-4 py-2 border border-slate-200 rounded-lg text-sm text-slate-600 hover:bg-slate-50"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleConfirmUpload}
                  disabled={uploadParsed.length === 0 || uploading}
                  className="px-5 py-2 bg-indigo-600 text-white rounded-lg text-sm font-bold hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {uploading ? 'Importando...' : `Importar ${uploadParsed.length} dia(s)`}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Legend */}
        <div className="flex items-center gap-4 text-xs text-slate-500 flex-wrap">
          <span className="flex items-center gap-1"><CheckCircle size={12} className="text-green-500" /> Coincide (&lt;1%)</span>
          <span className="flex items-center gap-1"><AlertTriangle size={12} className="text-yellow-500" /> Pequena diferença (1-5%)</span>
          <span className="flex items-center gap-1"><XCircle size={12} className="text-red-500" /> Diferença significativa (&gt;5%)</span>
          <span className="ml-auto text-slate-400">T = Trinks · C = Receitas manual</span>
        </div>
      </div>
    </div>
  );
};
