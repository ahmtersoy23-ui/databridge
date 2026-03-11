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
        <span style={{ fontSize: '0.85rem', color: '#64748b' }}>
          {loading ? 'Loading...' : `${pagination.total} items`}
        </span>
      </div>

      <div style={{ background: '#fff', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
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
                  No inventory data. Run a Wayfair sync first.
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {pagination.pages > 1 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.75rem 1rem', borderTop: '1px solid #e2e8f0' }}>
            <button disabled={pagination.page <= 1 || loading} onClick={() => fetchData(pagination.page - 1)}
              style={{ padding: '0.35rem 0.9rem', cursor: 'pointer', border: '1px solid #d1d5db', borderRadius: '6px', background: '#fff', fontSize: '0.85rem' }}>‹ Prev</button>
            <span style={{ fontSize: '0.85rem', color: '#64748b' }}>{pagination.page} / {pagination.pages}</span>
            <button disabled={pagination.page >= pagination.pages || loading} onClick={() => fetchData(pagination.page + 1)}
              style={{ padding: '0.35rem 0.9rem', cursor: 'pointer', border: '1px solid #d1d5db', borderRadius: '6px', background: '#fff', fontSize: '0.85rem' }}>Next ›</button>
          </div>
        )}
      </div>
    </div>
  );
}
