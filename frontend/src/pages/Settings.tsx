import { useState, useEffect } from 'react';
import axios from 'axios';

interface WisersellConfig {
  configured: boolean;
  email?: string;
  api_url?: string;
  updated_at?: string;
}

interface WayfairAccount {
  id: number;
  label: string;
  client_id: string;
  use_sandbox: boolean;
  supplier_id: number | null;
  channel: string;
  warehouse: string;
  is_active: boolean;
  updated_at: string;
}

interface Credential {
  id: number;
  region: string;
  seller_id: string;
  account_name: string;
  is_active: boolean;
  refresh_token_preview: string;
  client_id_preview: string;
  created_at: string;
}

const emptyForm = { region: 'NA', seller_id: '', refresh_token: '', client_id: '', client_secret: '', account_name: '' };

const cardStyle = {
  background: '#fff',
  borderRadius: '8px',
  padding: '1.5rem',
  boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
  marginBottom: '1rem',
} as const;

const inputStyle = {
  width: '100%',
  padding: '0.5rem',
  border: '1px solid #d1d5db',
  borderRadius: '6px',
  fontSize: '0.9rem',
  marginBottom: '0.75rem',
} as const;

const btnStyle = (bg: string) => ({
  padding: '0.25rem 0.75rem',
  background: bg,
  color: '#fff',
  border: 'none',
  borderRadius: '4px',
  cursor: 'pointer' as const,
  fontSize: '0.8rem',
  marginRight: '0.25rem',
});

const emptyWisersellForm = { email: '', password: '', api_url: 'https://dev2.wisersell.com/restapi' };
const emptyWayfairForm = { label: '', client_id: '', client_secret: '', use_sandbox: false, supplier_id: '', channel: '', warehouse: '' };

export default function Settings() {
  const [activeTab, setActiveTab] = useState<'amazon' | 'wayfair' | 'wisersell' | 'ads'>('amazon');
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [deleting, setDeleting] = useState<number | null>(null);

  const [wisersellConfig, setWisersellConfig] = useState<WisersellConfig | null>(null);
  const [wisersellForm, setWisersellForm] = useState(emptyWisersellForm);
  const [wisersellSaving, setWisersellSaving] = useState(false);
  const [wisersellMessage, setWisersellMessage] = useState('');

  const [wayfairAccounts, setWayfairAccounts] = useState<WayfairAccount[]>([]);
  const [wayfairForm, setWayfairForm] = useState(emptyWayfairForm);
  const [wayfairEditingId, setWayfairEditingId] = useState<number | null>(null);
  const [wayfairSaving, setWayfairSaving] = useState(false);
  const [wayfairMessage, setWayfairMessage] = useState('');
  const [wayfairTesting, setWayfairTesting] = useState<number | null>(null);
  const [wayfairDeleting, setWayfairDeleting] = useState<number | null>(null);

  // Ads state
  const [adsCredentials, setAdsCredentials] = useState<Array<{ id: number; region: string; account_name: string; is_active: boolean; has_ads_token: boolean }>>([]);
  const [adsProfiles, setAdsProfiles] = useState<Array<{ id: number; credential_id: number; profile_id: number; country_code: string; account_name: string; is_active: boolean; credential_name: string; region: string }>>([]);
  const [adsTokenForm, setAdsTokenForm] = useState<{ credentialId: number | null; token: string }>({ credentialId: null, token: '' });
  const [adsSaving, setAdsSaving] = useState(false);
  const [adsDiscovering, setAdsDiscovering] = useState(false);
  const [adsMessage, setAdsMessage] = useState('');

  const fetchCredentials = async () => {
    try {
      const res = await axios.get('/api/v1/credentials');
      setCredentials(res.data.data);
    } catch {
      // Not authenticated or no credentials
    }
  };

  const fetchWisersellConfig = async () => {
    try {
      const res = await axios.get('/api/v1/wisersell-settings');
      setWisersellConfig(res.data);
      if (res.data.configured) {
        setWisersellForm(prev => ({ ...prev, email: res.data.email, api_url: res.data.api_url }));
      }
    } catch {
      // ignore
    }
  };

  const fetchWayfairAccounts = async () => {
    try {
      const res = await axios.get('/api/v1/wayfair/settings');
      setWayfairAccounts(res.data.accounts || []);
    } catch {
      // ignore
    }
  };

  const fetchAdsCredentials = async () => {
    try {
      const res = await axios.get('/api/v1/ads/credentials');
      setAdsCredentials(res.data.data);
    } catch { /* ignore */ }
  };

  const fetchAdsProfiles = async () => {
    try {
      const res = await axios.get('/api/v1/ads/profiles');
      setAdsProfiles(res.data.data);
    } catch { /* ignore */ }
  };

  useEffect(() => { fetchCredentials(); fetchWisersellConfig(); fetchWayfairAccounts(); fetchAdsCredentials(); fetchAdsProfiles(); }, []);

  const handleEdit = (c: Credential) => {
    setEditingId(c.id);
    setForm({
      region: c.region,
      seller_id: c.seller_id,
      refresh_token: '',
      client_id: '',
      client_secret: '',
      account_name: c.account_name || '',
    });
    setMessage('Fill only fields you want to change. Leave blank to keep current value.');
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setForm(emptyForm);
    setMessage('');
  };

  const handleToggle = async (id: number) => {
    try {
      await axios.patch(`/api/v1/credentials/${id}/toggle`);
      fetchCredentials();
    } catch {
      // ignore
    }
  };

  const handleDelete = async (id: number, region: string) => {
    if (!confirm(`Delete ${region} credentials?`)) return;
    setDeleting(id);
    try {
      await axios.delete(`/api/v1/credentials/${id}`);
      fetchCredentials();
    } catch {
      // ignore
    } finally {
      setDeleting(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage('');

    try {
      if (editingId) {
        // Update: only send non-empty fields
        const updates: Record<string, string> = {};
        for (const [key, val] of Object.entries(form)) {
          if (val) updates[key] = val;
        }
        await axios.put(`/api/v1/credentials/${editingId}`, updates);
        setMessage('Credentials updated successfully!');
        setEditingId(null);
      } else {
        await axios.post('/api/v1/credentials', form);
        setMessage('Credentials saved successfully!');
      }
      setForm(emptyForm);
      fetchCredentials();
    } catch (err: any) {
      setMessage(err.response?.data?.error || 'Failed to save credentials');
    } finally {
      setSaving(false);
    }
  };

  const handleWayfairEdit = (a: WayfairAccount) => {
    setWayfairEditingId(a.id);
    setWayfairForm({
      label: a.label,
      client_id: a.client_id,
      client_secret: '',
      use_sandbox: a.use_sandbox,
      supplier_id: a.supplier_id ? String(a.supplier_id) : '',
      channel: a.channel,
      warehouse: a.warehouse,
    });
    setWayfairMessage('');
  };

  const handleWayfairCancelEdit = () => {
    setWayfairEditingId(null);
    setWayfairForm(emptyWayfairForm);
    setWayfairMessage('');
  };

  const handleWayfairSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setWayfairSaving(true);
    setWayfairMessage('');
    try {
      if (wayfairEditingId) {
        const updates: Record<string, unknown> = {};
        if (wayfairForm.label) updates.label = wayfairForm.label;
        if (wayfairForm.client_id) updates.client_id = wayfairForm.client_id;
        if (wayfairForm.client_secret) updates.client_secret = wayfairForm.client_secret;
        updates.use_sandbox = wayfairForm.use_sandbox;
        if (wayfairForm.supplier_id) updates.supplier_id = parseInt(wayfairForm.supplier_id, 10);
        if (wayfairForm.channel) updates.channel = wayfairForm.channel;
        if (wayfairForm.warehouse) updates.warehouse = wayfairForm.warehouse;
        await axios.put(`/api/v1/wayfair/settings/${wayfairEditingId}`, updates);
        setWayfairMessage('Updated successfully!');
        setWayfairEditingId(null);
      } else {
        const payload: Record<string, unknown> = {
          label: wayfairForm.label,
          client_id: wayfairForm.client_id,
          client_secret: wayfairForm.client_secret,
          use_sandbox: wayfairForm.use_sandbox,
          channel: wayfairForm.channel,
          warehouse: wayfairForm.warehouse,
        };
        if (wayfairForm.supplier_id) payload.supplier_id = parseInt(wayfairForm.supplier_id, 10);
        await axios.post('/api/v1/wayfair/settings', payload);
        setWayfairMessage('Account added successfully!');
      }
      setWayfairForm(emptyWayfairForm);
      fetchWayfairAccounts();
    } catch (err: any) {
      setWayfairMessage(err.response?.data?.error || 'Failed to save');
    } finally {
      setWayfairSaving(false);
    }
  };

  const handleWayfairTest = async (id: number) => {
    setWayfairTesting(id);
    setWayfairMessage('');
    try {
      const res = await axios.post(`/api/v1/wayfair/settings/${id}/test`);
      setWayfairMessage(`Connection OK — ${res.data.sandbox ? 'Sandbox' : 'Production'}${res.data.supplierId ? `, Supplier: ${res.data.supplierId}` : ''}`);
    } catch (err: any) {
      setWayfairMessage(err.response?.data?.error || 'Connection failed');
    } finally {
      setWayfairTesting(null);
    }
  };

  const handleWayfairToggle = async (id: number, currentActive: boolean) => {
    try {
      await axios.put(`/api/v1/wayfair/settings/${id}`, { is_active: !currentActive });
      fetchWayfairAccounts();
    } catch { /* ignore */ }
  };

  const handleWayfairDelete = async (id: number, label: string) => {
    if (!confirm(`Delete Wayfair account "${label}"?`)) return;
    setWayfairDeleting(id);
    try {
      await axios.delete(`/api/v1/wayfair/settings/${id}`);
      fetchWayfairAccounts();
    } catch (err: any) {
      setWayfairMessage(err.response?.data?.error || 'Failed to delete');
    } finally {
      setWayfairDeleting(null);
    }
  };

  const handleWisersellSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setWisersellSaving(true);
    setWisersellMessage('');
    try {
      await axios.post('/api/v1/wisersell-settings', wisersellForm);
      setWisersellMessage('Saved successfully!');
      fetchWisersellConfig();
    } catch (err: any) {
      setWisersellMessage(err.response?.data?.error || 'Failed to save');
    } finally {
      setWisersellSaving(false);
    }
  };

  const handleAdsSaveToken = async (credId: number) => {
    if (!adsTokenForm.token) return;
    setAdsSaving(true);
    setAdsMessage('');
    try {
      await axios.put(`/api/v1/ads/credentials/${credId}`, { ads_refresh_token: adsTokenForm.token });
      setAdsMessage('Ads refresh token saved!');
      setAdsTokenForm({ credentialId: null, token: '' });
      fetchAdsCredentials();
    } catch (err: any) {
      setAdsMessage(err.response?.data?.error || 'Failed to save');
    } finally {
      setAdsSaving(false);
    }
  };

  const handleAdsDiscover = async (credId: number) => {
    setAdsDiscovering(true);
    setAdsMessage('');
    try {
      const res = await axios.post('/api/v1/ads/profiles/discover', { credential_id: credId });
      setAdsMessage(`Discovered ${res.data.count} profiles`);
      fetchAdsProfiles();
    } catch (err: any) {
      setAdsMessage(err.response?.data?.error || 'Discovery failed');
    } finally {
      setAdsDiscovering(false);
    }
  };

  const handleAdsToggleProfile = async (id: number) => {
    try {
      await axios.patch(`/api/v1/ads/profiles/${id}/toggle`);
      fetchAdsProfiles();
    } catch { /* ignore */ }
  };

  const tabBtn = (tab: typeof activeTab, label: string) => (
    <button key={tab} onClick={() => setActiveTab(tab)}
      style={{
        padding: '0.5rem 1.25rem', border: 'none', background: 'none', cursor: 'pointer',
        fontSize: '0.9rem', fontWeight: 500,
        color: activeTab === tab ? '#0891b2' : '#64748b',
        borderBottom: activeTab === tab ? '2px solid #0891b2' : '2px solid transparent',
        marginBottom: '-2px',
      }}>
      {label}
    </button>
  );

  return (
    <div>
      <h1 style={{ marginBottom: '1rem' }}>Settings</h1>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: '0.25rem', marginBottom: '1.5rem', borderBottom: '2px solid #e2e8f0' }}>
        {tabBtn('amazon', 'Amazon SP-API')}
        {tabBtn('ads', 'Amazon Ads')}
        {tabBtn('wayfair', 'Wayfair')}
        {tabBtn('wisersell', 'Wisersell')}
      </div>

      {/* Amazon SP-API tab — credentials table */}
      {activeTab === 'amazon' && <div style={cardStyle}>
        <h2 style={{ marginBottom: '1rem' }}>Current Credentials</h2>
        {credentials.length === 0 ? (
          <p style={{ color: '#64748b' }}>No credentials configured yet.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #e2e8f0' }}>
                <th style={{ textAlign: 'left', padding: '0.5rem' }}>Region</th>
                <th style={{ textAlign: 'left', padding: '0.5rem' }}>Account</th>
                <th style={{ textAlign: 'left', padding: '0.5rem' }}>Seller ID</th>
                <th style={{ textAlign: 'left', padding: '0.5rem' }}>Client ID</th>
                <th style={{ textAlign: 'left', padding: '0.5rem' }}>Status</th>
                <th style={{ textAlign: 'left', padding: '0.5rem' }}>Added</th>
                <th style={{ textAlign: 'left', padding: '0.5rem' }}></th>
              </tr>
            </thead>
            <tbody>
              {credentials.map(c => (
                <tr key={c.id} style={{ borderBottom: '1px solid #e2e8f0', background: editingId === c.id ? '#eff6ff' : undefined }}>
                  <td style={{ padding: '0.5rem' }}>{c.region}</td>
                  <td style={{ padding: '0.5rem' }}>{c.account_name || '-'}</td>
                  <td style={{ padding: '0.5rem' }}>{c.seller_id}</td>
                  <td style={{ padding: '0.5rem' }}>{c.client_id_preview}</td>
                  <td style={{ padding: '0.5rem' }}>
                    <span style={{ color: c.is_active ? '#059669' : '#9ca3af' }}>
                      {c.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td style={{ padding: '0.5rem' }}>{new Date(c.created_at).toLocaleDateString()}</td>
                  <td style={{ padding: '0.5rem' }}>
                    <button onClick={() => handleToggle(c.id)} style={btnStyle(c.is_active ? '#d97706' : '#059669')}>
                      {c.is_active ? 'Deactivate' : 'Activate'}
                    </button>
                    <button onClick={() => handleEdit(c)} style={btnStyle('#2563eb')}>Edit</button>
                    <button
                      onClick={() => handleDelete(c.id, c.region)}
                      disabled={deleting === c.id}
                      style={btnStyle('#dc2626')}
                    >
                      {deleting === c.id ? '...' : 'Delete'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>}

      {/* Wisersell credentials */}
      {activeTab === 'wisersell' && <div style={cardStyle}>
        <h2 style={{ marginBottom: '0.5rem' }}>Wisersell API</h2>
        {wisersellConfig?.configured && (
          <p style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '1rem' }}>
            Current: <strong>{wisersellConfig.email}</strong> — {wisersellConfig.api_url}
            {wisersellConfig.updated_at && ` (updated ${new Date(wisersellConfig.updated_at).toLocaleDateString()})`}
          </p>
        )}
        <form onSubmit={handleWisersellSubmit}>
          <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: 500 }}>Email</label>
          <input
            type="email"
            placeholder="wisersell@example.com"
            value={wisersellForm.email}
            onChange={e => setWisersellForm({ ...wisersellForm, email: e.target.value })}
            style={inputStyle}
            required
          />
          <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: 500 }}>Password</label>
          <input
            type="password"
            placeholder={wisersellConfig?.configured ? 'Leave blank to keep current' : 'Password'}
            value={wisersellForm.password}
            onChange={e => setWisersellForm({ ...wisersellForm, password: e.target.value })}
            style={inputStyle}
            required={!wisersellConfig?.configured}
          />
          <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: 500 }}>API URL</label>
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem' }}>
            <button type="button"
              onClick={() => setWisersellForm({ ...wisersellForm, api_url: 'https://dev2.wisersell.com/restapi' })}
              style={{ ...btnStyle(wisersellForm.api_url.includes('dev2') ? '#2563eb' : '#94a3b8'), fontSize: '0.75rem' }}>
              Dev
            </button>
            <button type="button"
              onClick={() => setWisersellForm({ ...wisersellForm, api_url: 'https://www.wisersell.com/restapi' })}
              style={{ ...btnStyle(!wisersellForm.api_url.includes('dev2') ? '#059669' : '#94a3b8'), fontSize: '0.75rem' }}>
              Prod
            </button>
            <input
              type="text"
              value={wisersellForm.api_url}
              onChange={e => setWisersellForm({ ...wisersellForm, api_url: e.target.value })}
              style={{ ...inputStyle, marginBottom: 0, flex: 1 }}
            />
          </div>
          {wisersellMessage && (
            <p style={{ color: wisersellMessage.includes('success') ? '#059669' : '#dc2626', marginBottom: '0.75rem' }}>
              {wisersellMessage}
            </p>
          )}
          <button type="submit" disabled={wisersellSaving}
            style={{ padding: '0.5rem 2rem', background: '#0891b2', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer' }}>
            {wisersellSaving ? 'Saving...' : wisersellConfig?.configured ? 'Update' : 'Save'}
          </button>
        </form>
      </div>}

      {/* Wayfair accounts */}
      {activeTab === 'wayfair' && <>
        <div style={cardStyle}>
          <h2 style={{ marginBottom: '1rem' }}>Wayfair Accounts</h2>
          {wayfairMessage && (
            <p style={{ color: wayfairMessage.includes('OK') || wayfairMessage.includes('success') || wayfairMessage.includes('Updated') || wayfairMessage.includes('added') ? '#059669' : '#dc2626', marginBottom: '0.75rem' }}>
              {wayfairMessage}
            </p>
          )}
          {wayfairAccounts.length === 0 ? (
            <p style={{ color: '#64748b' }}>No Wayfair accounts configured yet.</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #e2e8f0' }}>
                  <th style={{ textAlign: 'left', padding: '0.5rem' }}>Account</th>
                  <th style={{ textAlign: 'left', padding: '0.5rem' }}>Client ID</th>
                  <th style={{ textAlign: 'left', padding: '0.5rem' }}>Channel</th>
                  <th style={{ textAlign: 'left', padding: '0.5rem' }}>Warehouse</th>
                  <th style={{ textAlign: 'left', padding: '0.5rem' }}>Supplier</th>
                  <th style={{ textAlign: 'left', padding: '0.5rem' }}>Status</th>
                  <th style={{ textAlign: 'left', padding: '0.5rem' }}>Updated</th>
                  <th style={{ textAlign: 'left', padding: '0.5rem' }}></th>
                </tr>
              </thead>
              <tbody>
                {wayfairAccounts.map(a => (
                  <tr key={a.id} style={{ borderBottom: '1px solid #e2e8f0', background: wayfairEditingId === a.id ? '#eff6ff' : undefined }}>
                    <td style={{ padding: '0.5rem', fontWeight: 600, textTransform: 'capitalize' }}>{a.label}</td>
                    <td style={{ padding: '0.5rem', fontFamily: 'monospace', fontSize: '0.82rem' }}>{a.client_id.slice(0, 8)}...{a.client_id.slice(-4)}</td>
                    <td style={{ padding: '0.5rem' }}>{a.channel}</td>
                    <td style={{ padding: '0.5rem' }}>{a.warehouse}</td>
                    <td style={{ padding: '0.5rem' }}>{a.supplier_id || '—'}</td>
                    <td style={{ padding: '0.5rem' }}>
                      <span style={{ color: a.is_active ? '#059669' : '#9ca3af' }}>
                        {a.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td style={{ padding: '0.5rem', fontSize: '0.82rem', color: '#64748b' }}>
                      {a.updated_at ? new Date(a.updated_at).toLocaleDateString() : '—'}
                    </td>
                    <td style={{ padding: '0.5rem', whiteSpace: 'nowrap' }}>
                      <button onClick={() => handleWayfairTest(a.id)} disabled={wayfairTesting === a.id} style={btnStyle('#6366f1')}>
                        {wayfairTesting === a.id ? '...' : 'Test'}
                      </button>
                      <button onClick={() => handleWayfairToggle(a.id, a.is_active)} style={btnStyle(a.is_active ? '#d97706' : '#059669')}>
                        {a.is_active ? 'Deactivate' : 'Activate'}
                      </button>
                      <button onClick={() => handleWayfairEdit(a)} style={btnStyle('#2563eb')}>Edit</button>
                      <button onClick={() => handleWayfairDelete(a.id, a.label)} disabled={wayfairDeleting === a.id} style={btnStyle('#dc2626')}>
                        {wayfairDeleting === a.id ? '...' : 'Delete'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Wayfair Add/Edit form */}
        <div style={cardStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h2>{wayfairEditingId ? `Edit — ${wayfairForm.label}` : 'Add Wayfair Account'}</h2>
            {wayfairEditingId && (
              <button onClick={handleWayfairCancelEdit} style={{ ...btnStyle('#6b7280'), fontSize: '0.85rem', padding: '0.35rem 1rem' }}>
                Cancel
              </button>
            )}
          </div>
          <form onSubmit={handleWayfairSubmit}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 1rem' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: 500 }}>Account Label</label>
                <input type="text" placeholder="e.g. shukran, mdn" value={wayfairForm.label}
                  onChange={e => setWayfairForm({ ...wayfairForm, label: e.target.value })}
                  style={inputStyle} required />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: 500 }}>
                  Supplier ID <span style={{ fontWeight: 400, color: '#94a3b8', fontSize: '0.8rem' }}>(auto-discovered)</span>
                </label>
                <input type="number" placeholder="e.g. 194115" value={wayfairForm.supplier_id}
                  onChange={e => setWayfairForm({ ...wayfairForm, supplier_id: e.target.value })}
                  style={inputStyle} />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: 500 }}>Client ID</label>
                <input type="text" placeholder="Wayfair Client ID" value={wayfairForm.client_id}
                  onChange={e => setWayfairForm({ ...wayfairForm, client_id: e.target.value })}
                  style={inputStyle} required={!wayfairEditingId} />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: 500 }}>Client Secret</label>
                <input type="password" placeholder={wayfairEditingId ? 'Leave blank to keep current' : 'Client Secret'}
                  value={wayfairForm.client_secret}
                  onChange={e => setWayfairForm({ ...wayfairForm, client_secret: e.target.value })}
                  style={inputStyle} required={!wayfairEditingId} />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: 500 }}>Sales Channel</label>
                <input type="text" placeholder="e.g. wfs, wfm" value={wayfairForm.channel}
                  onChange={e => setWayfairForm({ ...wayfairForm, channel: e.target.value })}
                  style={inputStyle} required={!wayfairEditingId} />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: 500 }}>Warehouse Code</label>
                <input type="text" placeholder="e.g. WFS, WFM" value={wayfairForm.warehouse}
                  onChange={e => setWayfairForm({ ...wayfairForm, warehouse: e.target.value })}
                  style={inputStyle} required={!wayfairEditingId} />
              </div>
            </div>
            <button type="submit" disabled={wayfairSaving}
              style={{ padding: '0.5rem 2rem', background: wayfairEditingId ? '#059669' : '#2563eb', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer' }}>
              {wayfairSaving ? 'Saving...' : wayfairEditingId ? 'Update Account' : 'Add Account'}
            </button>
          </form>
        </div>
      </>}

      {/* Amazon Ads tab */}
      {activeTab === 'ads' && <>
        <div style={cardStyle}>
          <h2 style={{ marginBottom: '1rem' }}>Ads API Credentials</h2>
          <p style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '1rem' }}>
            Each SP-API credential needs a separate Ads refresh token with <code>advertising::campaign_management</code> scope.
          </p>
          {adsMessage && (
            <p style={{ color: adsMessage.includes('saved') || adsMessage.includes('Discovered') ? '#059669' : '#dc2626', marginBottom: '0.75rem' }}>
              {adsMessage}
            </p>
          )}
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #e2e8f0' }}>
                <th style={{ textAlign: 'left', padding: '0.5rem' }}>Region</th>
                <th style={{ textAlign: 'left', padding: '0.5rem' }}>Account</th>
                <th style={{ textAlign: 'left', padding: '0.5rem' }}>Ads Token</th>
                <th style={{ textAlign: 'left', padding: '0.5rem' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {adsCredentials.map(c => (
                <tr key={c.id} style={{ borderBottom: '1px solid #e2e8f0' }}>
                  <td style={{ padding: '0.5rem' }}>{c.region}</td>
                  <td style={{ padding: '0.5rem' }}>{c.account_name || '-'}</td>
                  <td style={{ padding: '0.5rem' }}>
                    {adsTokenForm.credentialId === c.id ? (
                      <div style={{ display: 'flex', gap: '0.25rem' }}>
                        <input
                          type="password"
                          placeholder="Atzr|xxx..."
                          value={adsTokenForm.token}
                          onChange={e => setAdsTokenForm({ ...adsTokenForm, token: e.target.value })}
                          style={{ ...inputStyle, marginBottom: 0, flex: 1 }}
                        />
                        <button onClick={() => handleAdsSaveToken(c.id)} disabled={adsSaving} style={btnStyle('#059669')}>
                          {adsSaving ? '...' : 'Save'}
                        </button>
                        <button onClick={() => setAdsTokenForm({ credentialId: null, token: '' })} style={btnStyle('#6b7280')}>
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <span style={{ color: c.has_ads_token ? '#059669' : '#9ca3af' }}>
                        {c.has_ads_token ? 'Configured' : 'Not set'}
                      </span>
                    )}
                  </td>
                  <td style={{ padding: '0.5rem' }}>
                    {adsTokenForm.credentialId !== c.id && (
                      <>
                        <button onClick={() => setAdsTokenForm({ credentialId: c.id, token: '' })} style={btnStyle('#2563eb')}>
                          {c.has_ads_token ? 'Update Token' : 'Set Token'}
                        </button>
                        {c.has_ads_token && (
                          <button onClick={() => handleAdsDiscover(c.id)} disabled={adsDiscovering} style={btnStyle('#6366f1')}>
                            {adsDiscovering ? '...' : 'Discover Profiles'}
                          </button>
                        )}
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={cardStyle}>
          <h2 style={{ marginBottom: '1rem' }}>Ads Profiles</h2>
          {adsProfiles.length === 0 ? (
            <p style={{ color: '#64748b' }}>No profiles discovered yet. Set an Ads token and click "Discover Profiles".</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #e2e8f0' }}>
                  <th style={{ textAlign: 'left', padding: '0.5rem' }}>Country</th>
                  <th style={{ textAlign: 'left', padding: '0.5rem' }}>Account</th>
                  <th style={{ textAlign: 'left', padding: '0.5rem' }}>Profile ID</th>
                  <th style={{ textAlign: 'left', padding: '0.5rem' }}>Credential</th>
                  <th style={{ textAlign: 'left', padding: '0.5rem' }}>Status</th>
                  <th style={{ textAlign: 'left', padding: '0.5rem' }}></th>
                </tr>
              </thead>
              <tbody>
                {adsProfiles.map(p => (
                  <tr key={p.id} style={{ borderBottom: '1px solid #e2e8f0' }}>
                    <td style={{ padding: '0.5rem', fontWeight: 500 }}>{p.country_code}</td>
                    <td style={{ padding: '0.5rem' }}>{p.account_name || '-'}</td>
                    <td style={{ padding: '0.5rem', fontFamily: 'monospace', fontSize: '0.8rem' }}>{p.profile_id}</td>
                    <td style={{ padding: '0.5rem' }}>{p.credential_name} ({p.region})</td>
                    <td style={{ padding: '0.5rem' }}>
                      <span style={{ color: p.is_active ? '#059669' : '#9ca3af' }}>
                        {p.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td style={{ padding: '0.5rem' }}>
                      <button onClick={() => handleAdsToggleProfile(p.id)} style={btnStyle(p.is_active ? '#d97706' : '#059669')}>
                        {p.is_active ? 'Deactivate' : 'Activate'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </>}

      {/* Add/Edit credentials form */}
      {activeTab === 'amazon' && <div style={cardStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h2>{editingId ? 'Edit Credentials' : 'Add SP-API Credentials'}</h2>
          {editingId && (
            <button onClick={handleCancelEdit} style={{ ...btnStyle('#6b7280'), fontSize: '0.85rem', padding: '0.35rem 1rem' }}>
              Cancel
            </button>
          )}
        </div>
        <form onSubmit={handleSubmit}>
          <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: 500 }}>Region</label>
          <select
            value={form.region}
            onChange={e => setForm({ ...form, region: e.target.value })}
            style={{ ...inputStyle, background: '#fff' }}
          >
            <option value="NA">NA (North America - US, CA, MX)</option>
            <option value="EU">EU (Europe - UK, DE, FR, IT, ES)</option>
            <option value="FE">FE (Far East - AU, JP, SG)</option>
          </select>

          <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: 500 }}>Account Name</label>
          <input
            type="text"
            placeholder="e.g., iwa concept, IWA Concept AU"
            value={form.account_name}
            onChange={e => setForm({ ...form, account_name: e.target.value })}
            style={inputStyle}
          />

          <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: 500 }}>Seller ID</label>
          <input
            type="text"
            placeholder={editingId ? 'Leave blank to keep current' : 'e.g., A2ABC123DEF'}
            value={form.seller_id}
            onChange={e => setForm({ ...form, seller_id: e.target.value })}
            style={inputStyle}
            required={!editingId}
          />

          <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: 500 }}>Client ID (LWA)</label>
          <input
            type="text"
            placeholder={editingId ? 'Leave blank to keep current' : 'amzn1.application-oa2-client.xxx'}
            value={form.client_id}
            onChange={e => setForm({ ...form, client_id: e.target.value })}
            style={inputStyle}
            required={!editingId}
          />

          <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: 500 }}>Client Secret (LWA)</label>
          <input
            type="password"
            placeholder={editingId ? 'Leave blank to keep current' : 'Client secret from LWA app'}
            value={form.client_secret}
            onChange={e => setForm({ ...form, client_secret: e.target.value })}
            style={inputStyle}
            required={!editingId}
          />

          <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: 500 }}>Refresh Token</label>
          <input
            type="password"
            placeholder={editingId ? 'Leave blank to keep current' : 'Atzr|xxx...'}
            value={form.refresh_token}
            onChange={e => setForm({ ...form, refresh_token: e.target.value })}
            style={inputStyle}
            required={!editingId}
          />

          {message && (
            <p style={{ color: message.includes('success') ? '#059669' : message.includes('Fill only') ? '#2563eb' : '#dc2626', marginBottom: '0.75rem' }}>
              {message}
            </p>
          )}

          <button
            type="submit"
            disabled={saving}
            style={{ padding: '0.5rem 2rem', background: editingId ? '#059669' : '#2563eb', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer' }}
          >
            {saving ? 'Saving...' : editingId ? 'Update Credentials' : 'Save Credentials'}
          </button>
        </form>
      </div>}
    </div>
  );
}
