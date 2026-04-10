import { useState, useEffect } from 'react';
import axios from 'axios';

interface OrderRow {
  id: number;
  channel: string;
  amazon_order_id: string;
  purchase_date_local: string;
  sku: string;
  asin: string;
  iwasku: string | null;
  quantity: number;
  item_price: string;
  currency: string;
  order_status: string;
  fulfillment_channel: string;
}

export default function Orders() {
  const [rows, setRows] = useState<OrderRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [channels, setChannels] = useState<string[]>([]);

  // Filters
  const [channel, setChannel] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [search, setSearch] = useState('');
  const [matched, setMatched] = useState<'' | 'matched' | 'unmatched'>('');
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc');

  useEffect(() => {
    axios.get('/api/v1/orders/channels').then(res => {
      if (res.data.success) setChannels(res.data.data);
    }).catch(() => {});
  }, []);

  const fetchOrders = async (p = page) => {
    setLoading(true);
    try {
      const params: Record<string, string> = {
        page: String(p),
        limit: '50',
        sort: `date_${sortDir}`,
      };
      if (channel) params.channel = channel;
      if (dateFrom) params.dateFrom = dateFrom;
      if (dateTo) params.dateTo = dateTo;
      if (search) params.search = search;
      if (matched) params.matched = matched;

      const res = await axios.get('/api/v1/orders', { params });
      if (res.data.success) {
        const d = res.data.data;
        setRows(d.rows);
        setTotal(d.total);
        setPage(d.page);
        setTotalPages(d.totalPages);
      }
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchOrders(); }, []);

  const handleSearch = () => {
    setPage(1);
    fetchOrders(1);
  };

  const handlePageChange = (newPage: number) => {
    setPage(newPage);
    fetchOrders(newPage);
  };

  const handleSort = () => {
    const next = sortDir === 'desc' ? 'asc' : 'desc';
    setSortDir(next);
    setPage(1);
    // fetch with new sort after state update
    setLoading(true);
    const params: Record<string, string> = { page: '1', limit: '50', sort: `date_${next}` };
    if (channel) params.channel = channel;
    if (dateFrom) params.dateFrom = dateFrom;
    if (dateTo) params.dateTo = dateTo;
    if (search) params.search = search;
    if (matched) params.matched = matched;
    axios.get('/api/v1/orders', { params }).then(res => {
      if (res.data.success) {
        const d = res.data.data;
        setRows(d.rows);
        setTotal(d.total);
        setPage(d.page);
        setTotalPages(d.totalPages);
      }
    }).finally(() => setLoading(false));
  };

  const statusColor = (status: string) => {
    const s = status?.toLowerCase() || '';
    if (s.includes('ship')) return 'text-emerald-600';
    if (s.includes('cancel')) return 'text-red-600';
    if (s.includes('pending')) return 'text-amber-600';
    return 'text-slate-600';
  };

  return (
    <div>
      <h1 className="mb-6">Orders</h1>

      {/* Filters */}
      <div className="bg-white rounded-lg p-6 shadow-sm mb-4">
        <div className="flex gap-3 items-end flex-wrap">
          <div>
            <div className="text-xs text-slate-500 mb-1">Channel</div>
            <select value={channel} onChange={e => setChannel(e.target.value)} className="px-2 py-1.5 border border-gray-300 rounded-md text-sm min-w-[80px]">
              <option value="">All</option>
              {channels.map(c => <option key={c} value={c}>{c.toUpperCase()}</option>)}
            </select>
          </div>
          <div>
            <div className="text-xs text-slate-500 mb-1">From</div>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="px-2 py-1.5 border border-gray-300 rounded-md text-sm" />
          </div>
          <div>
            <div className="text-xs text-slate-500 mb-1">To</div>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="px-2 py-1.5 border border-gray-300 rounded-md text-sm" />
          </div>
          <div>
            <div className="text-xs text-slate-500 mb-1">Search (SKU/ASIN/IWASKU)</div>
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
              placeholder="Search..."
              className="px-2 py-1.5 border border-gray-300 rounded-md text-sm min-w-[180px]"
            />
          </div>
          <div>
            <div className="text-xs text-slate-500 mb-1">Match</div>
            <div className="flex gap-0.5">
              <button onClick={() => setMatched('')} className={`px-3 py-1 rounded text-xs cursor-pointer border border-gray-300 ${matched === '' ? 'bg-slate-700 text-white' : 'bg-slate-100 text-slate-600'}`}>All</button>
              <button onClick={() => setMatched('matched')} className={`px-3 py-1 rounded text-xs cursor-pointer border border-gray-300 ${matched === 'matched' ? 'bg-slate-700 text-white' : 'bg-slate-100 text-slate-600'}`}>Matched</button>
              <button onClick={() => setMatched('unmatched')} className={`px-3 py-1 rounded text-xs cursor-pointer border border-gray-300 ${matched === 'unmatched' ? 'bg-slate-700 text-white' : 'bg-slate-100 text-slate-600'}`}>Unmatched</button>
            </div>
          </div>
          <button onClick={handleSearch} className="px-4 py-1.5 bg-blue-600 text-white border-none rounded-md cursor-pointer text-sm">Search</button>
        </div>
      </div>

      {/* Results */}
      <div className="bg-white rounded-lg p-6 shadow-sm mb-4 overflow-x-auto">
        {loading ? (
          <p className="text-slate-500">Loading...</p>
        ) : rows.length === 0 ? (
          <p className="text-slate-500">No orders found.</p>
        ) : (
          <>
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b-2 border-slate-200">
                  <th
                    className="text-left p-2 cursor-pointer select-none"
                    onClick={handleSort}
                  >
                    Date {sortDir === 'desc' ? '\u2193' : '\u2191'}
                  </th>
                  <th className="text-left p-2">CH</th>
                  <th className="text-left p-2">Order ID</th>
                  <th className="text-left p-2">SKU</th>
                  <th className="text-left p-2">ASIN</th>
                  <th className="text-left p-2">IWA SKU</th>
                  <th className="text-right p-2">Qty</th>
                  <th className="text-right p-2">Price</th>
                  <th className="text-left p-2">Cur</th>
                  <th className="text-left p-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id} className="border-b border-slate-200">
                    <td className="p-2 whitespace-nowrap">{r.purchase_date_local}</td>
                    <td className="p-2">{r.channel?.toUpperCase()}</td>
                    <td className="p-2 max-w-[140px] overflow-hidden text-ellipsis whitespace-nowrap" title={r.amazon_order_id}>
                      {r.amazon_order_id}
                    </td>
                    <td className="p-2 max-w-[130px] overflow-hidden text-ellipsis whitespace-nowrap" title={r.sku}>
                      {r.sku}
                    </td>
                    <td className="p-2">{r.asin}</td>
                    <td className={`p-2 font-medium ${r.iwasku ? 'text-emerald-600' : 'text-amber-600'}`}>
                      {r.iwasku || '-'}
                    </td>
                    <td className="p-2 text-right">{r.quantity}</td>
                    <td className="p-2 text-right">{Number(r.item_price).toFixed(2)}</td>
                    <td className="p-2">{r.currency}</td>
                    <td className={`p-2 ${statusColor(r.order_status)}`}>{r.order_status}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Pagination */}
            <div className="flex justify-between items-center mt-4 pt-3 border-t border-slate-200">
              <button
                onClick={() => handlePageChange(page - 1)}
                disabled={page <= 1}
                className={`px-4 py-1.5 text-white border-none rounded-md text-sm ${page <= 1 ? 'bg-gray-400 cursor-default' : 'bg-slate-600 cursor-pointer'}`}
              >
                Previous
              </button>
              <span className="text-sm text-slate-500">
                Page {page} of {totalPages} ({total.toLocaleString()} total)
              </span>
              <button
                onClick={() => handlePageChange(page + 1)}
                disabled={page >= totalPages}
                className={`px-4 py-1.5 text-white border-none rounded-md text-sm ${page >= totalPages ? 'bg-gray-400 cursor-default' : 'bg-slate-600 cursor-pointer'}`}
              >
                Next
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
