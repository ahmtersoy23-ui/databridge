import { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import * as XLSX from 'xlsx';

interface MappingRow {
  part_number: string;
  iwasku: string | null;
}

interface Pagination {
  total: number;
  page: number;
  limit: number;
  pages: number;
}

const cardStyle = {
  background: '#fff',
  borderRadius: '8px',
  padding: '1.5rem',
  boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
  marginBottom: '1rem',
} as const;

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
      setRows(res.data.data.map((r: any) => ({ part_number: r.part_number, iwasku: r.iwasku })));
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

  return (
    <div>
      <h1 style={{ marginBottom: '1rem' }}>Wayfair Mappings</h1>

      {/* Toolbar */}
      <div style={{ ...cardStyle, display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
        {(['all', 'matched', 'unmatched'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            style={{
              padding: '0.35rem 0.9rem', border: '1px solid #d1d5db', borderRadius: '6px', cursor: 'pointer',
              background: filter === f ? '#0891b2' : '#fff',
              color: filter === f ? '#fff' : '#374151',
              fontSize: '0.85rem',
            }}>
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}

        <input
          type="text"
          placeholder="Search part number or iwasku..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{
            padding: '0.35rem 0.75rem', border: '1px solid #d1d5db', borderRadius: '6px',
            fontSize: '0.85rem', width: '220px',
          }}
        />

        <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.5rem' }}>
          <button onClick={handleExport}
            style={{ padding: '0.4rem 1rem', background: '#059669', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '0.85rem' }}>
            Export Excel
          </button>
          <label style={{ padding: '0.4rem 1rem', background: '#7c3aed', color: '#fff', borderRadius: '6px', cursor: 'pointer', fontSize: '0.85rem' }}>
            {importing ? 'Importing...' : 'Import Excel'}
            <input ref={fileInputRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }} onChange={handleImport} disabled={importing} />
          </label>
        </div>
      </div>

      {message && (
        <div style={{
          padding: '0.75rem 1rem', borderRadius: '6px', marginBottom: '1rem',
          background: message.includes('fail') || message.includes('error') || message.includes('No valid') ? '#fef2f2' : '#f0fdf4',
          color: message.includes('fail') || message.includes('error') || message.includes('No valid') ? '#dc2626' : '#059669',
          border: '1px solid',
          borderColor: message.includes('fail') || message.includes('error') || message.includes('No valid') ? '#fecaca' : '#bbf7d0',
        }}>
          {message}
        </div>
      )}

      <div style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: '0.75rem' }}>
        Export Excel → <code>iwasku</code> kolonunu doldur → Import Excel
      </div>

      {/* Table */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.75rem', alignItems: 'center' }}>
          <span style={{ fontSize: '0.85rem', color: '#64748b' }}>
            {loading ? 'Loading...' : `${pagination.total} items`}
          </span>
          {pagination.pages > 1 && (
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <button disabled={pagination.page <= 1 || loading} onClick={() => fetchData(pagination.page - 1)}
                style={{ padding: '0.25rem 0.6rem', cursor: 'pointer', border: '1px solid #d1d5db', borderRadius: '4px', background: '#fff' }}>
                ‹
              </button>
              <span style={{ fontSize: '0.85rem' }}>{pagination.page} / {pagination.pages}</span>
              <button disabled={pagination.page >= pagination.pages || loading} onClick={() => fetchData(pagination.page + 1)}
                style={{ padding: '0.25rem 0.6rem', cursor: 'pointer', border: '1px solid #d1d5db', borderRadius: '4px', background: '#fff' }}>
                ›
              </button>
            </div>
          )}
        </div>

        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #e2e8f0' }}>
              <th style={{ textAlign: 'left', padding: '0.5rem' }}>Part Number</th>
              <th style={{ textAlign: 'left', padding: '0.5rem' }}>IWASKU</th>
              <th style={{ textAlign: 'left', padding: '0.5rem', width: '80px' }}></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={row.part_number} style={{ borderBottom: '1px solid #f1f5f9' }}>
                <td style={{ padding: '0.5rem', fontFamily: 'monospace', fontSize: '0.82rem' }}>{row.part_number}</td>
                <td style={{ padding: '0.5rem' }}>
                  {editingPn === row.part_number ? (
                    <div style={{ display: 'flex', gap: '0.35rem' }}>
                      <input
                        autoFocus
                        type="text"
                        value={editValue}
                        onChange={e => setEditValue(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') saveEdit(row.part_number); if (e.key === 'Escape') cancelEdit(); }}
                        style={{ padding: '0.25rem 0.5rem', border: '1px solid #2563eb', borderRadius: '4px', width: '140px', fontFamily: 'monospace', fontSize: '0.82rem' }}
                      />
                      <button disabled={saving} onClick={() => saveEdit(row.part_number)}
                        style={{ padding: '0.25rem 0.5rem', background: '#059669', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.75rem' }}>
                        {saving ? '...' : '✓'}
                      </button>
                      <button onClick={cancelEdit}
                        style={{ padding: '0.25rem 0.5rem', background: '#e2e8f0', color: '#374151', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.75rem' }}>
                        ✕
                      </button>
                    </div>
                  ) : (
                    <span
                      onClick={() => startEdit(row)}
                      style={{ cursor: 'pointer', fontFamily: 'monospace', fontSize: '0.82rem', color: row.iwasku ? '#0f172a' : '#94a3b8' }}
                      title="Click to edit"
                    >
                      {row.iwasku || '— click to add —'}
                    </span>
                  )}
                </td>
                <td style={{ padding: '0.5rem' }}>
                  {row.iwasku && (
                    <button onClick={() => deleteMapping(row.part_number)}
                      style={{ padding: '0.15rem 0.5rem', background: 'none', color: '#ef4444', border: '1px solid #fca5a5', borderRadius: '4px', cursor: 'pointer', fontSize: '0.75rem' }}>
                      Remove
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={3} style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8' }}>
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
