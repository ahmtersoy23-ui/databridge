import { useState, useEffect } from 'react';
import axios from 'axios';

interface OrderRow {
  order_id: number;
  order_item_id: number;
  order_date_local: string;
  sku: string | null;
  tsin: number | null;
  iwasku: string | null;
  product_title: string | null;
  quantity: number;
  selling_price: string;
  item_price: string;
  dc: string | null;
  customer_dc: string | null;
  sale_status: boolean | null;
  promotion: boolean | null;
}

interface Pagination {
  total: number;
  page: number;
  limit: number;
  pages: number;
}

export default function TakealotOrders() {
  const [rows, setRows] = useState<OrderRow[]>([]);
  const [pagination, setPagination] = useState<Pagination>({ total: 0, page: 1, limit: 50, pages: 1 });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [showCancelled, setShowCancelled] = useState(false);

  const fetchData = async (page = 1, s = search, showC = showCancelled) => {
    setLoading(true);
    try {
      const res = await axios.get('/api/v1/takealot/orders/browse', {
        params: { page, limit: 50, search: s, showCancelled: showC },
      });
      setRows(res.data.data);
      setPagination(res.data.pagination);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(1, '', showCancelled); }, [showCancelled]);

  const handleSearch = () => {
    setSearch(searchInput);
    fetchData(1, searchInput, showCancelled);
  };

  return (
    <div>
      <h1 className="mb-4">Takealot Orders</h1>

      <div className="flex gap-3 items-center mb-4">
        <input type="text" placeholder="Search SKU / IWASKU / TSIN / order ID / product..."
          value={searchInput} onChange={e => setSearchInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSearch()}
          className="py-1 px-3 border border-gray-300 rounded-md text-sm flex-1 max-w-md" />
        <button onClick={handleSearch}
          className="py-1 px-3.5 bg-blue-600 text-white border-none rounded-md cursor-pointer text-sm">
          Search
        </button>
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={showCancelled}
            onChange={e => setShowCancelled(e.target.checked)} />
          <span className="text-sm text-slate-600">İptal edilenleri göster</span>
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
                  <th className="text-left p-2">TSIN</th>
                  <th className="text-left p-2">IWASKU</th>
                  <th className="text-left p-2">Product</th>
                  <th className="text-right p-2">Qty</th>
                  <th className="text-right p-2">Unit R</th>
                  <th className="text-right p-2">Line R</th>
                  <th className="text-left p-2">DC</th>
                  <th className="text-left p-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const isCancelled = r.sale_status === false;
                  return (
                    <tr key={i} className={`border-b border-slate-100 ${isCancelled ? 'bg-red-50/40 text-slate-400 line-through' : ''}`}>
                      <td className="p-2 text-slate-600 whitespace-nowrap">
                        {r.order_date_local ? new Date(r.order_date_local).toLocaleDateString() : '—'}
                      </td>
                      <td className="p-2 font-mono text-xs">{r.order_id}</td>
                      <td className="p-2 font-mono text-xs">{r.sku || '—'}</td>
                      <td className="p-2 font-mono text-xs text-slate-500">{r.tsin || '—'}</td>
                      <td className={`p-2 font-mono text-xs ${r.iwasku ? 'text-slate-900' : 'text-slate-400'}`}>
                        {r.iwasku || '—'}
                      </td>
                      <td className="p-2 text-slate-700 max-w-xs truncate" title={r.product_title || ''}>
                        {r.product_title || '—'}
                      </td>
                      <td className="p-2 text-right">{r.quantity}</td>
                      <td className="p-2 text-right">{r.selling_price != null ? `R${Number(r.selling_price).toFixed(2)}` : '—'}</td>
                      <td className="p-2 text-right font-semibold">
                        {r.item_price != null ? `R${Number(r.item_price).toFixed(2)}` : '—'}
                      </td>
                      <td className="p-2 text-xs">{r.dc || '—'}</td>
                      <td className="p-2 text-xs">
                        {isCancelled ? (
                          <span className="px-2 py-0.5 bg-red-100 text-red-700 border border-red-200 rounded font-sans font-semibold">İPTAL</span>
                        ) : (
                          <span className="px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded">Satıldı</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
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
