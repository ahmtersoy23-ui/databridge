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

  return (
    <div>
      <h1 className="mb-4">Settings</h1>

      {/* Tab bar */}
      <div className="flex gap-1 mb-6 border-b-2 border-slate-200">
        {(['amazon', 'ads', 'wayfair', 'wisersell'] as const).map(t => {
          const labels: Record<string, string> = { amazon: 'Amazon SP-API', ads: 'Amazon Ads', wayfair: 'Wayfair', wisersell: 'Wisersell' };
          return (
            <button
              key={t}
              onClick={() => setActiveTab(t)}
              className={`px-4 py-2 border-none bg-transparent cursor-pointer text-sm font-medium -mb-[2px] ${
                activeTab === t ? 'text-[#0891b2] border-b-2 border-[#0891b2]' : 'text-slate-500 border-b-2 border-transparent'
              }`}
            >
              {labels[t]}
            </button>
          );
        })}
      </div>

      {/* Amazon SP-API tab -- credentials table */}
      {activeTab === 'amazon' && <div className="bg-white rounded-lg p-6 shadow-sm mb-4">
        <h2 className="mb-4">Current Credentials</h2>
        {credentials.length === 0 ? (
          <p className="text-slate-500">No credentials configured yet.</p>
        ) : (
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b-2 border-slate-200">
                <th className="text-left p-2">Region</th>
                <th className="text-left p-2">Account</th>
                <th className="text-left p-2">Seller ID</th>
                <th className="text-left p-2">Client ID</th>
                <th className="text-left p-2">Status</th>
                <th className="text-left p-2">Added</th>
                <th className="text-left p-2"></th>
              </tr>
            </thead>
            <tbody>
              {credentials.map(c => (
                <tr key={c.id} className={`border-b border-slate-200 ${editingId === c.id ? 'bg-[#eff6ff]' : ''}`}>
                  <td className="p-2">{c.region}</td>
                  <td className="p-2">{c.account_name || '-'}</td>
                  <td className="p-2">{c.seller_id}</td>
                  <td className="p-2">{c.client_id_preview}</td>
                  <td className="p-2">
                    <span className={c.is_active ? 'text-emerald-600' : 'text-gray-400'}>
                      {c.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="p-2">{new Date(c.created_at).toLocaleDateString()}</td>
                  <td className="p-2">
                    <button onClick={() => handleToggle(c.id)} className={`px-3 py-1 text-white border-none rounded cursor-pointer text-xs mr-1 ${c.is_active ? 'bg-amber-600' : 'bg-emerald-600'}`}>
                      {c.is_active ? 'Deactivate' : 'Activate'}
                    </button>
                    <button onClick={() => handleEdit(c)} className="px-3 py-1 bg-blue-600 text-white border-none rounded cursor-pointer text-xs mr-1">Edit</button>
                    <button
                      onClick={() => handleDelete(c.id, c.region)}
                      disabled={deleting === c.id}
                      className="px-3 py-1 bg-red-600 text-white border-none rounded cursor-pointer text-xs mr-1"
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
      {activeTab === 'wisersell' && <div className="bg-white rounded-lg p-6 shadow-sm mb-4">
        <h2 className="mb-2">Wisersell API</h2>
        {wisersellConfig?.configured && (
          <p className="text-sm text-slate-500 mb-4">
            Current: <strong>{wisersellConfig.email}</strong> — {wisersellConfig.api_url}
            {wisersellConfig.updated_at && ` (updated ${new Date(wisersellConfig.updated_at).toLocaleDateString()})`}
          </p>
        )}
        <form onSubmit={handleWisersellSubmit}>
          <label className="block mb-1 font-medium">Email</label>
          <input
            type="email"
            placeholder="wisersell@example.com"
            value={wisersellForm.email}
            onChange={e => setWisersellForm({ ...wisersellForm, email: e.target.value })}
            className="w-full p-2 border border-gray-300 rounded-md text-sm mb-3"
            required
          />
          <label className="block mb-1 font-medium">Password</label>
          <input
            type="password"
            placeholder={wisersellConfig?.configured ? 'Leave blank to keep current' : 'Password'}
            value={wisersellForm.password}
            onChange={e => setWisersellForm({ ...wisersellForm, password: e.target.value })}
            className="w-full p-2 border border-gray-300 rounded-md text-sm mb-3"
            required={!wisersellConfig?.configured}
          />
          <label className="block mb-1 font-medium">API URL</label>
          <div className="flex gap-2 mb-3">
            <button type="button"
              onClick={() => setWisersellForm({ ...wisersellForm, api_url: 'https://dev2.wisersell.com/restapi' })}
              className={`px-3 py-1 text-white border-none rounded cursor-pointer text-xs mr-1 ${wisersellForm.api_url.includes('dev2') ? 'bg-blue-600' : 'bg-slate-400'}`}>
              Dev
            </button>
            <button type="button"
              onClick={() => setWisersellForm({ ...wisersellForm, api_url: 'https://www.wisersell.com/restapi' })}
              className={`px-3 py-1 text-white border-none rounded cursor-pointer text-xs mr-1 ${!wisersellForm.api_url.includes('dev2') ? 'bg-emerald-600' : 'bg-slate-400'}`}>
              Prod
            </button>
            <input
              type="text"
              value={wisersellForm.api_url}
              onChange={e => setWisersellForm({ ...wisersellForm, api_url: e.target.value })}
              className="flex-1 p-2 border border-gray-300 rounded-md text-sm"
            />
          </div>
          {wisersellMessage && (
            <p className={`mb-3 ${wisersellMessage.includes('success') ? 'text-emerald-600' : 'text-red-600'}`}>
              {wisersellMessage}
            </p>
          )}
          <button type="submit" disabled={wisersellSaving}
            className="px-8 py-2 bg-[#0891b2] text-white border-none rounded-md cursor-pointer">
            {wisersellSaving ? 'Saving...' : wisersellConfig?.configured ? 'Update' : 'Save'}
          </button>
        </form>
      </div>}

      {/* Wayfair accounts */}
      {activeTab === 'wayfair' && <>
        <div className="bg-white rounded-lg p-6 shadow-sm mb-4">
          <h2 className="mb-4">Wayfair Accounts</h2>
          {wayfairMessage && (
            <p className={`mb-3 ${wayfairMessage.includes('OK') || wayfairMessage.includes('success') || wayfairMessage.includes('Updated') || wayfairMessage.includes('added') ? 'text-emerald-600' : 'text-red-600'}`}>
              {wayfairMessage}
            </p>
          )}
          {wayfairAccounts.length === 0 ? (
            <p className="text-slate-500">No Wayfair accounts configured yet.</p>
          ) : (
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b-2 border-slate-200">
                  <th className="text-left p-2">Account</th>
                  <th className="text-left p-2">Client ID</th>
                  <th className="text-left p-2">Channel</th>
                  <th className="text-left p-2">Warehouse</th>
                  <th className="text-left p-2">Supplier</th>
                  <th className="text-left p-2">Status</th>
                  <th className="text-left p-2">Updated</th>
                  <th className="text-left p-2"></th>
                </tr>
              </thead>
              <tbody>
                {wayfairAccounts.map(a => (
                  <tr key={a.id} className={`border-b border-slate-200 ${wayfairEditingId === a.id ? 'bg-[#eff6ff]' : ''}`}>
                    <td className="p-2 font-semibold capitalize">{a.label}</td>
                    <td className="p-2 font-mono text-sm">{a.client_id.slice(0, 8)}...{a.client_id.slice(-4)}</td>
                    <td className="p-2">{a.channel}</td>
                    <td className="p-2">{a.warehouse}</td>
                    <td className="p-2">{a.supplier_id || '\u2014'}</td>
                    <td className="p-2">
                      <span className={a.is_active ? 'text-emerald-600' : 'text-gray-400'}>
                        {a.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="p-2 text-sm text-slate-500">
                      {a.updated_at ? new Date(a.updated_at).toLocaleDateString() : '\u2014'}
                    </td>
                    <td className="p-2 whitespace-nowrap">
                      <button onClick={() => handleWayfairTest(a.id)} disabled={wayfairTesting === a.id} className="px-3 py-1 bg-[#6366f1] text-white border-none rounded cursor-pointer text-xs mr-1">
                        {wayfairTesting === a.id ? '...' : 'Test'}
                      </button>
                      <button onClick={() => handleWayfairToggle(a.id, a.is_active)} className={`px-3 py-1 text-white border-none rounded cursor-pointer text-xs mr-1 ${a.is_active ? 'bg-amber-600' : 'bg-emerald-600'}`}>
                        {a.is_active ? 'Deactivate' : 'Activate'}
                      </button>
                      <button onClick={() => handleWayfairEdit(a)} className="px-3 py-1 bg-blue-600 text-white border-none rounded cursor-pointer text-xs mr-1">Edit</button>
                      <button onClick={() => handleWayfairDelete(a.id, a.label)} disabled={wayfairDeleting === a.id} className="px-3 py-1 bg-red-600 text-white border-none rounded cursor-pointer text-xs mr-1">
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
        <div className="bg-white rounded-lg p-6 shadow-sm mb-4">
          <div className="flex justify-between items-center mb-4">
            <h2>{wayfairEditingId ? `Edit \u2014 ${wayfairForm.label}` : 'Add Wayfair Account'}</h2>
            {wayfairEditingId && (
              <button onClick={handleWayfairCancelEdit} className="px-4 py-1 bg-gray-500 text-white border-none rounded cursor-pointer text-sm">
                Cancel
              </button>
            )}
          </div>
          <form onSubmit={handleWayfairSubmit}>
            <div className="grid grid-cols-2 gap-x-4">
              <div>
                <label className="block mb-1 font-medium">Account Label</label>
                <input type="text" placeholder="e.g. shukran, mdn" value={wayfairForm.label}
                  onChange={e => setWayfairForm({ ...wayfairForm, label: e.target.value })}
                  className="w-full p-2 border border-gray-300 rounded-md text-sm mb-3" required />
              </div>
              <div>
                <label className="block mb-1 font-medium">
                  Supplier ID <span className="font-normal text-slate-400 text-xs">(auto-discovered)</span>
                </label>
                <input type="number" placeholder="e.g. 194115" value={wayfairForm.supplier_id}
                  onChange={e => setWayfairForm({ ...wayfairForm, supplier_id: e.target.value })}
                  className="w-full p-2 border border-gray-300 rounded-md text-sm mb-3" />
              </div>
              <div>
                <label className="block mb-1 font-medium">Client ID</label>
                <input type="text" placeholder="Wayfair Client ID" value={wayfairForm.client_id}
                  onChange={e => setWayfairForm({ ...wayfairForm, client_id: e.target.value })}
                  className="w-full p-2 border border-gray-300 rounded-md text-sm mb-3" required={!wayfairEditingId} />
              </div>
              <div>
                <label className="block mb-1 font-medium">Client Secret</label>
                <input type="password" placeholder={wayfairEditingId ? 'Leave blank to keep current' : 'Client Secret'}
                  value={wayfairForm.client_secret}
                  onChange={e => setWayfairForm({ ...wayfairForm, client_secret: e.target.value })}
                  className="w-full p-2 border border-gray-300 rounded-md text-sm mb-3" required={!wayfairEditingId} />
              </div>
              <div>
                <label className="block mb-1 font-medium">Sales Channel</label>
                <input type="text" placeholder="e.g. wfs, wfm" value={wayfairForm.channel}
                  onChange={e => setWayfairForm({ ...wayfairForm, channel: e.target.value })}
                  className="w-full p-2 border border-gray-300 rounded-md text-sm mb-3" required={!wayfairEditingId} />
              </div>
              <div>
                <label className="block mb-1 font-medium">Warehouse Code</label>
                <input type="text" placeholder="e.g. WFS, WFM" value={wayfairForm.warehouse}
                  onChange={e => setWayfairForm({ ...wayfairForm, warehouse: e.target.value })}
                  className="w-full p-2 border border-gray-300 rounded-md text-sm mb-3" required={!wayfairEditingId} />
              </div>
            </div>
            <button type="submit" disabled={wayfairSaving}
              className={`px-8 py-2 text-white border-none rounded-md cursor-pointer ${wayfairEditingId ? 'bg-emerald-600' : 'bg-blue-600'}`}>
              {wayfairSaving ? 'Saving...' : wayfairEditingId ? 'Update Account' : 'Add Account'}
            </button>
          </form>
        </div>
      </>}

      {/* Amazon Ads tab */}
      {activeTab === 'ads' && <>
        <div className="bg-white rounded-lg p-6 shadow-sm mb-4">
          <h2 className="mb-4">Ads API Credentials</h2>
          <p className="text-sm text-slate-500 mb-4">
            Each SP-API credential needs a separate Ads refresh token with <code>advertising::campaign_management</code> scope.
          </p>
          {adsMessage && (
            <p className={`mb-3 ${adsMessage.includes('saved') || adsMessage.includes('Discovered') ? 'text-emerald-600' : 'text-red-600'}`}>
              {adsMessage}
            </p>
          )}
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b-2 border-slate-200">
                <th className="text-left p-2">Region</th>
                <th className="text-left p-2">Account</th>
                <th className="text-left p-2">Ads Token</th>
                <th className="text-left p-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {adsCredentials.map(c => (
                <tr key={c.id} className="border-b border-slate-200">
                  <td className="p-2">{c.region}</td>
                  <td className="p-2">{c.account_name || '-'}</td>
                  <td className="p-2">
                    {adsTokenForm.credentialId === c.id ? (
                      <div className="flex gap-1">
                        <input
                          type="password"
                          placeholder="Atzr|xxx..."
                          value={adsTokenForm.token}
                          onChange={e => setAdsTokenForm({ ...adsTokenForm, token: e.target.value })}
                          className="flex-1 p-2 border border-gray-300 rounded-md text-sm"
                        />
                        <button onClick={() => handleAdsSaveToken(c.id)} disabled={adsSaving} className="px-3 py-1 bg-emerald-600 text-white border-none rounded cursor-pointer text-xs mr-1">
                          {adsSaving ? '...' : 'Save'}
                        </button>
                        <button onClick={() => setAdsTokenForm({ credentialId: null, token: '' })} className="px-3 py-1 bg-gray-500 text-white border-none rounded cursor-pointer text-xs mr-1">
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <span className={c.has_ads_token ? 'text-emerald-600' : 'text-gray-400'}>
                        {c.has_ads_token ? 'Configured' : 'Not set'}
                      </span>
                    )}
                  </td>
                  <td className="p-2">
                    {adsTokenForm.credentialId !== c.id && (
                      <>
                        <button onClick={() => setAdsTokenForm({ credentialId: c.id, token: '' })} className="px-3 py-1 bg-blue-600 text-white border-none rounded cursor-pointer text-xs mr-1">
                          {c.has_ads_token ? 'Update Token' : 'Set Token'}
                        </button>
                        {c.has_ads_token && (
                          <button onClick={() => handleAdsDiscover(c.id)} disabled={adsDiscovering} className="px-3 py-1 bg-[#6366f1] text-white border-none rounded cursor-pointer text-xs mr-1">
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

        <div className="bg-white rounded-lg p-6 shadow-sm mb-4">
          <h2 className="mb-4">Ads Profiles</h2>
          {adsProfiles.length === 0 ? (
            <p className="text-slate-500">No profiles discovered yet. Set an Ads token and click "Discover Profiles".</p>
          ) : (
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b-2 border-slate-200">
                  <th className="text-left p-2">Country</th>
                  <th className="text-left p-2">Account</th>
                  <th className="text-left p-2">Profile ID</th>
                  <th className="text-left p-2">Credential</th>
                  <th className="text-left p-2">Status</th>
                  <th className="text-left p-2"></th>
                </tr>
              </thead>
              <tbody>
                {adsProfiles.map(p => (
                  <tr key={p.id} className="border-b border-slate-200">
                    <td className="p-2 font-medium">{p.country_code}</td>
                    <td className="p-2">{p.account_name || '-'}</td>
                    <td className="p-2 font-mono text-xs">{p.profile_id}</td>
                    <td className="p-2">{p.credential_name} ({p.region})</td>
                    <td className="p-2">
                      <span className={p.is_active ? 'text-emerald-600' : 'text-gray-400'}>
                        {p.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="p-2">
                      <button onClick={() => handleAdsToggleProfile(p.id)} className={`px-3 py-1 text-white border-none rounded cursor-pointer text-xs mr-1 ${p.is_active ? 'bg-amber-600' : 'bg-emerald-600'}`}>
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
      {activeTab === 'amazon' && <div className="bg-white rounded-lg p-6 shadow-sm mb-4">
        <div className="flex justify-between items-center mb-4">
          <h2>{editingId ? 'Edit Credentials' : 'Add SP-API Credentials'}</h2>
          {editingId && (
            <button onClick={handleCancelEdit} className="px-4 py-1 bg-gray-500 text-white border-none rounded cursor-pointer text-sm">
              Cancel
            </button>
          )}
        </div>
        <form onSubmit={handleSubmit}>
          <label className="block mb-1 font-medium">Region</label>
          <select
            value={form.region}
            onChange={e => setForm({ ...form, region: e.target.value })}
            className="w-full p-2 border border-gray-300 rounded-md text-sm mb-3 bg-white"
          >
            <option value="NA">NA (North America - US, CA, MX)</option>
            <option value="EU">EU (Europe - UK, DE, FR, IT, ES)</option>
            <option value="FE">FE (Far East - AU, JP, SG)</option>
          </select>

          <label className="block mb-1 font-medium">Account Name</label>
          <input
            type="text"
            placeholder="e.g., iwa concept, IWA Concept AU"
            value={form.account_name}
            onChange={e => setForm({ ...form, account_name: e.target.value })}
            className="w-full p-2 border border-gray-300 rounded-md text-sm mb-3"
          />

          <label className="block mb-1 font-medium">Seller ID</label>
          <input
            type="text"
            placeholder={editingId ? 'Leave blank to keep current' : 'e.g., A2ABC123DEF'}
            value={form.seller_id}
            onChange={e => setForm({ ...form, seller_id: e.target.value })}
            className="w-full p-2 border border-gray-300 rounded-md text-sm mb-3"
            required={!editingId}
          />

          <label className="block mb-1 font-medium">Client ID (LWA)</label>
          <input
            type="text"
            placeholder={editingId ? 'Leave blank to keep current' : 'amzn1.application-oa2-client.xxx'}
            value={form.client_id}
            onChange={e => setForm({ ...form, client_id: e.target.value })}
            className="w-full p-2 border border-gray-300 rounded-md text-sm mb-3"
            required={!editingId}
          />

          <label className="block mb-1 font-medium">Client Secret (LWA)</label>
          <input
            type="password"
            placeholder={editingId ? 'Leave blank to keep current' : 'Client secret from LWA app'}
            value={form.client_secret}
            onChange={e => setForm({ ...form, client_secret: e.target.value })}
            className="w-full p-2 border border-gray-300 rounded-md text-sm mb-3"
            required={!editingId}
          />

          <label className="block mb-1 font-medium">Refresh Token</label>
          <input
            type="password"
            placeholder={editingId ? 'Leave blank to keep current' : 'Atzr|xxx...'}
            value={form.refresh_token}
            onChange={e => setForm({ ...form, refresh_token: e.target.value })}
            className="w-full p-2 border border-gray-300 rounded-md text-sm mb-3"
            required={!editingId}
          />

          {message && (
            <p className={`mb-3 ${message.includes('success') ? 'text-emerald-600' : message.includes('Fill only') ? 'text-blue-600' : 'text-red-600'}`}>
              {message}
            </p>
          )}

          <button
            type="submit"
            disabled={saving}
            className={`px-8 py-2 text-white border-none rounded-md cursor-pointer ${editingId ? 'bg-emerald-600' : 'bg-blue-600'}`}
          >
            {saving ? 'Saving...' : editingId ? 'Update Credentials' : 'Save Credentials'}
          </button>
        </form>
      </div>}
    </div>
  );
}
