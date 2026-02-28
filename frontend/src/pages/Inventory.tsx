import { useState, useEffect } from 'react';
import axios from 'axios';

interface InventoryRow {
  id: number;
  warehouse: string;
  sku: string;
  asin: string;
  fnsku: string;
  iwasku: string | null;
  fulfillable_quantity: number;
  total_reserved_quantity: number;
  pending_customer_order_quantity: number;
  pending_transshipment_quantity: number;
  fc_processing_quantity: number;
  total_unfulfillable_quantity: number;
  customer_damaged_quantity: number;
  warehouse_damaged_quantity: number;
  distributor_damaged_quantity: number;
  inbound_shipped_quantity: number;
  inbound_working_quantity: number;
  inbound_receiving_quantity: number;
  last_synced_at: string;
}

const cardStyle = {
  background: '#fff',
  borderRadius: '8px',
  padding: '1.5rem',
  boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
  marginBottom: '1rem',
} as const;

const inputStyle = {
  padding: '0.4rem 0.5rem',
  border: '1px solid #d1d5db',
  borderRadius: '6px',
  fontSize: '0.85rem',
} as const;

const btnStyle = (bg: string, disabled?: boolean) => ({
  padding: '0.4rem 1rem',
  background: disabled ? '#9ca3af' : bg,
  color: '#fff',
  border: 'none',
  borderRadius: '6px',
  cursor: disabled ? 'default' as const : 'pointer' as const,
  fontSize: '0.85rem',
});

const toggleBtn = (active: boolean) => ({
  padding: '0.35rem 0.7rem',
  background: active ? '#334155' : '#f1f5f9',
  color: active ? '#fff' : '#475569',
  border: '1px solid #d1d5db',
  borderRadius: '4px',
  cursor: 'pointer' as const,
  fontSize: '0.8rem',
});

const qtyStyle = (val: number) => ({
  padding: '0.5rem',
  textAlign: 'right' as const,
  color: val > 0 ? '#059669' : '#9ca3af',
  fontVariantNumeric: 'tabular-nums' as const,
});

export default function InventoryPage() {
  const [rows, setRows] = useState<InventoryRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [warehouses, setWarehouses] = useState<string[]>([]);

  // Filters
  const [warehouse, setWarehouse] = useState('');
  const [search, setSearch] = useState('');
  const [matched, setMatched] = useState<'' | 'matched' | 'unmatched'>('');

  useEffect(() => {
    axios.get('/api/v1/inventory-detail/warehouses').then(res => {
      if (res.data.success) setWarehouses(res.data.data);
    }).catch(() => {});
  }, []);

  const fetchInventory = async (p = page) => {
    setLoading(true);
    try {
      const params: Record<string, string> = { page: String(p), limit: '50' };
      if (warehouse) params.warehouse = warehouse;
      if (search) params.search = search;
      if (matched) params.matched = matched;

      const res = await axios.get('/api/v1/inventory-detail', { params });
      if (res.data.success) {
        const d = res.data.data;
        setRows(d.rows);
        setTotal(d.total);
        setPage(d.page);
        setTotalPages(d.totalPages);
      }
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchInventory(); }, []);

  const handleSearch = () => {
    setPage(1);
    fetchInventory(1);
  };

  const handlePageChange = (newPage: number) => {
    setPage(newPage);
    fetchInventory(newPage);
  };

  return (
    <div>
      <h1 style={{ marginBottom: '1.5rem' }}>Inventory</h1>

      {/* Filters */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '0.25rem' }}>Warehouse</div>
            <select value={warehouse} onChange={e => setWarehouse(e.target.value)} style={{ ...inputStyle, minWidth: '80px' }}>
              <option value="">All</option>
              {warehouses.map(w => <option key={w} value={w}>{w}</option>)}
            </select>
          </div>
          <div>
            <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '0.25rem' }}>Search (SKU/ASIN/FNSKU/IWASKU)</div>
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
              placeholder="Search..."
              style={{ ...inputStyle, minWidth: '200px' }}
            />
          </div>
          <div>
            <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '0.25rem' }}>Match</div>
            <div style={{ display: 'flex', gap: '2px' }}>
              <button onClick={() => setMatched('')} style={toggleBtn(matched === '')}>All</button>
              <button onClick={() => setMatched('matched')} style={toggleBtn(matched === 'matched')}>Matched</button>
              <button onClick={() => setMatched('unmatched')} style={toggleBtn(matched === 'unmatched')}>Unmatched</button>
            </div>
          </div>
          <button onClick={handleSearch} style={btnStyle('#2563eb')}>Search</button>
        </div>
      </div>

      {/* Results */}
      <div style={{ ...cardStyle, overflowX: 'auto' }}>
        {loading ? (
          <p style={{ color: '#64748b' }}>Loading...</p>
        ) : rows.length === 0 ? (
          <p style={{ color: '#64748b' }}>No inventory items found.</p>
        ) : (
          <>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #e2e8f0' }}>
                  <th style={{ textAlign: 'left', padding: '0.5rem' }}>WH</th>
                  <th style={{ textAlign: 'left', padding: '0.5rem' }}>SKU</th>
                  <th style={{ textAlign: 'left', padding: '0.5rem' }}>ASIN</th>
                  <th style={{ textAlign: 'left', padding: '0.5rem' }}>FNSKU</th>
                  <th style={{ textAlign: 'left', padding: '0.5rem' }}>IWA SKU</th>
                  <th style={{ textAlign: 'right', padding: '0.5rem' }}>Fulfillable</th>
                  <th style={{ textAlign: 'right', padding: '0.5rem' }}>Reserved</th>
                  <th style={{ textAlign: 'right', padding: '0.5rem' }}>Unfulfillable</th>
                  <th style={{ textAlign: 'right', padding: '0.5rem' }}>Inbound Ship</th>
                  <th style={{ textAlign: 'right', padding: '0.5rem' }}>Inbound Work</th>
                  <th style={{ textAlign: 'right', padding: '0.5rem' }}>Inbound Recv</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id} style={{ borderBottom: '1px solid #e2e8f0' }}>
                    <td style={{ padding: '0.5rem' }}>{r.warehouse}</td>
                    <td style={{ padding: '0.5rem', maxWidth: '130px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.sku}>
                      {r.sku}
                    </td>
                    <td style={{ padding: '0.5rem' }}>{r.asin}</td>
                    <td style={{ padding: '0.5rem' }}>{r.fnsku}</td>
                    <td style={{ padding: '0.5rem', color: r.iwasku ? '#059669' : '#d97706', fontWeight: 500 }}>
                      {r.iwasku || '-'}
                    </td>
                    <td style={qtyStyle(r.fulfillable_quantity)}>{r.fulfillable_quantity}</td>
                    <td style={qtyStyle(r.total_reserved_quantity)}>{r.total_reserved_quantity}</td>
                    <td style={qtyStyle(r.total_unfulfillable_quantity)}>{r.total_unfulfillable_quantity}</td>
                    <td style={qtyStyle(r.inbound_shipped_quantity)}>{r.inbound_shipped_quantity}</td>
                    <td style={qtyStyle(r.inbound_working_quantity)}>{r.inbound_working_quantity}</td>
                    <td style={qtyStyle(r.inbound_receiving_quantity)}>{r.inbound_receiving_quantity}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Pagination */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1rem', paddingTop: '0.75rem', borderTop: '1px solid #e2e8f0' }}>
              <button
                onClick={() => handlePageChange(page - 1)}
                disabled={page <= 1}
                style={btnStyle('#475569', page <= 1)}
              >
                Previous
              </button>
              <span style={{ fontSize: '0.85rem', color: '#64748b' }}>
                Page {page} of {totalPages} ({total.toLocaleString()} total)
              </span>
              <button
                onClick={() => handlePageChange(page + 1)}
                disabled={page >= totalPages}
                style={btnStyle('#475569', page >= totalPages)}
              >
                Next
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
