import { useState, useEffect } from 'react';
import axios from 'axios';

interface OrderRow {
  customer_order_id: string;
  purchase_order_id: string;
  order_date_local: string;
  line_number: string;
  sku: string;
  iwasku: string | null;
  product_name: string | null;
  quantity: number;
  unit_price: string;
  item_price: string;
  currency: string;
  order_status: string | null;
  ship_node_type: string | null;
  shipping_state: string | null;
  shipping_postal_code: string | null;
}

interface Pagination {
  total: number;
  page: number;
  limit: number;
  pages: number;
}

interface StatusOption {
  order_status: string;
  cnt: number;
}

export default function WalmartOrders() {
  const [rows, setRows] = useState<OrderRow[]>([]);
  const [pagination, setPagination] = useState<Pagination>({ total: 0, page: 1, limit: 50, pages: 1 });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [statuses, setStatuses] = useState<StatusOption[]>([]);

  const fetchData = async (page = 1, s = search, st = statusFilter) => {
    setLoading(true);
    try {
      const res = await axios.get('/api/v1/walmart/orders/browse', {
        params: { page, limit: 50, search: s, status: st },
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
    fetchData(1, '', '');
    axios.get('/api/v1/walmart/orders/statuses').then(r => setStatuses(r.data.data || [])).catch(() => {});
  }, []);

  const handleSearch = () => {
    setSearch(searchInput);
    fetchData(1, searchInput, statusFilter);
  };

  const handleStatusChange = (s: string) => {
    setStatusFilter(s);
    fetchData(1, search, s);
  };

  return (
    <div>
      <h1 className="mb-4">Walmart Orders</h1>

      <div className="flex gap-3 items-center mb-4">
        <input type="text" placeholder="Search SKU / IWASKU / PO / order ID / product name..."
          value={searchInput} onChange={e => setSearchInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSearch()}
          className="py-1 px-3 border border-gray-300 rounded-md text-sm flex-1 max-w-md" />
        <button onClick={handleSearch}
          className="py-1 px-3.5 bg-blue-600 text-white border-none rounded-md cursor-pointer text-sm">
          Search
        </button>
        <select value={statusFilter} onChange={e => handleStatusChange(e.target.value)}
          className="py-1 px-2 border border-gray-300 rounded-md text-sm">
          <option value="">All statuses</option>
          {statuses.map(s => (
            <option key={s.order_status} value={s.order_status}>
              {s.order_status} ({s.cnt})
            </option>
          ))}
        </select>
        <span className="text-sm text-slate-500">
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
                  <th className="text-left p-2">PO #</th>
                  <th className="text-left p-2">SKU</th>
                  <th className="text-left p-2">IWASKU</th>
                  <th className="text-left p-2">Product</th>
                  <th className="text-right p-2">Qty</th>
                  <th className="text-right p-2">Unit $</th>
                  <th className="text-right p-2">Line $</th>
                  <th className="text-left p-2">Status</th>
                  <th className="text-left p-2">Ship To</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-b border-slate-100">
                    <td className="p-2 text-slate-600 whitespace-nowrap">
                      {r.order_date_local ? new Date(r.order_date_local).toLocaleDateString() : '—'}
                    </td>
                    <td className="p-2 font-mono text-xs">{r.purchase_order_id}</td>
                    <td className="p-2 font-mono text-xs">{r.sku}</td>
                    <td className={`p-2 font-mono text-xs ${r.iwasku ? 'text-slate-900' : 'text-slate-400'}`}>
                      {r.iwasku || '—'}
                    </td>
                    <td className="p-2 text-slate-700 max-w-xs truncate" title={r.product_name || ''}>
                      {r.product_name || '—'}
                    </td>
                    <td className="p-2 text-right">{r.quantity}</td>
                    <td className="p-2 text-right">{r.unit_price != null ? `$${Number(r.unit_price).toFixed(2)}` : '—'}</td>
                    <td className="p-2 text-right font-semibold">
                      {r.item_price != null ? `$${Number(r.item_price).toFixed(2)}` : '—'}
                    </td>
                    <td className="p-2 text-xs">
                      <span className="px-2 py-0.5 bg-slate-100 rounded">
                        {r.order_status || '—'}
                      </span>
                    </td>
                    <td className="p-2 text-xs text-slate-500">
                      {r.shipping_state || ''} {r.shipping_postal_code || ''}
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
