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
      <h1 className="mb-6">Inventory Aging</h1>

      {/* Warehouse tabs + search + upload */}
      <div className="bg-white rounded-lg p-6 shadow-sm mb-4">
        <div className="flex justify-between items-center flex-wrap gap-3">
          <div className="flex gap-2">
            {WAREHOUSES.map(wh => (
              <button
                key={wh}
                onClick={() => setWarehouse(wh)}
                className={`px-4 py-2 border border-gray-300 rounded-md cursor-pointer text-sm ${
                  warehouse === wh ? 'bg-slate-700 text-white font-semibold' : 'bg-slate-100 text-slate-600'
                }`}
              >
                {wh}
              </button>
            ))}
          </div>
          <div className="flex gap-2 items-center">
            <input
              type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search SKU / ASIN / Name..."
              className="px-2 py-1.5 border border-gray-300 rounded-md text-sm min-w-[200px]"
            />
            <input ref={fileRef} type="file" accept=".txt,.csv,.tsv" className="hidden"
              onChange={e => { if (e.target.files?.[0]) handleUpload(e.target.files[0]); }}
            />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className={`px-4 py-1.5 bg-[#6366f1] text-white border-none rounded-md cursor-pointer text-sm ${uploading ? 'opacity-70' : ''}`}
            >
              {uploading ? 'Uploading...' : 'Upload CSV'}
            </button>
            <span className="text-xs text-slate-500">{filtered.length} items</span>
          </div>
        </div>
        {uploadMsg && (
          <div className={`mt-2 text-sm ${uploadMsg.startsWith('Upload failed') ? 'text-red-600' : 'text-emerald-600'}`}>
            {uploadMsg}
          </div>
        )}
      </div>

      {/* Summary cards */}
      {!loading && rows.length > 0 && (
        <div className="grid grid-cols-6 gap-4 mb-4">
          {summaryCards.map(card => (
            <div key={card.label} className="bg-white rounded-lg p-6 shadow-sm text-center">
              <div className="text-xs text-slate-500 mb-1">{card.label}</div>
              <div className="text-xl font-bold" style={{ color: card.color }}>
                {card.fmt === 'usd' ? fmtUsd(card.value) : card.value.toLocaleString()}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 270+ Warning */}
      {!loading && age270plus > 0 && (
        <div className="bg-red-50 border border-[#fecaca] rounded-lg px-4 py-3 mb-4 text-red-600 text-sm font-medium">
          {skus270plus} SKU has inventory aged 270+ days ({age270plus.toLocaleString()} units). Est. next month storage: {fmtUsd(summary.storage_cost)}
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-lg shadow-sm overflow-x-auto p-0 mb-4">
        {loading ? (
          <p className="p-6 text-slate-500">Loading...</p>
        ) : filtered.length === 0 ? (
          <p className="p-6 text-slate-500">No data. Upload a Seller Central inventory aging CSV to get started.</p>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b-2 border-slate-200">
                {columns.map(col => (
                  <th key={col.key} onClick={() => handleSort(col.key)}
                    className={`p-2 cursor-pointer select-none whitespace-nowrap text-[0.78rem] ${
                      col.sticky ? 'text-left sticky bg-white z-[2]' : 'text-right'
                    }`}
                    style={{
                      color: col.color || '#475569',
                      left: col.sticky ? (col.key === 'iwasku' ? 0 : '130px') : undefined,
                      minWidth: col.sticky ? '130px' : col.key === 'recommended_action' ? '120px' : '55px',
                    }}>
                    {col.label} {sortKey === col.key ? (sortAsc ? '\u2191' : '\u2193') : ''}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => (
                <tr key={i} className="border-b border-slate-100">
                  {columns.map(col => {
                    if (col.sticky) {
                      return (
                        <td key={col.key}
                          className="px-2 py-1.5 whitespace-nowrap font-mono text-[0.78rem] sticky bg-white z-[1] max-w-[130px] overflow-hidden text-ellipsis"
                          style={{ left: col.key === 'iwasku' ? 0 : '130px' }}
                          title={String(r[col.key] ?? '')}>
                          {r[col.key]}
                        </td>
                      );
                    }
                    if (col.key === 'estimated_storage_cost') {
                      const n = Number(r[col.key]) || 0;
                      return (
                        <td key={col.key} className="px-2 py-1.5 text-right font-mono text-[0.78rem]" style={{ color: n > 0 ? COL_RED : COL_ZERO, fontVariantNumeric: 'tabular-nums' }}>
                          {n === 0 ? '-' : `$${n.toFixed(2)}`}
                        </td>
                      );
                    }
                    if (col.key === 'sell_through') {
                      const n = Number(r[col.key]) || 0;
                      return (
                        <td key={col.key} className="px-2 py-1.5 text-right font-mono text-[0.78rem]" style={{ color: n > 0 ? COL_GRAY : COL_ZERO, fontVariantNumeric: 'tabular-nums' }}>
                          {n === 0 ? '-' : n.toFixed(2)}
                        </td>
                      );
                    }
                    if (col.key === 'recommended_action') {
                      const val = r[col.key] || '';
                      return (
                        <td key={col.key} className="px-2 py-1.5 text-right text-xs max-w-[140px] overflow-hidden text-ellipsis whitespace-nowrap" style={{ color: val ? COL_AMBER : COL_ZERO }} title={val}>
                          {val || '-'}
                        </td>
                      );
                    }
                    const { text, color } = fmtNum(r[col.key] as number, col.color);
                    const is270plus = col.key === 'inv_age_271_to_365_days' || col.key === 'inv_age_366_to_455_days' || col.key === 'inv_age_456_plus_days';
                    return (
                      <td key={col.key}
                        className="px-2 py-1.5 text-right font-mono text-[0.78rem]"
                        style={{
                          color,
                          fontVariantNumeric: 'tabular-nums',
                          fontWeight: is270plus && Number(r[col.key]) > 0 ? 700 : 400,
                        }}>
                        {text}
                      </td>
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
