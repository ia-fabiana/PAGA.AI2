import React, { useState, useEffect, useCallback } from 'react';
import { db } from './firebase';
import { collection, getDocs, query, where, orderBy, setDoc, doc } from 'firebase/firestore';
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
  Download, Edit2, Save, X,
} from 'lucide-react';

interface Props {
  user: TeamMember;
  onBack: () => void;
  onShowCashBoxEntry?: () => void;
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

export const TrinksReconciliation: React.FC<Props> = ({ user, onBack, onShowCashBoxEntry }) => {
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

  return (
    <div className="flex flex-col flex-1 bg-slate-50 p-6 overflow-y-auto">
      <div className="max-w-full mx-auto w-full space-y-6">

        {/* Header */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-3">
              <div>
                <h1 className="text-2xl font-black text-slate-800">CAIXA</h1>
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
              {onShowCashBoxEntry && (
                <button
                  onClick={onShowCashBoxEntry}
                  className="flex items-center gap-2 px-4 py-2 bg-slate-100 text-slate-700 rounded-lg text-sm font-semibold hover:bg-slate-200"
                >
                  Lançamentos
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
                                <td className={`px-2 py-2 text-right font-mono ${cs === 'erro' ? 'text-red-600 font-bold' : cs === 'aviso' ? 'text-yellow-700' : 'text-slate-600'}`}>
                                  {cv > 0 ? fmt(cv) : <span className="text-slate-300">—</span>}
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
