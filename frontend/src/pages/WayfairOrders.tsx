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

function WayfairDropshipOrdersInline({ mappings }: { mappings: MappingMap }) {
  const [orders, setOrders] = useState<DropshipOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<'all' | 'new' | 'responded'>('all');
  const [rawResponse, setRawResponse] = useState<unknown>(null);
  const [rawLoading, setRawLoading] = useState(false);

  const fetchOrders = async (f = filter) => {
    setLoading(true);
    setError('');
    try {
      const params: Record<string, string> = {};
      if (f === 'new') params.hasResponse = 'false';
      if (f === 'responded') params.hasResponse = 'true';
      const res = await axios.get('/api/v1/wayfair/orders/dropship', { params });
      setOrders(res.data.data);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to fetch dropship orders');
    } finally {
      setLoading(false);
    }
  };

  const fetchRaw = async () => {
    setRawLoading(true);
    try {
      const res = await axios.get('/api/v1/wayfair/orders/dropship/raw');
      setRawResponse(res.data);
    } catch (err: any) {
      setRawResponse({ error: err.response?.data?.error || err.message });
    } finally {
      setRawLoading(false);
    }
  };

  useEffect(() => { fetchOrders(); }, []);

  const handleFilter = (f: 'all' | 'new' | 'responded') => {
    setFilter(f);
    fetchOrders(f);
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          {(['all', 'new', 'responded'] as const).map(f => (
            <button key={f} onClick={() => handleFilter(f)}
              style={{ padding: '0.35rem 0.9rem', border: '1px solid #d1d5db', borderRadius: '6px', cursor: 'pointer', fontSize: '0.85rem', background: filter === f ? '#0891b2' : '#fff', color: filter === f ? '#fff' : '#374151' }}>
              {f === 'all' ? 'All' : f === 'new' ? 'New (no response)' : 'Responded'}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button onClick={fetchRaw} disabled={rawLoading}
            style={{ padding: '0.4rem 1rem', background: '#dc2626', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '0.85rem' }}>
            {rawLoading ? 'Loading...' : 'Raw Response'}
          </button>
          <button onClick={() => fetchOrders()} disabled={loading}
            style={{ padding: '0.4rem 1rem', background: '#2563eb', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '0.85rem' }}>
            {loading ? 'Loading...' : 'Refresh'}
          </button>
        </div>
      </div>

      {rawResponse !== null && (
        <div style={{ background: '#1e293b', color: '#e2e8f0', borderRadius: '8px', padding: '1rem', marginBottom: '1rem', fontSize: '0.75rem', fontFamily: 'monospace' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
            <strong style={{ color: '#94a3b8' }}>Raw Dropship API Response (limit: 5)</strong>
            <span onClick={() => setRawResponse(null)} style={{ cursor: 'pointer', color: '#94a3b8' }}>✕</span>
          </div>
          <pre style={{ maxHeight: '500px', overflowY: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: 0 }}>
            {JSON.stringify(rawResponse, null, 2)}
          </pre>
        </div>
      )}

      {error && <div style={{ padding: '0.75rem 1rem', borderRadius: '6px', marginBottom: '1rem', background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca' }}>{error}</div>}

      <div style={{ background: '#fff', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
        {loading ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: '#94a3b8' }}>Loading...</div>
        ) : orders.length === 0 ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: '#94a3b8' }}>No dropship orders found.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #e2e8f0' }}>
                <th style={{ textAlign: 'left', padding: '0.75rem 1rem' }}>PO Number</th>
                <th style={{ textAlign: 'left', padding: '0.75rem 0.5rem' }}>PO Date</th>
                <th style={{ textAlign: 'left', padding: '0.75rem 0.5rem' }}>Part Number</th>
                <th style={{ textAlign: 'left', padding: '0.75rem 0.5rem' }}>IWASKU</th>
                <th style={{ textAlign: 'right', padding: '0.75rem 0.5rem' }}>Qty</th>
                <th style={{ textAlign: 'right', padding: '0.75rem 0.5rem' }}>Price</th>
              </tr>
            </thead>
            <tbody>
              {orders.map(order => {
                const products = order.products || [];
                return products.length === 0 ? (
                  <tr key={order.poNumber} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '0.6rem 1rem', fontFamily: 'monospace', fontWeight: 600 }}>{order.poNumber}</td>
                    <td style={{ padding: '0.6rem 0.5rem', color: '#475569' }}>{order.poDate ? new Date(order.poDate).toLocaleDateString() : '—'}</td>
                    <td colSpan={4} style={{ padding: '0.6rem 0.5rem', color: '#94a3b8' }}>No products</td>
                  </tr>
                ) : products.map((p, i) => (
                  <tr key={`${order.poNumber}-${i}`} style={{ borderBottom: i === products.length - 1 ? '2px solid #e2e8f0' : '1px solid #f1f5f9' }}>
                    {i === 0 ? (
                      <>
                        <td rowSpan={products.length} style={{ padding: '0.6rem 1rem', fontFamily: 'monospace', fontWeight: 600, verticalAlign: 'top', borderRight: '1px solid #f1f5f9' }}>{order.poNumber}</td>
                        <td rowSpan={products.length} style={{ padding: '0.6rem 0.5rem', color: '#475569', verticalAlign: 'top', borderRight: '1px solid #f1f5f9' }}>{order.poDate ? new Date(order.poDate).toLocaleDateString() : '—'}</td>
                      </>
                    ) : null}
                    <td style={{ padding: '0.4rem 0.5rem', fontFamily: 'monospace', fontSize: '0.82rem' }}>{p.partNumber}</td>
                    <td style={{ padding: '0.4rem 0.5rem', fontFamily: 'monospace', fontSize: '0.82rem', color: mappings[p.partNumber] ? '#0f172a' : '#94a3b8' }}>
                      {mappings[p.partNumber] || '—'}
                    </td>
                    <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right' }}>{p.quantity}</td>
                    <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right' }}>{p.price != null ? `$${p.price.toFixed(2)}` : '—'}</td>
                  </tr>
                ));
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function WayfairCGOrdersInline({ mappings }: { mappings: MappingMap }) {
  const [orders, setOrders] = useState<WayfairPurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<'all' | 'new' | 'responded'>('all');
  const [rawResponse, setRawResponse] = useState<unknown>(null);
  const [rawLoading, setRawLoading] = useState(false);

  const fetchOrders = async (f = filter) => {
    setLoading(true);
    setError('');
    try {
      const params: Record<string, string> = {};
      if (f === 'new') params.hasResponse = 'false';
      if (f === 'responded') params.hasResponse = 'true';
      const res = await axios.get('/api/v1/wayfair/orders', { params });
      setOrders(res.data.data);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to fetch CastleGate orders');
    } finally {
      setLoading(false);
    }
  };

  const fetchRaw = async () => {
    setRawLoading(true);
    try {
      const res = await axios.get('/api/v1/wayfair/orders/raw');
      setRawResponse(res.data);
    } catch (err: any) {
      setRawResponse({ error: err.response?.data?.error || err.message });
    } finally {
      setRawLoading(false);
    }
  };

  useEffect(() => { fetchOrders(); }, []);

  const handleFilter = (f: 'all' | 'new' | 'responded') => {
    setFilter(f);
    fetchOrders(f);
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          {(['all', 'new', 'responded'] as const).map(f => (
            <button key={f} onClick={() => handleFilter(f)}
              style={{ padding: '0.35rem 0.9rem', border: '1px solid #d1d5db', borderRadius: '6px', cursor: 'pointer', fontSize: '0.85rem', background: filter === f ? '#0891b2' : '#fff', color: filter === f ? '#fff' : '#374151' }}>
              {f === 'all' ? 'All' : f === 'new' ? 'New (no response)' : 'Responded'}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button onClick={fetchRaw} disabled={rawLoading}
            style={{ padding: '0.4rem 1rem', background: '#dc2626', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '0.85rem' }}>
            {rawLoading ? 'Loading...' : 'Raw Response'}
          </button>
          <button onClick={() => fetchOrders()} disabled={loading}
            style={{ padding: '0.4rem 1rem', background: '#2563eb', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '0.85rem' }}>
            {loading ? 'Loading...' : 'Refresh'}
          </button>
        </div>
      </div>

      {rawResponse !== null && (
        <div style={{ background: '#1e293b', color: '#e2e8f0', borderRadius: '8px', padding: '1rem', marginBottom: '1rem', fontSize: '0.75rem', fontFamily: 'monospace' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
            <strong style={{ color: '#94a3b8' }}>Raw CastleGate API Response (limit: 5)</strong>
            <span onClick={() => setRawResponse(null)} style={{ cursor: 'pointer', color: '#94a3b8' }}>✕</span>
          </div>
          <pre style={{ maxHeight: '500px', overflowY: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: 0 }}>
            {JSON.stringify(rawResponse, null, 2)}
          </pre>
        </div>
      )}

      {error && <div style={{ padding: '0.75rem 1rem', borderRadius: '6px', marginBottom: '1rem', background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca' }}>{error}</div>}

      <div style={{ background: '#fff', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
        {loading ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: '#94a3b8' }}>Loading...</div>
        ) : orders.length === 0 ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: '#94a3b8' }}>No CastleGate orders found.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #e2e8f0' }}>
                <th style={{ textAlign: 'left', padding: '0.75rem 1rem' }}>PO Number</th>
                <th style={{ textAlign: 'left', padding: '0.75rem 0.5rem' }}>PO Date</th>
                <th style={{ textAlign: 'left', padding: '0.75rem 0.5rem' }}>Part Number</th>
                <th style={{ textAlign: 'left', padding: '0.75rem 0.5rem' }}>IWASKU</th>
                <th style={{ textAlign: 'right', padding: '0.75rem 0.5rem' }}>Qty</th>
                <th style={{ textAlign: 'right', padding: '0.75rem 0.5rem' }}>Price</th>
                <th style={{ textAlign: 'right', padding: '0.75rem 0.5rem' }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {orders.map(order => {
                const products = order.products || [];
                return products.length === 0 ? (
                  <tr key={order.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '0.6rem 1rem', fontFamily: 'monospace', fontWeight: 600 }}>{order.poNumber}</td>
                    <td style={{ padding: '0.6rem 0.5rem', color: '#475569' }}>{order.poDate ? new Date(order.poDate).toLocaleDateString() : '—'}</td>
                    <td colSpan={5} style={{ padding: '0.6rem 0.5rem', color: '#94a3b8' }}>No products</td>
                  </tr>
                ) : products.map((p, i) => (
                  <tr key={`${order.id}-${i}`} style={{ borderBottom: i === products.length - 1 ? '2px solid #e2e8f0' : '1px solid #f1f5f9' }}>
                    {i === 0 ? (
                      <>
                        <td rowSpan={products.length} style={{ padding: '0.6rem 1rem', fontFamily: 'monospace', fontWeight: 600, verticalAlign: 'top', borderRight: '1px solid #f1f5f9' }}>{order.poNumber}</td>
                        <td rowSpan={products.length} style={{ padding: '0.6rem 0.5rem', color: '#475569', verticalAlign: 'top', borderRight: '1px solid #f1f5f9' }}>{order.poDate ? new Date(order.poDate).toLocaleDateString() : '—'}</td>
                      </>
                    ) : null}
                    <td style={{ padding: '0.4rem 0.5rem', fontFamily: 'monospace', fontSize: '0.82rem' }}>{p.partNumber}</td>
                    <td style={{ padding: '0.4rem 0.5rem', fontFamily: 'monospace', fontSize: '0.82rem', color: mappings[p.partNumber] ? '#0f172a' : '#94a3b8' }}>
                      {mappings[p.partNumber] || '—'}
                    </td>
                    <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right' }}>{p.quantity}</td>
                    <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right' }}>{p.price != null ? `$${p.price.toFixed(2)}` : '—'}</td>
                    <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right' }}>{p.totalCost != null ? `$${p.totalCost.toFixed(2)}` : '—'}</td>
                  </tr>
                ));
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
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
      {orderSubTab === 'castlegate' && <WayfairCGOrdersInline mappings={mappings} />}
      {orderSubTab === 'dropship' && <WayfairDropshipOrdersInline mappings={mappings} />}
    </div>
  );
}
