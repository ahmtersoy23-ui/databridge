import { useState, useEffect, useMemo } from 'react';
import axios from 'axios';

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

const WAREHOUSES = ['US', 'AU', 'AE', 'SA'];

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
      <h1 style={{ marginBottom: '1.5rem' }}>Inventory Analysis</h1>

      {/* Warehouse tabs + search */}
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
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search SKU / ASIN..."
              style={{ padding: '0.4rem 0.5rem', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '0.85rem', minWidth: '200px' }}
            />
            <span style={{ fontSize: '0.8rem', color: '#64748b' }}>{filtered.length} items</span>
          </div>
        </div>
      </div>

      {/* Summary cards */}
      {!loading && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem', marginBottom: '1rem' }}>
          {summaryCards.map(card => (
            <div key={card.label} style={{ ...cardStyle, marginBottom: 0, textAlign: 'center' }}>
              <div style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: '0.3rem' }}>{card.label}</div>
              <div style={{ fontSize: '1.5rem', fontWeight: 700, color: card.color }}>{card.value.toLocaleString()}</div>
            </div>
          ))}
        </div>
      )}

      {/* Table */}
      <div style={{ ...cardStyle, overflowX: 'auto', padding: '0' }}>
        {loading ? (
          <p style={{ padding: '1.5rem', color: '#64748b' }}>Loading...</p>
        ) : filtered.length === 0 ? (
          <p style={{ padding: '1.5rem', color: '#64748b' }}>No inventory data found.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
            {/* Group headers */}
            <thead>
              <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
                {groupHeaders.map((g, i) => (
                  <th
                    key={i}
                    colSpan={g.span}
                    style={{
                      padding: '0.4rem 0.5rem',
                      textAlign: 'center',
                      fontSize: '0.72rem',
                      fontWeight: 600,
                      color: g.color || '#64748b',
                      letterSpacing: '0.05em',
                      textTransform: 'uppercase',
                    }}
                  >
                    {g.label}
                  </th>
                ))}
              </tr>
              {/* Column headers */}
              <tr style={{ borderBottom: '2px solid #e2e8f0' }}>
                {columns.map(col => (
                  <th
                    key={col.key}
                    onClick={() => handleSort(col.key)}
                    style={{
                      padding: '0.5rem',
                      textAlign: col.group === 'id' ? 'left' : 'right',
                      cursor: 'pointer',
                      userSelect: 'none',
                      whiteSpace: 'nowrap',
                      color: col.color || '#475569',
                      fontSize: '0.78rem',
                      position: col.group === 'id' ? 'sticky' as const : undefined,
                      left: col.key === 'iwasku' ? 0 : col.key === 'asin' ? '130px' : undefined,
                      background: col.group === 'id' ? '#fff' : undefined,
                      zIndex: col.group === 'id' ? 2 : undefined,
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
                <tr key={i} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  {columns.map(col => {
                    if (col.group === 'id') {
                      return (
                        <td
                          key={col.key}
                          style={{
                            padding: '0.4rem 0.5rem',
                            whiteSpace: 'nowrap',
                            fontFamily: 'monospace',
                            fontSize: '0.78rem',
                            position: 'sticky',
                            left: col.key === 'iwasku' ? 0 : '130px',
                            background: '#fff',
                            zIndex: 1,
                            maxWidth: '130px',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
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
                        style={{
                          padding: '0.4rem 0.5rem',
                          textAlign: 'right',
                          color,
                          fontVariantNumeric: 'tabular-nums',
                          fontFamily: 'monospace',
                          fontSize: '0.78rem',
                        }}
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
