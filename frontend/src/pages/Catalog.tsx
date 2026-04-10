import { useState, useEffect, useMemo } from 'react';
import axios from 'axios';

interface WisersellProduct {
  id: number;
  name: string | null;
  code: string | null;
  weight: number | null;
  deci: number | null;
  width: number | null;
  length: number | null;
  height: number | null;
  arr_sku: string[] | null;
  category_id: number | null;
  category_name: string | null;
  size: string | null;
  color: string | null;
  synced_at: string | null;
  identifier?: string | null;
  product_name?: string | null;
}

const PAGE_SIZE = 200;

type SortKey = 'id' | 'name' | 'code' | 'deci' | 'category_name' | 'size' | 'color' | 'weight' | 'identifier' | 'parent_name';

export default function Catalog() {
  const [rows, setRows] = useState<WisersellProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('code');
  const [sortAsc, setSortAsc] = useState(true);
  const [page, setPage] = useState(0);

  useEffect(() => {
    setLoading(true);
    axios.get('/api/v1/catalog')
      .then(res => setRows(Array.isArray(res.data) ? res.data : []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, []);

  // Reset to page 0 when search or sort changes
  useEffect(() => { setPage(0); }, [search, sortKey, sortAsc]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(true); }
  };

  const sortArrow = (key: SortKey) => sortKey === key ? (sortAsc ? ' \u2191' : ' \u2193') : '';

  const summary = useMemo(() => ({
    total: rows.length,
    withCode: rows.filter(r => r.code).length,
    withSkus: rows.filter(r => r.arr_sku && r.arr_sku.length > 0).length,
  }), [rows]);

  const filtered = useMemo(() => {
    let data = rows;
    if (search) {
      const q = search.toLowerCase();
      data = data.filter(r =>
        r.name?.toLowerCase().includes(q) ||
        r.code?.toLowerCase().includes(q) ||
        r.arr_sku?.some(s => s.toLowerCase().includes(q)) ||
        r.category_name?.toLowerCase().includes(q) ||
        r.size?.toLowerCase().includes(q) ||
        r.color?.toLowerCase().includes(q)
      );
    }
    const withComputed = data.map(r => ({
      ...r,
      identifier: r.identifier ?? (r.name?.split(' ')[0] || null),
      parent_name: r.product_name || r.name,
    }));
    return [...withComputed].sort((a, b) => {
      const av = (a as any)[sortKey] ?? '';
      const bv = (b as any)[sortKey] ?? '';
      if (sortKey === 'id' || sortKey === 'deci' || sortKey === 'weight') {
        return sortAsc ? Number(av) - Number(bv) : Number(bv) - Number(av);
      }
      return sortAsc
        ? String(av).localeCompare(String(bv))
        : String(bv).localeCompare(String(av));
    });
  }, [rows, search, sortKey, sortAsc]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const pageRows = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const summaryData: { label: string; value: number; colorClass: string }[] = [
    { label: 'Total Products', value: summary.total, colorClass: 'text-slate-700' },
    { label: 'With Code', value: summary.withCode, colorClass: 'text-emerald-600' },
    { label: 'With SKUs', value: summary.withSkus, colorClass: 'text-blue-600' },
  ];

  return (
    <div>
      <h1 className="mb-6">Catalog</h1>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4 mb-4">
        {summaryData.map(c => (
          <div key={c.label} className="bg-white rounded-lg p-6 shadow-sm text-center">
            <div className="text-xs text-gray-500 mb-1">{c.label}</div>
            <div className={`text-2xl font-bold ${c.colorClass}`}>{c.value.toLocaleString()}</div>
          </div>
        ))}
      </div>

      {/* Search + pagination info */}
      <div className="bg-white rounded-lg p-6 shadow-sm mb-4">
        <div className="flex gap-4 items-center">
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search name / code / SKU / category / size / color..."
            className="px-2 py-1.5 border border-gray-300 rounded-md text-sm flex-1"
          />
          <span className="text-xs text-gray-500 whitespace-nowrap">
            {filtered.length.toLocaleString()} items
          </span>
          {totalPages > 1 && (
            <div className="flex gap-1.5 items-center whitespace-nowrap">
              <button
                onClick={() => setPage(p => Math.max(0, p - 1))}
                disabled={page === 0}
                className={`px-2 py-1 border border-gray-300 rounded text-xs bg-white ${page === 0 ? 'cursor-default text-gray-300' : 'cursor-pointer text-slate-700'}`}
              >{'\u2039'}</button>
              <span className="text-xs text-gray-500">
                {page + 1} / {totalPages}
              </span>
              <button
                onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                className={`px-2 py-1 border border-gray-300 rounded text-xs bg-white ${page >= totalPages - 1 ? 'cursor-default text-gray-300' : 'cursor-pointer text-slate-700'}`}
              >{'\u203A'}</button>
            </div>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg shadow-sm mb-4 overflow-x-auto p-0">
        {loading ? (
          <p className="p-6 text-gray-500">Loading...</p>
        ) : filtered.length === 0 ? (
          <p className="p-6 text-gray-500">No data found.</p>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b-2 border-slate-200 bg-slate-50">
                <th onClick={() => handleSort('identifier')} className="p-2 text-left cursor-pointer select-none whitespace-nowrap text-slate-600 text-xs font-semibold">Identifier{sortArrow('identifier')}</th>
                <th onClick={() => handleSort('parent_name')} className="p-2 text-left cursor-pointer select-none whitespace-nowrap text-slate-600 text-xs font-semibold">Parent Name{sortArrow('parent_name')}</th>
                <th onClick={() => handleSort('name')} className="p-2 text-left cursor-pointer select-none whitespace-nowrap text-slate-600 text-xs font-semibold">Name{sortArrow('name')}</th>
                <th onClick={() => handleSort('code')} className="p-2 text-left cursor-pointer select-none whitespace-nowrap text-slate-600 text-xs font-semibold">SKU{sortArrow('code')}</th>
                <th onClick={() => handleSort('category_name')} className="p-2 text-left cursor-pointer select-none whitespace-nowrap text-slate-600 text-xs font-semibold">Category{sortArrow('category_name')}</th>
                <th onClick={() => handleSort('size')} className="p-2 text-left cursor-pointer select-none whitespace-nowrap text-slate-600 text-xs font-semibold">Size{sortArrow('size')}</th>
                <th onClick={() => handleSort('color')} className="p-2 text-left cursor-pointer select-none whitespace-nowrap text-slate-600 text-xs font-semibold">Color{sortArrow('color')}</th>
                <th onClick={() => handleSort('weight')} className="p-2 text-right cursor-pointer select-none whitespace-nowrap text-slate-600 text-xs font-semibold">Weight{sortArrow('weight')}</th>
                <th onClick={() => handleSort('deci')} className="p-2 text-right cursor-pointer select-none whitespace-nowrap text-slate-600 text-xs font-semibold">Deci{sortArrow('deci')}</th>
                <th className="p-2 text-right cursor-default whitespace-nowrap text-slate-600 text-xs font-semibold">Width</th>
                <th className="p-2 text-right cursor-default whitespace-nowrap text-slate-600 text-xs font-semibold">Length</th>
                <th className="p-2 text-right cursor-default whitespace-nowrap text-slate-600 text-xs font-semibold">Height</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map(r => {
                const row = r as any;
                return (
                <tr key={r.id} className="border-b border-slate-100">
                  <td className={`px-2 py-1.5 font-mono text-[0.78rem] whitespace-nowrap ${row.identifier ? 'text-slate-800' : 'text-gray-300'}`}>
                    {row.identifier || '\u2014'}
                  </td>
                  <td className="px-2 py-1.5 min-w-[160px]">
                    {row.parent_name || '\u2014'}
                  </td>
                  <td className="px-2 py-1.5 min-w-[160px]">
                    {r.name || '\u2014'}
                  </td>
                  <td className={`px-2 py-1.5 font-mono text-[0.78rem] ${r.code ? 'text-slate-800' : 'text-gray-300'}`}>
                    {r.code || '\u2014'}
                  </td>
                  <td className={`px-2 py-1.5 whitespace-nowrap ${r.category_name ? 'text-slate-800' : 'text-gray-300'}`}>
                    {r.category_name || '\u2014'}
                  </td>
                  <td className={`px-2 py-1.5 ${r.size ? 'text-slate-800' : 'text-gray-300'}`}>
                    {r.size || '\u2014'}
                  </td>
                  <td className={`px-2 py-1.5 ${r.color ? 'text-slate-800' : 'text-gray-300'}`}>
                    {r.color || '\u2014'}
                  </td>
                  <td className={`px-2 py-1.5 text-right font-mono text-xs ${r.weight ? 'text-slate-700' : 'text-gray-300'}`}>
                    {r.weight != null ? `${Number(r.weight).toFixed(1)} kg` : '\u2014'}
                  </td>
                  <td className={`px-2 py-1.5 text-right font-mono ${r.deci ? 'text-slate-800' : 'text-gray-300'}`}>
                    {r.deci ?? '\u2014'}
                  </td>
                  <td className={`px-2 py-1.5 text-right font-mono text-xs ${r.width ? 'text-slate-700' : 'text-gray-300'}`}>
                    {r.width != null ? Number(r.width).toFixed(1) : '\u2014'}
                  </td>
                  <td className={`px-2 py-1.5 text-right font-mono text-xs ${r.length ? 'text-slate-700' : 'text-gray-300'}`}>
                    {r.length != null ? Number(r.length).toFixed(1) : '\u2014'}
                  </td>
                  <td className={`px-2 py-1.5 text-right font-mono text-xs ${r.height ? 'text-slate-700' : 'text-gray-300'}`}>
                    {r.height != null ? Number(r.height).toFixed(1) : '\u2014'}
                  </td>

                </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
