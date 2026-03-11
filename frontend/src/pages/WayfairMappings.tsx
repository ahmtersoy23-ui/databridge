import { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import * as XLSX from 'xlsx';

interface WayfairCGProduct { partNumber: string; quantity: number; price: number; totalCost?: number; }
interface WayfairPurchaseOrder {
  id: string;
  poNumber: string;
  poDate: string;
  supplierId: number;
  products: WayfairCGProduct[];
}

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

interface DropshipProduct { partNumber: string; quantity: number; price: number; }
interface DropshipOrder { poNumber: string; poDate: string; supplierId: number; products: DropshipProduct[]; }

function WayfairDropshipOrders() {
  const [orders, setOrders] = useState<DropshipOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
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
        <button onClick={fetchRaw} disabled={rawLoading}
          style={{ padding: '0.4rem 1rem', background: '#dc2626', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '0.85rem' }}>
          {rawLoading ? 'Loading...' : 'Raw Response'}
        </button>
        <button onClick={() => fetchOrders()} disabled={loading}
          style={{ padding: '0.4rem 1rem', background: '#2563eb', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '0.85rem' }}>
          {loading ? 'Loading...' : 'Refresh'}
        </button>
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
                <th style={{ textAlign: 'left', padding: '0.75rem 0.5rem' }}>Supplier ID</th>
                <th style={{ textAlign: 'left', padding: '0.75rem 0.5rem' }}>Items</th>
              </tr>
            </thead>
            <tbody>
              {orders.map(order => (
                <>
                  <tr key={order.poNumber}
                    style={{ borderBottom: '1px solid #f1f5f9', cursor: 'pointer', background: expanded === order.poNumber ? '#f8fafc' : undefined }}
                    onClick={() => setExpanded(expanded === order.poNumber ? null : order.poNumber)}>
                    <td style={{ padding: '0.6rem 1rem', fontFamily: 'monospace', fontWeight: 600 }}>{order.poNumber}</td>
                    <td style={{ padding: '0.6rem 0.5rem', color: '#475569' }}>{order.poDate ? new Date(order.poDate).toLocaleDateString() : '—'}</td>
                    <td style={{ padding: '0.6rem 0.5rem', color: '#64748b' }}>{order.supplierId}</td>
                    <td style={{ padding: '0.6rem 0.5rem', color: '#64748b' }}>{order.products?.length ?? 0}</td>
                  </tr>
                  {expanded === order.poNumber && (
                    <tr key={`${order.poNumber}-d`} style={{ borderBottom: '1px solid #e2e8f0', background: '#f8fafc' }}>
                      <td colSpan={4} style={{ padding: '0.5rem 1rem 1rem 2rem' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                          <thead>
                            <tr style={{ color: '#64748b' }}>
                              <th style={{ textAlign: 'left', padding: '0.25rem 0.5rem' }}>Part Number</th>
                              <th style={{ textAlign: 'left', padding: '0.25rem 0.5rem' }}>Qty</th>
                              <th style={{ textAlign: 'left', padding: '0.25rem 0.5rem' }}>Price</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(order.products || []).map((p, i) => (
                              <tr key={i}>
                                <td style={{ padding: '0.2rem 0.5rem', fontFamily: 'monospace' }}>{p.partNumber}</td>
                                <td style={{ padding: '0.2rem 0.5rem' }}>{p.quantity}</td>
                                <td style={{ padding: '0.2rem 0.5rem' }}>{p.price != null ? `$${p.price.toFixed(2)}` : '—'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function WayfairCGOrders() {
  const [orders, setOrders] = useState<WayfairPurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
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
                <th style={{ textAlign: 'left', padding: '0.75rem 0.5rem' }}>Supplier ID</th>
                <th style={{ textAlign: 'left', padding: '0.75rem 0.5rem' }}>Items</th>
              </tr>
            </thead>
            <tbody>
              {orders.map(order => (
                <>
                  <tr key={order.id}
                    style={{ borderBottom: '1px solid #f1f5f9', cursor: 'pointer', background: expanded === order.id ? '#f8fafc' : undefined }}
                    onClick={() => setExpanded(expanded === order.id ? null : order.id)}>
                    <td style={{ padding: '0.6rem 1rem', fontFamily: 'monospace', fontWeight: 600 }}>{order.poNumber}</td>
                    <td style={{ padding: '0.6rem 0.5rem', color: '#475569' }}>{order.poDate ? new Date(order.poDate).toLocaleDateString() : '—'}</td>
                    <td style={{ padding: '0.6rem 0.5rem', color: '#64748b' }}>{order.supplierId}</td>
                    <td style={{ padding: '0.6rem 0.5rem', color: '#64748b' }}>{order.products?.length ?? 0}</td>
                  </tr>
                  {expanded === order.id && (
                    <tr key={`${order.id}-d`} style={{ borderBottom: '1px solid #e2e8f0', background: '#f8fafc' }}>
                      <td colSpan={4} style={{ padding: '0.5rem 1rem 1rem 2rem' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                          <thead>
                            <tr style={{ color: '#64748b' }}>
                              <th style={{ textAlign: 'left', padding: '0.25rem 0.5rem' }}>Part Number</th>
                              <th style={{ textAlign: 'left', padding: '0.25rem 0.5rem' }}>Qty</th>
                              <th style={{ textAlign: 'left', padding: '0.25rem 0.5rem' }}>Price</th>
                              <th style={{ textAlign: 'left', padding: '0.25rem 0.5rem' }}>Total</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(order.products || []).map((p, i) => (
                              <tr key={i}>
                                <td style={{ padding: '0.2rem 0.5rem', fontFamily: 'monospace' }}>{p.partNumber}</td>
                                <td style={{ padding: '0.2rem 0.5rem' }}>{p.quantity}</td>
                                <td style={{ padding: '0.2rem 0.5rem' }}>{p.price != null ? `$${p.price.toFixed(2)}` : '—'}</td>
                                <td style={{ padding: '0.2rem 0.5rem' }}>{p.totalCost != null ? `$${p.totalCost.toFixed(2)}` : '—'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function WayfairInventoryTab() {
  const [rawResponse, setRawResponse] = useState<unknown>(null);
  const [rawLoading, setRawLoading] = useState(false);

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

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1rem' }}>
        <button onClick={fetchRaw} disabled={rawLoading}
          style={{ padding: '0.4rem 1rem', background: '#dc2626', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '0.85rem' }}>
          {rawLoading ? 'Loading...' : 'Raw Inventory Response'}
        </button>
      </div>

      {rawResponse !== null && (
        <div style={{ background: '#1e293b', color: '#e2e8f0', borderRadius: '8px', padding: '1rem', fontSize: '0.75rem', fontFamily: 'monospace' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
            <strong style={{ color: '#94a3b8' }}>Raw Inventory API Response (ilk 5 ürün)</strong>
            <span onClick={() => setRawResponse(null)} style={{ cursor: 'pointer', color: '#94a3b8' }}>✕</span>
          </div>
          <pre style={{ maxHeight: '600px', overflowY: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: 0 }}>
            {JSON.stringify(rawResponse, null, 2)}
          </pre>
        </div>
      )}

      {rawResponse === null && (
        <div style={{ padding: '3rem', textAlign: 'center', color: '#94a3b8', background: '#fff', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
          API'den gelen ham stok verisini görmek için "Raw Inventory Response" butonuna tıkla.<br />
          <span style={{ fontSize: '0.8rem', marginTop: '0.5rem', display: 'block' }}>
            onHandQty · inStockQty · fulfillableQty (Available) · warehouse breakdown
          </span>
        </div>
      )}
    </div>
  );
}

function WayfairOrders() {
  const [orderSubTab, setOrderSubTab] = useState<'castlegate' | 'dropship'>('castlegate');

  return (
    <div>
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
      {orderSubTab === 'castlegate' && <WayfairCGOrders />}
      {orderSubTab === 'dropship' && <WayfairDropshipOrders />}
    </div>
  );
}

export default function WayfairMappings() {
  const [activeTab, setActiveTab] = useState<'mappings' | 'orders' | 'inventory'>('mappings');
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
      <h1 style={{ marginBottom: '1rem' }}>Wayfair CastleGate</h1>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: '0.25rem', marginBottom: '1.5rem', borderBottom: '2px solid #e2e8f0' }}>
        {(['mappings', 'orders', 'inventory'] as const).map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            style={{
              padding: '0.5rem 1.25rem', border: 'none', background: 'none', cursor: 'pointer',
              fontSize: '0.9rem', fontWeight: 500,
              color: activeTab === tab ? '#0891b2' : '#64748b',
              borderBottom: activeTab === tab ? '2px solid #0891b2' : '2px solid transparent',
              marginBottom: '-2px',
            }}>
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      {activeTab === 'orders' && <WayfairOrders />}
      {activeTab === 'inventory' && <WayfairInventoryTab />}
      {activeTab === 'mappings' && <>

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
            Export Excel
          </button>
          <label style={{ padding: '0.4rem 1rem', background: '#7c3aed', color: '#fff', borderRadius: '6px', cursor: 'pointer', fontSize: '0.85rem' }}>
            {importing ? 'Importing...' : 'Import Excel'}
            <input ref={fileInputRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }} onChange={handleImport} disabled={importing} />
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

      {/* Excel format hint */}
      <div style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: '0.75rem' }}>
        Export Excel → <code>iwasku</code> kolonunu doldur → Import Excel
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
      </>}
    </div>
  );
}
