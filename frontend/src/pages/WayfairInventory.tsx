import { useState, useEffect } from 'react';
import axios from 'axios';

interface InventoryRow {
  part_number: string;
  iwasku: string | null;
  on_hand_qty: number;
  available_qty: number;
  last_synced_at: string | null;
}

interface WfAccount { id: number; label: string; channel: string; is_active: boolean; }

const ACCOUNT_LABELS: Record<string, string> = { shukran: 'Shukran', mdn: 'MDN' };

export default function WayfairInventory() {
  const [rows, setRows] = useState<InventoryRow[]>([]);
  const [pagination, setPagination] = useState({ total: 0, page: 1, limit: 50, pages: 1 });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
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

  const fetchData = async (page = 1) => {
    setLoading(true);
    try {
      const res = await axios.get('/api/v1/wayfair/inventory', { params: { page, limit: 50, search, account: selectedAccount } });
      setRows(res.data.data);
      setPagination(res.data.pagination);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(1); }, [search, selectedAccount]);

  return (
    <div>
      <h1 className="mb-4">Wayfair Inventory</h1>

      {accounts.length > 1 && (
        <div className="flex gap-2 mb-4">
          {accounts.map(a => (
            <button key={a.label} onClick={() => setSelectedAccount(a.label)}
              className={`px-4 py-1.5 rounded-md cursor-pointer text-sm font-semibold border-2 ${
                selectedAccount === a.label
                  ? 'bg-cyan-600 text-white border-cyan-600'
                  : 'bg-white text-slate-700 border-gray-300'
              }`}>
              {ACCOUNT_LABELS[a.label] || a.label.toUpperCase()}
            </button>
          ))}
        </div>
      )}

      <div className="flex gap-3 items-center mb-4">
        <input
          type="text" placeholder="Search part number or iwasku..."
          value={search} onChange={e => setSearch(e.target.value)}
          className="py-1 px-3 border border-gray-300 rounded-md text-sm w-60"
        />
        <span className="text-sm text-slate-500">
          {loading ? 'Loading...' : `${pagination.total} items`}
        </span>
      </div>

      <div className="bg-white rounded-lg shadow-sm">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b-2 border-slate-200">
              <th className="text-left py-3 px-4">Part Number</th>
              <th className="text-left py-3 px-2">IWASKU</th>
              <th className="text-right py-3 px-4">On Hand</th>
              <th className="text-right py-3 px-4">Available</th>
              <th className="text-left py-3 px-2">Last Sync</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={row.part_number} className="border-b border-slate-100">
                <td className="p-2 px-4 font-mono text-xs">{row.part_number}</td>
                <td className={`p-2 font-mono text-xs ${row.iwasku ? 'text-slate-900' : 'text-slate-400'}`}>
                  {row.iwasku || '—'}
                </td>
                <td className="p-2 px-4 text-right font-medium">
                  {row.on_hand_qty ?? 0}
                </td>
                <td className={`p-2 px-4 text-right font-semibold ${(row.available_qty ?? 0) > 0 ? 'text-emerald-600' : 'text-slate-400'}`}>
                  {row.available_qty ?? 0}
                </td>
                <td className="p-2 text-xs text-slate-500">
                  {row.last_synced_at ? new Date(row.last_synced_at).toLocaleDateString() : '—'}
                </td>
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={5} className="p-12 text-center text-slate-400">
                  No inventory data. Run a Wayfair sync first.
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {pagination.pages > 1 && (
          <div className="flex justify-between items-center py-3 px-4 border-t border-slate-200">
            <button disabled={pagination.page <= 1 || loading} onClick={() => fetchData(pagination.page - 1)}
              className="py-1 px-3.5 cursor-pointer border border-gray-300 rounded-md bg-white text-sm">‹ Prev</button>
            <span className="text-sm text-slate-500">{pagination.page} / {pagination.pages}</span>
            <button disabled={pagination.page >= pagination.pages || loading} onClick={() => fetchData(pagination.page + 1)}
              className="py-1 px-3.5 cursor-pointer border border-gray-300 rounded-md bg-white text-sm">Next ›</button>
          </div>
        )}
      </div>
    </div>
  );
}
