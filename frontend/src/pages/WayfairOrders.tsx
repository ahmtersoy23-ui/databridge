import { useState, useEffect } from 'react';
import axios from 'axios';

interface OrderRow {
  po_number: string;
  po_date: string;
  part_number: string;
  iwasku: string | null;
  quantity: number;
  price: string;
  total_cost: string | null;
}

interface Pagination {
  total: number;
  page: number;
  limit: number;
  pages: number;
}

interface WfAccount {
  id: number;
  label: string;
  channel: string;
  is_active: boolean;
}

const ACCOUNT_LABELS: Record<string, string> = {
  shukran: 'Shukran',
  mdn: 'MDN',
};

function OrdersTable({ orderType, account }: { orderType: 'castlegate' | 'dropship'; account: string }) {
  const [rows, setRows] = useState<OrderRow[]>([]);
  const [pagination, setPagination] = useState<Pagination>({ total: 0, page: 1, limit: 50, pages: 1 });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');

  const fetchData = async (page = 1, s = search) => {
    setLoading(true);
    try {
      const res = await axios.get('/api/v1/wayfair/orders/browse', {
        params: { type: orderType, account, page, limit: 50, search: s },
      });
      setRows(res.data.data);
      setPagination(res.data.pagination);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { setSearch(''); setSearchInput(''); fetchData(1, ''); }, [orderType, account]);

  const handleSearch = () => {
    setSearch(searchInput);
    fetchData(1, searchInput);
  };

  const isCG = orderType === 'castlegate';

  return (
    <>
      <div className="flex gap-3 items-center mb-4">
        <input type="text" placeholder="Search PO / part number / iwasku..."
          value={searchInput} onChange={e => setSearchInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSearch()}
          className="py-1 px-3 border border-gray-300 rounded-md text-sm w-70" />
        <button onClick={handleSearch}
          className="py-1 px-3.5 bg-blue-600 text-white border-none rounded-md cursor-pointer text-sm">
          Search
        </button>
        <span className="text-sm text-slate-500">
          {loading ? 'Loading...' : `${pagination.total} rows`}
        </span>
      </div>

      <div className="bg-white rounded-lg p-6 shadow-sm mb-4">
        {loading ? (
          <div className="p-12 text-center text-slate-400">Loading...</div>
        ) : rows.length === 0 ? (
          <div className="p-12 text-center text-slate-400">
            No orders found.
          </div>
        ) : (
          <>
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b-2 border-slate-200">
                  <th className="text-left p-2">PO Number</th>
                  <th className="text-left p-2">PO Date</th>
                  <th className="text-left p-2">Part Number</th>
                  <th className="text-left p-2">IWASKU</th>
                  <th className="text-right p-2">Qty</th>
                  <th className="text-right p-2">Price</th>
                  {isCG && <th className="text-right p-2">Total</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-b border-slate-100">
                    <td className="p-2 font-mono text-xs">{r.po_number}</td>
                    <td className="p-2 text-slate-600">{r.po_date ? new Date(r.po_date).toLocaleDateString() : '—'}</td>
                    <td className="p-2 font-mono text-xs">{r.part_number}</td>
                    <td className={`p-2 font-mono text-xs ${r.iwasku ? 'text-slate-900' : 'text-slate-400'}`}>{r.iwasku || '—'}</td>
                    <td className="p-2 text-right">{r.quantity}</td>
                    <td className="p-2 text-right">{r.price != null ? `$${Number(r.price).toFixed(2)}` : '—'}</td>
                    {isCG && <td className="p-2 text-right">{r.total_cost != null ? `$${Number(r.total_cost).toFixed(2)}` : '—'}</td>}
                  </tr>
                ))}
              </tbody>
            </table>

            {pagination.pages > 1 && (
              <div className="flex justify-between items-center mt-3 pt-3 border-t border-slate-200">
                <button onClick={() => fetchData(pagination.page - 1)} disabled={pagination.page <= 1}
                  className={`py-1 px-3.5 border border-gray-300 rounded-md bg-white text-sm ${pagination.page <= 1 ? 'cursor-default' : 'cursor-pointer'}`}>
                  ‹ Prev
                </button>
                <span className="text-sm text-slate-500">
                  Page {pagination.page} / {pagination.pages} ({pagination.total} total)
                </span>
                <button onClick={() => fetchData(pagination.page + 1)} disabled={pagination.page >= pagination.pages}
                  className={`py-1 px-3.5 border border-gray-300 rounded-md bg-white text-sm ${pagination.page >= pagination.pages ? 'cursor-default' : 'cursor-pointer'}`}>
                  Next ›
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}

export default function WayfairOrders() {
  const [accounts, setAccounts] = useState<WfAccount[]>([]);
  const [selectedAccount, setSelectedAccount] = useState('shukran');
  const [orderSubTab, setOrderSubTab] = useState<'castlegate' | 'dropship'>('castlegate');

  useEffect(() => {
    axios.get('/api/v1/wayfair/settings').then(r => {
      const active = (r.data.accounts || []).filter((a: WfAccount) => a.is_active);
      setAccounts(active);
      if (active.length > 0 && !active.find((a: WfAccount) => a.label === selectedAccount)) {
        setSelectedAccount(active[0].label);
      }
    }).catch(() => {});
  }, []);

  return (
    <div>
      <h1 className="mb-4">Wayfair Orders</h1>

      {/* Account selector */}
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

      {/* CastleGate / Dropship sub-tabs */}
      <div className="flex gap-1 mb-5 border-b-2 border-slate-200">
        {(['castlegate', 'dropship'] as const).map(t => (
          <button key={t} onClick={() => setOrderSubTab(t)}
            className={`px-4 py-1.5 border-none bg-transparent cursor-pointer text-sm font-medium -mb-0.5 ${
              orderSubTab === t
                ? 'text-cyan-600 border-b-2 border-b-cyan-600'
                : 'text-slate-500 border-b-2 border-b-transparent'
            }`}>
            {t === 'castlegate' ? 'CastleGate' : 'Dropship'}
          </button>
        ))}
      </div>

      <OrdersTable orderType={orderSubTab} account={selectedAccount} />
    </div>
  );
}
