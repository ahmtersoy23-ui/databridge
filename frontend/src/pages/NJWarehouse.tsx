import { useState, useEffect, useMemo } from 'react';
import axios from 'axios';

interface NJRow {
  fnsku: string;
  iwasku: string | null;
  asin: string | null;
  name: string;
  category: string;
  total_count: number;
  count_in_raf: number;
  count_in_ship: number;
}

type SortKey = keyof NJRow;

export default function NJWarehouse() {
  const [rows, setRows] = useState<NJRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('total_count');
  const [sortAsc, setSortAsc] = useState(false);

  useEffect(() => {
    setLoading(true);
    axios.get('/api/v1/amazonfba/NJ')
      .then(res => setRows(Array.isArray(res.data) ? res.data : []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, []);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(false); }
  };

  const filtered = useMemo(() => {
    let data = rows;
    if (search) {
      const q = search.toLowerCase();
      data = data.filter(r =>
        r.iwasku?.toLowerCase().includes(q) ||
        r.asin?.toLowerCase().includes(q) ||
        r.fnsku?.toLowerCase().includes(q) ||
        r.name?.toLowerCase().includes(q) ||
        r.category?.toLowerCase().includes(q)
      );
    }
    return [...data].sort((a, b) => {
      const av = a[sortKey] ?? '';
      const bv = b[sortKey] ?? '';
      if (sortKey === 'total_count' || sortKey === 'count_in_raf' || sortKey === 'count_in_ship') {
        return sortAsc ? Number(av) - Number(bv) : Number(bv) - Number(av);
      }
      return sortAsc
        ? String(av).localeCompare(String(bv))
        : String(bv).localeCompare(String(av));
    });
  }, [rows, search, sortKey, sortAsc]);

  const summary = useMemo(() => ({
    total: rows.length,
    enriched: rows.filter(r => r.iwasku).length,
    totalCount: rows.reduce((s, r) => s + (Number(r.total_count) || 0), 0),
    totalRaf: rows.reduce((s, r) => s + (Number(r.count_in_raf) || 0), 0),
    totalShip: rows.reduce((s, r) => s + (Number(r.count_in_ship) || 0), 0),
  }), [rows]);

  const sortArrow = (key: SortKey) => sortKey === key ? (sortAsc ? ' ↑' : ' ↓') : '';

  return (
    <div>
      <h1 className="mb-6">NJ Warehouse</h1>

      {/* Summary cards */}
      <div className="grid grid-cols-5 gap-4 mb-4">
        {[
          { label: 'Total SKUs', value: summary.total, color: 'text-slate-700' },
          { label: 'Enriched (iwasku)', value: summary.enriched, color: 'text-emerald-600' },
          { label: 'Total Count', value: summary.totalCount, color: 'text-slate-700' },
          { label: 'In Raf', value: summary.totalRaf, color: 'text-blue-600' },
          { label: 'In Shipment', value: summary.totalShip, color: 'text-amber-600' },
        ].map(c => (
          <div key={c.label} className="bg-white rounded-lg p-6 shadow-sm text-center">
            <div className="text-xs text-gray-500 mb-1">{c.label}</div>
            <div className={`text-2xl font-bold ${c.color}`}>{c.value.toLocaleString()}</div>
          </div>
        ))}
      </div>

      {/* Search + count */}
      <div className="bg-white rounded-lg p-6 shadow-sm mb-4">
        <div className="flex gap-4 items-center">
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search SKU / ASIN / FNSKU / Name / Category..."
            className="px-2.5 py-1.5 border border-gray-300 rounded-md text-sm flex-1"
          />
          <span className="text-xs text-gray-500 whitespace-nowrap">{filtered.length} items</span>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg shadow-sm mb-4 overflow-x-auto">
        {loading ? (
          <p className="p-6 text-gray-500">Loading...</p>
        ) : filtered.length === 0 ? (
          <p className="p-6 text-gray-500">No data found.</p>
        ) : (
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-b-2 border-slate-200 bg-slate-50">
                <th onClick={() => handleSort('iwasku')} className="p-2 text-left cursor-pointer select-none whitespace-nowrap text-slate-600 text-xs font-semibold">IWA SKU{sortArrow('iwasku')}</th>
                <th onClick={() => handleSort('asin')} className="p-2 text-left cursor-pointer select-none whitespace-nowrap text-slate-600 text-xs font-semibold">ASIN{sortArrow('asin')}</th>
                <th onClick={() => handleSort('fnsku')} className="p-2 text-left cursor-pointer select-none whitespace-nowrap text-slate-600 text-xs font-semibold">FNSKU{sortArrow('fnsku')}</th>
                <th onClick={() => handleSort('name')} className="p-2 text-left cursor-pointer select-none whitespace-nowrap text-slate-600 text-xs font-semibold">Name{sortArrow('name')}</th>
                <th onClick={() => handleSort('category')} className="p-2 text-left cursor-pointer select-none whitespace-nowrap text-slate-600 text-xs font-semibold">Category{sortArrow('category')}</th>
                <th onClick={() => handleSort('total_count')} className="p-2 text-right cursor-pointer select-none whitespace-nowrap text-slate-700 text-xs font-semibold">Total{sortArrow('total_count')}</th>
                <th onClick={() => handleSort('count_in_raf')} className="p-2 text-right cursor-pointer select-none whitespace-nowrap text-blue-600 text-xs font-semibold">In Raf{sortArrow('count_in_raf')}</th>
                <th onClick={() => handleSort('count_in_ship')} className="p-2 text-right cursor-pointer select-none whitespace-nowrap text-amber-600 text-xs font-semibold">In Ship{sortArrow('count_in_ship')}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => (
                <tr key={i} className="border-b border-slate-100">
                  <td className={`px-2 py-1.5 font-mono text-xs ${r.iwasku ? 'text-slate-800' : 'text-gray-300'}`}>
                    {r.iwasku || '—'}
                  </td>
                  <td className={`px-2 py-1.5 font-mono text-xs ${r.asin ? 'text-slate-800' : 'text-gray-300'}`}>
                    {r.asin || '—'}
                  </td>
                  <td className="px-2 py-1.5 font-mono text-xs text-gray-500">
                    {r.fnsku}
                  </td>
                  <td className="px-2 py-1.5 max-w-[220px] overflow-hidden text-ellipsis whitespace-nowrap" title={r.name}>
                    {r.name}
                  </td>
                  <td className="px-2 py-1.5 text-gray-500 text-xs">
                    {r.category}
                  </td>
                  <td className={`px-2 py-1.5 text-right font-semibold tabular-nums font-mono ${Number(r.total_count) > 0 ? 'text-slate-800' : 'text-gray-300'}`}>
                    {Number(r.total_count) > 0 ? r.total_count.toLocaleString() : '—'}
                  </td>
                  <td className={`px-2 py-1.5 text-right tabular-nums font-mono ${Number(r.count_in_raf) > 0 ? 'text-blue-600' : 'text-gray-300'}`}>
                    {Number(r.count_in_raf) > 0 ? r.count_in_raf.toLocaleString() : '—'}
                  </td>
                  <td className={`px-2 py-1.5 text-right tabular-nums font-mono ${Number(r.count_in_ship) > 0 ? 'text-amber-600' : 'text-gray-300'}`}>
                    {Number(r.count_in_ship) > 0 ? r.count_in_ship.toLocaleString() : '—'}
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
