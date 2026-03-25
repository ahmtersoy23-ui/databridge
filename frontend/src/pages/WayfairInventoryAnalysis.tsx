import { useState, useEffect, useMemo } from 'react';
import axios from 'axios';

interface InvRow {
  part_number: string;
  iwasku: string | null;
  on_hand_qty: number;
  available_qty: number;
  last_synced_at: string | null;
}

interface WfAccount { id: number; label: string; channel: string; is_active: boolean; }

const ACCOUNT_LABELS: Record<string, string> = { shukran: 'Shukran', mdn: 'MDN' };

const cardStyle = {
  background: '#fff',
  borderRadius: '8px',
  padding: '1.5rem',
  boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
  marginBottom: '1rem',
} as const;

const COL_GREEN = '#059669';
const COL_BLUE = '#2563eb';
const COL_ORANGE = '#d97706';
const COL_ZERO = '#9ca3af';

type SortKey = 'part_number' | 'iwasku' | 'on_hand_qty' | 'available_qty';

export default function WayfairInventoryAnalysis() {
  const [rows, setRows] = useState<InvRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [matchFilter, setMatchFilter] = useState<'all' | 'matched' | 'unmatched'>('all');
  const [sortKey, setSortKey] = useState<SortKey>('on_hand_qty');
  const [sortAsc, setSortAsc] = useState(false);
  const [accounts, setAccounts] = useState<WfAccount[]>([]);
  const [selectedAccount, setSelectedAccount] = useState('shukran');

  useEffect(() => {
    axios.get('/api/v1/wayfair/settings').then(r => {
      const active = (r.data.accounts || []).filter((a: WfAccount) => a.is_active);
      setAccounts(active);
      if (active.length > 0 && !active.find((a: WfAccount) => a.label === selectedAccount)) {
        setSelectedAccount(active[0].label);
      }
    }).catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    axios.get('/api/v1/wayfair/inventory', { params: { page: 1, limit: 200, account: selectedAccount } })
      .then(res => setRows(res.data.data))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [selectedAccount]);

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
    if (matchFilter === 'matched') data = data.filter(r => r.iwasku);
    if (matchFilter === 'unmatched') data = data.filter(r => !r.iwasku);

    return [...data].sort((a, b) => {
      const av = a[sortKey] ?? '';
      const bv = b[sortKey] ?? '';
      if (sortKey === 'part_number' || sortKey === 'iwasku') {
        return sortAsc ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
      }
      return sortAsc ? (Number(av) || 0) - (Number(bv) || 0) : (Number(bv) || 0) - (Number(av) || 0);
    });
  }, [rows, search, matchFilter, sortKey, sortAsc]);

  const summary = useMemo(() => {
    const totalParts = rows.length;
    const totalOnHand = rows.reduce((s, r) => s + (r.on_hand_qty || 0), 0);
    const totalAvailable = rows.reduce((s, r) => s + (r.available_qty || 0), 0);
    const matched = rows.filter(r => r.iwasku).length;
    const matchPct = totalParts > 0 ? ((matched / totalParts) * 100).toFixed(1) : '0';
    return { totalParts, totalOnHand, totalAvailable, matched, unmatched: totalParts - matched, matchPct };
  }, [rows]);

  const summaryCards = [
    { label: 'Total Parts', value: summary.totalParts.toLocaleString(), color: '#334155' },
    { label: 'On Hand', value: summary.totalOnHand.toLocaleString(), color: COL_GREEN },
    { label: 'Available', value: summary.totalAvailable.toLocaleString(), color: COL_BLUE },
    { label: 'Match Rate', value: `${summary.matchPct}%`, color: summary.unmatched > 0 ? COL_ORANGE : COL_GREEN },
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

  const toggleBtn = (active: boolean) => ({
    padding: '0.35rem 0.7rem',
    background: active ? '#334155' : '#f1f5f9',
    color: active ? '#fff' : '#475569',
    border: '1px solid #d1d5db',
    borderRadius: '4px',
    cursor: 'pointer' as const,
    fontSize: '0.8rem',
  });

  return (
    <div>
      <h1 style={{ marginBottom: '1.5rem' }}>Wayfair Inventory Analysis</h1>

      {accounts.length > 1 && (
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
          {accounts.map(a => (
            <button key={a.label} onClick={() => setSelectedAccount(a.label)}
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

      {/* Summary cards */}
      {!loading && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem', marginBottom: '1rem' }}>
          {summaryCards.map(card => (
            <div key={card.label} style={{ ...cardStyle, marginBottom: 0, textAlign: 'center' }}>
              <div style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: '0.3rem' }}>{card.label}</div>
              <div style={{ fontSize: '1.5rem', fontWeight: 700, color: card.color }}>{card.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Match progress bar */}
      {!loading && summary.totalParts > 0 && (
        <div style={cardStyle}>
          <div style={{ display: 'flex', gap: '1.5rem', marginBottom: '0.5rem', fontSize: '0.85rem' }}>
            <span style={{ color: COL_GREEN }}><strong>{summary.matched}</strong> matched</span>
            <span style={{ color: summary.unmatched > 0 ? COL_ORANGE : COL_GREEN }}><strong>{summary.unmatched}</strong> unmatched</span>
          </div>
          <div style={{ background: '#e2e8f0', borderRadius: '4px', height: '8px', overflow: 'hidden' }}>
            <div style={{ background: COL_GREEN, height: '100%', width: `${summary.matchPct}%`, borderRadius: '4px' }} />
          </div>
        </div>
      )}

      {/* Filters */}
      <div style={{ ...cardStyle, display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <input type="text" placeholder="Search part number / iwasku..." value={search} onChange={e => setSearch(e.target.value)}
          style={{ padding: '0.35rem 0.75rem', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '0.85rem', width: '240px' }} />
        <div style={{ display: 'flex', gap: '2px' }}>
          {(['all', 'matched', 'unmatched'] as const).map(f => (
            <button key={f} onClick={() => setMatchFilter(f)} style={toggleBtn(matchFilter === f)}>
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
        <span style={{ fontSize: '0.85rem', color: '#64748b' }}>{filtered.length} items</span>
      </div>

      {/* Table */}
      <div style={{ ...cardStyle, padding: 0 }}>
        {loading ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: '#94a3b8' }}>Loading...</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: '#94a3b8' }}>No inventory data found.</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #e2e8f0' }}>
                <th onClick={() => handleSort('part_number')} style={thStyle('part_number')}>
                  Part Number {sortKey === 'part_number' ? (sortAsc ? '\u2191' : '\u2193') : ''}
                </th>
                <th onClick={() => handleSort('iwasku')} style={thStyle('iwasku')}>
                  IWASKU {sortKey === 'iwasku' ? (sortAsc ? '\u2191' : '\u2193') : ''}
                </th>
                <th onClick={() => handleSort('on_hand_qty')} style={thStyle('on_hand_qty', 'right')}>
                  On Hand {sortKey === 'on_hand_qty' ? (sortAsc ? '\u2191' : '\u2193') : ''}
                </th>
                <th onClick={() => handleSort('available_qty')} style={thStyle('available_qty', 'right')}>
                  Available {sortKey === 'available_qty' ? (sortAsc ? '\u2191' : '\u2193') : ''}
                </th>
                <th style={{ textAlign: 'left', padding: '0.5rem', fontSize: '0.82rem', fontWeight: 600 }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => (
                <tr key={r.part_number} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '0.5rem', fontFamily: 'monospace', fontSize: '0.82rem' }}>{r.part_number}</td>
                  <td style={{ padding: '0.5rem', fontFamily: 'monospace', fontSize: '0.82rem', color: r.iwasku ? '#0f172a' : '#94a3b8' }}>{r.iwasku || '—'}</td>
                  <td style={{ padding: '0.5rem', textAlign: 'right', fontWeight: 500, color: (r.on_hand_qty || 0) > 0 ? '#0f172a' : COL_ZERO }}>{r.on_hand_qty ?? 0}</td>
                  <td style={{ padding: '0.5rem', textAlign: 'right', fontWeight: 600, color: (r.available_qty || 0) > 0 ? COL_GREEN : COL_ZERO }}>{r.available_qty ?? 0}</td>
                  <td style={{ padding: '0.5rem' }}>
                    <span style={{
                      padding: '0.15rem 0.5rem', borderRadius: '999px', fontSize: '0.75rem',
                      background: r.iwasku ? '#dcfce7' : '#fef3c7',
                      color: r.iwasku ? '#166534' : '#92400e',
                    }}>
                      {r.iwasku ? 'Matched' : 'Unmatched'}
                    </span>
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
