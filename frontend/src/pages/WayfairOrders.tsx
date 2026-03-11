import { useState, useEffect } from 'react';
import axios from 'axios';

interface OrderRow {
  po_number: string;
  po_date: string;
  part_number: string;
  iwasku: string | null;
  quantity: number;
  price: string;
  total_cost: string | null;
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

function OrdersTable({ orderType }: { orderType: 'castlegate' | 'dropship' }) {
  const [rows, setRows] = useState<OrderRow[]>([]);
  const [pagination, setPagination] = useState<Pagination>({ total: 0, page: 1, limit: 50, pages: 1 });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');

  const fetchData = async (page = 1, s = search) => {
    setLoading(true);
    try {
      const res = await axios.get('/api/v1/wayfair/orders/browse', {
        params: { type: orderType, page, limit: 50, search: s },
      });
      setRows(res.data.data);
      setPagination(res.data.pagination);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(1); }, [orderType]);

  const handleSearch = () => {
    setSearch(searchInput);
    fetchData(1, searchInput);
  };

  const isCG = orderType === 'castlegate';

  return (
    <>
      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginBottom: '1rem' }}>
        <input type="text" placeholder="Search PO / part number / iwasku..."
          value={searchInput} onChange={e => setSearchInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSearch()}
          style={{ padding: '0.35rem 0.75rem', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '0.85rem', width: '280px' }} />
        <button onClick={handleSearch}
          style={{ padding: '0.35rem 0.9rem', background: '#2563eb', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '0.85rem' }}>
          Search
        </button>
        <span style={{ fontSize: '0.85rem', color: '#64748b' }}>
          {loading ? 'Loading...' : `${pagination.total} rows`}
        </span>
      </div>

      <div style={cardStyle}>
        {loading ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: '#94a3b8' }}>Loading...</div>
        ) : rows.length === 0 ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: '#94a3b8' }}>
            No orders found. Run a Wayfair sync to populate order data.
          </div>
        ) : (
          <>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #e2e8f0' }}>
                  <th style={{ textAlign: 'left', padding: '0.5rem' }}>PO Number</th>
                  <th style={{ textAlign: 'left', padding: '0.5rem' }}>PO Date</th>
                  <th style={{ textAlign: 'left', padding: '0.5rem' }}>Part Number</th>
                  <th style={{ textAlign: 'left', padding: '0.5rem' }}>IWASKU</th>
                  <th style={{ textAlign: 'right', padding: '0.5rem' }}>Qty</th>
                  <th style={{ textAlign: 'right', padding: '0.5rem' }}>Price</th>
                  {isCG && <th style={{ textAlign: 'right', padding: '0.5rem' }}>Total</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '0.5rem', fontFamily: 'monospace', fontSize: '0.82rem' }}>{r.po_number}</td>
                    <td style={{ padding: '0.5rem', color: '#475569' }}>{r.po_date ? new Date(r.po_date).toLocaleDateString() : '—'}</td>
                    <td style={{ padding: '0.5rem', fontFamily: 'monospace', fontSize: '0.82rem' }}>{r.part_number}</td>
                    <td style={{ padding: '0.5rem', fontFamily: 'monospace', fontSize: '0.82rem', color: r.iwasku ? '#0f172a' : '#94a3b8' }}>{r.iwasku || '—'}</td>
                    <td style={{ padding: '0.5rem', textAlign: 'right' }}>{r.quantity}</td>
                    <td style={{ padding: '0.5rem', textAlign: 'right' }}>{r.price != null ? `$${Number(r.price).toFixed(2)}` : '—'}</td>
                    {isCG && <td style={{ padding: '0.5rem', textAlign: 'right' }}>{r.total_cost != null ? `$${Number(r.total_cost).toFixed(2)}` : '—'}</td>}
                  </tr>
                ))}
              </tbody>
            </table>

            {pagination.pages > 1 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid #e2e8f0' }}>
                <button onClick={() => fetchData(pagination.page - 1)} disabled={pagination.page <= 1}
                  style={{ padding: '0.35rem 0.9rem', border: '1px solid #d1d5db', borderRadius: '6px', cursor: pagination.page <= 1 ? 'default' : 'pointer', background: '#fff', fontSize: '0.85rem' }}>
                  ‹ Prev
                </button>
                <span style={{ fontSize: '0.85rem', color: '#64748b' }}>
                  Page {pagination.page} / {pagination.pages} ({pagination.total} total)
                </span>
                <button onClick={() => fetchData(pagination.page + 1)} disabled={pagination.page >= pagination.pages}
                  style={{ padding: '0.35rem 0.9rem', border: '1px solid #d1d5db', borderRadius: '6px', cursor: pagination.page >= pagination.pages ? 'default' : 'pointer', background: '#fff', fontSize: '0.85rem' }}>
                  Next ›
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}

export default function WayfairOrders() {
  const [orderSubTab, setOrderSubTab] = useState<'castlegate' | 'dropship'>('castlegate');

  return (
    <div>
      <h1 style={{ marginBottom: '1rem' }}>Wayfair Orders</h1>
      <div style={{ display: 'flex', gap: '0.25rem', marginBottom: '1.25rem', borderBottom: '2px solid #e2e8f0' }}>
        {(['castlegate', 'dropship'] as const).map(t => (
          <button key={t} onClick={() => setOrderSubTab(t)}
            style={{
              padding: '0.4rem 1.1rem', border: 'none', background: 'none', cursor: 'pointer',
              fontSize: '0.875rem', fontWeight: 500,
              color: orderSubTab === t ? '#0891b2' : '#64748b',
              borderBottom: orderSubTab === t ? '2px solid #0891b2' : '2px solid transparent',
              marginBottom: '-2px',
            }}>
            {t === 'castlegate' ? 'CastleGate' : 'Dropship'}
          </button>
        ))}
      </div>
      <OrdersTable orderType={orderSubTab} />
    </div>
  );
}
