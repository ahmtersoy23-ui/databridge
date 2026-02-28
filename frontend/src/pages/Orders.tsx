import { useState, useEffect } from 'react';
import axios from 'axios';

interface OrderRow {
  id: number;
  channel: string;
  amazon_order_id: string;
  purchase_date_local: string;
  sku: string;
  asin: string;
  iwasku: string | null;
  quantity: number;
  item_price: string;
  currency: string;
  order_status: string;
  fulfillment_channel: string;
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

export default function Orders() {
  const [rows, setRows] = useState<OrderRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [channels, setChannels] = useState<string[]>([]);

  // Filters
  const [channel, setChannel] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [search, setSearch] = useState('');
  const [matched, setMatched] = useState<'' | 'matched' | 'unmatched'>('');
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc');

  useEffect(() => {
    axios.get('/api/v1/orders/channels').then(res => {
      if (res.data.success) setChannels(res.data.data);
    }).catch(() => {});
  }, []);

  const fetchOrders = async (p = page) => {
    setLoading(true);
    try {
      const params: Record<string, string> = {
        page: String(p),
        limit: '50',
        sort: `date_${sortDir}`,
      };
      if (channel) params.channel = channel;
      if (dateFrom) params.dateFrom = dateFrom;
      if (dateTo) params.dateTo = dateTo;
      if (search) params.search = search;
      if (matched) params.matched = matched;

      const res = await axios.get('/api/v1/orders', { params });
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

  useEffect(() => { fetchOrders(); }, []);

  const handleSearch = () => {
    setPage(1);
    fetchOrders(1);
  };

  const handlePageChange = (newPage: number) => {
    setPage(newPage);
    fetchOrders(newPage);
  };

  const handleSort = () => {
    const next = sortDir === 'desc' ? 'asc' : 'desc';
    setSortDir(next);
    setPage(1);
    // fetch with new sort after state update
    setLoading(true);
    const params: Record<string, string> = { page: '1', limit: '50', sort: `date_${next}` };
    if (channel) params.channel = channel;
    if (dateFrom) params.dateFrom = dateFrom;
    if (dateTo) params.dateTo = dateTo;
    if (search) params.search = search;
    if (matched) params.matched = matched;
    axios.get('/api/v1/orders', { params }).then(res => {
      if (res.data.success) {
        const d = res.data.data;
        setRows(d.rows);
        setTotal(d.total);
        setPage(d.page);
        setTotalPages(d.totalPages);
      }
    }).finally(() => setLoading(false));
  };

  const statusColor = (status: string) => {
    const s = status?.toLowerCase() || '';
    if (s.includes('ship')) return '#059669';
    if (s.includes('cancel')) return '#dc2626';
    if (s.includes('pending')) return '#d97706';
    return '#475569';
  };

  return (
    <div>
      <h1 style={{ marginBottom: '1.5rem' }}>Orders</h1>

      {/* Filters */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '0.25rem' }}>Channel</div>
            <select value={channel} onChange={e => setChannel(e.target.value)} style={{ ...inputStyle, minWidth: '80px' }}>
              <option value="">All</option>
              {channels.map(c => <option key={c} value={c}>{c.toUpperCase()}</option>)}
            </select>
          </div>
          <div>
            <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '0.25rem' }}>From</div>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '0.25rem' }}>To</div>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={inputStyle} />
          </div>
          <div>
            <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '0.25rem' }}>Search (SKU/ASIN/IWASKU)</div>
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
              placeholder="Search..."
              style={{ ...inputStyle, minWidth: '180px' }}
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
          <p style={{ color: '#64748b' }}>No orders found.</p>
        ) : (
          <>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #e2e8f0' }}>
                  <th
                    style={{ textAlign: 'left', padding: '0.5rem', cursor: 'pointer', userSelect: 'none' }}
                    onClick={handleSort}
                  >
                    Date {sortDir === 'desc' ? '\u2193' : '\u2191'}
                  </th>
                  <th style={{ textAlign: 'left', padding: '0.5rem' }}>CH</th>
                  <th style={{ textAlign: 'left', padding: '0.5rem' }}>Order ID</th>
                  <th style={{ textAlign: 'left', padding: '0.5rem' }}>SKU</th>
                  <th style={{ textAlign: 'left', padding: '0.5rem' }}>ASIN</th>
                  <th style={{ textAlign: 'left', padding: '0.5rem' }}>IWA SKU</th>
                  <th style={{ textAlign: 'right', padding: '0.5rem' }}>Qty</th>
                  <th style={{ textAlign: 'right', padding: '0.5rem' }}>Price</th>
                  <th style={{ textAlign: 'left', padding: '0.5rem' }}>Cur</th>
                  <th style={{ textAlign: 'left', padding: '0.5rem' }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id} style={{ borderBottom: '1px solid #e2e8f0' }}>
                    <td style={{ padding: '0.5rem', whiteSpace: 'nowrap' }}>{r.purchase_date_local}</td>
                    <td style={{ padding: '0.5rem' }}>{r.channel?.toUpperCase()}</td>
                    <td style={{ padding: '0.5rem', maxWidth: '140px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.amazon_order_id}>
                      {r.amazon_order_id}
                    </td>
                    <td style={{ padding: '0.5rem', maxWidth: '130px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.sku}>
                      {r.sku}
                    </td>
                    <td style={{ padding: '0.5rem' }}>{r.asin}</td>
                    <td style={{ padding: '0.5rem', color: r.iwasku ? '#059669' : '#d97706', fontWeight: 500 }}>
                      {r.iwasku || '-'}
                    </td>
                    <td style={{ padding: '0.5rem', textAlign: 'right' }}>{r.quantity}</td>
                    <td style={{ padding: '0.5rem', textAlign: 'right' }}>{Number(r.item_price).toFixed(2)}</td>
                    <td style={{ padding: '0.5rem' }}>{r.currency}</td>
                    <td style={{ padding: '0.5rem', color: statusColor(r.order_status) }}>{r.order_status}</td>
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
