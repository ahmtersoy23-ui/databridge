import { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import * as XLSX from 'xlsx';

interface MappingRow {
  sku: string;
  tsin: number | null;
  iwasku: string | null;
  product_title: string | null;
  total_qty: number;
  last_order_date: string | null;
  mapped_at: string | null;
}

interface Pagination {
  total: number;
  page: number;
  limit: number;
  pages: number;
}

export default function TakealotMappings() {
  const [rows, setRows] = useState<MappingRow[]>([]);
  const [pagination, setPagination] = useState<Pagination>({ total: 0, page: 1, limit: 50, pages: 1 });
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'matched' | 'unmatched'>('all');
  const [search, setSearch] = useState('');
  const [editingSku, setEditingSku] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchData = async (page = 1) => {
    setLoading(true);
    try {
      const res = await axios.get('/api/v1/takealot/mappings', {
        params: { filter, page, limit: pagination.limit, search },
      });
      setRows(res.data.data);
      setPagination(res.data.pagination);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchData(1); }, [filter, search]);

  const startEdit = (row: MappingRow) => {
    setEditingSku(row.sku);
    setEditValue(row.iwasku || '');
  };
  const cancelEdit = () => { setEditingSku(null); setEditValue(''); };

  const saveEdit = async (sku: string) => {
    if (!editValue.trim()) return;
    setSaving(true); setMessage('');
    try {
      await axios.post('/api/v1/takealot/mappings', { sku, iwasku: editValue.trim() });
      setMessage('Mapping saved.');
      setEditingSku(null);
      fetchData(pagination.page);
    } catch (err: any) {
      setMessage(err.response?.data?.error || 'Save failed');
    } finally { setSaving(false); }
  };

  const deleteMapping = async (sku: string) => {
    if (!confirm(`Remove mapping for ${sku}?`)) return;
    try {
      await axios.delete(`/api/v1/takealot/mappings/${encodeURIComponent(sku)}`);
      fetchData(pagination.page);
    } catch (err: any) { setMessage(err.response?.data?.error || 'Delete failed'); }
  };

  const handleExport = () => { window.location.href = '/api/v1/takealot/mappings/export'; };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true); setMessage('');
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: '' });
      const mappings: Array<{ sku: string; iwasku: string }> = [];
      for (const row of rawRows) {
        const sku = String(row['sku'] ?? '').trim();
        const iwasku = String(row['iwasku'] ?? '').trim();
        if (sku && iwasku) mappings.push({ sku, iwasku });
      }
      if (mappings.length === 0) {
        setMessage('No valid rows found. Excel must have "sku" and "iwasku" columns.');
        return;
      }
      const res = await axios.post('/api/v1/takealot/mappings/bulk', { mappings });
      setMessage(`Imported ${res.data.upserted} mappings.`);
      fetchData(1);
    } catch (err: any) {
      setMessage(err.response?.data?.error || 'Import failed');
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const isError = message.includes('fail') || message.includes('error') || message.includes('No valid');

  return (
    <div>
      <h1 className="mb-4">Takealot Mappings</h1>

      <div className="bg-white rounded-lg p-6 shadow-sm mb-4 flex gap-3 items-center flex-wrap">
        {(['all', 'matched', 'unmatched'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-3.5 py-1 border border-gray-300 rounded-md cursor-pointer text-sm ${filter === f ? 'bg-cyan-600 text-white' : 'bg-white text-gray-700'}`}>
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}

        <input type="text" placeholder="Search SKU / IWASKU / product..." value={search}
          onChange={e => setSearch(e.target.value)}
          className="py-1 px-3 border border-gray-300 rounded-md text-sm w-[240px]" />

        <div className="ml-auto flex gap-2">
          <button onClick={handleExport}
            className="px-4 py-1.5 bg-emerald-600 text-white border-none rounded-md cursor-pointer text-sm">
            Export Excel
          </button>
          <label className="px-4 py-1.5 bg-violet-600 text-white rounded-md cursor-pointer text-sm">
            {importing ? 'Importing...' : 'Import Excel'}
            <input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleImport} disabled={importing} />
          </label>
        </div>
      </div>

      {message && (
        <div className={`px-4 py-3 rounded-md mb-4 border ${isError ? 'bg-red-50 text-red-600 border-red-200' : 'bg-green-50 text-emerald-600 border-green-200'}`}>
          {message}
        </div>
      )}

      <div className="text-xs text-slate-500 mb-3">
        Export Excel &rarr; <code>iwasku</code> kolonunu doldur &rarr; Import Excel
      </div>

      <div className="bg-white rounded-lg p-6 shadow-sm mb-4">
        <div className="flex justify-between mb-3 items-center">
          <span className="text-sm text-slate-500">{loading ? 'Loading...' : `${pagination.total} items`}</span>
          {pagination.pages > 1 && (
            <div className="flex gap-2 items-center">
              <button disabled={pagination.page <= 1 || loading} onClick={() => fetchData(pagination.page - 1)}
                className="px-2 py-1 cursor-pointer border border-gray-300 rounded bg-white">‹</button>
              <span className="text-sm">{pagination.page} / {pagination.pages}</span>
              <button disabled={pagination.page >= pagination.pages || loading} onClick={() => fetchData(pagination.page + 1)}
                className="px-2 py-1 cursor-pointer border border-gray-300 rounded bg-white">›</button>
            </div>
          )}
        </div>

        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b-2 border-slate-200">
              <th className="text-left p-2">SKU</th>
              <th className="text-left p-2">TSIN</th>
              <th className="text-left p-2">Product</th>
              <th className="text-right p-2">Total Qty</th>
              <th className="text-left p-2">Last Order</th>
              <th className="text-left p-2">IWASKU</th>
              <th className="text-left p-2 w-[80px]"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={row.sku} className="border-b border-slate-100">
                <td className="p-2 font-mono text-sm">{row.sku}</td>
                <td className="p-2 font-mono text-xs text-slate-500">{row.tsin || '—'}</td>
                <td className="p-2 text-slate-700 max-w-xs truncate" title={row.product_title || ''}>
                  {row.product_title || '—'}
                </td>
                <td className="p-2 text-right">{Number(row.total_qty).toLocaleString()}</td>
                <td className="p-2 text-xs text-slate-500">
                  {row.last_order_date ? new Date(row.last_order_date).toLocaleDateString() : '—'}
                </td>
                <td className="p-2">
                  {editingSku === row.sku ? (
                    <div className="flex gap-1.5">
                      <input autoFocus type="text" value={editValue}
                        onChange={e => setEditValue(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') saveEdit(row.sku); if (e.key === 'Escape') cancelEdit(); }}
                        className="px-2 py-1 border border-blue-600 rounded w-[140px] font-mono text-sm" />
                      <button disabled={saving} onClick={() => saveEdit(row.sku)}
                        className="px-2 py-1 bg-emerald-600 text-white border-none rounded cursor-pointer text-xs">
                        {saving ? '...' : '✓'}
                      </button>
                      <button onClick={cancelEdit}
                        className="px-2 py-1 bg-slate-200 text-gray-700 border-none rounded cursor-pointer text-xs">✕</button>
                    </div>
                  ) : (
                    <span onClick={() => startEdit(row)}
                      className={`cursor-pointer font-mono text-sm ${row.iwasku ? 'text-slate-900' : 'text-slate-400'}`}
                      title="Click to edit">
                      {row.iwasku || '— click to add —'}
                    </span>
                  )}
                </td>
                <td className="p-2">
                  {row.iwasku && (
                    <button onClick={() => deleteMapping(row.sku)}
                      className="px-2 py-0.5 bg-transparent text-red-500 border border-red-300 rounded cursor-pointer text-xs">
                      Remove
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={7} className="p-8 text-center text-slate-400">
                  No items found. Run a Takealot sync first.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
