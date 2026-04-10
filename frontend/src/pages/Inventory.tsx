import { useState, useEffect } from 'react';
import axios from 'axios';

interface InventoryRow {
  id: number;
  warehouse: string;
  sku: string;
  asin: string;
  fnsku: string;
  iwasku: string | null;
  fulfillable_quantity: number;
  total_reserved_quantity: number;
  pending_customer_order_quantity: number;
  pending_transshipment_quantity: number;
  fc_processing_quantity: number;
  total_unfulfillable_quantity: number;
  customer_damaged_quantity: number;
  warehouse_damaged_quantity: number;
  distributor_damaged_quantity: number;
  inbound_shipped_quantity: number;
  inbound_working_quantity: number;
  inbound_receiving_quantity: number;
  last_synced_at: string;
}

export default function InventoryPage() {
  const [rows, setRows] = useState<InventoryRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [warehouses, setWarehouses] = useState<string[]>([]);

  // Filters
  const [warehouse, setWarehouse] = useState('');
  const [search, setSearch] = useState('');
  const [matched, setMatched] = useState<'' | 'matched' | 'unmatched'>('');

  useEffect(() => {
    axios.get('/api/v1/inventory-detail/warehouses').then(res => {
      if (res.data.success) setWarehouses(res.data.data);
    }).catch(() => {});
  }, []);

  const fetchInventory = async (p = page) => {
    setLoading(true);
    try {
      const params: Record<string, string> = { page: String(p), limit: '50' };
      if (warehouse) params.warehouse = warehouse;
      if (search) params.search = search;
      if (matched) params.matched = matched;

      const res = await axios.get('/api/v1/inventory-detail', { params });
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

  useEffect(() => { fetchInventory(); }, []);

  const handleSearch = () => {
    setPage(1);
    fetchInventory(1);
  };

  const handlePageChange = (newPage: number) => {
    setPage(newPage);
    fetchInventory(newPage);
  };

  return (
    <div>
      <h1 className="mb-6">Inventory</h1>

      {/* Filters */}
      <div className="bg-white rounded-lg p-6 shadow-sm mb-4">
        <div className="flex gap-3 items-end flex-wrap">
          <div>
            <div className="text-xs text-slate-500 mb-1">Warehouse</div>
            <select value={warehouse} onChange={e => setWarehouse(e.target.value)} className="px-2 py-1.5 border border-gray-300 rounded-md text-sm min-w-[80px]">
              <option value="">All</option>
              {warehouses.map(w => <option key={w} value={w}>{w}</option>)}
            </select>
          </div>
          <div>
            <div className="text-xs text-slate-500 mb-1">Search (SKU/ASIN/FNSKU/IWASKU)</div>
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
              placeholder="Search..."
              className="px-2 py-1.5 border border-gray-300 rounded-md text-sm min-w-[200px]"
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
          <p className="text-slate-500">No inventory items found.</p>
        ) : (
          <>
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b-2 border-slate-200">
                  <th className="text-left p-2">WH</th>
                  <th className="text-left p-2">SKU</th>
                  <th className="text-left p-2">ASIN</th>
                  <th className="text-left p-2">FNSKU</th>
                  <th className="text-left p-2">IWA SKU</th>
                  <th className="text-right p-2">Fulfillable</th>
                  <th className="text-right p-2">Reserved</th>
                  <th className="text-right p-2">Unfulfillable</th>
                  <th className="text-right p-2">Inbound Ship</th>
                  <th className="text-right p-2">Inbound Work</th>
                  <th className="text-right p-2">Inbound Recv</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id} className="border-b border-slate-200">
                    <td className="p-2">{r.warehouse}</td>
                    <td className="p-2 max-w-[130px] overflow-hidden text-ellipsis whitespace-nowrap" title={r.sku}>
                      {r.sku}
                    </td>
                    <td className="p-2">{r.asin}</td>
                    <td className="p-2">{r.fnsku}</td>
                    <td className={`p-2 font-medium ${r.iwasku ? 'text-emerald-600' : 'text-amber-600'}`}>
                      {r.iwasku || '-'}
                    </td>
                    <td className={`p-2 text-right tabular-nums ${r.fulfillable_quantity > 0 ? 'text-emerald-600' : 'text-gray-400'}`}>{r.fulfillable_quantity}</td>
                    <td className={`p-2 text-right tabular-nums ${r.total_reserved_quantity > 0 ? 'text-emerald-600' : 'text-gray-400'}`}>{r.total_reserved_quantity}</td>
                    <td className={`p-2 text-right tabular-nums ${r.total_unfulfillable_quantity > 0 ? 'text-emerald-600' : 'text-gray-400'}`}>{r.total_unfulfillable_quantity}</td>
                    <td className={`p-2 text-right tabular-nums ${r.inbound_shipped_quantity > 0 ? 'text-emerald-600' : 'text-gray-400'}`}>{r.inbound_shipped_quantity}</td>
                    <td className={`p-2 text-right tabular-nums ${r.inbound_working_quantity > 0 ? 'text-emerald-600' : 'text-gray-400'}`}>{r.inbound_working_quantity}</td>
                    <td className={`p-2 text-right tabular-nums ${r.inbound_receiving_quantity > 0 ? 'text-emerald-600' : 'text-gray-400'}`}>{r.inbound_receiving_quantity}</td>
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
