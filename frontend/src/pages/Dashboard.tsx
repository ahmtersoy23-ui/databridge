import { useState, useEffect } from 'react';
import axios from 'axios';

interface SyncInfo {
  job_type: string;
  marketplace: string;
  status: string;
  started_at: string | null;
  completed_at: string | null;
  records_processed: number;
  error_message: string | null;
}

interface SkuQuality {
  orders: { total: string; matched: string; unmatched: string };
  unmatchedOrders: Array<{ sku: string; asin: string; channel: string; order_count: string; total_qty: string }>;
  inventory: { total: string; matched: string; unmatched: string };
  unmatchedInventory: Array<{ sku: string; asin: string; warehouse: string; fulfillable_quantity: number }>;
}

interface WayfairSkuQuality {
  inventory: { total: string; matched: string; unmatched: string };
  unmatchedInventory: Array<{ part_number: string; total_qty: string }>;
}

interface StatusData {
  lastSyncs: SyncInfo[];
  marketplaces: Array<{ country_code: string; channel: string; warehouse: string; region: string; is_active: boolean }>;
  credentials: Array<{ region: string; count: string; has_active: boolean }>;
  dataCounts: { total_orders: string; total_inventory: string; channels_with_data: string; warehouses_with_data: string };
  skuQuality?: SkuQuality;
  wayfairSkuQuality?: WayfairSkuQuality;
}

function SkuMatchQualityCard({ skuQuality, wayfairSkuQuality }: { skuQuality?: SkuQuality; wayfairSkuQuality?: WayfairSkuQuality }) {
  const [tab, setTab] = useState<'amazon' | 'wayfair'>('amazon');

  const renderBar = (q: { total: string; matched: string; unmatched: string }, label: string) => {
    const total = parseInt(q.total);
    const matched = parseInt(q.matched);
    const pct = total > 0 ? ((matched / total) * 100).toFixed(1) : '0';
    return (
      <div>
        <h3 className="text-base text-slate-600 mb-2">{label}</h3>
        <div className="flex gap-6 mb-2">
          <span><strong>{Number(q.total).toLocaleString()}</strong> total</span>
          <span className="text-emerald-600"><strong>{Number(q.matched).toLocaleString()}</strong> matched</span>
          <span className={parseInt(q.unmatched) > 0 ? 'text-amber-600' : 'text-emerald-600'}><strong>{q.unmatched}</strong> unmatched</span>
          <span className="text-blue-600 font-semibold">{pct}%</span>
        </div>
        <div className="bg-slate-200 rounded h-2 overflow-hidden">
          <div className="bg-emerald-600 h-full rounded" style={{ width: `${pct}%` }} />
        </div>
      </div>
    );
  };

  return (
    <div className="bg-white rounded-lg p-6 shadow-sm mb-4">
      <div className="flex items-center gap-4 mb-4">
        <h2 className="m-0">SKU Match Quality</h2>
        <div className="flex gap-1 border-b-2 border-slate-200 ml-4">
          <button
            onClick={() => setTab('amazon')}
            className={`px-4 py-1.5 border-none bg-transparent cursor-pointer text-sm font-medium -mb-[2px] ${
              tab === 'amazon' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-slate-500 border-b-2 border-transparent'
            }`}
          >Amazon</button>
          <button
            onClick={() => setTab('wayfair')}
            className={`px-4 py-1.5 border-none bg-transparent cursor-pointer text-sm font-medium -mb-[2px] ${
              tab === 'wayfair' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-slate-500 border-b-2 border-transparent'
            }`}
          >Wayfair</button>
        </div>
      </div>

      {tab === 'amazon' && skuQuality && (
        <>
          <div className="grid grid-cols-2 gap-6">
            {renderBar(skuQuality.orders, 'Orders')}
            {renderBar(skuQuality.inventory, 'Inventory')}
          </div>
          {(skuQuality.unmatchedOrders.length > 0 || skuQuality.unmatchedInventory.length > 0) && (
            <details className="mt-4">
              <summary className="cursor-pointer text-amber-600 font-medium">
                Unmatched SKUs ({parseInt(skuQuality.orders.unmatched) + parseInt(skuQuality.inventory.unmatched)} total)
              </summary>
              <div className="grid grid-cols-2 gap-6 mt-3">
                {skuQuality.unmatchedOrders.length > 0 && (
                  <div>
                    <h4 className="text-sm text-slate-500 mb-2">Unmatched Orders</h4>
                    <table className="w-full border-collapse text-xs">
                      <thead>
                        <tr className="border-b border-slate-200">
                          <th className="text-left p-1">SKU</th>
                          <th className="text-left p-1">ASIN</th>
                          <th className="text-left p-1">CH</th>
                          <th className="text-right p-1">Orders</th>
                          <th className="text-right p-1">Qty</th>
                        </tr>
                      </thead>
                      <tbody>
                        {skuQuality.unmatchedOrders.map((u, i) => (
                          <tr key={i} className="border-b border-slate-100">
                            <td className="p-1 max-w-[150px] overflow-hidden text-ellipsis whitespace-nowrap" title={u.sku}>{u.sku}</td>
                            <td className="p-1">{u.asin}</td>
                            <td className="p-1">{u.channel}</td>
                            <td className="p-1 text-right">{u.order_count}</td>
                            <td className="p-1 text-right">{u.total_qty}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {skuQuality.unmatchedInventory.length > 0 && (
                  <div>
                    <h4 className="text-sm text-slate-500 mb-2">Unmatched Inventory</h4>
                    <table className="w-full border-collapse text-xs">
                      <thead>
                        <tr className="border-b border-slate-200">
                          <th className="text-left p-1">SKU</th>
                          <th className="text-left p-1">ASIN</th>
                          <th className="text-left p-1">WH</th>
                          <th className="text-right p-1">FBA Qty</th>
                        </tr>
                      </thead>
                      <tbody>
                        {skuQuality.unmatchedInventory.map((u, i) => (
                          <tr key={i} className="border-b border-slate-100">
                            <td className="p-1 max-w-[150px] overflow-hidden text-ellipsis whitespace-nowrap" title={u.sku}>{u.sku}</td>
                            <td className="p-1">{u.asin}</td>
                            <td className="p-1">{u.warehouse}</td>
                            <td className="p-1 text-right">{u.fulfillable_quantity}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </details>
          )}
        </>
      )}

      {tab === 'wayfair' && wayfairSkuQuality && (
        <>
          {renderBar(wayfairSkuQuality.inventory, 'Inventory (Part Numbers)')}
          {wayfairSkuQuality.unmatchedInventory.length > 0 && (
            <details className="mt-4">
              <summary className="cursor-pointer text-amber-600 font-medium">
                Unmatched Part Numbers ({wayfairSkuQuality.inventory.unmatched} total)
              </summary>
              <table className="w-full border-collapse text-xs mt-3">
                <thead>
                  <tr className="border-b border-slate-200">
                    <th className="text-left p-1">Part Number</th>
                    <th className="text-right p-1">Total Qty</th>
                  </tr>
                </thead>
                <tbody>
                  {wayfairSkuQuality.unmatchedInventory.map((u, i) => (
                    <tr key={i} className="border-b border-slate-100">
                      <td className="p-1 font-mono text-sm">{u.part_number}</td>
                      <td className="p-1 text-right">{u.total_qty}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}
        </>
      )}

      {tab === 'amazon' && !skuQuality && (
        <div className="text-slate-400 py-4">No Amazon SKU data available.</div>
      )}
      {tab === 'wayfair' && !wayfairSkuQuality && (
        <div className="text-slate-400 py-4">No Wayfair inventory data available. Run a Wayfair sync first.</div>
      )}
    </div>
  );
}

export default function Dashboard() {
  const [status, setStatus] = useState<StatusData | null>(null);
  const [error, setError] = useState('');
  const [syncing, setSyncing] = useState('');

  const fetchStatus = async () => {
    try {
      const res = await axios.get('/api/v1/status');
      setStatus(res.data.data);
      setError('');
    } catch {
      setError('Failed to load status. Is the backend running?');
    }
  };

  useEffect(() => { fetchStatus(); }, []);

  const triggerSync = async (type: string) => {
    setSyncing(type);
    try {
      await axios.post('/api/v1/sync/trigger', { type });
      setTimeout(fetchStatus, 2000);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Sync trigger failed');
    } finally {
      setSyncing('');
    }
  };

  if (error && !status) {
    return <div className="bg-white rounded-lg p-6 shadow-sm mb-4"><p className="text-red-600">{error}</p></div>;
  }

  if (!status) {
    return <div className="bg-white rounded-lg p-6 shadow-sm mb-4">Loading...</div>;
  }

  const { dataCounts, lastSyncs, marketplaces, credentials } = status;

  return (
    <div>
      <h1 className="mb-6">Dashboard</h1>

      {/* Data overview */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        <div className="bg-white rounded-lg p-6 shadow-sm mb-4">
          <div className="text-3xl font-semibold">{dataCounts.total_orders}</div>
          <div className="text-slate-500">Total Orders</div>
        </div>
        <div className="bg-white rounded-lg p-6 shadow-sm mb-4">
          <div className="text-3xl font-semibold">{dataCounts.total_inventory}</div>
          <div className="text-slate-500">Inventory Items</div>
        </div>
        <div className="bg-white rounded-lg p-6 shadow-sm mb-4">
          <div className="text-3xl font-semibold">{dataCounts.channels_with_data}</div>
          <div className="text-slate-500">Active Channels</div>
        </div>
        <div className="bg-white rounded-lg p-6 shadow-sm mb-4">
          <div className="text-3xl font-semibold">{dataCounts.warehouses_with_data}</div>
          <div className="text-slate-500">Warehouses</div>
        </div>
      </div>

      {/* Sync controls */}
      <div className="bg-white rounded-lg p-6 shadow-sm mb-4">
        <h2 className="mb-4">Manual Sync</h2>
        {(() => {
          const btn = (type: string, label: string, bg: string) => (
            <button
              key={type}
              onClick={() => triggerSync(type)}
              disabled={!!syncing}
              className={`px-4 py-1.5 text-white border-none rounded-md cursor-pointer text-sm ${syncing ? 'opacity-70' : ''}`}
              style={{ background: bg }}
            >
              {syncing === type ? 'Syncing...' : label}
            </button>
          );
          const groupLabel = (text: string) => (
            <div key={text} className="text-[0.72rem] font-semibold text-slate-400 uppercase tracking-wide mb-1.5">{text}</div>
          );
          return (
            <div className="flex gap-8">
              <div>
                {groupLabel('Amazon')}
                <div className="flex gap-2 flex-wrap">
                  {btn('inventory', 'Inventory', '#2563eb')}
                  {btn('sales', 'Sales', '#059669')}
                  {btn('transactions', 'Transactions', '#d97706')}
                  {btn('ads', 'Ads', '#be185d')}
                </div>
              </div>
              <div>
                {groupLabel('Wayfair')}
                <div className="flex gap-2">
                  {btn('wayfair', 'Wayfair', '#ea580c')}
                </div>
              </div>
              <div>
                {groupLabel('Other')}
                <div className="flex gap-2 flex-wrap">
                  {btn('nj_warehouse', 'NJ Warehouse', '#7c3aed')}
                  {btn('wisersell', 'Catalog', '#0891b2')}
                </div>
              </div>
              <div>
                {groupLabel('Master Data')}
                <div className="flex gap-2 flex-wrap">
                  {btn('sku_master_diff', 'SKU Diff', '#475569')}
                  {btn('sku_master_update', 'SKU Update', '#16a34a')}
                </div>
              </div>
            </div>
          );
        })()}
      </div>

      {/* Credentials status */}
      <div className="bg-white rounded-lg p-6 shadow-sm mb-4">
        <h2 className="mb-4">API Credentials</h2>
        {credentials.length === 0 ? (
          <p className="text-red-600">No credentials configured. Go to Settings to add SP-API credentials.</p>
        ) : (
          <div className="flex gap-4">
            {credentials.map(c => (
              <div key={c.region} className={`px-6 py-3 rounded-md ${c.has_active ? 'bg-green-100' : 'bg-red-50'}`}>
                <strong>{c.region}</strong>: {c.has_active ? 'Active' : 'Inactive'}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Marketplaces */}
      <div className="bg-white rounded-lg p-6 shadow-sm mb-4">
        <h2 className="mb-4">Marketplaces</h2>
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b-2 border-slate-200">
              <th className="text-left p-2">Country</th>
              <th className="text-left p-2">Channel</th>
              <th className="text-left p-2">Warehouse</th>
              <th className="text-left p-2">Region</th>
              <th className="text-left p-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {marketplaces.map(mp => (
              <tr key={mp.country_code} className="border-b border-slate-200">
                <td className="p-2">{mp.country_code}</td>
                <td className="p-2">{mp.channel}</td>
                <td className="p-2">{mp.warehouse}</td>
                <td className="p-2">{mp.region}</td>
                <td className="p-2">
                  <span className={mp.is_active ? 'text-emerald-600' : 'text-gray-400'}>
                    {mp.is_active ? 'Active' : 'Inactive'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* SKU Match Quality -- Tabbed (Amazon / Wayfair) */}
      {(status.skuQuality || status.wayfairSkuQuality) && <SkuMatchQualityCard skuQuality={status.skuQuality} wayfairSkuQuality={status.wayfairSkuQuality} />}

      {/* Last syncs */}
      {lastSyncs.length > 0 && (
        <div className="bg-white rounded-lg p-6 shadow-sm mb-4">
          <h2 className="mb-4">Last Sync Results</h2>
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b-2 border-slate-200">
                <th className="text-left p-2">Type</th>
                <th className="text-left p-2">Marketplace</th>
                <th className="text-left p-2">Status</th>
                <th className="text-left p-2">Records</th>
                <th className="text-left p-2">Completed</th>
              </tr>
            </thead>
            <tbody>
              {lastSyncs.map((sync, i) => (
                <tr key={i} className="border-b border-slate-200">
                  <td className="p-2">{sync.job_type}</td>
                  <td className="p-2">{sync.marketplace}</td>
                  <td className="p-2">
                    <span className={
                      sync.status === 'completed' ? 'text-emerald-600' :
                      sync.status === 'failed' ? 'text-red-600' : 'text-amber-600'
                    }>
                      {sync.status}
                    </span>
                  </td>
                  <td className="p-2">{sync.records_processed}</td>
                  <td className="p-2">{sync.completed_at ? new Date(sync.completed_at).toLocaleString() : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
