import { useState, useEffect, useMemo } from 'react';
import axios from 'axios';

interface SalesRow {
  iwasku: string;
  asin: string;
  last7: number; last30: number; last90: number; last180: number; last366: number;
  preYearLast7: number; preYearLast30: number; preYearLast90: number;
  preYearLast180: number; preYearLast365: number;
  preYearNext7: number; preYearNext30: number; preYearNext90: number; preYearNext180: number;
}

const CHANNELS = ['us', 'au', 'ae', 'sa'];

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
const COL_BLUE = '#2563eb';
const COL_PURPLE = '#7c3aed';
const COL_ZERO = '#d1d5db';

type SortKey = keyof SalesRow;

const columns: { key: SortKey; label: string; group: string; color: string }[] = [
  { key: 'iwasku', label: 'SKU', group: 'id', color: '' },
  { key: 'asin', label: 'ASIN', group: 'id', color: '' },
  { key: 'last7', label: '7', group: 'current', color: COL_GREEN },
  { key: 'last30', label: '30', group: 'current', color: COL_GREEN },
  { key: 'last90', label: '90', group: 'current', color: COL_GREEN },
  { key: 'last180', label: '180', group: 'current', color: COL_GREEN },
  { key: 'last366', label: '366', group: 'current', color: COL_GREEN },
  { key: 'preYearLast7', label: '7', group: 'pyLast', color: COL_BLUE },
  { key: 'preYearLast30', label: '30', group: 'pyLast', color: COL_BLUE },
  { key: 'preYearLast90', label: '90', group: 'pyLast', color: COL_BLUE },
  { key: 'preYearLast180', label: '180', group: 'pyLast', color: COL_BLUE },
  { key: 'preYearLast365', label: '365', group: 'pyLast', color: COL_BLUE },
  { key: 'preYearNext7', label: '7', group: 'pyNext', color: COL_PURPLE },
  { key: 'preYearNext30', label: '30', group: 'pyNext', color: COL_PURPLE },
  { key: 'preYearNext90', label: '90', group: 'pyNext', color: COL_PURPLE },
  { key: 'preYearNext180', label: '180', group: 'pyNext', color: COL_PURPLE },
];

const groupHeaders = [
  { label: '', span: 2 },
  { label: 'Current', span: 5, color: COL_GREEN },
  { label: 'PY Last', span: 5, color: COL_BLUE },
  { label: 'PY Next', span: 4, color: COL_PURPLE },
];

export default function SalesAnalysis() {
  const [channel, setChannel] = useState('us');
  const [rows, setRows] = useState<SalesRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('last30');
  const [sortAsc, setSortAsc] = useState(false);

  const fetchData = async (ch: string) => {
    setLoading(true);
    try {
      const res = await axios.get(`/api/v1/amazonsales/${ch}`);
      setRows(Array.isArray(res.data) ? res.data : []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(channel); }, [channel]);

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
      if (sortKey !== 'iwasku' && sortKey !== 'asin') {
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

  const fmtNum = (v: number | null | undefined, color: string) => {
    const n = Number(v) || 0;
    return {
      text: n === 0 ? '-' : n.toLocaleString(),
      color: n === 0 ? COL_ZERO : color,
    };
  };

  const thBase = {
    padding: '0.3rem 0.4rem',
    cursor: 'pointer',
    userSelect: 'none' as const,
    whiteSpace: 'nowrap' as const,
    fontSize: '0.75rem',
    fontWeight: 600,
  };

  const tdBase = {
    padding: '0.25rem 0.4rem',
    fontVariantNumeric: 'tabular-nums' as const,
    fontFamily: 'monospace',
    fontSize: '0.75rem',
  };

  return (
    <div style={{ margin: '0 -2rem' }}>
      <h1 style={{ marginBottom: '1rem', padding: '0 2rem' }}>Sales Analysis</h1>

      {/* Channel tabs + search */}
      <div style={{ ...cardStyle, margin: '0 2rem 1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            {CHANNELS.map(ch => (
              <button key={ch} onClick={() => setChannel(ch)} style={tabStyle(channel === ch)}>
                {ch.toUpperCase()}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search SKU / ASIN..."
              style={{ padding: '0.4rem 0.5rem', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '0.85rem', minWidth: '180px' }}
            />
            <span style={{ fontSize: '0.8rem', color: '#64748b' }}>{filtered.length} items</span>
          </div>
        </div>
      </div>

      {/* Table */}
      <div style={{ background: '#fff', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)', margin: '0 2rem', padding: '0' }}>
        {loading ? (
          <p style={{ padding: '1.5rem', color: '#64748b' }}>Loading...</p>
        ) : filtered.length === 0 ? (
          <p style={{ padding: '1.5rem', color: '#64748b' }}>No sales data found.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
            <colgroup>
              <col style={{ width: '110px' }} />
              <col style={{ width: '105px' }} />
              {columns.filter(c => c.group !== 'id').map(c => (
                <col key={c.key} style={{ width: `${(1 / 14) * 100}%` }} />
              ))}
            </colgroup>
            {/* Group headers */}
            <thead>
              <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
                {groupHeaders.map((g, i) => (
                  <th
                    key={i}
                    colSpan={g.span}
                    style={{
                      padding: '0.3rem 0.4rem',
                      textAlign: 'center',
                      fontSize: '0.68rem',
                      fontWeight: 600,
                      color: g.color || '#64748b',
                      letterSpacing: '0.04em',
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
                      ...thBase,
                      textAlign: col.group === 'id' ? 'left' : 'right',
                      color: col.color || '#475569',
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
                            ...tdBase,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                          title={String(r[col.key])}
                        >
                          {r[col.key]}
                        </td>
                      );
                    }
                    const { text, color } = fmtNum(r[col.key] as number, col.color);
                    return (
                      <td key={col.key} style={{ ...tdBase, textAlign: 'right', color }}>
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
