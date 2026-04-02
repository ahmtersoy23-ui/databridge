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

const cardStyle = {
  background: '#fff',
  borderRadius: '8px',
  padding: '1.5rem',
  boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
  marginBottom: '1rem',
} as const;

function SkuMatchQualityCard({ skuQuality, wayfairSkuQuality }: { skuQuality?: SkuQuality; wayfairSkuQuality?: WayfairSkuQuality }) {
  const [tab, setTab] = useState<'amazon' | 'wayfair'>('amazon');

  const tabBtn = (t: 'amazon' | 'wayfair', label: string) => (
    <button onClick={() => setTab(t)} style={{
      padding: '0.4rem 1.1rem', border: 'none', background: 'none', cursor: 'pointer',
      fontSize: '0.875rem', fontWeight: 500,
      color: tab === t ? '#2563eb' : '#64748b',
      borderBottom: tab === t ? '2px solid #2563eb' : '2px solid transparent',
      marginBottom: '-2px',
    }}>{label}</button>
  );

  const renderBar = (q: { total: string; matched: string; unmatched: string }, label: string) => {
    const total = parseInt(q.total);
    const matched = parseInt(q.matched);
    const pct = total > 0 ? ((matched / total) * 100).toFixed(1) : '0';
    return (
      <div>
        <h3 style={{ fontSize: '0.95rem', color: '#475569', marginBottom: '0.5rem' }}>{label}</h3>
        <div style={{ display: 'flex', gap: '1.5rem', marginBottom: '0.5rem' }}>
          <span><strong>{Number(q.total).toLocaleString()}</strong> total</span>
          <span style={{ color: '#059669' }}><strong>{Number(q.matched).toLocaleString()}</strong> matched</span>
          <span style={{ color: parseInt(q.unmatched) > 0 ? '#d97706' : '#059669' }}><strong>{q.unmatched}</strong> unmatched</span>
          <span style={{ color: '#2563eb', fontWeight: 600 }}>{pct}%</span>
        </div>
        <div style={{ background: '#e2e8f0', borderRadius: '4px', height: '8px', overflow: 'hidden' }}>
          <div style={{ background: '#059669', height: '100%', width: `${pct}%`, borderRadius: '4px' }} />
        </div>
      </div>
    );
  };

  return (
    <div style={cardStyle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1rem' }}>
        <h2 style={{ margin: 0 }}>SKU Match Quality</h2>
        <div style={{ display: 'flex', gap: '0.25rem', borderBottom: '2px solid #e2e8f0', marginLeft: '1rem' }}>
          {tabBtn('amazon', 'Amazon')}
          {tabBtn('wayfair', 'Wayfair')}
        </div>
      </div>

      {tab === 'amazon' && skuQuality && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
            {renderBar(skuQuality.orders, 'Orders')}
            {renderBar(skuQuality.inventory, 'Inventory')}
          </div>
          {(skuQuality.unmatchedOrders.length > 0 || skuQuality.unmatchedInventory.length > 0) && (
            <details style={{ marginTop: '1rem' }}>
              <summary style={{ cursor: 'pointer', color: '#d97706', fontWeight: 500 }}>
                Unmatched SKUs ({parseInt(skuQuality.orders.unmatched) + parseInt(skuQuality.inventory.unmatched)} total)
              </summary>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', marginTop: '0.75rem' }}>
                {skuQuality.unmatchedOrders.length > 0 && (
                  <div>
                    <h4 style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '0.5rem' }}>Unmatched Orders</h4>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
                          <th style={{ textAlign: 'left', padding: '0.25rem' }}>SKU</th>
                          <th style={{ textAlign: 'left', padding: '0.25rem' }}>ASIN</th>
                          <th style={{ textAlign: 'left', padding: '0.25rem' }}>CH</th>
                          <th style={{ textAlign: 'right', padding: '0.25rem' }}>Orders</th>
                          <th style={{ textAlign: 'right', padding: '0.25rem' }}>Qty</th>
                        </tr>
                      </thead>
                      <tbody>
                        {skuQuality.unmatchedOrders.map((u, i) => (
                          <tr key={i} style={{ borderBottom: '1px solid #f1f5f9' }}>
                            <td style={{ padding: '0.25rem', maxWidth: '150px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={u.sku}>{u.sku}</td>
                            <td style={{ padding: '0.25rem' }}>{u.asin}</td>
                            <td style={{ padding: '0.25rem' }}>{u.channel}</td>
                            <td style={{ padding: '0.25rem', textAlign: 'right' }}>{u.order_count}</td>
                            <td style={{ padding: '0.25rem', textAlign: 'right' }}>{u.total_qty}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {skuQuality.unmatchedInventory.length > 0 && (
                  <div>
                    <h4 style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '0.5rem' }}>Unmatched Inventory</h4>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
                          <th style={{ textAlign: 'left', padding: '0.25rem' }}>SKU</th>
                          <th style={{ textAlign: 'left', padding: '0.25rem' }}>ASIN</th>
                          <th style={{ textAlign: 'left', padding: '0.25rem' }}>WH</th>
                          <th style={{ textAlign: 'right', padding: '0.25rem' }}>FBA Qty</th>
                        </tr>
                      </thead>
                      <tbody>
                        {skuQuality.unmatchedInventory.map((u, i) => (
                          <tr key={i} style={{ borderBottom: '1px solid #f1f5f9' }}>
                            <td style={{ padding: '0.25rem', maxWidth: '150px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={u.sku}>{u.sku}</td>
                            <td style={{ padding: '0.25rem' }}>{u.asin}</td>
                            <td style={{ padding: '0.25rem' }}>{u.warehouse}</td>
                            <td style={{ padding: '0.25rem', textAlign: 'right' }}>{u.fulfillable_quantity}</td>
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
            <details style={{ marginTop: '1rem' }}>
              <summary style={{ cursor: 'pointer', color: '#d97706', fontWeight: 500 }}>
                Unmatched Part Numbers ({wayfairSkuQuality.inventory.unmatched} total)
              </summary>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem', marginTop: '0.75rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #e2e8f0' }}>
                    <th style={{ textAlign: 'left', padding: '0.25rem' }}>Part Number</th>
                    <th style={{ textAlign: 'right', padding: '0.25rem' }}>Total Qty</th>
                  </tr>
                </thead>
                <tbody>
                  {wayfairSkuQuality.unmatchedInventory.map((u, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '0.25rem', fontFamily: 'monospace', fontSize: '0.82rem' }}>{u.part_number}</td>
                      <td style={{ padding: '0.25rem', textAlign: 'right' }}>{u.total_qty}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}
        </>
      )}

      {tab === 'amazon' && !skuQuality && (
        <div style={{ color: '#94a3b8', padding: '1rem 0' }}>No Amazon SKU data available.</div>
      )}
      {tab === 'wayfair' && !wayfairSkuQuality && (
        <div style={{ color: '#94a3b8', padding: '1rem 0' }}>No Wayfair inventory data available. Run a Wayfair sync first.</div>
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
    return <div style={cardStyle}><p style={{ color: '#dc2626' }}>{error}</p></div>;
  }

  if (!status) {
    return <div style={cardStyle}>Loading...</div>;
  }

  const { dataCounts, lastSyncs, marketplaces, credentials } = status;

  return (
    <div>
      <h1 style={{ marginBottom: '1.5rem' }}>Dashboard</h1>

      {/* Data overview */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem', marginBottom: '2rem' }}>
        <div style={cardStyle}>
          <div style={{ fontSize: '2rem', fontWeight: 'bold' }}>{dataCounts.total_orders}</div>
          <div style={{ color: '#64748b' }}>Total Orders</div>
        </div>
        <div style={cardStyle}>
          <div style={{ fontSize: '2rem', fontWeight: 'bold' }}>{dataCounts.total_inventory}</div>
          <div style={{ color: '#64748b' }}>Inventory Items</div>
        </div>
        <div style={cardStyle}>
          <div style={{ fontSize: '2rem', fontWeight: 'bold' }}>{dataCounts.channels_with_data}</div>
          <div style={{ color: '#64748b' }}>Active Channels</div>
        </div>
        <div style={cardStyle}>
          <div style={{ fontSize: '2rem', fontWeight: 'bold' }}>{dataCounts.warehouses_with_data}</div>
          <div style={{ color: '#64748b' }}>Warehouses</div>
        </div>
      </div>

      {/* Sync controls */}
      <div style={cardStyle}>
        <h2 style={{ marginBottom: '1rem' }}>Manual Sync</h2>
        {(() => {
          const btn = (type: string, label: string, bg: string) => (
            <button
              key={type}
              onClick={() => triggerSync(type)}
              disabled={!!syncing}
              style={{ padding: '0.45rem 1.2rem', background: bg, color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '0.85rem', opacity: syncing ? 0.7 : 1 }}
            >
              {syncing === type ? 'Syncing...' : label}
            </button>
          );
          const groupLabel = (text: string) => (
            <div key={text} style={{ fontSize: '0.72rem', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase' as const, letterSpacing: '0.05em', marginBottom: '0.4rem' }}>{text}</div>
          );
          return (
            <div style={{ display: 'flex', gap: '2rem' }}>
              <div>
                {groupLabel('Amazon')}
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  {btn('inventory', 'Inventory', '#2563eb')}
                  {btn('inventory_aging', 'Inv. Aging', '#6366f1')}
                  {btn('sales', 'Sales', '#059669')}
                  {btn('transactions', 'Transactions', '#d97706')}
                  {btn('ads', 'Ads', '#be185d')}
                </div>
              </div>
              <div>
                {groupLabel('Wayfair')}
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  {btn('wayfair', 'Wayfair', '#ea580c')}
                </div>
              </div>
              <div>
                {groupLabel('Other')}
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  {btn('nj_warehouse', 'NJ Warehouse', '#7c3aed')}
                  {btn('wisersell', 'Catalog', '#0891b2')}
                </div>
              </div>
            </div>
          );
        })()}
      </div>

      {/* Credentials status */}
      <div style={cardStyle}>
        <h2 style={{ marginBottom: '1rem' }}>API Credentials</h2>
        {credentials.length === 0 ? (
          <p style={{ color: '#dc2626' }}>No credentials configured. Go to Settings to add SP-API credentials.</p>
        ) : (
          <div style={{ display: 'flex', gap: '1rem' }}>
            {credentials.map(c => (
              <div key={c.region} style={{ padding: '0.75rem 1.5rem', background: c.has_active ? '#dcfce7' : '#fef2f2', borderRadius: '6px' }}>
                <strong>{c.region}</strong>: {c.has_active ? 'Active' : 'Inactive'}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Marketplaces */}
      <div style={cardStyle}>
        <h2 style={{ marginBottom: '1rem' }}>Marketplaces</h2>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #e2e8f0' }}>
              <th style={{ textAlign: 'left', padding: '0.5rem' }}>Country</th>
              <th style={{ textAlign: 'left', padding: '0.5rem' }}>Channel</th>
              <th style={{ textAlign: 'left', padding: '0.5rem' }}>Warehouse</th>
              <th style={{ textAlign: 'left', padding: '0.5rem' }}>Region</th>
              <th style={{ textAlign: 'left', padding: '0.5rem' }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {marketplaces.map(mp => (
              <tr key={mp.country_code} style={{ borderBottom: '1px solid #e2e8f0' }}>
                <td style={{ padding: '0.5rem' }}>{mp.country_code}</td>
                <td style={{ padding: '0.5rem' }}>{mp.channel}</td>
                <td style={{ padding: '0.5rem' }}>{mp.warehouse}</td>
                <td style={{ padding: '0.5rem' }}>{mp.region}</td>
                <td style={{ padding: '0.5rem' }}>
                  <span style={{ color: mp.is_active ? '#059669' : '#9ca3af' }}>
                    {mp.is_active ? 'Active' : 'Inactive'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* SKU Match Quality — Tabbed (Amazon / Wayfair) */}
      {(status.skuQuality || status.wayfairSkuQuality) && <SkuMatchQualityCard skuQuality={status.skuQuality} wayfairSkuQuality={status.wayfairSkuQuality} />}

      {/* Last syncs */}
      {lastSyncs.length > 0 && (
        <div style={cardStyle}>
          <h2 style={{ marginBottom: '1rem' }}>Last Sync Results</h2>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #e2e8f0' }}>
                <th style={{ textAlign: 'left', padding: '0.5rem' }}>Type</th>
                <th style={{ textAlign: 'left', padding: '0.5rem' }}>Marketplace</th>
                <th style={{ textAlign: 'left', padding: '0.5rem' }}>Status</th>
                <th style={{ textAlign: 'left', padding: '0.5rem' }}>Records</th>
                <th style={{ textAlign: 'left', padding: '0.5rem' }}>Completed</th>
              </tr>
            </thead>
            <tbody>
              {lastSyncs.map((sync, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #e2e8f0' }}>
                  <td style={{ padding: '0.5rem' }}>{sync.job_type}</td>
                  <td style={{ padding: '0.5rem' }}>{sync.marketplace}</td>
                  <td style={{ padding: '0.5rem' }}>
                    <span style={{ color: sync.status === 'completed' ? '#059669' : sync.status === 'failed' ? '#dc2626' : '#d97706' }}>
                      {sync.status}
                    </span>
                  </td>
                  <td style={{ padding: '0.5rem' }}>{sync.records_processed}</td>
                  <td style={{ padding: '0.5rem' }}>{sync.completed_at ? new Date(sync.completed_at).toLocaleString() : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
