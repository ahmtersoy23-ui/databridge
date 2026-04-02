import { useState, useEffect, useMemo, useRef } from 'react';
import axios from 'axios';

interface AgingRow {
  iwasku: string;
  asin: string;
  product_name: string;
  available_quantity: number;
  inv_age_0_to_90_days: number;
  inv_age_91_to_180_days: number;
  inv_age_181_to_270_days: number;
  inv_age_271_to_365_days: number;
  inv_age_366_to_455_days: number;
  inv_age_456_plus_days: number;
  estimated_storage_cost: number;
  units_shipped_last_30_days: number;
  sell_through: number;
  days_of_supply: number;
  recommended_action: string;
  snapshot_date: string;
}

const WAREHOUSES = ['US', 'AU', 'AE', 'SA', 'UK', 'EU'];

const cardStyle = {
  background: '#fff',
  borderRadius: '8px',
  padding: '1.5rem',
  boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
  marginBottom: '1rem',
} as const;

const tabStyle = (active: boolean) => ({
  padding: '0.5rem 1.2rem',
  background: active ? '#334155' : '#f1f5f9',
  color: active ? '#fff' : '#475569',
  border: '1px solid #d1d5db',
  borderRadius: '6px',
  cursor: 'pointer' as const,
  fontSize: '0.9rem',
  fontWeight: active ? 600 : 400,
});

const COL_GREEN = '#059669';
const COL_YELLOW = '#ca8a04';
const COL_AMBER = '#ea580c';
const COL_RED = '#dc2626';
const COL_DARK_RED = '#991b1b';
const COL_GRAY = '#6b7280';
const COL_ZERO = '#9ca3af';

type SortKey = keyof AgingRow;

const columns: { key: SortKey; label: string; color: string; sticky?: boolean }[] = [
  { key: 'iwasku', label: 'IWA SKU', color: '', sticky: true },
  { key: 'asin', label: 'ASIN', color: '', sticky: true },
  { key: 'available_quantity', label: 'Avail', color: COL_GREEN },
  { key: 'inv_age_0_to_90_days', label: '0-90d', color: COL_GREEN },
  { key: 'inv_age_91_to_180_days', label: '91-180d', color: COL_YELLOW },
  { key: 'inv_age_181_to_270_days', label: '181-270d', color: COL_AMBER },
  { key: 'inv_age_271_to_365_days', label: '271-365d', color: COL_RED },
  { key: 'inv_age_366_to_455_days', label: '366-455d', color: COL_DARK_RED },
  { key: 'inv_age_456_plus_days', label: '456+d', color: COL_DARK_RED },
  { key: 'estimated_storage_cost', label: 'Storage$', color: COL_RED },
  { key: 'units_shipped_last_30_days', label: 'Ship 30d', color: COL_GRAY },
  { key: 'days_of_supply', label: 'DoS', color: COL_GRAY },
  { key: 'sell_through', label: 'Sell-Thru', color: COL_GRAY },
  { key: 'recommended_action', label: 'Rec. Action', color: COL_GRAY },
];

export default function InventoryAging() {
  const [warehouse, setWarehouse] = useState('US');
  const [rows, setRows] = useState<AgingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('inv_age_271_to_365_days');
  const [sortAsc, setSortAsc] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const fetchData = async (wh: string) => {
    setLoading(true);
    try {
      const res = await axios.get(`/api/v1/inventory-aging/${wh}`);
      setRows(Array.isArray(res.data) ? res.data : []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(warehouse); }, [warehouse]);

  const handleUpload = async (file: File) => {
    setUploading(true);
    setUploadMsg('');
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await axios.post('/api/v1/inventory-aging/upload', formData);
      const { warehouse: wh, items } = res.data;
      setUploadMsg(`${items} items uploaded for ${wh}`);
      setWarehouse(wh);
      fetchData(wh);
    } catch (err: any) {
      setUploadMsg('Upload failed: ' + (err.response?.data?.error || err.message));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(false); }
  };

  const filtered = useMemo(() => {
    let data = rows;
    if (search) {
      const q = search.toLowerCase();
      data = data.filter(r =>
        r.iwasku?.toLowerCase().includes(q) ||
        r.asin?.toLowerCase().includes(q) ||
        r.product_name?.toLowerCase().includes(q)
      );
    }
    data = [...data].sort((a, b) => {
      const av = a[sortKey] ?? '';
      const bv = b[sortKey] ?? '';
      if (sortKey === 'iwasku' || sortKey === 'asin' || sortKey === 'product_name' || sortKey === 'recommended_action') {
        return sortAsc ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
      }
      return sortAsc ? (Number(av) || 0) - (Number(bv) || 0) : (Number(bv) || 0) - (Number(av) || 0);
    });
    return data;
  }, [rows, search, sortKey, sortAsc]);

  const summary = useMemo(() => {
    const sum = (key: keyof AgingRow) => rows.reduce((acc, r) => acc + (Number(r[key]) || 0), 0);
    return {
      available: sum('available_quantity'),
      age_0_90: sum('inv_age_0_to_90_days'),
      age_91_180: sum('inv_age_91_to_180_days'),
      age_181_270: sum('inv_age_181_to_270_days'),
      age_271_365: sum('inv_age_271_to_365_days'),
      age_366_455: sum('inv_age_366_to_455_days'),
      age_456_plus: sum('inv_age_456_plus_days'),
      storage_cost: sum('estimated_storage_cost'),
    };
  }, [rows]);

  const age270plus = summary.age_271_365 + summary.age_366_455 + summary.age_456_plus;
  const skus270plus = rows.filter(r =>
    (Number(r.inv_age_271_to_365_days) || 0) + (Number(r.inv_age_366_to_455_days) || 0) + (Number(r.inv_age_456_plus_days) || 0) > 0
  ).length;

  const summaryCards = [
    { label: 'Available', value: summary.available, color: '#334155', fmt: 'num' },
    { label: '0-90d', value: summary.age_0_90, color: COL_GREEN, fmt: 'num' },
    { label: '91-180d', value: summary.age_91_180, color: COL_YELLOW, fmt: 'num' },
    { label: '181-270d', value: summary.age_181_270, color: COL_AMBER, fmt: 'num' },
    { label: '270+d', value: age270plus, color: COL_RED, fmt: 'num' },
    { label: 'Est. Storage', value: summary.storage_cost, color: COL_RED, fmt: 'usd' },
  ];

  const fmtNum = (v: number | null | undefined, color: string) => {
    const n = Number(v) || 0;
    return { text: n === 0 ? '-' : n.toLocaleString(), color: n === 0 ? COL_ZERO : color };
  };

  const fmtUsd = (v: number | null | undefined) => {
    const n = Number(v) || 0;
    return n === 0 ? '-' : `$${n.toFixed(2)}`;
  };

  return (
    <div>
      <h1 style={{ marginBottom: '1.5rem' }}>Inventory Aging</h1>

      {/* Warehouse tabs + search + upload */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            {WAREHOUSES.map(wh => (
              <button key={wh} onClick={() => setWarehouse(wh)} style={tabStyle(warehouse === wh)}>
                {wh}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <input
              type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search SKU / ASIN / Name..."
              style={{ padding: '0.4rem 0.5rem', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '0.85rem', minWidth: '200px' }}
            />
            <input ref={fileRef} type="file" accept=".txt,.csv,.tsv" style={{ display: 'none' }}
              onChange={e => { if (e.target.files?.[0]) handleUpload(e.target.files[0]); }}
            />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              style={{ padding: '0.4rem 1rem', background: '#6366f1', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '0.85rem', opacity: uploading ? 0.7 : 1 }}
            >
              {uploading ? 'Uploading...' : 'Upload CSV'}
            </button>
            <span style={{ fontSize: '0.8rem', color: '#64748b' }}>{filtered.length} items</span>
          </div>
        </div>
        {uploadMsg && (
          <div style={{ marginTop: '0.5rem', fontSize: '0.82rem', color: uploadMsg.startsWith('Upload failed') ? COL_RED : COL_GREEN }}>
            {uploadMsg}
          </div>
        )}
      </div>

      {/* Summary cards */}
      {!loading && rows.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '1rem', marginBottom: '1rem' }}>
          {summaryCards.map(card => (
            <div key={card.label} style={{ ...cardStyle, marginBottom: 0, textAlign: 'center' }}>
              <div style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: '0.3rem' }}>{card.label}</div>
              <div style={{ fontSize: '1.3rem', fontWeight: 700, color: card.color }}>
                {card.fmt === 'usd' ? fmtUsd(card.value) : card.value.toLocaleString()}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 270+ Warning */}
      {!loading && age270plus > 0 && (
        <div style={{
          background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px',
          padding: '0.75rem 1rem', marginBottom: '1rem', color: COL_RED, fontSize: '0.85rem', fontWeight: 500,
        }}>
          {skus270plus} SKU has inventory aged 270+ days ({age270plus.toLocaleString()} units). Est. next month storage: {fmtUsd(summary.storage_cost)}
        </div>
      )}

      {/* Table */}
      <div style={{ ...cardStyle, overflowX: 'auto', padding: '0' }}>
        {loading ? (
          <p style={{ padding: '1.5rem', color: '#64748b' }}>Loading...</p>
        ) : filtered.length === 0 ? (
          <p style={{ padding: '1.5rem', color: '#64748b' }}>No data. Upload a Seller Central inventory aging CSV to get started.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #e2e8f0' }}>
                {columns.map(col => (
                  <th key={col.key} onClick={() => handleSort(col.key)}
                    style={{
                      padding: '0.5rem', textAlign: col.sticky ? 'left' : 'right', cursor: 'pointer',
                      userSelect: 'none', whiteSpace: 'nowrap', color: col.color || '#475569', fontSize: '0.78rem',
                      position: col.sticky ? 'sticky' as const : undefined,
                      left: col.key === 'iwasku' ? 0 : col.key === 'asin' ? '130px' : undefined,
                      background: col.sticky ? '#fff' : undefined, zIndex: col.sticky ? 2 : undefined,
                      minWidth: col.sticky ? '130px' : col.key === 'recommended_action' ? '120px' : '55px',
                    }}>
                    {col.label} {sortKey === col.key ? (sortAsc ? '\u2191' : '\u2193') : ''}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  {columns.map(col => {
                    if (col.sticky) {
                      return (
                        <td key={col.key} style={{
                          padding: '0.4rem 0.5rem', whiteSpace: 'nowrap', fontFamily: 'monospace', fontSize: '0.78rem',
                          position: 'sticky', left: col.key === 'iwasku' ? 0 : '130px', background: '#fff', zIndex: 1,
                          maxWidth: '130px', overflow: 'hidden', textOverflow: 'ellipsis',
                        }} title={String(r[col.key] ?? '')}>
                          {r[col.key]}
                        </td>
                      );
                    }
                    if (col.key === 'estimated_storage_cost') {
                      const n = Number(r[col.key]) || 0;
                      return (<td key={col.key} style={{ padding: '0.4rem 0.5rem', textAlign: 'right', color: n > 0 ? COL_RED : COL_ZERO, fontVariantNumeric: 'tabular-nums', fontFamily: 'monospace', fontSize: '0.78rem' }}>{n === 0 ? '-' : `$${n.toFixed(2)}`}</td>);
                    }
                    if (col.key === 'sell_through') {
                      const n = Number(r[col.key]) || 0;
                      return (<td key={col.key} style={{ padding: '0.4rem 0.5rem', textAlign: 'right', color: n > 0 ? COL_GRAY : COL_ZERO, fontVariantNumeric: 'tabular-nums', fontFamily: 'monospace', fontSize: '0.78rem' }}>{n === 0 ? '-' : n.toFixed(2)}</td>);
                    }
                    if (col.key === 'recommended_action') {
                      const val = r[col.key] || '';
                      return (<td key={col.key} style={{ padding: '0.4rem 0.5rem', textAlign: 'right', color: val ? COL_AMBER : COL_ZERO, fontSize: '0.75rem', maxWidth: '140px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={val}>{val || '-'}</td>);
                    }
                    const { text, color } = fmtNum(r[col.key] as number, col.color);
                    const is270plus = col.key === 'inv_age_271_to_365_days' || col.key === 'inv_age_366_to_455_days' || col.key === 'inv_age_456_plus_days';
                    return (
                      <td key={col.key} style={{
                        padding: '0.4rem 0.5rem', textAlign: 'right', color,
                        fontVariantNumeric: 'tabular-nums', fontFamily: 'monospace', fontSize: '0.78rem',
                        fontWeight: is270plus && Number(r[col.key]) > 0 ? 700 : 400,
                      }}>{text}</td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
