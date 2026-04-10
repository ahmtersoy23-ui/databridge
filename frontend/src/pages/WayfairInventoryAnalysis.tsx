import { useState, useEffect, useMemo } from 'react';
import axios from 'axios';

interface InvRow {
  part_number: string;
  iwasku: string | null;
  on_hand_qty: number;
  available_qty: number;
  shipping_cost: number | null;
  last_synced_at: string | null;
}

interface WfAccount { id: number; label: string; channel: string; is_active: boolean; }

const ACCOUNT_LABELS: Record<string, string> = { shukran: 'Shukran', mdn: 'MDN' };

type SortKey = 'part_number' | 'iwasku' | 'on_hand_qty' | 'available_qty' | 'shipping_cost';

export default function WayfairInventoryAnalysis() {
  const [rows, setRows] = useState<InvRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [matchFilter, setMatchFilter] = useState<'all' | 'matched' | 'unmatched'>('all');
  const [sortKey, setSortKey] = useState<SortKey>('on_hand_qty');
  const [sortAsc, setSortAsc] = useState(false);
  const [accounts, setAccounts] = useState<WfAccount[]>([]);
  const [selectedAccount, setSelectedAccount] = useState('shukran');
  const [editingPn, setEditingPn] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    axios.get('/api/v1/wayfair/settings').then(r => {
      const active = (r.data.accounts || []).filter((a: WfAccount) => a.is_active);
      setAccounts(active);
      if (active.length > 0 && !active.find((a: WfAccount) => a.label === selectedAccount)) {
        setSelectedAccount(active[0].label);
      }
    }).catch(() => {});
  }, []);

  const fetchData = () => {
    setLoading(true);
    axios.get('/api/v1/wayfair/inventory', { params: { page: 1, limit: 200, account: selectedAccount } })
      .then(res => setRows(res.data.data))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchData(); }, [selectedAccount]);

  const saveCost = async (partNumber: string) => {
    setSaving(true);
    try {
      const cost = editValue.trim() === '' ? null : editValue.trim();
      await axios.put('/api/v1/wayfair/inventory/shipping-cost', { part_number: partNumber, shipping_cost: cost });
      setRows(prev => prev.map(r => r.part_number === partNumber ? { ...r, shipping_cost: cost ? parseFloat(cost) : null } : r));
      setEditingPn(null);
    } catch { /* ignore */ }
    finally { setSaving(false); }
  };

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

  const summaryCards: { label: string; value: string; colorClass: string }[] = [
    { label: 'Total Parts', value: summary.totalParts.toLocaleString(), colorClass: 'text-slate-700' },
    { label: 'On Hand', value: summary.totalOnHand.toLocaleString(), colorClass: 'text-emerald-600' },
    { label: 'Available', value: summary.totalAvailable.toLocaleString(), colorClass: 'text-blue-600' },
    { label: 'Match Rate', value: `${summary.matchPct}%`, colorClass: summary.unmatched > 0 ? 'text-amber-600' : 'text-emerald-600' },
  ];

  return (
    <div>
      <h1 className="mb-6">Wayfair Inventory Analysis</h1>

      {accounts.length > 1 && (
        <div className="flex gap-2 mb-4">
          {accounts.map(a => (
            <button key={a.label} onClick={() => setSelectedAccount(a.label)}
              className={`px-4 py-1.5 rounded-md cursor-pointer text-sm font-semibold border-2 ${selectedAccount === a.label ? 'bg-cyan-600 text-white border-cyan-600' : 'bg-white text-slate-700 border-gray-300'}`}>
              {ACCOUNT_LABELS[a.label] || a.label.toUpperCase()}
            </button>
          ))}
        </div>
      )}

      {/* Summary cards */}
      {!loading && (
        <div className="grid grid-cols-4 gap-4 mb-4">
          {summaryCards.map(card => (
            <div key={card.label} className="bg-white rounded-lg p-6 shadow-sm text-center">
              <div className="text-xs text-slate-500 mb-1">{card.label}</div>
              <div className={`text-2xl font-bold ${card.colorClass}`}>{card.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Match progress bar */}
      {!loading && summary.totalParts > 0 && (
        <div className="bg-white rounded-lg p-6 shadow-sm mb-4">
          <div className="flex gap-6 mb-2 text-sm">
            <span className="text-emerald-600"><strong>{summary.matched}</strong> matched</span>
            <span className={summary.unmatched > 0 ? 'text-amber-600' : 'text-emerald-600'}><strong>{summary.unmatched}</strong> unmatched</span>
          </div>
          <div className="bg-slate-200 rounded h-2 overflow-hidden">
            <div className="bg-emerald-600 h-full rounded" style={{ width: `${summary.matchPct}%` }} />
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="bg-white rounded-lg p-6 shadow-sm mb-4 flex gap-3 items-center flex-wrap">
        <input type="text" placeholder="Search part number / iwasku..." value={search} onChange={e => setSearch(e.target.value)}
          className="py-1 px-3 border border-gray-300 rounded-md text-sm w-[240px]" />
        <div className="flex gap-0.5">
          {(['all', 'matched', 'unmatched'] as const).map(f => (
            <button key={f} onClick={() => setMatchFilter(f)} className={`px-3 py-1 rounded text-xs cursor-pointer border border-gray-300 ${matchFilter === f ? 'bg-slate-700 text-white' : 'bg-slate-100 text-slate-600'}`}>
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
        <span className="text-sm text-slate-500">{filtered.length} items</span>
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg shadow-sm mb-4 p-0">
        {loading ? (
          <div className="p-12 text-center text-slate-400">Loading...</div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center text-slate-400">No inventory data found.</div>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b-2 border-slate-200">
                <th onClick={() => handleSort('part_number')} className="text-left p-2 cursor-pointer select-none whitespace-nowrap text-sm font-semibold">
                  Part Number {sortKey === 'part_number' ? (sortAsc ? '\u2191' : '\u2193') : ''}
                </th>
                <th onClick={() => handleSort('iwasku')} className="text-left p-2 cursor-pointer select-none whitespace-nowrap text-sm font-semibold">
                  IWASKU {sortKey === 'iwasku' ? (sortAsc ? '\u2191' : '\u2193') : ''}
                </th>
                <th onClick={() => handleSort('on_hand_qty')} className="text-right p-2 cursor-pointer select-none whitespace-nowrap text-sm font-semibold">
                  On Hand {sortKey === 'on_hand_qty' ? (sortAsc ? '\u2191' : '\u2193') : ''}
                </th>
                <th onClick={() => handleSort('available_qty')} className="text-right p-2 cursor-pointer select-none whitespace-nowrap text-sm font-semibold">
                  Available {sortKey === 'available_qty' ? (sortAsc ? '\u2191' : '\u2193') : ''}
                </th>
                <th onClick={() => handleSort('shipping_cost')} className="text-right p-2 cursor-pointer select-none whitespace-nowrap text-sm font-semibold">
                  Ship Cost {sortKey === 'shipping_cost' ? (sortAsc ? '\u2191' : '\u2193') : ''}
                </th>
                <th className="text-left p-2 text-sm font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => (
                <tr key={r.part_number} className="border-b border-slate-100">
                  <td className="p-2 font-mono text-sm">{r.part_number}</td>
                  <td className={`p-2 font-mono text-sm ${r.iwasku ? 'text-slate-900' : 'text-slate-400'}`}>{r.iwasku || '\u2014'}</td>
                  <td className={`p-2 text-right font-medium ${(r.on_hand_qty || 0) > 0 ? 'text-slate-900' : 'text-gray-400'}`}>{r.on_hand_qty ?? 0}</td>
                  <td className={`p-2 text-right font-semibold ${(r.available_qty || 0) > 0 ? 'text-emerald-600' : 'text-gray-400'}`}>{r.available_qty ?? 0}</td>
                  <td className="p-2 text-right">
                    {editingPn === r.part_number ? (
                      <div className="flex gap-1 justify-end">
                        <input
                          autoFocus type="number" step="0.01" value={editValue}
                          onChange={e => setEditValue(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') saveCost(r.part_number); if (e.key === 'Escape') setEditingPn(null); }}
                          className="w-[70px] px-1.5 py-0.5 border border-blue-600 rounded text-sm text-right"
                        />
                        <button disabled={saving} onClick={() => saveCost(r.part_number)}
                          className="px-1.5 py-0.5 bg-emerald-600 text-white border-none rounded cursor-pointer text-xs">
                          {saving ? '..' : '\u2713'}
                        </button>
                        <button onClick={() => setEditingPn(null)}
                          className="px-1.5 py-0.5 bg-slate-200 border-none rounded cursor-pointer text-xs">
                          \u2715
                        </button>
                      </div>
                    ) : (
                      <span
                        onClick={() => { setEditingPn(r.part_number); setEditValue(r.shipping_cost != null ? String(r.shipping_cost) : ''); }}
                        className={`cursor-pointer font-medium ${r.shipping_cost != null ? 'text-slate-900' : 'text-slate-400'}`}
                        title="Click to edit"
                      >
                        {r.shipping_cost != null ? `$${Number(r.shipping_cost).toFixed(2)}` : '\u2014'}
                      </span>
                    )}
                  </td>
                  <td className="p-2">
                    <span className={`px-2 py-0.5 rounded-full text-xs ${r.iwasku ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'}`}>
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
