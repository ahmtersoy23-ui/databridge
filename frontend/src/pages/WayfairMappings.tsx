import { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import * as XLSX from 'xlsx';

interface MappingRow {
  part_number: string;
  iwasku: string | null;
  accounts: string[];
}

const ACCOUNT_LABELS: Record<string, string> = { shukran: 'Shukran', mdn: 'MDN' };

interface Pagination {
  total: number;
  page: number;
  limit: number;
  pages: number;
}

export default function WayfairMappings() {
  const [rows, setRows] = useState<MappingRow[]>([]);
  const [pagination, setPagination] = useState<Pagination>({ total: 0, page: 1, limit: 50, pages: 1 });
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'matched' | 'unmatched'>('all');
  const [search, setSearch] = useState('');
  const [editingPn, setEditingPn] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchData = async (page = 1) => {
    setLoading(true);
    try {
      const res = await axios.get('/api/v1/wayfair/parts', {
        params: { filter, page, limit: pagination.limit, search, includeOrders: 'true' },
      });
      setRows(res.data.data.map((r: any) => ({ part_number: r.part_number, iwasku: r.iwasku, accounts: r.accounts || [] })));
      setPagination(res.data.pagination);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(1); }, [filter, search]);

  const startEdit = (row: MappingRow) => {
    setEditingPn(row.part_number);
    setEditValue(row.iwasku || '');
  };

  const cancelEdit = () => {
    setEditingPn(null);
    setEditValue('');
  };

  const saveEdit = async (partNumber: string) => {
    if (!editValue.trim()) return;
    setSaving(true);
    setMessage('');
    try {
      await axios.post('/api/v1/wayfair/mappings', { part_number: partNumber, iwasku: editValue.trim() });
      setMessage('Mapping saved.');
      setEditingPn(null);
      fetchData(pagination.page);
    } catch (err: any) {
      setMessage(err.response?.data?.error || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const deleteMapping = async (partNumber: string) => {
    if (!confirm(`Remove mapping for ${partNumber}?`)) return;
    try {
      await axios.delete(`/api/v1/wayfair/mappings/${encodeURIComponent(partNumber)}`);
      fetchData(pagination.page);
    } catch (err: any) {
      setMessage(err.response?.data?.error || 'Delete failed');
    }
  };

  const handleExport = () => {
    window.location.href = '/api/v1/wayfair/mappings/export';
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImporting(true);
    setMessage('');

    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });

      const mappings: Array<{ part_number: string; iwasku: string }> = [];
      for (const row of rawRows) {
        const pn = String(row['part_number'] ?? '').trim();
        const iwasku = String(row['iwasku'] ?? '').trim();
        if (pn && iwasku) mappings.push({ part_number: pn, iwasku });
      }

      if (mappings.length === 0) {
        setMessage('No valid rows found. Excel must have "part_number" and "iwasku" columns.');
        return;
      }

      const res = await axios.post('/api/v1/wayfair/mappings/bulk', { mappings });
      setMessage(`Imported ${res.data.upserted} mappings, ${res.data.aggregated} rows updated in StockPulse.`);
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
      <h1 className="mb-4">Wayfair Mappings</h1>

      {/* Toolbar */}
      <div className="bg-white rounded-lg p-6 shadow-sm mb-4 flex gap-3 items-center flex-wrap">
        {(['all', 'matched', 'unmatched'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-3.5 py-1 border border-gray-300 rounded-md cursor-pointer text-sm ${filter === f ? 'bg-cyan-600 text-white' : 'bg-white text-gray-700'}`}>
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}

        <input
          type="text"
          placeholder="Search part number or iwasku..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="py-1 px-3 border border-gray-300 rounded-md text-sm w-[220px]"
        />

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

      {/* Table */}
      <div className="bg-white rounded-lg p-6 shadow-sm mb-4">
        <div className="flex justify-between mb-3 items-center">
          <span className="text-sm text-slate-500">
            {loading ? 'Loading...' : `${pagination.total} items`}
          </span>
          {pagination.pages > 1 && (
            <div className="flex gap-2 items-center">
              <button disabled={pagination.page <= 1 || loading} onClick={() => fetchData(pagination.page - 1)}
                className="px-2 py-1 cursor-pointer border border-gray-300 rounded bg-white">
                {'\u2039'}
              </button>
              <span className="text-sm">{pagination.page} / {pagination.pages}</span>
              <button disabled={pagination.page >= pagination.pages || loading} onClick={() => fetchData(pagination.page + 1)}
                className="px-2 py-1 cursor-pointer border border-gray-300 rounded bg-white">
                {'\u203A'}
              </button>
            </div>
          )}
        </div>

        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b-2 border-slate-200">
              <th className="text-left p-2">Part Number</th>
              <th className="text-left p-2">Account</th>
              <th className="text-left p-2">IWASKU</th>
              <th className="text-left p-2 w-[80px]"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={row.part_number} className="border-b border-slate-100">
                <td className="p-2 font-mono text-sm">{row.part_number}</td>
                <td className={`p-2 text-xs font-medium ${row.accounts[0] === 'shukran' ? 'text-blue-800' : row.accounts[0] === 'mdn' ? 'text-pink-800' : 'text-slate-400'}`}>
                  {row.accounts[0] ? (ACCOUNT_LABELS[row.accounts[0]] || row.accounts[0].toUpperCase()) : '\u2014'}
                </td>
                <td className="p-2">
                  {editingPn === row.part_number ? (
                    <div className="flex gap-1.5">
                      <input
                        autoFocus
                        type="text"
                        value={editValue}
                        onChange={e => setEditValue(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') saveEdit(row.part_number); if (e.key === 'Escape') cancelEdit(); }}
                        className="px-2 py-1 border border-blue-600 rounded w-[140px] font-mono text-sm"
                      />
                      <button disabled={saving} onClick={() => saveEdit(row.part_number)}
                        className="px-2 py-1 bg-emerald-600 text-white border-none rounded cursor-pointer text-xs">
                        {saving ? '...' : '\u2713'}
                      </button>
                      <button onClick={cancelEdit}
                        className="px-2 py-1 bg-slate-200 text-gray-700 border-none rounded cursor-pointer text-xs">
                        \u2715
                      </button>
                    </div>
                  ) : (
                    <span
                      onClick={() => startEdit(row)}
                      className={`cursor-pointer font-mono text-sm ${row.iwasku ? 'text-slate-900' : 'text-slate-400'}`}
                      title="Click to edit"
                    >
                      {row.iwasku || '\u2014 click to add \u2014'}
                    </span>
                  )}
                </td>
                <td className="p-2">
                  {row.iwasku && (
                    <button onClick={() => deleteMapping(row.part_number)}
                      className="px-2 py-0.5 bg-transparent text-red-500 border border-red-300 rounded cursor-pointer text-xs">
                      Remove
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={4} className="p-8 text-center text-slate-400">
                  No items found. Run a Wayfair sync first to populate part numbers.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
