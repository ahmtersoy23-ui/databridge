import { useState, useEffect, useMemo } from 'react';
import axios from 'axios';

interface WfAccount {
  id: number;
  label: string;
  is_active: boolean;
}

interface AggRow {
  part_number: string;
  iwasku: string | null;
  total_qty: number;
  total_cost: number;
  po_count: number;
  avg_price: number;
}

interface Summary {
  totalParts: number;
  totalQty: number;
  totalCost: number;
  matched: number;
  unmatched: number;
}

const ACCOUNT_LABELS: Record<string, string> = {
  shukran: 'Shukran',
  mdn: 'MDN',
};

type SortKey = keyof AggRow;

export default function WayfairOrdersAnalysis() {
  const [accounts, setAccounts] = useState<WfAccount[]>([]);
  const [selectedAccount, setSelectedAccount] = useState('shukran');
  const [tab, setTab] = useState<'total' | 'castlegate' | 'dropship'>('total');
  const [rows, setRows] = useState<AggRow[]>([]);
  const [summary, setSummary] = useState<Summary>({ totalParts: 0, totalQty: 0, totalCost: 0, matched: 0, unmatched: 0 });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('total_qty');
  const [sortAsc, setSortAsc] = useState(false);

  useEffect(() => {
    axios.get('/api/v1/wayfair/settings').then(r => {
      const active = (r.data.accounts || []).filter((a: WfAccount) => a.is_active);
      setAccounts(active);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    axios.get('/api/v1/wayfair/orders/analysis', {
      params: { account: selectedAccount, type: tab },
    }).then(r => {
      setRows(r.data.data || []);
      setSummary(r.data.summary || { totalParts: 0, totalQty: 0, totalCost: 0, matched: 0, unmatched: 0 });
    }).catch(() => {
      setRows([]);
    }).finally(() => setLoading(false));
  }, [selectedAccount, tab]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(false); }
  };

  const filtered = useMemo(() => {
    let data = rows;
    if (search) {
      const q = search.toLowerCase();
      data = data.filter(r => r.part_number.toLowerCase().includes(q) || (r.iwasku && r.iwasku.toLowerCase().includes(q)));
    }
    return [...data].sort((a, b) => {
      const av = a[sortKey] ?? '';
      const bv = b[sortKey] ?? '';
      if (sortKey === 'part_number' || sortKey === 'iwasku') {
        return sortAsc ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
      }
      return sortAsc ? (Number(av) || 0) - (Number(bv) || 0) : (Number(bv) || 0) - (Number(av) || 0);
    });
  }, [rows, search, sortKey, sortAsc]);

  const summaryCards = [
    { label: 'Part Numbers', value: summary.totalParts.toLocaleString(), color: 'text-slate-700' },
    { label: 'Total Qty', value: summary.totalQty.toLocaleString(), color: 'text-emerald-600' },
    { label: 'Total Cost', value: `$${summary.totalCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, color: 'text-blue-600' },
    { label: 'Matched', value: `${summary.matched} / ${summary.totalParts}`, color: summary.unmatched > 0 ? 'text-amber-600' : 'text-emerald-600' },
  ];

  const sortIcon = (key: SortKey) => sortKey === key ? (sortAsc ? '\u2191' : '\u2193') : '';

  return (
    <div>
      <h1 className="mb-4">Wayfair Orders Analysis</h1>

      {accounts.length > 1 && (
        <div className="flex gap-2 mb-4">
          {accounts.map(a => (
            <button key={a.label} onClick={() => { setSelectedAccount(a.label); setSearch(''); }}
              className={`px-4 py-1.5 rounded-md cursor-pointer text-sm font-semibold border-2 ${
                selectedAccount === a.label
                  ? 'bg-cyan-600 text-white border-cyan-600'
                  : 'bg-white text-slate-700 border-gray-300'
              }`}>
              {ACCOUNT_LABELS[a.label] || a.label.toUpperCase()}
            </button>
          ))}
        </div>
      )}

      <div className="flex gap-1 mb-5 border-b-2 border-slate-200">
        {(['total', 'castlegate', 'dropship'] as const).map(t => (
          <button key={t} onClick={() => { setTab(t); setSearch(''); }}
            className={`px-4 py-1.5 border-none bg-transparent cursor-pointer text-sm font-medium -mb-0.5 ${
              tab === t
                ? 'text-cyan-600 border-b-2 border-b-cyan-600'
                : 'text-slate-500 border-b-2 border-b-transparent'
            }`}>
            {t === 'total' ? 'Total' : t === 'castlegate' ? 'CastleGate' : 'Dropship'}
          </button>
        ))}
      </div>

      {!loading && (
        <div className="grid grid-cols-4 gap-4 mb-4">
          {summaryCards.map(card => (
            <div key={card.label} className="bg-white rounded-lg p-6 shadow-sm text-center">
              <div className="text-xs text-slate-500 mb-1">{card.label}</div>
              <div className={`text-xl font-bold ${card.color}`}>{card.value}</div>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-3 items-center mb-4">
        <input type="text" placeholder="Search part number / iwasku..." value={search} onChange={e => setSearch(e.target.value)}
          className="py-1 px-3 border border-gray-300 rounded-md text-sm w-60" />
        <span className="text-sm text-slate-500">{filtered.length} items</span>
      </div>

      <div className="bg-white rounded-lg shadow-sm mb-4">
        {loading ? (
          <div className="p-12 text-center text-slate-400">Loading...</div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center text-slate-400">No order data found.</div>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b-2 border-slate-200">
                <th onClick={() => handleSort('part_number')} className="text-left p-2 cursor-pointer select-none whitespace-nowrap text-xs font-semibold">Part Number {sortIcon('part_number')}</th>
                <th onClick={() => handleSort('iwasku')} className="text-left p-2 cursor-pointer select-none whitespace-nowrap text-xs font-semibold">IWASKU {sortIcon('iwasku')}</th>
                <th onClick={() => handleSort('total_qty')} className="text-right p-2 cursor-pointer select-none whitespace-nowrap text-xs font-semibold">Total Qty {sortIcon('total_qty')}</th>
                <th onClick={() => handleSort('avg_price')} className="text-right p-2 cursor-pointer select-none whitespace-nowrap text-xs font-semibold">Avg Price {sortIcon('avg_price')}</th>
                <th onClick={() => handleSort('total_cost')} className="text-right p-2 cursor-pointer select-none whitespace-nowrap text-xs font-semibold">Total Cost {sortIcon('total_cost')}</th>
                <th onClick={() => handleSort('po_count')} className="text-right p-2 cursor-pointer select-none whitespace-nowrap text-xs font-semibold">POs {sortIcon('po_count')}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => (
                <tr key={r.part_number} className="border-b border-slate-100">
                  <td className="p-2 font-mono text-xs">{r.part_number}</td>
                  <td className={`p-2 font-mono text-xs ${r.iwasku ? 'text-slate-900' : 'text-slate-400'}`}>{r.iwasku || '—'}</td>
                  <td className={`p-2 text-right font-semibold ${r.total_qty > 0 ? 'text-emerald-600' : 'text-gray-300'}`}>{r.total_qty.toLocaleString()}</td>
                  <td className="p-2 text-right text-slate-600">${Number(r.avg_price).toFixed(2)}</td>
                  <td className={`p-2 text-right font-semibold ${Number(r.total_cost) > 0 ? 'text-blue-600' : 'text-gray-300'}`}>${Number(r.total_cost).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                  <td className="p-2 text-right">{r.po_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
