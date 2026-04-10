import { useState, useEffect, useMemo } from 'react';
import axios from 'axios';

interface AgingSummary {
  age_0_90: number;
  age_91_180: number;
  age_181_270: number;
  age_271_365: number;
  age_366_455: number;
  age_456_plus: number;
  total_storage_cost: number;
  unique_skus: number;
  skus_270_plus: number;
}

interface InvRow {
  iwasku: string;
  asin: string;
  fnsku: string;
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
}

const WAREHOUSES = ['US', 'AU', 'AE', 'SA', 'UK', 'EU'];

const COL_GREEN = '#059669';
const COL_ORANGE = '#d97706';
const COL_RED = '#dc2626';
const COL_BLUE = '#2563eb';
const COL_GRAY = '#6b7280';
const COL_ZERO = '#9ca3af';

type SortKey = keyof InvRow;

const columns: { key: SortKey; label: string; group: string; color: string }[] = [
  { key: 'iwasku', label: 'IWA SKU', group: 'id', color: '' },
  { key: 'asin', label: 'ASIN', group: 'id', color: '' },
  { key: 'fulfillable_quantity', label: 'Fulfillable', group: 'main', color: COL_GREEN },
  { key: 'total_reserved_quantity', label: 'Reserved', group: 'main', color: COL_ORANGE },
  { key: 'fc_processing_quantity', label: 'FC Process', group: 'main', color: COL_GRAY },
  { key: 'pending_customer_order_quantity', label: 'Pend Cust', group: 'pending', color: COL_GRAY },
  { key: 'pending_transshipment_quantity', label: 'Pend Trans', group: 'pending', color: COL_GRAY },
  { key: 'customer_damaged_quantity', label: 'Cust Dmg', group: 'damaged', color: COL_RED },
  { key: 'warehouse_damaged_quantity', label: 'WH Dmg', group: 'damaged', color: COL_RED },
  { key: 'distributor_damaged_quantity', label: 'Dist Dmg', group: 'damaged', color: COL_RED },
  { key: 'total_unfulfillable_quantity', label: 'Unfulfill', group: 'damaged', color: COL_RED },
  { key: 'inbound_shipped_quantity', label: 'Inb Ship', group: 'inbound', color: COL_BLUE },
  { key: 'inbound_working_quantity', label: 'Inb Work', group: 'inbound', color: COL_BLUE },
  { key: 'inbound_receiving_quantity', label: 'Inb Recv', group: 'inbound', color: COL_BLUE },
];

const groupHeaders = [
  { label: '', span: 2 },
  { label: 'Main', span: 3, color: COL_GREEN },
  { label: 'Pending', span: 2, color: COL_GRAY },
  { label: 'Damaged / Unfulfillable', span: 4, color: COL_RED },
  { label: 'Inbound', span: 3, color: COL_BLUE },
];

export default function InventoryAnalysis() {
  const [warehouse, setWarehouse] = useState('US');
  const [rows, setRows] = useState<InvRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('fulfillable_quantity');
  const [sortAsc, setSortAsc] = useState(false);
  const [agingSummary, setAgingSummary] = useState<AgingSummary | null>(null);

  const fetchData = async (wh: string) => {
    setLoading(true);
    try {
      const res = await axios.get(`/api/v1/amazonfba/${wh}`);
      setRows(Array.isArray(res.data) ? res.data : []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(warehouse); }, [warehouse]);

  useEffect(() => {
    axios.get(`/api/v1/inventory-aging/summary/${warehouse}`)
      .then(res => setAgingSummary(res.data))
      .catch(() => setAgingSummary(null));
  }, [warehouse]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(false);
    }
  };

  const filtered = useMemo(() => {
    let data = rows;
    if (search) {
      const q = search.toLowerCase();
      data = data.filter(r => r.iwasku?.toLowerCase().includes(q) || r.asin?.toLowerCase().includes(q));
    }
    data = [...data].sort((a, b) => {
      const av = a[sortKey] ?? '';
      const bv = b[sortKey] ?? '';
      if (sortKey !== 'iwasku' && sortKey !== 'asin' && sortKey !== 'fnsku') {
        const na = Number(av) || 0;
        const nb = Number(bv) || 0;
        return sortAsc ? na - nb : nb - na;
      }
      return sortAsc
        ? String(av).localeCompare(String(bv))
        : String(bv).localeCompare(String(av));
    });
    return data;
  }, [rows, search, sortKey, sortAsc]);

  // Summary calculations
  const summary = useMemo(() => {
    const sum = (key: keyof InvRow) => rows.reduce((acc, r) => acc + (Number(r[key]) || 0), 0);
    const fulfillable = sum('fulfillable_quantity');
    const reserved = sum('total_reserved_quantity');
    const unfulfillable = sum('total_unfulfillable_quantity');
    const inboundShip = sum('inbound_shipped_quantity');
    const inboundWork = sum('inbound_working_quantity');
    const inboundRecv = sum('inbound_receiving_quantity');
    const inbound = inboundShip + inboundWork + inboundRecv;
    const total = fulfillable + reserved + unfulfillable + inbound;
    return { total, fulfillable, inbound, unfulfillable };
  }, [rows]);

  const summaryCards = [
    { label: 'Total Stock', value: summary.total, color: '#334155' },
    { label: 'Fulfillable', value: summary.fulfillable, color: COL_GREEN },
    { label: 'Inbound', value: summary.inbound, color: COL_BLUE },
    { label: 'Unfulfillable', value: summary.unfulfillable, color: COL_RED },
  ];

  const fmtNum = (v: number | null | undefined, color: string) => {
    const n = Number(v) || 0;
    return {
      text: n === 0 ? '-' : n.toLocaleString(),
      color: n === 0 ? COL_ZERO : color,
    };
  };

  return (
    <div>
      <h1 className="mb-6">Inventory Analysis</h1>

      {/* Warehouse tabs + search */}
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
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search SKU / ASIN..."
              className="px-2 py-1.5 border border-gray-300 rounded-md text-sm min-w-[200px]"
            />
            <span className="text-xs text-slate-500">{filtered.length} items</span>
          </div>
        </div>
      </div>

      {/* Summary cards */}
      {!loading && (
        <div className="grid grid-cols-4 gap-4 mb-4">
          {summaryCards.map(card => (
            <div key={card.label} className="bg-white rounded-lg p-6 shadow-sm text-center">
              <div className="text-xs text-slate-500 mb-1">{card.label}</div>
              <div className="text-2xl font-bold" style={{ color: card.color }}>{card.value.toLocaleString()}</div>
            </div>
          ))}
        </div>
      )}

      {/* Aging Summary */}
      {!loading && agingSummary && (
        <>
          <div className="bg-white rounded-lg px-6 py-4 shadow-sm mb-2">
            <div className="text-sm font-semibold text-slate-700 mb-3">Inventory Aging</div>
            <div className="grid grid-cols-6 gap-3">
              {[
                { label: '0-90d', value: agingSummary.age_0_90, color: COL_GREEN },
                { label: '91-180d', value: agingSummary.age_91_180, color: COL_ORANGE },
                { label: '181-270d', value: agingSummary.age_181_270, color: '#ea580c' },
                { label: '271-365d', value: agingSummary.age_271_365, color: COL_RED },
                { label: '366-455d', value: agingSummary.age_366_455, color: '#991b1b' },
                { label: '456+d', value: agingSummary.age_456_plus, color: '#991b1b' },
              ].map(item => (
                <div key={item.label} className="text-center">
                  <div className="text-[0.72rem] text-slate-500">{item.label}</div>
                  <div className="text-xl font-bold" style={{ color: item.color, fontVariantNumeric: 'tabular-nums' }}>
                    {(item.value || 0).toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          </div>
          {((agingSummary.age_271_365 || 0) + (agingSummary.age_366_455 || 0) + (agingSummary.age_456_plus || 0)) > 0 && (
            <div className="bg-red-50 border border-[#fecaca] rounded-lg px-4 py-2 mb-4 text-red-600 text-sm font-medium">
              {agingSummary.skus_270_plus} SKU has 270+ day inventory ({((agingSummary.age_271_365 || 0) + (agingSummary.age_366_455 || 0) + (agingSummary.age_456_plus || 0)).toLocaleString()} units). Est. storage: ${Number(agingSummary.total_storage_cost || 0).toFixed(2)}
            </div>
          )}
        </>
      )}

      {/* Table */}
      <div className="bg-white rounded-lg shadow-sm overflow-x-auto p-0 mb-4">
        {loading ? (
          <p className="p-6 text-slate-500">Loading...</p>
        ) : filtered.length === 0 ? (
          <p className="p-6 text-slate-500">No inventory data found.</p>
        ) : (
          <table className="w-full border-collapse text-sm">
            {/* Group headers */}
            <thead>
              <tr className="border-b border-slate-200">
                {groupHeaders.map((g, i) => (
                  <th
                    key={i}
                    colSpan={g.span}
                    className="px-2 py-1.5 text-center text-[0.72rem] font-semibold tracking-wide uppercase"
                    style={{ color: g.color || '#64748b' }}
                  >
                    {g.label}
                  </th>
                ))}
              </tr>
              {/* Column headers */}
              <tr className="border-b-2 border-slate-200">
                {columns.map(col => (
                  <th
                    key={col.key}
                    onClick={() => handleSort(col.key)}
                    className={`p-2 cursor-pointer select-none whitespace-nowrap text-[0.78rem] ${
                      col.group === 'id' ? 'text-left sticky bg-white z-[2]' : 'text-right'
                    }`}
                    style={{
                      color: col.color || '#475569',
                      left: col.group === 'id' ? (col.key === 'iwasku' ? 0 : '130px') : undefined,
                      minWidth: col.group === 'id' ? '130px' : '65px',
                    }}
                  >
                    {col.label} {sortKey === col.key ? (sortAsc ? '\u2191' : '\u2193') : ''}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => (
                <tr key={i} className="border-b border-slate-100">
                  {columns.map(col => {
                    if (col.group === 'id') {
                      return (
                        <td
                          key={col.key}
                          className="px-2 py-1.5 whitespace-nowrap font-mono text-[0.78rem] sticky bg-white z-[1] max-w-[130px] overflow-hidden text-ellipsis"
                          style={{ left: col.key === 'iwasku' ? 0 : '130px' }}
                          title={String(r[col.key])}
                        >
                          {r[col.key]}
                        </td>
                      );
                    }
                    const { text, color } = fmtNum(r[col.key] as number, col.color);
                    return (
                      <td
                        key={col.key}
                        className="px-2 py-1.5 text-right font-mono text-[0.78rem]"
                        style={{ color, fontVariantNumeric: 'tabular-nums' }}
                      >
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
