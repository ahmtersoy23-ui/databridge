import { useState, useEffect, useMemo } from 'react';
import axios from 'axios';

interface AggRow {
  sku: string;
  iwasku: string | null;
  product_name: string | null;
  total_qty: number;
  total_revenue: number;
  order_count: number;
  avg_unit_price: number;
  last_order_date: string | null;
}

interface Summary {
  totalSkus: number;
  totalQty: number;
  totalRevenue: number;
  matched: number;
  unmatched: number;
  days: number;
}

type SortKey = keyof AggRow;

const RANGES = [7, 30, 90, 180, 366];

export default function WalmartOrdersAnalysis() {
  const [days, setDays] = useState(30);
  const [rows, setRows] = useState<AggRow[]>([]);
  const [summary, setSummary] = useState<Summary>({
    totalSkus: 0, totalQty: 0, totalRevenue: 0, matched: 0, unmatched: 0, days: 30,
  });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('total_qty');
  const [sortAsc, setSortAsc] = useState(false);

  useEffect(() => {
    setLoading(true);
    axios.get('/api/v1/walmart/orders/analysis', { params: { days } })
      .then(r => {
        setRows(r.data.data || []);
        setSummary(r.data.summary || { totalSkus: 0, totalQty: 0, totalRevenue: 0, matched: 0, unmatched: 0, days });
      })
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [days]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(false); }
  };

  const filtered = useMemo(() => {
    let data = rows;
    if (search) {
      const q = search.toLowerCase();
      data = data.filter(r =>
        r.sku.toLowerCase().includes(q) ||
        (r.iwasku && r.iwasku.toLowerCase().includes(q)) ||
        (r.product_name && r.product_name.toLowerCase().includes(q)),
      );
    }
    return [...data].sort((a, b) => {
      const av = a[sortKey] ?? '';
      const bv = b[sortKey] ?? '';
      if (sortKey === 'sku' || sortKey === 'iwasku' || sortKey === 'product_name' || sortKey === 'last_order_date') {
        return sortAsc ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
      }
      return sortAsc ? (Number(av) || 0) - (Number(bv) || 0) : (Number(bv) || 0) - (Number(av) || 0);
    });
  }, [rows, search, sortKey, sortAsc]);

  const summaryCards = [
    { label: 'SKUs', value: summary.totalSkus.toLocaleString(), color: 'text-slate-700' },
    { label: 'Total Qty', value: summary.totalQty.toLocaleString(), color: 'text-emerald-600' },
    { label: 'Total Revenue', value: `$${summary.totalRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, color: 'text-blue-600' },
    { label: 'Matched', value: `${summary.matched} / ${summary.totalSkus}`, color: summary.unmatched > 0 ? 'text-amber-600' : 'text-emerald-600' },
  ];

  const sortIcon = (key: SortKey) => sortKey === key ? (sortAsc ? '↑' : '↓') : '';

  return (
    <div>
      <h1 className="mb-4">Walmart Orders Analysis</h1>

      <div className="flex gap-2 mb-5 border-b-2 border-slate-200">
        {RANGES.map(d => (
          <button key={d} onClick={() => { setDays(d); setSearch(''); }}
            className={`px-4 py-1.5 border-none bg-transparent cursor-pointer text-sm font-medium -mb-0.5 ${
              days === d
                ? 'text-cyan-600 border-b-2 border-b-cyan-600'
                : 'text-slate-500 border-b-2 border-b-transparent'
            }`}>
            Last {d}d
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
        <input type="text" placeholder="Search SKU / IWASKU / product..."
          value={search} onChange={e => setSearch(e.target.value)}
          className="py-1 px-3 border border-gray-300 rounded-md text-sm w-72" />
        <span className="text-sm text-slate-500">{filtered.length} items</span>
      </div>

      <div className="bg-white rounded-lg shadow-sm mb-4">
        {loading ? (
          <div className="p-12 text-center text-slate-400">Loading...</div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center text-slate-400">No order data in this range.</div>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b-2 border-slate-200">
                <th onClick={() => handleSort('sku')} className="text-left p-2 cursor-pointer select-none whitespace-nowrap text-xs font-semibold">SKU {sortIcon('sku')}</th>
                <th onClick={() => handleSort('iwasku')} className="text-left p-2 cursor-pointer select-none whitespace-nowrap text-xs font-semibold">IWASKU {sortIcon('iwasku')}</th>
                <th onClick={() => handleSort('product_name')} className="text-left p-2 cursor-pointer select-none text-xs font-semibold">Product {sortIcon('product_name')}</th>
                <th onClick={() => handleSort('total_qty')} className="text-right p-2 cursor-pointer select-none whitespace-nowrap text-xs font-semibold">Qty {sortIcon('total_qty')}</th>
                <th onClick={() => handleSort('avg_unit_price')} className="text-right p-2 cursor-pointer select-none whitespace-nowrap text-xs font-semibold">Avg $ {sortIcon('avg_unit_price')}</th>
                <th onClick={() => handleSort('total_revenue')} className="text-right p-2 cursor-pointer select-none whitespace-nowrap text-xs font-semibold">Revenue {sortIcon('total_revenue')}</th>
                <th onClick={() => handleSort('order_count')} className="text-right p-2 cursor-pointer select-none whitespace-nowrap text-xs font-semibold">Orders {sortIcon('order_count')}</th>
                <th onClick={() => handleSort('last_order_date')} className="text-left p-2 cursor-pointer select-none whitespace-nowrap text-xs font-semibold">Last {sortIcon('last_order_date')}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => (
                <tr key={r.sku} className="border-b border-slate-100">
                  <td className="p-2 font-mono text-xs">{r.sku}</td>
                  <td className={`p-2 font-mono text-xs ${r.iwasku ? 'text-slate-900' : 'text-slate-400'}`}>{r.iwasku || '—'}</td>
                  <td className="p-2 text-slate-700 max-w-xs truncate" title={r.product_name || ''}>{r.product_name || '—'}</td>
                  <td className={`p-2 text-right font-semibold ${Number(r.total_qty) > 0 ? 'text-emerald-600' : 'text-gray-300'}`}>
                    {Number(r.total_qty).toLocaleString()}
                  </td>
                  <td className="p-2 text-right text-slate-600">${Number(r.avg_unit_price).toFixed(2)}</td>
                  <td className={`p-2 text-right font-semibold ${Number(r.total_revenue) > 0 ? 'text-blue-600' : 'text-gray-300'}`}>
                    ${Number(r.total_revenue).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                  <td className="p-2 text-right">{r.order_count}</td>
                  <td className="p-2 text-xs text-slate-500">
                    {r.last_order_date ? new Date(r.last_order_date).toLocaleDateString() : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
