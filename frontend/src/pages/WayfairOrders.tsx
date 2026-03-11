import { useState, useEffect } from 'react';
import axios from 'axios';

interface WayfairCGProduct { partNumber: string; quantity: number; price: number; totalCost?: number; }
interface WayfairPurchaseOrder {
  id: string;
  poNumber: string;
  poDate: string;
  supplierId: number;
  products: WayfairCGProduct[];
}

interface DropshipProduct { partNumber: string; quantity: number; price: number; }
interface DropshipOrder { poNumber: string; poDate: string; supplierId: number; products: DropshipProduct[]; }

type MappingMap = Record<string, string>;

const cardStyle = {
  background: '#fff',
  borderRadius: '8px',
  padding: '1.5rem',
  boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
  marginBottom: '1rem',
} as const;

function CGOrdersTable({ mappings }: { mappings: MappingMap }) {
  const [orders, setOrders] = useState<WayfairPurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const limit = 50;

  useEffect(() => {
    setLoading(true);
    setError('');
    axios.get('/api/v1/wayfair/orders')
      .then(res => setOrders(res.data.data))
      .catch(err => setError(err.response?.data?.error || 'Failed to fetch CastleGate orders'))
      .finally(() => setLoading(false));
  }, []);

  // Flatten orders into product rows
  const allRows = orders.flatMap(order =>
    (order.products || []).map(p => ({
      poNumber: order.poNumber,
      poDate: order.poDate,
      partNumber: p.partNumber,
      iwasku: mappings[p.partNumber] || null,
      quantity: p.quantity,
      price: p.price,
      totalCost: p.totalCost,
    }))
  );

  const filtered = search
    ? allRows.filter(r => r.partNumber.toLowerCase().includes(search.toLowerCase()) || r.poNumber.toLowerCase().includes(search.toLowerCase()) || (r.iwasku && r.iwasku.toLowerCase().includes(search.toLowerCase())))
    : allRows;

  const totalPages = Math.ceil(filtered.length / limit);
  const paginated = filtered.slice((page - 1) * limit, page * limit);

  useEffect(() => { setPage(1); }, [search]);

  if (error) return <div style={{ padding: '0.75rem 1rem', borderRadius: '6px', background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca' }}>{error}</div>;

  return (
    <>
      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginBottom: '1rem' }}>
        <input type="text" placeholder="Search PO / part number / iwasku..." value={search} onChange={e => setSearch(e.target.value)}
          style={{ padding: '0.35rem 0.75rem', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '0.85rem', width: '280px' }} />
        <span style={{ fontSize: '0.85rem', color: '#64748b' }}>{filtered.length} rows</span>
      </div>

      <div style={cardStyle}>
        {loading ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: '#94a3b8' }}>Loading...</div>
        ) : paginated.length === 0 ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: '#94a3b8' }}>No CastleGate orders found.</div>
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
                  <th style={{ textAlign: 'right', padding: '0.5rem' }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {paginated.map((r, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '0.5rem', fontFamily: 'monospace', fontSize: '0.82rem' }}>{r.poNumber}</td>
                    <td style={{ padding: '0.5rem', color: '#475569' }}>{r.poDate ? new Date(r.poDate).toLocaleDateString() : '—'}</td>
                    <td style={{ padding: '0.5rem', fontFamily: 'monospace', fontSize: '0.82rem' }}>{r.partNumber}</td>
                    <td style={{ padding: '0.5rem', fontFamily: 'monospace', fontSize: '0.82rem', color: r.iwasku ? '#0f172a' : '#94a3b8' }}>{r.iwasku || '—'}</td>
                    <td style={{ padding: '0.5rem', textAlign: 'right' }}>{r.quantity}</td>
                    <td style={{ padding: '0.5rem', textAlign: 'right' }}>{r.price != null ? `$${r.price.toFixed(2)}` : '—'}</td>
                    <td style={{ padding: '0.5rem', textAlign: 'right' }}>{r.totalCost != null ? `$${r.totalCost.toFixed(2)}` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {totalPages > 1 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid #e2e8f0' }}>
                <button onClick={() => setPage(p => p - 1)} disabled={page <= 1}
                  style={{ padding: '0.35rem 0.9rem', border: '1px solid #d1d5db', borderRadius: '6px', cursor: page <= 1 ? 'default' : 'pointer', background: '#fff', fontSize: '0.85rem' }}>‹ Prev</button>
                <span style={{ fontSize: '0.85rem', color: '#64748b' }}>Page {page} / {totalPages}</span>
                <button onClick={() => setPage(p => p + 1)} disabled={page >= totalPages}
                  style={{ padding: '0.35rem 0.9rem', border: '1px solid #d1d5db', borderRadius: '6px', cursor: page >= totalPages ? 'default' : 'pointer', background: '#fff', fontSize: '0.85rem' }}>Next ›</button>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}

function DropshipOrdersTable({ mappings }: { mappings: MappingMap }) {
  const [orders, setOrders] = useState<DropshipOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const limit = 50;

  useEffect(() => {
    setLoading(true);
    setError('');
    axios.get('/api/v1/wayfair/orders/dropship')
      .then(res => setOrders(res.data.data))
      .catch(err => setError(err.response?.data?.error || 'Failed to fetch dropship orders'))
      .finally(() => setLoading(false));
  }, []);

  const allRows = orders.flatMap(order =>
    (order.products || []).map(p => ({
      poNumber: order.poNumber,
      poDate: order.poDate,
      partNumber: p.partNumber,
      iwasku: mappings[p.partNumber] || null,
      quantity: p.quantity,
      price: p.price,
    }))
  );

  const filtered = search
    ? allRows.filter(r => r.partNumber.toLowerCase().includes(search.toLowerCase()) || r.poNumber.toLowerCase().includes(search.toLowerCase()) || (r.iwasku && r.iwasku.toLowerCase().includes(search.toLowerCase())))
    : allRows;

  const totalPages = Math.ceil(filtered.length / limit);
  const paginated = filtered.slice((page - 1) * limit, page * limit);

  useEffect(() => { setPage(1); }, [search]);

  if (error) return <div style={{ padding: '0.75rem 1rem', borderRadius: '6px', background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca' }}>{error}</div>;

  return (
    <>
      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginBottom: '1rem' }}>
        <input type="text" placeholder="Search PO / part number / iwasku..." value={search} onChange={e => setSearch(e.target.value)}
          style={{ padding: '0.35rem 0.75rem', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '0.85rem', width: '280px' }} />
        <span style={{ fontSize: '0.85rem', color: '#64748b' }}>{filtered.length} rows</span>
      </div>

      <div style={cardStyle}>
        {loading ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: '#94a3b8' }}>Loading...</div>
        ) : paginated.length === 0 ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: '#94a3b8' }}>No dropship orders found.</div>
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
                </tr>
              </thead>
              <tbody>
                {paginated.map((r, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '0.5rem', fontFamily: 'monospace', fontSize: '0.82rem' }}>{r.poNumber}</td>
                    <td style={{ padding: '0.5rem', color: '#475569' }}>{r.poDate ? new Date(r.poDate).toLocaleDateString() : '—'}</td>
                    <td style={{ padding: '0.5rem', fontFamily: 'monospace', fontSize: '0.82rem' }}>{r.partNumber}</td>
                    <td style={{ padding: '0.5rem', fontFamily: 'monospace', fontSize: '0.82rem', color: r.iwasku ? '#0f172a' : '#94a3b8' }}>{r.iwasku || '—'}</td>
                    <td style={{ padding: '0.5rem', textAlign: 'right' }}>{r.quantity}</td>
                    <td style={{ padding: '0.5rem', textAlign: 'right' }}>{r.price != null ? `$${r.price.toFixed(2)}` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {totalPages > 1 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid #e2e8f0' }}>
                <button onClick={() => setPage(p => p - 1)} disabled={page <= 1}
                  style={{ padding: '0.35rem 0.9rem', border: '1px solid #d1d5db', borderRadius: '6px', cursor: page <= 1 ? 'default' : 'pointer', background: '#fff', fontSize: '0.85rem' }}>‹ Prev</button>
                <span style={{ fontSize: '0.85rem', color: '#64748b' }}>Page {page} / {totalPages}</span>
                <button onClick={() => setPage(p => p + 1)} disabled={page >= totalPages}
                  style={{ padding: '0.35rem 0.9rem', border: '1px solid #d1d5db', borderRadius: '6px', cursor: page >= totalPages ? 'default' : 'pointer', background: '#fff', fontSize: '0.85rem' }}>Next ›</button>
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
  const [mappings, setMappings] = useState<MappingMap>({});

  useEffect(() => {
    axios.get('/api/v1/wayfair/mappings/all')
      .then(res => setMappings(res.data.data || {}))
      .catch(() => {});
  }, []);

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
      {orderSubTab === 'castlegate' && <CGOrdersTable mappings={mappings} />}
      {orderSubTab === 'dropship' && <DropshipOrdersTable mappings={mappings} />}
    </div>
  );
}
