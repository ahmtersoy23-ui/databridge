import { useState, useEffect, useMemo } from 'react';
import axios from 'axios';

interface WfAccount {
  id: number;
  label: string;
  is_active: boolean;
}

interface AggRow {
  part_number: string;
  iwasku: string | null;
  total_qty: number;
  total_cost: number;
  po_count: number;
  avg_price: number;
}

interface Summary {
  totalParts: number;
  totalQty: number;
  totalCost: number;
  matched: number;
  unmatched: number;
}

const ACCOUNT_LABELS: Record<string, string> = {
  shukran: 'Shukran',
  mdn: 'MDN',
};

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
  const [accounts, setAccounts] = useState<WfAccount[]>([]);
  const [selectedAccount, setSelectedAccount] = useState('shukran');
  const [tab, setTab] = useState<'total' | 'castlegate' | 'dropship'>('total');
  const [rows, setRows] = useState<AggRow[]>([]);
  const [summary, setSummary] = useState<Summary>({ totalParts: 0, totalQty: 0, totalCost: 0, matched: 0, unmatched: 0 });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('total_qty');
  const [sortAsc, setSortAsc] = useState(false);

  useEffect(() => {
    axios.get('/api/v1/wayfair/settings').then(r => {
      const active = (r.data.accounts || []).filter((a: WfAccount) => a.is_active);
      setAccounts(active);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    axios.get('/api/v1/wayfair/orders/analysis', {
      params: { account: selectedAccount, type: tab },
    }).then(r => {
      setRows(r.data.data || []);
      setSummary(r.data.summary || { totalParts: 0, totalQty: 0, totalCost: 0, matched: 0, unmatched: 0 });
    }).catch(() => {
      setRows([]);
    }).finally(() => setLoading(false));
  }, [selectedAccount, tab]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(false); }
  };

  const filtered = useMemo(() => {
    let data = rows;
    if (search) {
      const q = search.toLowerCase();
      data = data.filter(r => r.part_number.toLowerCase().includes(q) || (r.iwasku && r.iwasku.toLowerCase().includes(q)));
    }
    return [...data].sort((a, b) => {
      const av = a[sortKey] ?? '';
      const bv = b[sortKey] ?? '';
      if (sortKey === 'part_number' || sortKey === 'iwasku') {
        return sortAsc ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
      }
      return sortAsc ? (Number(av) || 0) - (Number(bv) || 0) : (Number(bv) || 0) - (Number(av) || 0);
    });
  }, [rows, search, sortKey, sortAsc]);

  const summaryCards = [
    { label: 'Part Numbers', value: summary.totalParts.toLocaleString(), color: '#334155' },
    { label: 'Total Qty', value: summary.totalQty.toLocaleString(), color: COL_GREEN },
    { label: 'Total Cost', value: `$${summary.totalCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, color: COL_BLUE },
    { label: 'Matched', value: `${summary.matched} / ${summary.totalParts}`, color: summary.unmatched > 0 ? '#d97706' : COL_GREEN },
  ];

  const thStyle = (align: string = 'left') => ({
    textAlign: align as any,
    padding: '0.5rem',
    cursor: 'pointer',
    userSelect: 'none' as const,
    whiteSpace: 'nowrap' as const,
    fontSize: '0.82rem',
    fontWeight: 600,
  });

  const sortIcon = (key: SortKey) => sortKey === key ? (sortAsc ? '\u2191' : '\u2193') : '';

  return (
    <div>
      <h1 style={{ marginBottom: '1rem' }}>Wayfair Orders Analysis</h1>

      {accounts.length > 1 && (
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
          {accounts.map(a => (
            <button key={a.label} onClick={() => { setSelectedAccount(a.label); setSearch(''); }}
              style={{
                padding: '0.4rem 1rem', borderRadius: '6px', cursor: 'pointer',
                fontSize: '0.85rem', fontWeight: 600, border: '2px solid',
                background: selectedAccount === a.label ? '#0891b2' : '#fff',
                color: selectedAccount === a.label ? '#fff' : '#334155',
                borderColor: selectedAccount === a.label ? '#0891b2' : '#d1d5db',
              }}>
              {ACCOUNT_LABELS[a.label] || a.label.toUpperCase()}
            </button>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: '0.25rem', marginBottom: '1.25rem', borderBottom: '2px solid #e2e8f0' }}>
        {(['total', 'castlegate', 'dropship'] as const).map(t => (
          <button key={t} onClick={() => { setTab(t); setSearch(''); }}
            style={{
              padding: '0.4rem 1.1rem', border: 'none', background: 'none', cursor: 'pointer',
              fontSize: '0.875rem', fontWeight: 500,
              color: tab === t ? '#0891b2' : '#64748b',
              borderBottom: tab === t ? '2px solid #0891b2' : '2px solid transparent',
              marginBottom: '-2px',
            }}>
            {t === 'total' ? 'Total' : t === 'castlegate' ? 'CastleGate' : 'Dropship'}
          </button>
        ))}
      </div>

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

      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginBottom: '1rem' }}>
        <input type="text" placeholder="Search part number / iwasku..." value={search} onChange={e => setSearch(e.target.value)}
          style={{ padding: '0.35rem 0.75rem', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '0.85rem', width: '240px' }} />
        <span style={{ fontSize: '0.85rem', color: '#64748b' }}>{filtered.length} items</span>
      </div>

      <div style={{ ...cardStyle, padding: 0 }}>
        {loading ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: '#94a3b8' }}>Loading...</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: '#94a3b8' }}>No order data found.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #e2e8f0' }}>
                <th onClick={() => handleSort('part_number')} style={thStyle()}>Part Number {sortIcon('part_number')}</th>
                <th onClick={() => handleSort('iwasku')} style={thStyle()}>IWASKU {sortIcon('iwasku')}</th>
                <th onClick={() => handleSort('total_qty')} style={thStyle('right')}>Total Qty {sortIcon('total_qty')}</th>
                <th onClick={() => handleSort('avg_price')} style={thStyle('right')}>Avg Price {sortIcon('avg_price')}</th>
                <th onClick={() => handleSort('total_cost')} style={thStyle('right')}>Total Cost {sortIcon('total_cost')}</th>
                <th onClick={() => handleSort('po_count')} style={thStyle('right')}>POs {sortIcon('po_count')}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => (
                <tr key={r.part_number} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '0.5rem', fontFamily: 'monospace', fontSize: '0.82rem' }}>{r.part_number}</td>
                  <td style={{ padding: '0.5rem', fontFamily: 'monospace', fontSize: '0.82rem', color: r.iwasku ? '#0f172a' : '#94a3b8' }}>{r.iwasku || '—'}</td>
                  <td style={{ padding: '0.5rem', textAlign: 'right', fontWeight: 600, color: r.total_qty > 0 ? COL_GREEN : COL_ZERO }}>{r.total_qty.toLocaleString()}</td>
                  <td style={{ padding: '0.5rem', textAlign: 'right', color: '#475569' }}>${Number(r.avg_price).toFixed(2)}</td>
                  <td style={{ padding: '0.5rem', textAlign: 'right', fontWeight: 600, color: Number(r.total_cost) > 0 ? COL_BLUE : COL_ZERO }}>${Number(r.total_cost).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                  <td style={{ padding: '0.5rem', textAlign: 'right' }}>{r.po_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
