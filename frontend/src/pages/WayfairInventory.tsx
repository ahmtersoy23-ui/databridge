import { useState, useEffect } from 'react';
import axios from 'axios';

interface InventoryRow {
  part_number: string;
  iwasku: string | null;
  on_hand_qty: number;
  available_qty: number;
  last_synced_at: string | null;
}

export default function WayfairInventory() {
  const [rows, setRows] = useState<InventoryRow[]>([]);
  const [pagination, setPagination] = useState({ total: 0, page: 1, limit: 50, pages: 1 });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [rawResponse, setRawResponse] = useState<unknown>(null);
  const [rawLoading, setRawLoading] = useState(false);

  const fetchData = async (page = 1) => {
    setLoading(true);
    try {
      const res = await axios.get('/api/v1/wayfair/inventory', { params: { page, limit: 50, search } });
      setRows(res.data.data);
      setPagination(res.data.pagination);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  const fetchRaw = async () => {
    setRawLoading(true);
    try {
      const res = await axios.get('/api/v1/wayfair/inventory/raw');
      setRawResponse(res.data);
    } catch (err: any) {
      setRawResponse({ error: err.response?.data?.error || err.message });
    } finally {
      setRawLoading(false);
    }
  };

  useEffect(() => { fetchData(1); }, [search]);

  return (
    <div>
      <h1 style={{ marginBottom: '1rem' }}>Wayfair Inventory</h1>

      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginBottom: '1rem' }}>
        <input
          type="text" placeholder="Search part number or iwasku..."
          value={search} onChange={e => setSearch(e.target.value)}
          style={{ padding: '0.35rem 0.75rem', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '0.85rem', width: '240px' }}
        />
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.5rem' }}>
          <button onClick={fetchRaw} disabled={rawLoading}
            style={{ padding: '0.4rem 1rem', background: '#dc2626', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '0.85rem' }}>
            {rawLoading ? 'Loading...' : 'Raw Response'}
          </button>
          <button onClick={() => fetchData(1)} disabled={loading}
            style={{ padding: '0.4rem 1rem', background: '#2563eb', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '0.85rem' }}>
            {loading ? 'Loading...' : 'Refresh'}
          </button>
        </div>
      </div>

      {rawResponse !== null && (
        <div style={{ background: '#1e293b', color: '#e2e8f0', borderRadius: '8px', padding: '1rem', marginBottom: '1rem', fontSize: '0.75rem', fontFamily: 'monospace' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
            <strong style={{ color: '#94a3b8' }}>Raw Inventory API Response (ilk 5 ürün)</strong>
            <span onClick={() => setRawResponse(null)} style={{ cursor: 'pointer', color: '#94a3b8' }}>✕</span>
          </div>
          <pre style={{ maxHeight: '500px', overflowY: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: 0 }}>
            {JSON.stringify(rawResponse, null, 2)}
          </pre>
        </div>
      )}

      <div style={{ background: '#fff', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.75rem 1rem', borderBottom: '1px solid #e2e8f0', alignItems: 'center' }}>
          <span style={{ fontSize: '0.85rem', color: '#64748b' }}>
            {loading ? 'Loading...' : `${pagination.total} items`}
          </span>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <button disabled={pagination.page <= 1 || loading} onClick={() => fetchData(pagination.page - 1)}
              style={{ padding: '0.25rem 0.6rem', cursor: 'pointer', border: '1px solid #d1d5db', borderRadius: '4px', background: '#fff' }}>‹</button>
            <span style={{ fontSize: '0.85rem' }}>{pagination.page} / {pagination.pages}</span>
            <button disabled={pagination.page >= pagination.pages || loading} onClick={() => fetchData(pagination.page + 1)}
              style={{ padding: '0.25rem 0.6rem', cursor: 'pointer', border: '1px solid #d1d5db', borderRadius: '4px', background: '#fff' }}>›</button>
          </div>
        </div>

        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #e2e8f0' }}>
              <th style={{ textAlign: 'left', padding: '0.75rem 1rem' }}>Part Number</th>
              <th style={{ textAlign: 'left', padding: '0.75rem 0.5rem' }}>IWASKU</th>
              <th style={{ textAlign: 'right', padding: '0.75rem 1rem' }}>On Hand</th>
              <th style={{ textAlign: 'right', padding: '0.75rem 1rem' }}>Available</th>
              <th style={{ textAlign: 'left', padding: '0.75rem 0.5rem' }}>Last Sync</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={row.part_number} style={{ borderBottom: '1px solid #f1f5f9' }}>
                <td style={{ padding: '0.5rem 1rem', fontFamily: 'monospace', fontSize: '0.82rem' }}>{row.part_number}</td>
                <td style={{ padding: '0.5rem 0.5rem', fontFamily: 'monospace', fontSize: '0.82rem', color: row.iwasku ? '#0f172a' : '#94a3b8' }}>
                  {row.iwasku || '—'}
                </td>
                <td style={{ padding: '0.5rem 1rem', textAlign: 'right', fontWeight: 500 }}>
                  {row.on_hand_qty ?? 0}
                </td>
                <td style={{ padding: '0.5rem 1rem', textAlign: 'right', fontWeight: 600,
                  color: (row.available_qty ?? 0) > 0 ? '#059669' : '#94a3b8' }}>
                  {row.available_qty ?? 0}
                </td>
                <td style={{ padding: '0.5rem 0.5rem', fontSize: '0.8rem', color: '#64748b' }}>
                  {row.last_synced_at ? new Date(row.last_synced_at).toLocaleDateString() : '—'}
                </td>
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={5} style={{ padding: '3rem', textAlign: 'center', color: '#94a3b8' }}>
                  Veri yok. Wayfair sync çalıştırın.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
