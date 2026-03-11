import { useState, useEffect, useMemo } from 'react';
import axios from 'axios';

interface CGProduct { partNumber: string; quantity: number; price: number; totalCost?: number; }
interface CGOrder { id: string; poNumber: string; poDate: string; products: CGProduct[]; }
interface DSProduct { partNumber: string; quantity: number; price: number; }
interface DSOrder { poNumber: string; poDate: string; products: DSProduct[]; }

type MappingMap = Record<string, string>;

interface AggRow {
  partNumber: string;
  iwasku: string | null;
  totalQty: number;
  totalCost: number;
  poCount: number;
  avgPrice: number;
}

const cardStyle = {
  background: '#fff',
  borderRadius: '8px',
  padding: '1.5rem',
  boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
  marginBottom: '1rem',
} as const;

const COL_GREEN = '#059669';
const COL_BLUE = '#2563eb';
const COL_ZERO = '#d1d5db';

type SortKey = keyof AggRow;

export default function WayfairOrdersAnalysis() {
  const [tab, setTab] = useState<'castlegate' | 'dropship'>('castlegate');
  const [cgOrders, setCgOrders] = useState<CGOrder[]>([]);
  const [dsOrders, setDsOrders] = useState<DSOrder[]>([]);
  const [mappings, setMappings] = useState<MappingMap>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('totalQty');
  const [sortAsc, setSortAsc] = useState(false);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      axios.get('/api/v1/wayfair/orders').then(r => setCgOrders(r.data.data)).catch(() => {}),
      axios.get('/api/v1/wayfair/orders/dropship').then(r => setDsOrders(r.data.data)).catch(() => {}),
      axios.get('/api/v1/wayfair/mappings/all').then(r => setMappings(r.data.data || {})).catch(() => {}),
    ]).finally(() => setLoading(false));
  }, []);

  const aggregate = (orders: Array<{ products: Array<{ partNumber: string; quantity: number; price: number; totalCost?: number }> }>) => {
    const map = new Map<string, { totalQty: number; totalCost: number; poNumbers: Set<string>; prices: number[] }>();
    for (const order of orders) {
      const poNum = (order as any).poNumber || (order as any).id || '';
      for (const p of order.products || []) {
        const existing = map.get(p.partNumber);
        if (existing) {
          existing.totalQty += p.quantity;
          existing.totalCost += (p as any).totalCost ?? p.price * p.quantity;
          existing.poNumbers.add(poNum);
          existing.prices.push(p.price);
        } else {
          map.set(p.partNumber, {
            totalQty: p.quantity,
            totalCost: (p as any).totalCost ?? p.price * p.quantity,
            poNumbers: new Set([poNum]),
            prices: [p.price],
          });
        }
      }
    }
    const rows: AggRow[] = [];
    for (const [partNumber, v] of map) {
      rows.push({
        partNumber,
        iwasku: mappings[partNumber] || null,
        totalQty: v.totalQty,
        totalCost: v.totalCost,
        poCount: v.poNumbers.size,
        avgPrice: v.prices.length > 0 ? v.prices.reduce((a, b) => a + b, 0) / v.prices.length : 0,
      });
    }
    return rows;
  };

  const cgAgg = useMemo(() => aggregate(cgOrders), [cgOrders, mappings]);
  const dsAgg = useMemo(() => aggregate(dsOrders), [dsOrders, mappings]);
  const rows = tab === 'castlegate' ? cgAgg : dsAgg;

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(false); }
  };

  const filtered = useMemo(() => {
    let data = rows;
    if (search) {
      const q = search.toLowerCase();
      data = data.filter(r => r.partNumber.toLowerCase().includes(q) || (r.iwasku && r.iwasku.toLowerCase().includes(q)));
    }
    return [...data].sort((a, b) => {
      const av = a[sortKey] ?? '';
      const bv = b[sortKey] ?? '';
      if (sortKey === 'partNumber' || sortKey === 'iwasku') {
        return sortAsc ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
      }
      return sortAsc ? (Number(av) || 0) - (Number(bv) || 0) : (Number(bv) || 0) - (Number(av) || 0);
    });
  }, [rows, search, sortKey, sortAsc]);

  // Summary
  const summary = useMemo(() => {
    const totalParts = filtered.length;
    const totalQty = filtered.reduce((s, r) => s + r.totalQty, 0);
    const totalCost = filtered.reduce((s, r) => s + r.totalCost, 0);
    const matched = filtered.filter(r => r.iwasku).length;
    return { totalParts, totalQty, totalCost, matched, unmatched: totalParts - matched };
  }, [filtered]);

  const summaryCards = [
    { label: 'Part Numbers', value: summary.totalParts.toLocaleString(), color: '#334155' },
    { label: 'Total Qty', value: summary.totalQty.toLocaleString(), color: COL_GREEN },
    { label: 'Total Cost', value: `$${summary.totalCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, color: COL_BLUE },
    { label: 'Matched', value: `${summary.matched} / ${summary.totalParts}`, color: summary.unmatched > 0 ? '#d97706' : COL_GREEN },
  ];

  const thStyle = (_key: SortKey, align: string = 'left') => ({
    textAlign: align as any,
    padding: '0.5rem',
    cursor: 'pointer',
    userSelect: 'none' as const,
    whiteSpace: 'nowrap' as const,
    fontSize: '0.82rem',
    fontWeight: 600,
  });

  return (
    <div>
      <h1 style={{ marginBottom: '1rem' }}>Wayfair Orders Analysis</h1>

      {/* CG / DS subtab */}
      <div style={{ display: 'flex', gap: '0.25rem', marginBottom: '1.25rem', borderBottom: '2px solid #e2e8f0' }}>
        {(['castlegate', 'dropship'] as const).map(t => (
          <button key={t} onClick={() => { setTab(t); setSearch(''); }}
            style={{
              padding: '0.4rem 1.1rem', border: 'none', background: 'none', cursor: 'pointer',
              fontSize: '0.875rem', fontWeight: 500,
              color: tab === t ? '#0891b2' : '#64748b',
              borderBottom: tab === t ? '2px solid #0891b2' : '2px solid transparent',
              marginBottom: '-2px',
            }}>
            {t === 'castlegate' ? 'CastleGate' : 'Dropship'}
          </button>
        ))}
      </div>

      {/* Summary cards */}
      {!loading && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem', marginBottom: '1rem' }}>
          {summaryCards.map(card => (
            <div key={card.label} style={{ ...cardStyle, marginBottom: 0, textAlign: 'center' }}>
              <div style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: '0.3rem' }}>{card.label}</div>
              <div style={{ fontSize: '1.4rem', fontWeight: 700, color: card.color }}>{card.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Search */}
      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginBottom: '1rem' }}>
        <input type="text" placeholder="Search part number / iwasku..." value={search} onChange={e => setSearch(e.target.value)}
          style={{ padding: '0.35rem 0.75rem', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '0.85rem', width: '240px' }} />
        <span style={{ fontSize: '0.85rem', color: '#64748b' }}>{filtered.length} items</span>
      </div>

      {/* Table */}
      <div style={{ ...cardStyle, padding: 0 }}>
        {loading ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: '#94a3b8' }}>Loading...</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: '#94a3b8' }}>No order data found.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #e2e8f0' }}>
                <th onClick={() => handleSort('partNumber')} style={thStyle('partNumber')}>
                  Part Number {sortKey === 'partNumber' ? (sortAsc ? '\u2191' : '\u2193') : ''}
                </th>
                <th onClick={() => handleSort('iwasku')} style={thStyle('iwasku')}>
                  IWASKU {sortKey === 'iwasku' ? (sortAsc ? '\u2191' : '\u2193') : ''}
                </th>
                <th onClick={() => handleSort('totalQty')} style={thStyle('totalQty', 'right')}>
                  Total Qty {sortKey === 'totalQty' ? (sortAsc ? '\u2191' : '\u2193') : ''}
                </th>
                <th onClick={() => handleSort('avgPrice')} style={thStyle('avgPrice', 'right')}>
                  Avg Price {sortKey === 'avgPrice' ? (sortAsc ? '\u2191' : '\u2193') : ''}
                </th>
                <th onClick={() => handleSort('totalCost')} style={thStyle('totalCost', 'right')}>
                  Total Cost {sortKey === 'totalCost' ? (sortAsc ? '\u2191' : '\u2193') : ''}
                </th>
                <th onClick={() => handleSort('poCount')} style={thStyle('poCount', 'right')}>
                  POs {sortKey === 'poCount' ? (sortAsc ? '\u2191' : '\u2193') : ''}
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => (
                <tr key={r.partNumber} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '0.5rem', fontFamily: 'monospace', fontSize: '0.82rem' }}>{r.partNumber}</td>
                  <td style={{ padding: '0.5rem', fontFamily: 'monospace', fontSize: '0.82rem', color: r.iwasku ? '#0f172a' : '#94a3b8' }}>{r.iwasku || '—'}</td>
                  <td style={{ padding: '0.5rem', textAlign: 'right', fontWeight: 600, color: r.totalQty > 0 ? COL_GREEN : COL_ZERO }}>{r.totalQty.toLocaleString()}</td>
                  <td style={{ padding: '0.5rem', textAlign: 'right', color: '#475569' }}>${r.avgPrice.toFixed(2)}</td>
                  <td style={{ padding: '0.5rem', textAlign: 'right', fontWeight: 600, color: r.totalCost > 0 ? COL_BLUE : COL_ZERO }}>${r.totalCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                  <td style={{ padding: '0.5rem', textAlign: 'right' }}>{r.poCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
