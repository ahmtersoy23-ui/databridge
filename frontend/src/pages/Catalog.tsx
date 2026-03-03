import { useState, useEffect, useMemo } from 'react';
import axios from 'axios';

interface WisersellProduct {
  id: number;
  name: string | null;
  code: string | null;
  weight: number | null;
  deci: number | null;
  width: number | null;
  length: number | null;
  height: number | null;
  arr_sku: string[] | null;
  category_id: number | null;
  category_name: string | null;
  size: string | null;
  color: string | null;
  synced_at: string | null;
}

const cardStyle = {
  background: '#fff',
  borderRadius: '8px',
  padding: '1.5rem',
  boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
  marginBottom: '1rem',
} as const;

const COL_GRAY = '#6b7280';
const COL_ZERO = '#d1d5db';
const PAGE_SIZE = 200;

type SortKey = 'id' | 'name' | 'code' | 'deci' | 'category_name' | 'size' | 'color' | 'weight' | 'identifier' | 'parent_name';

export default function Catalog() {
  const [rows, setRows] = useState<WisersellProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('code');
  const [sortAsc, setSortAsc] = useState(true);
  const [page, setPage] = useState(0);

  useEffect(() => {
    setLoading(true);
    axios.get('/api/v1/catalog')
      .then(res => setRows(Array.isArray(res.data) ? res.data : []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, []);

  // Reset to page 0 when search or sort changes
  useEffect(() => { setPage(0); }, [search, sortKey, sortAsc]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(true); }
  };

  const sortArrow = (key: SortKey) => sortKey === key ? (sortAsc ? ' ↑' : ' ↓') : '';

  const summary = useMemo(() => ({
    total: rows.length,
    withCode: rows.filter(r => r.code).length,
    withSkus: rows.filter(r => r.arr_sku && r.arr_sku.length > 0).length,
  }), [rows]);

  const filtered = useMemo(() => {
    let data = rows;
    if (search) {
      const q = search.toLowerCase();
      data = data.filter(r =>
        r.name?.toLowerCase().includes(q) ||
        r.code?.toLowerCase().includes(q) ||
        r.arr_sku?.some(s => s.toLowerCase().includes(q)) ||
        r.category_name?.toLowerCase().includes(q) ||
        r.size?.toLowerCase().includes(q) ||
        r.color?.toLowerCase().includes(q)
      );
    }
    const withComputed = data.map(r => {
      const m = r.code?.match(/^([A-Za-z]+)([0-9]{3})/);
      const identifier = m ? `${m[1]}-${m[2]}` : null;
      const parent_name = identifier && r.name
        ? r.name.replace(/^[A-Za-z]+-?\s*[0-9]{3}\s+/i, '') || r.name
        : r.name;
      return { ...r, identifier, parent_name };
    });
    return [...withComputed].sort((a, b) => {
      const av = (a as any)[sortKey] ?? '';
      const bv = (b as any)[sortKey] ?? '';
      if (sortKey === 'id' || sortKey === 'deci' || sortKey === 'weight') {
        return sortAsc ? Number(av) - Number(bv) : Number(bv) - Number(av);
      }
      return sortAsc
        ? String(av).localeCompare(String(bv))
        : String(bv).localeCompare(String(av));
    });
  }, [rows, search, sortKey, sortAsc]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const pageRows = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const thStyle = (_key: SortKey, align: 'left' | 'right' = 'left') => ({
    padding: '0.5rem',
    textAlign: align as 'left' | 'right',
    cursor: 'pointer' as const,
    userSelect: 'none' as const,
    whiteSpace: 'nowrap' as const,
    color: '#475569',
    fontSize: '0.8rem',
    fontWeight: 600,
  });

  const thStylePlain = (align: 'left' | 'right' = 'left') => ({
    padding: '0.5rem',
    textAlign: align as 'left' | 'right',
    cursor: 'default' as const,
    whiteSpace: 'nowrap' as const,
    color: '#475569',
    fontSize: '0.8rem',
    fontWeight: 600,
  });

  return (
    <div>
      <h1 style={{ marginBottom: '1.5rem' }}>Catalog</h1>

      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', marginBottom: '1rem' }}>
        {[
          { label: 'Total Products', value: summary.total, color: '#334155' },
          { label: 'With Code', value: summary.withCode, color: '#059669' },
          { label: 'With SKUs', value: summary.withSkus, color: '#2563eb' },
        ].map(c => (
          <div key={c.label} style={{ ...cardStyle, marginBottom: 0, textAlign: 'center' }}>
            <div style={{ fontSize: '0.75rem', color: COL_GRAY, marginBottom: '0.25rem' }}>{c.label}</div>
            <div style={{ fontSize: '1.5rem', fontWeight: 700, color: c.color }}>{c.value.toLocaleString()}</div>
          </div>
        ))}
      </div>

      {/* Search + pagination info */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search name / code / SKU / category / size / color..."
            style={{ padding: '0.4rem 0.6rem', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '0.85rem', flex: 1 }}
          />
          <span style={{ fontSize: '0.8rem', color: COL_GRAY, whiteSpace: 'nowrap' }}>
            {filtered.length.toLocaleString()} items
          </span>
          {totalPages > 1 && (
            <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', whiteSpace: 'nowrap' }}>
              <button
                onClick={() => setPage(p => Math.max(0, p - 1))}
                disabled={page === 0}
                style={{ padding: '0.25rem 0.6rem', border: '1px solid #d1d5db', borderRadius: '4px', cursor: page === 0 ? 'default' : 'pointer', background: '#fff', color: page === 0 ? COL_ZERO : '#334155', fontSize: '0.8rem' }}
              >‹</button>
              <span style={{ fontSize: '0.8rem', color: COL_GRAY }}>
                {page + 1} / {totalPages}
              </span>
              <button
                onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                style={{ padding: '0.25rem 0.6rem', border: '1px solid #d1d5db', borderRadius: '4px', cursor: page >= totalPages - 1 ? 'default' : 'pointer', background: '#fff', color: page >= totalPages - 1 ? COL_ZERO : '#334155', fontSize: '0.8rem' }}
              >›</button>
            </div>
          )}
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
                <th onClick={() => handleSort('identifier')} style={thStyle('identifier')}>Identifier{sortArrow('identifier')}</th>
                <th onClick={() => handleSort('parent_name')} style={thStyle('parent_name')}>Parent Name{sortArrow('parent_name')}</th>
                <th onClick={() => handleSort('code')} style={thStyle('code')}>Code{sortArrow('code')}</th>
                <th onClick={() => handleSort('category_name')} style={thStyle('category_name')}>Category{sortArrow('category_name')}</th>
                <th onClick={() => handleSort('size')} style={thStyle('size')}>Size{sortArrow('size')}</th>
                <th onClick={() => handleSort('color')} style={thStyle('color')}>Color{sortArrow('color')}</th>
                <th onClick={() => handleSort('weight')} style={thStyle('weight', 'right')}>Weight{sortArrow('weight')}</th>
                <th onClick={() => handleSort('deci')} style={thStyle('deci', 'right')}>Deci{sortArrow('deci')}</th>
                <th style={thStylePlain('right')}>W</th>
                <th style={thStylePlain('right')}>L</th>
                <th style={thStylePlain('right')}>H</th>
                <th style={thStylePlain()}>SKUs</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map(r => {
                const row = r as any;
                return (
                <tr key={r.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '0.4rem 0.5rem', fontFamily: 'monospace', fontSize: '0.78rem', color: row.identifier ? '#1e293b' : COL_ZERO, whiteSpace: 'nowrap' }}>
                    {row.identifier || '—'}
                  </td>
                  <td style={{ padding: '0.4rem 0.5rem', maxWidth: '220px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={row.parent_name ?? ''}>
                    {row.parent_name || '—'}
                  </td>
                  <td style={{ padding: '0.4rem 0.5rem', fontFamily: 'monospace', fontSize: '0.78rem', color: r.code ? '#1e293b' : COL_ZERO }}>
                    {r.code || '—'}
                  </td>
                  <td style={{ padding: '0.4rem 0.5rem', color: r.category_name ? '#1e293b' : COL_ZERO, whiteSpace: 'nowrap' }}>
                    {r.category_name || '—'}
                  </td>
                  <td style={{ padding: '0.4rem 0.5rem', color: r.size ? '#1e293b' : COL_ZERO }}>
                    {r.size || '—'}
                  </td>
                  <td style={{ padding: '0.4rem 0.5rem', color: r.color ? '#1e293b' : COL_ZERO }}>
                    {r.color || '—'}
                  </td>
                  <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right', fontFamily: 'monospace', fontSize: '0.75rem', color: r.weight ? '#334155' : COL_ZERO }}>
                    {r.weight != null ? `${Number(r.weight).toFixed(1)} kg` : '—'}
                  </td>
                  <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right', fontFamily: 'monospace', color: r.deci ? '#1e293b' : COL_ZERO }}>
                    {r.deci ?? '—'}
                  </td>
                  <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right', fontFamily: 'monospace', fontSize: '0.75rem', color: r.width ? '#334155' : COL_ZERO }}>
                    {r.width != null ? Number(r.width).toFixed(1) : '—'}
                  </td>
                  <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right', fontFamily: 'monospace', fontSize: '0.75rem', color: r.length ? '#334155' : COL_ZERO }}>
                    {r.length != null ? Number(r.length).toFixed(1) : '—'}
                  </td>
                  <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right', fontFamily: 'monospace', fontSize: '0.75rem', color: r.height ? '#334155' : COL_ZERO }}>
                    {r.height != null ? Number(r.height).toFixed(1) : '—'}
                  </td>
                  <td style={{ padding: '0.4rem 0.5rem', fontFamily: 'monospace', fontSize: '0.75rem', color: r.arr_sku?.length ? '#334155' : COL_ZERO }}>
                    {r.arr_sku?.length ? r.arr_sku.join(', ') : '—'}
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
