import { useState, useEffect, useRef } from 'react';
import axios from 'axios';

interface MappingRow {
  part_number: string;
  iwasku: string | null;
  total_quantity: number;
  warehouses: string;
  mapped_at: string | null;
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
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState('');
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchData = async (page = 1) => {
    setLoading(true);
    try {
      const res = await axios.get('/api/v1/wayfair/mappings', {
        params: { filter, page, limit: pagination.limit, search },
      });
      setRows(res.data.data);
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
      const text = await file.text();
      const lines = text.split('\n').filter(l => l.trim());
      const mappings: Array<{ part_number: string; iwasku: string }> = [];

      // Skip header row if present
      const startIdx = lines[0].toLowerCase().includes('part_number') ? 1 : 0;
      for (let i = startIdx; i < lines.length; i++) {
        const cols = lines[i].split(',');
        const pn = cols[0]?.trim();
        const iwasku = cols[1]?.trim();
        if (pn && iwasku) mappings.push({ part_number: pn, iwasku });
      }

      if (mappings.length === 0) {
        setMessage('No valid rows found. Format: part_number,iwasku');
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

  const handleSync = async () => {
    setSyncing(true);
    setMessage('');
    try {
      await axios.post('/api/v1/sync/trigger', { type: 'wayfair' });
      setMessage('Wayfair sync started in background.');
    } catch (err: any) {
      setMessage(err.response?.data?.error || 'Sync failed');
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div>
      <h1 style={{ marginBottom: '1.5rem' }}>Wayfair CastleGate Mappings</h1>

      {/* Toolbar */}
      <div style={{ ...cardStyle, display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
        {/* Filter */}
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
            Export CSV
          </button>
          <label style={{ padding: '0.4rem 1rem', background: '#7c3aed', color: '#fff', borderRadius: '6px', cursor: 'pointer', fontSize: '0.85rem' }}>
            {importing ? 'Importing...' : 'Import CSV'}
            <input ref={fileInputRef} type="file" accept=".csv,.txt" style={{ display: 'none' }} onChange={handleImport} disabled={importing} />
          </label>
          <button onClick={handleSync} disabled={syncing}
            style={{ padding: '0.4rem 1rem', background: '#2563eb', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '0.85rem' }}>
            {syncing ? 'Starting...' : 'Sync Now'}
          </button>
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

      {/* CSV format hint */}
      <div style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: '0.75rem' }}>
        Import format: <code>part_number,iwasku</code> (CSV, one per line, header optional)
        &nbsp;&nbsp;·&nbsp;&nbsp;
        Export CSV → fill iwasku column → Import
      </div>

      {/* Table */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.75rem', alignItems: 'center' }}>
          <span style={{ fontSize: '0.85rem', color: '#64748b' }}>
            {loading ? 'Loading...' : `${pagination.total} items`}
          </span>
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
        </div>

        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #e2e8f0' }}>
              <th style={{ textAlign: 'left', padding: '0.5rem' }}>Part Number</th>
              <th style={{ textAlign: 'left', padding: '0.5rem' }}>IWASKU</th>
              <th style={{ textAlign: 'left', padding: '0.5rem' }}>Qty</th>
              <th style={{ textAlign: 'left', padding: '0.5rem' }}>Warehouses</th>
              <th style={{ textAlign: 'left', padding: '0.5rem' }}>Status</th>
              <th style={{ textAlign: 'left', padding: '0.5rem' }}></th>
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
                        style={{ padding: '0.25rem 0.5rem', border: '1px solid #2563eb', borderRadius: '4px', width: '120px', fontFamily: 'monospace', fontSize: '0.82rem' }}
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
                <td style={{ padding: '0.5rem' }}>{row.total_quantity?.toLocaleString()}</td>
                <td style={{ padding: '0.5rem', color: '#64748b', fontSize: '0.8rem' }}>{row.warehouses}</td>
                <td style={{ padding: '0.5rem' }}>
                  <span style={{
                    padding: '0.15rem 0.5rem', borderRadius: '999px', fontSize: '0.75rem',
                    background: row.iwasku ? '#dcfce7' : '#fef3c7',
                    color: row.iwasku ? '#166534' : '#92400e',
                  }}>
                    {row.iwasku ? 'Matched' : 'Unmatched'}
                  </span>
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
                <td colSpan={6} style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8' }}>
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
