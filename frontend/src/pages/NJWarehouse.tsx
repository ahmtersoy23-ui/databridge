import { useState, useEffect, useMemo } from 'react';
import axios from 'axios';

interface NJRow {
  fnsku: string;
  iwasku: string | null;
  asin: string | null;
  name: string;
  category: string;
  total_count: number;
  count_in_raf: number;
  count_in_ship: number;
}

const cardStyle = {
  background: '#fff',
  borderRadius: '8px',
  padding: '1.5rem',
  boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
  marginBottom: '1rem',
} as const;

type SortKey = keyof NJRow;

export default function NJWarehouse() {
  const [rows, setRows] = useState<NJRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('total_count');
  const [sortAsc, setSortAsc] = useState(false);

  useEffect(() => {
    setLoading(true);
    axios.get('/api/v1/amazonfba/NJ')
      .then(res => setRows(Array.isArray(res.data) ? res.data : []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, []);

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
        r.fnsku?.toLowerCase().includes(q) ||
        r.name?.toLowerCase().includes(q) ||
        r.category?.toLowerCase().includes(q)
      );
    }
    return [...data].sort((a, b) => {
      const av = a[sortKey] ?? '';
      const bv = b[sortKey] ?? '';
      if (sortKey === 'total_count' || sortKey === 'count_in_raf' || sortKey === 'count_in_ship') {
        return sortAsc ? Number(av) - Number(bv) : Number(bv) - Number(av);
      }
      return sortAsc
        ? String(av).localeCompare(String(bv))
        : String(bv).localeCompare(String(av));
    });
  }, [rows, search, sortKey, sortAsc]);

  const summary = useMemo(() => ({
    total: rows.length,
    enriched: rows.filter(r => r.iwasku).length,
    totalCount: rows.reduce((s, r) => s + (Number(r.total_count) || 0), 0),
    totalRaf: rows.reduce((s, r) => s + (Number(r.count_in_raf) || 0), 0),
    totalShip: rows.reduce((s, r) => s + (Number(r.count_in_ship) || 0), 0),
  }), [rows]);

  const COL_GRAY = '#6b7280';
  const COL_ZERO = '#d1d5db';
  const COL_GREEN = '#059669';
  const COL_BLUE = '#2563eb';
  const COL_ORANGE = '#d97706';

  const thStyle = (key: SortKey, align: 'left' | 'right' = 'right') => ({
    padding: '0.5rem',
    textAlign: align as 'left' | 'right',
    cursor: 'pointer' as const,
    userSelect: 'none' as const,
    whiteSpace: 'nowrap' as const,
    color: '#475569',
    fontSize: '0.8rem',
    fontWeight: 600,
  });

  const sortArrow = (key: SortKey) => sortKey === key ? (sortAsc ? ' ↑' : ' ↓') : '';

  return (
    <div>
      <h1 style={{ marginBottom: '1.5rem' }}>NJ Warehouse</h1>

      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '1rem', marginBottom: '1rem' }}>
        {[
          { label: 'Total SKUs', value: summary.total, color: '#334155' },
          { label: 'Enriched (iwasku)', value: summary.enriched, color: COL_GREEN },
          { label: 'Total Count', value: summary.totalCount, color: '#334155' },
          { label: 'In Raf', value: summary.totalRaf, color: COL_BLUE },
          { label: 'In Shipment', value: summary.totalShip, color: COL_ORANGE },
        ].map(c => (
          <div key={c.label} style={{ ...cardStyle, marginBottom: 0, textAlign: 'center' }}>
            <div style={{ fontSize: '0.75rem', color: COL_GRAY, marginBottom: '0.25rem' }}>{c.label}</div>
            <div style={{ fontSize: '1.5rem', fontWeight: 700, color: c.color }}>{c.value.toLocaleString()}</div>
          </div>
        ))}
      </div>

      {/* Search + count */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search SKU / ASIN / FNSKU / Name / Category..."
            style={{ padding: '0.4rem 0.6rem', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '0.85rem', flex: 1 }}
          />
          <span style={{ fontSize: '0.8rem', color: COL_GRAY, whiteSpace: 'nowrap' }}>{filtered.length} items</span>
        </div>
      </div>

      {/* Table */}
      <div style={{ ...cardStyle, overflowX: 'auto', padding: 0 }}>
        {loading ? (
          <p style={{ padding: '1.5rem', color: COL_GRAY }}>Loading...</p>
        ) : filtered.length === 0 ? (
          <p style={{ padding: '1.5rem', color: COL_GRAY }}>No data found.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #e2e8f0', background: '#f8fafc' }}>
                <th onClick={() => handleSort('iwasku')} style={thStyle('iwasku', 'left')}>IWA SKU{sortArrow('iwasku')}</th>
                <th onClick={() => handleSort('asin')} style={thStyle('asin', 'left')}>ASIN{sortArrow('asin')}</th>
                <th onClick={() => handleSort('fnsku')} style={thStyle('fnsku', 'left')}>FNSKU{sortArrow('fnsku')}</th>
                <th onClick={() => handleSort('name')} style={thStyle('name', 'left')}>Name{sortArrow('name')}</th>
                <th onClick={() => handleSort('category')} style={thStyle('category', 'left')}>Category{sortArrow('category')}</th>
                <th onClick={() => handleSort('total_count')} style={{ ...thStyle('total_count'), color: '#334155' }}>Total{sortArrow('total_count')}</th>
                <th onClick={() => handleSort('count_in_raf')} style={{ ...thStyle('count_in_raf'), color: COL_BLUE }}>In Raf{sortArrow('count_in_raf')}</th>
                <th onClick={() => handleSort('count_in_ship')} style={{ ...thStyle('count_in_ship'), color: COL_ORANGE }}>In Ship{sortArrow('count_in_ship')}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '0.4rem 0.5rem', fontFamily: 'monospace', fontSize: '0.78rem', color: r.iwasku ? '#1e293b' : COL_ZERO }}>
                    {r.iwasku || '—'}
                  </td>
                  <td style={{ padding: '0.4rem 0.5rem', fontFamily: 'monospace', fontSize: '0.78rem', color: r.asin ? '#1e293b' : COL_ZERO }}>
                    {r.asin || '—'}
                  </td>
                  <td style={{ padding: '0.4rem 0.5rem', fontFamily: 'monospace', fontSize: '0.78rem', color: COL_GRAY }}>
                    {r.fnsku}
                  </td>
                  <td style={{ padding: '0.4rem 0.5rem', maxWidth: '220px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.name}>
                    {r.name}
                  </td>
                  <td style={{ padding: '0.4rem 0.5rem', color: COL_GRAY, fontSize: '0.78rem' }}>
                    {r.category}
                  </td>
                  <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums', fontFamily: 'monospace', color: Number(r.total_count) > 0 ? '#1e293b' : COL_ZERO }}>
                    {Number(r.total_count) > 0 ? r.total_count.toLocaleString() : '—'}
                  </td>
                  <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontFamily: 'monospace', color: Number(r.count_in_raf) > 0 ? COL_BLUE : COL_ZERO }}>
                    {Number(r.count_in_raf) > 0 ? r.count_in_raf.toLocaleString() : '—'}
                  </td>
                  <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontFamily: 'monospace', color: Number(r.count_in_ship) > 0 ? COL_ORANGE : COL_ZERO }}>
                    {Number(r.count_in_ship) > 0 ? r.count_in_ship.toLocaleString() : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
