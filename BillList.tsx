
import React, { useState, useMemo } from 'react';
import { Bill, Supplier, BillStatus, UserRole, ChartOfAccount } from './types';
import { Search, Plus, FileDown, Edit2, Trash2, CheckCircle2, Repeat, Calendar, ListTree, User, AlertCircle } from 'lucide-react';
import { jsPDF } from 'jspdf';
import 'jspdf-autotable';

interface BillListProps {
  bills: Bill[];
  suppliers: Supplier[];
  accounts: ChartOfAccount[];
  onEdit: (bill: Bill) => void;
  onDelete: (id: string) => void;
  onStatusChange: (id: string, status: BillStatus) => void;
  onOpenForm: () => void;
  onToggleEstimate: (id: string) => void;
  userRole: UserRole;
}

export const BillList: React.FC<BillListProps> = ({ bills, suppliers, accounts, onEdit, onDelete, onStatusChange, onOpenForm, onToggleEstimate, userRole }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [supplierFilter, setSupplierFilter] = useState('ALL');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const filteredBills = useMemo(() => {
    return bills.filter(bill => {
      const supplier = suppliers.find(s => s.id === bill.supplierId);
      const account = accounts.find(a => a.id === bill.accountId);
      
      const matchesSearch = 
        bill.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
        supplier?.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        account?.name.toLowerCase().includes(searchTerm.toLowerCase());
      
      const matchesStatus = statusFilter === 'ALL' || bill.status === statusFilter;
      const matchesSupplier = supplierFilter === 'ALL' || bill.supplierId === supplierFilter;
      
      const billDate = new Date(bill.dueDate);
      const matchesDate = 
        (!startDate || billDate >= new Date(startDate)) &&
        (!endDate || billDate <= new Date(endDate));

      return matchesSearch && matchesStatus && matchesSupplier && matchesDate;
    }).sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());
  }, [bills, suppliers, accounts, searchTerm, statusFilter, supplierFilter, startDate, endDate]);

  const canEdit = userRole !== UserRole.VIEWER;
  const canDelete = userRole === UserRole.ADMIN;

  const exportPDF = () => {
    const doc = new jsPDF();
    const title = `Relatório PAGA.AI - ${new Date().toLocaleDateString()}`;
    doc.setFontSize(18);
    doc.text(title, 14, 22);
    const tableData = filteredBills.map(b => {
      const s = suppliers.find(sup => sup.id === b.supplierId);
      const acc = accounts.find(a => a.id === b.accountId);
      const typeLabel = acc?.type === 'VARIABLE' ? '(V)' : '(F)';
      const desc = b.currentInstallment ? `${b.description} (${b.currentInstallment}/${b.totalInstallments})` : b.description;
      return [
        `${desc} ${typeLabel}`, 
        s?.name || 'N/A', 
        acc?.name || 'N/A',
        new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(b.amount), 
        new Date(b.dueDate).toLocaleDateString('pt-BR'), 
        b.status
      ];
    });
    (doc as any).autoTable({ 
      startY: 30, 
      head: [['Descrição', 'Fornecedor', 'Plano de Contas', 'Valor', 'Vencimento', 'Status']], 
      body: tableData, 
      theme: 'grid', 
      headStyles: { fillStyle: '#4f46e5' } 
    });
    const total = filteredBills.reduce((acc, curr) => acc + curr.amount, 0);
    const finalY = (doc as any).lastAutoTable.finalY + 10;
    doc.setFontSize(12);
    doc.text(`Total do Período: ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(total)}`, 14, finalY);
    doc.save(`paga-ai-relatorio-${new Date().getTime()}.pdf`);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-4xl font-black text-slate-800">Contas a Pagar</h1>
          <p className="text-slate-600 font-semibold text-sm">Acompanhe suas despesas Fixas (F) e Variáveis (V).</p>
        </div>
        <div className="flex gap-2">
          <button onClick={exportPDF} className="flex items-center gap-2 px-4 py-2 border border-slate-200 rounded-xl bg-white text-slate-700 hover:bg-slate-50 transition-colors font-medium text-sm shadow-sm">
            <FileDown size={18} /> Exportar PDF
          </button>
          {canEdit && (
            <button onClick={onOpenForm} className="flex items-center gap-2 px-4 py-2 bg-indigo-600 rounded-xl text-white hover:bg-indigo-700 transition-colors font-medium text-sm shadow-md">
              <Plus size={18} /> Nova Conta
            </button>
          )}
        </div>
      </div>

      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-4">
        <div className="relative md:col-span-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <input 
            type="text" 
            placeholder="Buscar..." 
            className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none text-sm" 
            value={searchTerm} 
            onChange={(e) => setSearchTerm(e.target.value)} 
          />
        </div>

        <div className="relative">
          <select 
            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 focus:ring-2 focus:ring-indigo-500 outline-none text-sm appearance-none" 
            value={statusFilter} 
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="ALL">Todos Status</option>
            <option value={BillStatus.PENDING}>Pendente</option>
            <option value={BillStatus.PAID}>Pago</option>
            <option value={BillStatus.OVERDUE}>Atrasado</option>
          </select>
        </div>

        <div className="relative">
          <select 
            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 focus:ring-2 focus:ring-indigo-500 outline-none text-sm appearance-none" 
            value={supplierFilter} 
            onChange={(e) => setSupplierFilter(e.target.value)}
          >
            <option value="ALL">Todos Fornecedores</option>
            {suppliers.map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <Calendar size={16} className="text-slate-400 shrink-0" />
          <input 
            type="date" 
            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-2 py-2 text-xs focus:ring-2 focus:ring-indigo-500 outline-none" 
            value={startDate} 
            onChange={(e) => setStartDate(e.target.value)} 
          />
        </div>
        <div className="flex items-center gap-2">
          <input 
            type="date" 
            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-2 py-2 text-xs focus:ring-2 focus:ring-indigo-500 outline-none" 
            value={endDate} 
            onChange={(e) => setEndDate(e.target.value)} 
          />
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[800px]">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-6 py-4 text-sm font-semibold text-slate-500 uppercase tracking-wider">Descrição / Fornecedor</th>
                <th className="px-6 py-4 text-sm font-semibold text-slate-500 uppercase tracking-wider text-center">Tipo</th>
                <th className="px-6 py-4 text-sm font-semibold text-slate-500 uppercase tracking-wider">Plano de Contas</th>
                <th className="px-6 py-4 text-sm font-semibold text-slate-500 uppercase tracking-wider">Vencimento</th>
                <th className="px-6 py-4 text-sm font-semibold text-slate-500 uppercase tracking-wider">Valor</th>
                <th className="px-6 py-4 text-sm font-semibold text-slate-500 uppercase tracking-wider text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredBills.map(bill => {
                const supplier = suppliers.find(s => s.id === bill.supplierId);
                const account = accounts.find(a => a.id === bill.accountId);
                return (
                  <tr key={bill.id} className="hover:bg-slate-50 transition-colors group">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        {bill.recurrenceType !== 'none' && <div className="bg-indigo-100 p-1.5 rounded-lg text-indigo-600"><Repeat size={14} /></div>}
                        {bill.isEstimate && <div className="bg-amber-100 px-2 py-1 rounded text-amber-700 text-xs font-bold uppercase tracking-tight">Estimativa</div>}
                        <div>
                          <p className="font-semibold text-slate-800 text-sm">
                            {bill.description}
                            {bill.currentInstallment && <span className="ml-2 text-xs font-bold text-slate-400">({bill.currentInstallment}/{bill.totalInstallments})</span>}
                          </p>
                          <p className="text-sm text-slate-500 flex items-center gap-1">
                            <User size={10} /> {supplier?.name || 'Fornecedor Desconhecido'}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-center">
                      <span className={`px-2 py-0.5 rounded text-xs font-black uppercase ${account?.type === 'VARIABLE' ? 'bg-orange-100 text-orange-600' : 'bg-indigo-100 text-indigo-600'}`} title={account?.type === 'VARIABLE' ? 'Despesa Variável' : 'Despesa Fixa'}>
                        {account?.type === 'VARIABLE' ? 'V' : 'F'}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2 text-xs text-indigo-700 bg-indigo-50 px-3 py-1 rounded-full w-fit font-bold uppercase tracking-tighter">
                        <ListTree size={12} />
                        {account?.name || 'N/A'}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-sm text-slate-600 flex items-center gap-2">
                        {new Date(bill.dueDate).toLocaleDateString('pt-BR')}
                        {new Date(bill.dueDate) < new Date() && bill.status !== BillStatus.PAID && (
                          <span className="text-xs bg-rose-100 text-rose-600 px-1.5 py-0.5 rounded font-bold uppercase">Atrasada</span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className="font-semibold text-slate-800 text-sm">
                        {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(bill.amount)}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        {canEdit && bill.status !== BillStatus.PAID && (
                          <button onClick={() => onStatusChange(bill.id, BillStatus.PAID)} className="p-2 text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors" title="Marcar como Pago">
                            <CheckCircle2 size={18} />
                          </button>
                        )}
                        {canEdit && (
                          <button 
                            onClick={() => onToggleEstimate(bill.id)} 
                            className={`p-2 rounded-lg transition-colors ${bill.isEstimate ? 'text-amber-600 hover:bg-amber-50' : 'text-slate-400 hover:bg-slate-50'}`}
                            title={bill.isEstimate ? 'Marcar como valor real' : 'Marcar como estimativa'}
                          >
                            <AlertCircle size={18} />
                          </button>
                        )}
                        {canEdit && (
                          <button onClick={() => onEdit(bill)} className="p-2 text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors" title="Editar">
                            <Edit2 size={18} />
                          </button>
                        )}
                        {canDelete && (
                          <button onClick={() => onDelete(bill.id)} className="p-2 text-rose-600 hover:bg-rose-50 rounded-lg transition-colors" title="Excluir">
                            <Trash2 size={18} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {filteredBills.length === 0 && (
            <div className="p-20 text-center bg-slate-50/50">
              <p className="text-slate-400 font-medium">Nenhuma conta encontrada com os filtros aplicados.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
