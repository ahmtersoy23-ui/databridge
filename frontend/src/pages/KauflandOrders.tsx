import { useState, useEffect } from 'react';
import axios from 'axios';

interface OrderRow {
  account_id: number;
  id_order: string;
  id_order_unit: string;
  storefront: string;
  order_date_local: string;
  ean: string | null;
  offer_sku: string | null;
  iwasku: string | null;
  product_title: string | null;
  quantity: number;
  unit_price: string;
  item_price: string;
  currency: string;
  status: string | null;
  is_cancelled: boolean;
}

interface Pagination {
  total: number;
  page: number;
  limit: number;
  pages: number;
}

interface KauflandAccount {
  id: number;
  label: string;
  storefront: string;
  channel: string;
  is_active: boolean;
}

export default function KauflandOrders() {
  const [accounts, setAccounts] = useState<KauflandAccount[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<number | ''>('');
  const [rows, setRows] = useState<OrderRow[]>([]);
  const [pagination, setPagination] = useState<Pagination>({ total: 0, page: 1, limit: 50, pages: 1 });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [showCancelled, setShowCancelled] = useState(false);

  useEffect(() => {
    axios.get('/api/v1/kaufland/settings').then(r => {
      const active = (r.data.accounts || []).filter((a: KauflandAccount) => a.is_active);
      setAccounts(active);
      if (active.length > 0 && !selectedAccountId) setSelectedAccountId(active[0].id);
    }).catch(() => {});
  }, []);

  const fetchData = async (page = 1, s = search, accountId = selectedAccountId, sc = showCancelled) => {
    if (!accountId) return;
    setLoading(true);
    try {
      const res = await axios.get('/api/v1/kaufland/orders/browse', {
        params: { page, limit: 50, search: s, accountId, showCancelled: sc },
      });
      setRows(res.data.data);
      setPagination(res.data.pagination);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (selectedAccountId) { setSearch(''); setSearchInput(''); fetchData(1, '', selectedAccountId, showCancelled); }
  }, [selectedAccountId, showCancelled]);

  const handleSearch = () => { setSearch(searchInput); fetchData(1, searchInput, selectedAccountId, showCancelled); };

  return (
    <div>
      <h1 className="mb-4">Kaufland Orders</h1>

      {accounts.length > 1 && (
        <div className="flex gap-2 mb-4">
          {accounts.map(a => (
            <button key={a.id} onClick={() => setSelectedAccountId(a.id)}
              className={`px-4 py-1.5 rounded-md cursor-pointer text-sm font-semibold border-2 ${
                selectedAccountId === a.id
                  ? 'bg-cyan-600 text-white border-cyan-600'
                  : 'bg-white text-slate-700 border-gray-300'
              }`}>
              {a.label} ({a.storefront})
            </button>
          ))}
        </div>
      )}

      <div className="flex gap-3 items-center mb-4">
        <input type="text" placeholder="Search EAN / SKU / IWASKU / order ID / product..."
          value={searchInput} onChange={e => setSearchInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSearch()}
          className="py-1 px-3 border border-gray-300 rounded-md text-sm flex-1 max-w-md" />
        <button onClick={handleSearch}
          className="py-1 px-3.5 bg-blue-600 text-white border-none rounded-md cursor-pointer text-sm">
          Search
        </button>
        <label className="text-sm text-slate-600 flex items-center gap-1">
          <input type="checkbox" checked={showCancelled} onChange={e => setShowCancelled(e.target.checked)} />
          Show cancelled
        </label>
        <span className="text-sm text-slate-500 ml-auto">
          {loading ? 'Loading...' : `${pagination.total} rows`}
        </span>
      </div>

      <div className="bg-white rounded-lg p-6 shadow-sm mb-4">
        {loading ? (
          <div className="p-12 text-center text-slate-400">Loading...</div>
        ) : rows.length === 0 ? (
          <div className="p-12 text-center text-slate-400">No orders found.</div>
        ) : (
          <>
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b-2 border-slate-200">
                  <th className="text-left p-2">Date</th>
                  <th className="text-left p-2">Order ID</th>
                  <th className="text-left p-2">SKU</th>
                  <th className="text-left p-2">EAN</th>
                  <th className="text-left p-2">IWASKU</th>
                  <th className="text-left p-2">Product</th>
                  <th className="text-right p-2">Qty</th>
                  <th className="text-right p-2">Unit</th>
                  <th className="text-right p-2">Line</th>
                  <th className="text-left p-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className={`border-b border-slate-100 ${r.is_cancelled ? 'bg-red-50/40 text-slate-400 line-through' : ''}`}>
                    <td className="p-2 text-slate-600 whitespace-nowrap">
                      {r.order_date_local ? new Date(r.order_date_local).toLocaleDateString() : '—'}
                    </td>
                    <td className="p-2 font-mono text-xs">{r.id_order}</td>
                    <td className="p-2 font-mono text-xs">{r.offer_sku || '—'}</td>
                    <td className="p-2 font-mono text-xs text-slate-500">{r.ean || '—'}</td>
                    <td className={`p-2 font-mono text-xs ${r.iwasku ? 'text-slate-900' : 'text-slate-400'}`}>
                      {r.iwasku || '—'}
                    </td>
                    <td className="p-2 text-slate-700 max-w-xs truncate" title={r.product_title || ''}>
                      {r.product_title || '—'}
                    </td>
                    <td className="p-2 text-right">{r.quantity}</td>
                    <td className="p-2 text-right">{r.unit_price != null ? `${Number(r.unit_price).toFixed(2)} ${r.currency || ''}` : '—'}</td>
                    <td className="p-2 text-right font-semibold">
                      {r.item_price != null ? `${Number(r.item_price).toFixed(2)} ${r.currency || ''}` : '—'}
                    </td>
                    <td className="p-2 text-xs">
                      <span className="px-2 py-0.5 bg-slate-100 rounded">{r.status || '—'}</span>
                    </td>
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
    </div>
  );
}
