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

interface WalmartAccount {
  id: number;
  label: string;
  client_id: string;
  use_sandbox: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface BolAccount {
  id: number;
  label: string;
  client_id: string;
  channel: string;
  use_sandbox: boolean;
  is_active: boolean;
  updated_at: string;
}

interface TakealotAccount {
  id: number;
  label: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface KauflandAccount {
  id: number;
  label: string;
  client_key: string;
  storefront: string;
  channel: string;
  is_active: boolean;
  created_at: string;
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
const emptyWalmartForm = { label: 'us-main', client_id: '', client_secret: '', use_sandbox: false };
const emptyBolForm = { label: '', client_id: '', client_secret: '', channel: '' };
const emptyTakealotForm = { label: 'za-main', api_key: '' };
const emptyKauflandForm = { label: 'de-main', client_key: '', secret_key: '', storefront: 'de_DE', channel: 'kaufland_de' };

export default function Settings() {
  const [activeTab, setActiveTab] = useState<'amazon' | 'wayfair' | 'walmart' | 'bol' | 'takealot' | 'kaufland' | 'wisersell' | 'ads'>('amazon');
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

  const [walmartAccounts, setWalmartAccounts] = useState<WalmartAccount[]>([]);
  const [walmartForm, setWalmartForm] = useState(emptyWalmartForm);
  const [walmartEditingId, setWalmartEditingId] = useState<number | null>(null);
  const [walmartSaving, setWalmartSaving] = useState(false);
  const [walmartMessage, setWalmartMessage] = useState('');
  const [walmartTesting, setWalmartTesting] = useState<number | null>(null);
  const [walmartDeleting, setWalmartDeleting] = useState<number | null>(null);

  const [bolAccounts, setBolAccounts] = useState<BolAccount[]>([]);
  const [bolForm, setBolForm] = useState(emptyBolForm);
  const [bolEditingId, setBolEditingId] = useState<number | null>(null);
  const [bolSaving, setBolSaving] = useState(false);
  const [bolMessage, setBolMessage] = useState('');
  const [bolTesting, setBolTesting] = useState<number | null>(null);
  const [bolDeleting, setBolDeleting] = useState<number | null>(null);

  const [takealotAccounts, setTakealotAccounts] = useState<TakealotAccount[]>([]);
  const [takealotForm, setTakealotForm] = useState(emptyTakealotForm);
  const [takealotEditingId, setTakealotEditingId] = useState<number | null>(null);
  const [takealotSaving, setTakealotSaving] = useState(false);
  const [takealotMessage, setTakealotMessage] = useState('');
  const [takealotTesting, setTakealotTesting] = useState<number | null>(null);
  const [takealotDeleting, setTakealotDeleting] = useState<number | null>(null);

  const [kauflandAccounts, setKauflandAccounts] = useState<KauflandAccount[]>([]);
  const [kauflandForm, setKauflandForm] = useState(emptyKauflandForm);
  const [kauflandEditingId, setKauflandEditingId] = useState<number | null>(null);
  const [kauflandSaving, setKauflandSaving] = useState(false);
  const [kauflandMessage, setKauflandMessage] = useState('');
  const [kauflandTesting, setKauflandTesting] = useState<number | null>(null);
  const [kauflandDeleting, setKauflandDeleting] = useState<number | null>(null);

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

  const fetchWalmartAccounts = async () => {
    try {
      const res = await axios.get('/api/v1/walmart/settings');
      setWalmartAccounts(res.data.accounts || []);
    } catch {
      // ignore
    }
  };

  const fetchBolAccounts = async () => {
    try {
      const res = await axios.get('/api/v1/bol/settings');
      setBolAccounts(res.data.accounts || []);
    } catch {
      // ignore
    }
  };

  const fetchKauflandAccounts = async () => {
    try {
      const res = await axios.get('/api/v1/kaufland/settings');
      setKauflandAccounts(res.data.accounts || []);
    } catch (err) {
      console.error('Failed to fetch Kaufland accounts:', err);
    }
  };

  const fetchTakealotAccounts = async () => {
    try {
      const res = await axios.get('/api/v1/takealot/settings');
      setTakealotAccounts(res.data.accounts || []);
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

  useEffect(() => { fetchCredentials(); fetchWisersellConfig(); fetchWayfairAccounts(); fetchWalmartAccounts(); fetchBolAccounts(); fetchTakealotAccounts(); fetchKauflandAccounts(); fetchAdsCredentials(); fetchAdsProfiles(); }, []);

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

  const handleWalmartEdit = (a: WalmartAccount) => {
    setWalmartEditingId(a.id);
    setWalmartForm({ label: a.label, client_id: a.client_id, client_secret: '', use_sandbox: a.use_sandbox });
    setWalmartMessage('');
  };

  const handleWalmartCancelEdit = () => {
    setWalmartEditingId(null);
    setWalmartForm(emptyWalmartForm);
    setWalmartMessage('');
  };

  const handleWalmartSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setWalmartSaving(true);
    setWalmartMessage('');
    try {
      if (walmartEditingId) {
        const updates: Record<string, unknown> = { use_sandbox: walmartForm.use_sandbox };
        if (walmartForm.label) updates.label = walmartForm.label;
        if (walmartForm.client_id) updates.client_id = walmartForm.client_id;
        if (walmartForm.client_secret) updates.client_secret = walmartForm.client_secret;
        await axios.put(`/api/v1/walmart/settings/${walmartEditingId}`, updates);
        setWalmartMessage('Updated successfully!');
        setWalmartEditingId(null);
      } else {
        await axios.post('/api/v1/walmart/settings', {
          label: walmartForm.label,
          client_id: walmartForm.client_id,
          client_secret: walmartForm.client_secret,
          use_sandbox: walmartForm.use_sandbox,
        });
        setWalmartMessage('Account added successfully!');
      }
      setWalmartForm(emptyWalmartForm);
      fetchWalmartAccounts();
    } catch (err: any) {
      setWalmartMessage(err.response?.data?.error || 'Failed to save');
    } finally {
      setWalmartSaving(false);
    }
  };

  const handleWalmartTest = async (id: number) => {
    setWalmartTesting(id);
    setWalmartMessage('');
    try {
      const res = await axios.post(`/api/v1/walmart/settings/${id}/test`);
      setWalmartMessage(`Connection OK — ${res.data.sandbox ? 'Sandbox' : 'Production'} (${res.data.message})`);
    } catch (err: any) {
      setWalmartMessage(err.response?.data?.error || 'Connection failed');
    } finally {
      setWalmartTesting(null);
    }
  };

  const handleWalmartToggle = async (id: number, currentActive: boolean) => {
    try {
      await axios.put(`/api/v1/walmart/settings/${id}`, { is_active: !currentActive });
      fetchWalmartAccounts();
    } catch { /* ignore */ }
  };

  const handleWalmartDelete = async (id: number, label: string) => {
    if (!confirm(`Delete Walmart account "${label}"?`)) return;
    setWalmartDeleting(id);
    try {
      await axios.delete(`/api/v1/walmart/settings/${id}`);
      fetchWalmartAccounts();
    } catch (err: any) {
      setWalmartMessage(err.response?.data?.error || 'Failed to delete');
    } finally {
      setWalmartDeleting(null);
    }
  };

  // --- Bol handlers --------------------------------------------------------

  const handleBolEdit = (a: BolAccount) => {
    setBolEditingId(a.id);
    setBolForm({ label: a.label, client_id: a.client_id, client_secret: '', channel: a.channel });
    setBolMessage('');
  };

  const handleBolCancelEdit = () => {
    setBolEditingId(null);
    setBolForm(emptyBolForm);
    setBolMessage('');
  };

  const handleBolSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBolSaving(true);
    setBolMessage('');
    try {
      if (bolEditingId) {
        const updates: Record<string, unknown> = {};
        if (bolForm.label) updates.label = bolForm.label;
        if (bolForm.client_id) updates.client_id = bolForm.client_id;
        if (bolForm.client_secret) updates.client_secret = bolForm.client_secret;
        if (bolForm.channel) updates.channel = bolForm.channel;
        await axios.put(`/api/v1/bol/settings/${bolEditingId}`, updates);
        setBolMessage('Updated successfully!');
        setBolEditingId(null);
      } else {
        await axios.post('/api/v1/bol/settings', {
          label: bolForm.label,
          client_id: bolForm.client_id,
          client_secret: bolForm.client_secret,
          channel: bolForm.channel,
        });
        setBolMessage('Account added successfully!');
      }
      setBolForm(emptyBolForm);
      fetchBolAccounts();
    } catch (err: any) {
      setBolMessage(err.response?.data?.error || 'Failed to save');
    } finally {
      setBolSaving(false);
    }
  };

  const handleBolTest = async (id: number) => {
    setBolTesting(id);
    setBolMessage('');
    try {
      const res = await axios.post(`/api/v1/bol/settings/${id}/test`);
      setBolMessage(res.data.message);
    } catch (err: any) {
      setBolMessage(err.response?.data?.error || 'Connection failed');
    } finally {
      setBolTesting(null);
    }
  };

  const handleBolToggle = async (id: number, currentActive: boolean) => {
    try {
      await axios.put(`/api/v1/bol/settings/${id}`, { is_active: !currentActive });
      fetchBolAccounts();
    } catch { /* ignore */ }
  };

  const handleBolDelete = async (id: number, label: string) => {
    if (!confirm(`Delete Bol account "${label}"?`)) return;
    setBolDeleting(id);
    try {
      await axios.delete(`/api/v1/bol/settings/${id}`);
      fetchBolAccounts();
    } catch (err: any) {
      setBolMessage(err.response?.data?.error || 'Failed to delete');
    } finally {
      setBolDeleting(null);
    }
  };

  // --- Takealot handlers ---------------------------------------------------

  const handleTakealotEdit = (a: TakealotAccount) => {
    setTakealotEditingId(a.id);
    setTakealotForm({ label: a.label, api_key: '' });
    setTakealotMessage('');
  };

  const handleTakealotCancelEdit = () => {
    setTakealotEditingId(null);
    setTakealotForm(emptyTakealotForm);
    setTakealotMessage('');
  };

  const handleTakealotSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTakealotSaving(true);
    setTakealotMessage('');
    try {
      if (takealotEditingId) {
        const updates: Record<string, unknown> = {};
        if (takealotForm.label) updates.label = takealotForm.label;
        if (takealotForm.api_key) updates.api_key = takealotForm.api_key;
        await axios.put(`/api/v1/takealot/settings/${takealotEditingId}`, updates);
        setTakealotMessage('Updated successfully!');
        setTakealotEditingId(null);
      } else {
        await axios.post('/api/v1/takealot/settings', {
          label: takealotForm.label,
          api_key: takealotForm.api_key,
        });
        setTakealotMessage('Account added successfully!');
      }
      setTakealotForm(emptyTakealotForm);
      fetchTakealotAccounts();
    } catch (err: any) {
      setTakealotMessage(err.response?.data?.error || 'Failed to save');
    } finally {
      setTakealotSaving(false);
    }
  };

  const handleTakealotTest = async (id: number) => {
    setTakealotTesting(id);
    setTakealotMessage('');
    try {
      const res = await axios.post(`/api/v1/takealot/settings/${id}/test`);
      setTakealotMessage(res.data.message);
    } catch (err: any) {
      setTakealotMessage(err.response?.data?.error || 'Connection failed');
    } finally {
      setTakealotTesting(null);
    }
  };

  const handleTakealotToggle = async (id: number, currentActive: boolean) => {
    try {
      await axios.put(`/api/v1/takealot/settings/${id}`, { is_active: !currentActive });
      fetchTakealotAccounts();
    } catch { /* ignore */ }
  };

  const handleTakealotDelete = async (id: number, label: string) => {
    if (!confirm(`Delete Takealot account "${label}"?`)) return;
    setTakealotDeleting(id);
    try {
      await axios.delete(`/api/v1/takealot/settings/${id}`);
      fetchTakealotAccounts();
    } catch (err: any) {
      setTakealotMessage(err.response?.data?.error || 'Failed to delete');
    } finally {
      setTakealotDeleting(null);
    }
  };

  // --- Kaufland handlers ---------------------------------------------------

  const handleKauflandEdit = (a: KauflandAccount) => {
    setKauflandEditingId(a.id);
    setKauflandForm({ label: a.label, client_key: a.client_key, secret_key: '', storefront: a.storefront, channel: a.channel });
    setKauflandMessage('');
  };

  const handleKauflandCancelEdit = () => {
    setKauflandEditingId(null);
    setKauflandForm(emptyKauflandForm);
    setKauflandMessage('');
  };

  const handleKauflandSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setKauflandSaving(true);
    setKauflandMessage('');
    try {
      if (kauflandEditingId) {
        const updates: Record<string, unknown> = {};
        if (kauflandForm.label) updates.label = kauflandForm.label;
        if (kauflandForm.client_key) updates.client_key = kauflandForm.client_key;
        if (kauflandForm.secret_key) updates.secret_key = kauflandForm.secret_key;
        if (kauflandForm.storefront) updates.storefront = kauflandForm.storefront;
        if (kauflandForm.channel) updates.channel = kauflandForm.channel;
        await axios.put(`/api/v1/kaufland/settings/${kauflandEditingId}`, updates);
        setKauflandMessage('Updated successfully!');
        setKauflandEditingId(null);
      } else {
        await axios.post('/api/v1/kaufland/settings', {
          label: kauflandForm.label,
          client_key: kauflandForm.client_key,
          secret_key: kauflandForm.secret_key,
          storefront: kauflandForm.storefront,
          channel: kauflandForm.channel,
        });
        setKauflandMessage('Account added successfully!');
      }
      setKauflandForm(emptyKauflandForm);
      fetchKauflandAccounts();
    } catch (err: any) {
      setKauflandMessage(err.response?.data?.error || 'Failed to save');
    } finally {
      setKauflandSaving(false);
    }
  };

  const handleKauflandTest = async (id: number) => {
    setKauflandTesting(id);
    setKauflandMessage('');
    try {
      const res = await axios.post(`/api/v1/kaufland/settings/${id}/test`);
      setKauflandMessage(res.data.message);
    } catch (err: any) {
      setKauflandMessage(err.response?.data?.error || 'Connection failed');
    } finally {
      setKauflandTesting(null);
    }
  };

  const handleKauflandToggle = async (id: number, currentActive: boolean) => {
    try {
      await axios.put(`/api/v1/kaufland/settings/${id}`, { is_active: !currentActive });
      fetchKauflandAccounts();
    } catch { /* ignore */ }
  };

  const handleKauflandDelete = async (id: number, label: string) => {
    if (!confirm(`Delete Kaufland account "${label}"?`)) return;
    setKauflandDeleting(id);
    try {
      await axios.delete(`/api/v1/kaufland/settings/${id}`);
      fetchKauflandAccounts();
    } catch (err: any) {
      setKauflandMessage(err.response?.data?.error || 'Failed to delete');
    } finally {
      setKauflandDeleting(null);
    }
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
        {(['amazon', 'ads', 'wayfair', 'walmart', 'bol', 'takealot', 'kaufland', 'wisersell'] as const).map(t => {
          const labels: Record<string, string> = { amazon: 'Amazon SP-API', ads: 'Amazon Ads', wayfair: 'Wayfair', walmart: 'Walmart', bol: 'Bol', takealot: 'Takealot', wisersell: 'Wisersell' };
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
          <label htmlFor="wisersell-email" className="block mb-1 font-medium">Email</label>
          <input
            id="wisersell-email"
            type="email"
            placeholder="wisersell@example.com"
            value={wisersellForm.email}
            onChange={e => setWisersellForm({ ...wisersellForm, email: e.target.value })}
            className="w-full p-2 border border-gray-300 rounded-md text-sm mb-3"
            required
          />
          <label htmlFor="wisersell-password" className="block mb-1 font-medium">Password</label>
          <input
            id="wisersell-password"
            type="password"
            placeholder={wisersellConfig?.configured ? 'Leave blank to keep current' : 'Password'}
            value={wisersellForm.password}
            onChange={e => setWisersellForm({ ...wisersellForm, password: e.target.value })}
            className="w-full p-2 border border-gray-300 rounded-md text-sm mb-3"
            required={!wisersellConfig?.configured}
          />
          <label htmlFor="wisersell-api-url" className="block mb-1 font-medium">API URL</label>
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
              id="wisersell-api-url"
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
                <label htmlFor="wayfair-label" className="block mb-1 font-medium">Account Label</label>
                <input id="wayfair-label" type="text" placeholder="e.g. shukran, mdn" value={wayfairForm.label}
                  onChange={e => setWayfairForm({ ...wayfairForm, label: e.target.value })}
                  className="w-full p-2 border border-gray-300 rounded-md text-sm mb-3" required />
              </div>
              <div>
                <label htmlFor="wayfair-supplier-id" className="block mb-1 font-medium">
                  Supplier ID <span className="font-normal text-slate-400 text-xs">(auto-discovered)</span>
                </label>
                <input id="wayfair-supplier-id" type="number" placeholder="e.g. 194115" value={wayfairForm.supplier_id}
                  onChange={e => setWayfairForm({ ...wayfairForm, supplier_id: e.target.value })}
                  className="w-full p-2 border border-gray-300 rounded-md text-sm mb-3" />
              </div>
              <div>
                <label htmlFor="wayfair-client-id" className="block mb-1 font-medium">Client ID</label>
                <input id="wayfair-client-id" type="text" placeholder="Wayfair Client ID" value={wayfairForm.client_id}
                  onChange={e => setWayfairForm({ ...wayfairForm, client_id: e.target.value })}
                  className="w-full p-2 border border-gray-300 rounded-md text-sm mb-3" required={!wayfairEditingId} />
              </div>
              <div>
                <label htmlFor="wayfair-client-secret" className="block mb-1 font-medium">Client Secret</label>
                <input id="wayfair-client-secret" type="password" placeholder={wayfairEditingId ? 'Leave blank to keep current' : 'Client Secret'}
                  value={wayfairForm.client_secret}
                  onChange={e => setWayfairForm({ ...wayfairForm, client_secret: e.target.value })}
                  className="w-full p-2 border border-gray-300 rounded-md text-sm mb-3" required={!wayfairEditingId} />
              </div>
              <div>
                <label htmlFor="wayfair-channel" className="block mb-1 font-medium">Sales Channel</label>
                <input id="wayfair-channel" type="text" placeholder="e.g. wfs, wfm" value={wayfairForm.channel}
                  onChange={e => setWayfairForm({ ...wayfairForm, channel: e.target.value })}
                  className="w-full p-2 border border-gray-300 rounded-md text-sm mb-3" required={!wayfairEditingId} />
              </div>
              <div>
                <label htmlFor="wayfair-warehouse" className="block mb-1 font-medium">Warehouse Code</label>
                <input id="wayfair-warehouse" type="text" placeholder="e.g. WFS, WFM" value={wayfairForm.warehouse}
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

      {/* Walmart tab */}
      {activeTab === 'walmart' && <>
        <div className="bg-white rounded-lg p-6 shadow-sm mb-4">
          <h2 className="mb-4">Walmart Accounts</h2>
          {walmartMessage && (
            <p className={`mb-3 ${walmartMessage.includes('OK') || walmartMessage.includes('success') || walmartMessage.includes('Updated') || walmartMessage.includes('added') ? 'text-emerald-600' : 'text-red-600'}`}>
              {walmartMessage}
            </p>
          )}
          {walmartAccounts.length === 0 ? (
            <p className="text-slate-500">No Walmart accounts configured yet.</p>
          ) : (
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b-2 border-slate-200">
                  <th className="text-left p-2">Account</th>
                  <th className="text-left p-2">Client ID</th>
                  <th className="text-left p-2">Mode</th>
                  <th className="text-left p-2">Status</th>
                  <th className="text-left p-2">Updated</th>
                  <th className="text-left p-2"></th>
                </tr>
              </thead>
              <tbody>
                {walmartAccounts.map(a => (
                  <tr key={a.id} className={`border-b border-slate-200 ${walmartEditingId === a.id ? 'bg-[#eff6ff]' : ''}`}>
                    <td className="p-2 font-semibold">{a.label}</td>
                    <td className="p-2 font-mono text-sm">{a.client_id.slice(0, 8)}...{a.client_id.slice(-4)}</td>
                    <td className="p-2">{a.use_sandbox ? 'Sandbox' : 'Production'}</td>
                    <td className="p-2">
                      <span className={a.is_active ? 'text-emerald-600' : 'text-gray-400'}>
                        {a.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="p-2 text-sm text-slate-500">
                      {a.updated_at ? new Date(a.updated_at).toLocaleDateString() : '—'}
                    </td>
                    <td className="p-2 whitespace-nowrap">
                      <button onClick={() => handleWalmartTest(a.id)} disabled={walmartTesting === a.id} className="px-3 py-1 bg-[#6366f1] text-white border-none rounded cursor-pointer text-xs mr-1">
                        {walmartTesting === a.id ? '...' : 'Test'}
                      </button>
                      <button onClick={() => handleWalmartToggle(a.id, a.is_active)} className={`px-3 py-1 text-white border-none rounded cursor-pointer text-xs mr-1 ${a.is_active ? 'bg-amber-600' : 'bg-emerald-600'}`}>
                        {a.is_active ? 'Deactivate' : 'Activate'}
                      </button>
                      <button onClick={() => handleWalmartEdit(a)} className="px-3 py-1 bg-blue-600 text-white border-none rounded cursor-pointer text-xs mr-1">Edit</button>
                      <button onClick={() => handleWalmartDelete(a.id, a.label)} disabled={walmartDeleting === a.id} className="px-3 py-1 bg-red-600 text-white border-none rounded cursor-pointer text-xs mr-1">
                        {walmartDeleting === a.id ? '...' : 'Delete'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="bg-white rounded-lg p-6 shadow-sm mb-4">
          <div className="flex justify-between items-center mb-4">
            <h2>{walmartEditingId ? `Edit — ${walmartForm.label}` : 'Add Walmart Account'}</h2>
            {walmartEditingId && (
              <button onClick={handleWalmartCancelEdit} className="px-4 py-1 bg-gray-500 text-white border-none rounded cursor-pointer text-sm">
                Cancel
              </button>
            )}
          </div>
          <p className="text-sm text-slate-500 mb-4">
            Walmart Marketplace US (seller-fulfilled). Token TTL 15 min, son 30 gün siparişleri günlük 04:00 UTC çekilir.
          </p>
          <form onSubmit={handleWalmartSubmit}>
            <div className="grid grid-cols-2 gap-x-4">
              <div>
                <label htmlFor="walmart-label" className="block mb-1 font-medium">Account Label</label>
                <input id="walmart-label" type="text" placeholder="e.g. us-main" value={walmartForm.label}
                  onChange={e => setWalmartForm({ ...walmartForm, label: e.target.value })}
                  className="w-full p-2 border border-gray-300 rounded-md text-sm mb-3" required />
              </div>
              <div className="flex items-end mb-3">
                <label htmlFor="walmart-sandbox" className="flex items-center gap-2 cursor-pointer">
                  <input id="walmart-sandbox" type="checkbox" checked={walmartForm.use_sandbox}
                    onChange={e => setWalmartForm({ ...walmartForm, use_sandbox: e.target.checked })} />
                  <span>Use Sandbox</span>
                </label>
              </div>
              <div>
                <label htmlFor="walmart-client-id" className="block mb-1 font-medium">Client ID</label>
                <input id="walmart-client-id" type="text" placeholder="Walmart Client ID" value={walmartForm.client_id}
                  onChange={e => setWalmartForm({ ...walmartForm, client_id: e.target.value })}
                  className="w-full p-2 border border-gray-300 rounded-md text-sm mb-3" required={!walmartEditingId} />
              </div>
              <div>
                <label htmlFor="walmart-client-secret" className="block mb-1 font-medium">Client Secret</label>
                <input id="walmart-client-secret" type="password" placeholder={walmartEditingId ? 'Leave blank to keep current' : 'Client Secret'}
                  value={walmartForm.client_secret}
                  onChange={e => setWalmartForm({ ...walmartForm, client_secret: e.target.value })}
                  className="w-full p-2 border border-gray-300 rounded-md text-sm mb-3" required={!walmartEditingId} />
              </div>
            </div>
            <button type="submit" disabled={walmartSaving}
              className={`px-8 py-2 text-white border-none rounded-md cursor-pointer ${walmartEditingId ? 'bg-emerald-600' : 'bg-blue-600'}`}>
              {walmartSaving ? 'Saving...' : walmartEditingId ? 'Update Account' : 'Add Account'}
            </button>
          </form>
        </div>
      </>}

      {/* Bol tab */}
      {activeTab === 'bol' && <>
        <div className="bg-white rounded-lg p-6 shadow-sm mb-4">
          <h2 className="mb-4">Bol Accounts</h2>
          {bolMessage && (
            <p className={`mb-3 ${bolMessage.includes('OK') || bolMessage.includes('success') || bolMessage.includes('Updated') || bolMessage.includes('added') ? 'text-emerald-600' : 'text-red-600'}`}>
              {bolMessage}
            </p>
          )}
          {bolAccounts.length === 0 ? (
            <p className="text-slate-500">No Bol accounts configured yet.</p>
          ) : (
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b-2 border-slate-200">
                  <th className="text-left p-2">Account</th>
                  <th className="text-left p-2">Channel</th>
                  <th className="text-left p-2">Client ID</th>
                  <th className="text-left p-2">Status</th>
                  <th className="text-left p-2">Updated</th>
                  <th className="text-left p-2"></th>
                </tr>
              </thead>
              <tbody>
                {bolAccounts.map(a => (
                  <tr key={a.id} className={`border-b border-slate-200 ${bolEditingId === a.id ? 'bg-[#eff6ff]' : ''}`}>
                    <td className="p-2 font-semibold capitalize">{a.label}</td>
                    <td className="p-2 font-mono text-sm text-slate-600">{a.channel}</td>
                    <td className="p-2 font-mono text-sm">{a.client_id.slice(0, 8)}...{a.client_id.slice(-4)}</td>
                    <td className="p-2">
                      <span className={a.is_active ? 'text-emerald-600' : 'text-gray-400'}>
                        {a.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="p-2 text-sm text-slate-500">
                      {a.updated_at ? new Date(a.updated_at).toLocaleDateString() : '—'}
                    </td>
                    <td className="p-2 whitespace-nowrap">
                      <button onClick={() => handleBolTest(a.id)} disabled={bolTesting === a.id}
                        className="px-3 py-1 bg-[#6366f1] text-white border-none rounded cursor-pointer text-xs mr-1">
                        {bolTesting === a.id ? '...' : 'Test'}
                      </button>
                      <button onClick={() => handleBolToggle(a.id, a.is_active)}
                        className={`px-3 py-1 text-white border-none rounded cursor-pointer text-xs mr-1 ${a.is_active ? 'bg-amber-600' : 'bg-emerald-600'}`}>
                        {a.is_active ? 'Deactivate' : 'Activate'}
                      </button>
                      <button onClick={() => handleBolEdit(a)}
                        className="px-3 py-1 bg-blue-600 text-white border-none rounded cursor-pointer text-xs mr-1">Edit</button>
                      <button onClick={() => handleBolDelete(a.id, a.label)} disabled={bolDeleting === a.id}
                        className="px-3 py-1 bg-red-600 text-white border-none rounded cursor-pointer text-xs mr-1">
                        {bolDeleting === a.id ? '...' : 'Delete'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="bg-white rounded-lg p-6 shadow-sm mb-4">
          <div className="flex justify-between items-center mb-4">
            <h2>{bolEditingId ? `Edit — ${bolForm.label}` : 'Add Bol Account'}</h2>
            {bolEditingId && (
              <button onClick={handleBolCancelEdit}
                className="px-4 py-1 bg-gray-500 text-white border-none rounded cursor-pointer text-sm">Cancel</button>
            )}
          </div>
          <p className="text-sm text-slate-500 mb-4">
            Bol Retailer API (FBR). Token TTL 5dk, son 30 gün siparişleri günlük 04:15 UTC çekilir.
            Channel kodu sales_data tablosunda kullanılır (örn. bol_pera, bol_onebv).
          </p>
          <form onSubmit={handleBolSubmit}>
            <div className="grid grid-cols-2 gap-x-4">
              <div>
                <label htmlFor="bol-label" className="block mb-1 font-medium">Account Label</label>
                <input id="bol-label" type="text" placeholder="e.g. pera, onebv" value={bolForm.label}
                  onChange={e => setBolForm({ ...bolForm, label: e.target.value })}
                  className="w-full p-2 border border-gray-300 rounded-md text-sm mb-3" required />
              </div>
              <div>
                <label htmlFor="bol-channel" className="block mb-1 font-medium">Sales Channel</label>
                <input id="bol-channel" type="text" placeholder="e.g. bol_pera, bol_onebv" value={bolForm.channel}
                  onChange={e => setBolForm({ ...bolForm, channel: e.target.value })}
                  className="w-full p-2 border border-gray-300 rounded-md text-sm mb-3" required={!bolEditingId} />
              </div>
              <div>
                <label htmlFor="bol-client-id" className="block mb-1 font-medium">Client ID</label>
                <input id="bol-client-id" type="text" placeholder="Bol Client ID" value={bolForm.client_id}
                  onChange={e => setBolForm({ ...bolForm, client_id: e.target.value })}
                  className="w-full p-2 border border-gray-300 rounded-md text-sm mb-3" required={!bolEditingId} />
              </div>
              <div>
                <label htmlFor="bol-client-secret" className="block mb-1 font-medium">Client Secret</label>
                <input id="bol-client-secret" type="password"
                  placeholder={bolEditingId ? 'Leave blank to keep current' : 'Client Secret'}
                  value={bolForm.client_secret}
                  onChange={e => setBolForm({ ...bolForm, client_secret: e.target.value })}
                  className="w-full p-2 border border-gray-300 rounded-md text-sm mb-3" required={!bolEditingId} />
              </div>
            </div>
            <button type="submit" disabled={bolSaving}
              className={`px-8 py-2 text-white border-none rounded-md cursor-pointer ${bolEditingId ? 'bg-emerald-600' : 'bg-blue-600'}`}>
              {bolSaving ? 'Saving...' : bolEditingId ? 'Update Account' : 'Add Account'}
            </button>
          </form>
        </div>
      </>}

      {/* Takealot tab */}
      {activeTab === 'takealot' && <>
        <div className="bg-white rounded-lg p-6 shadow-sm mb-4">
          <h2 className="mb-4">Takealot Accounts</h2>
          {takealotMessage && (
            <p className={`mb-3 ${takealotMessage.includes('OK') || takealotMessage.includes('success') || takealotMessage.includes('Updated') || takealotMessage.includes('added') ? 'text-emerald-600' : 'text-red-600'}`}>
              {takealotMessage}
            </p>
          )}
          {takealotAccounts.length === 0 ? (
            <p className="text-slate-500">No Takealot accounts configured yet.</p>
          ) : (
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b-2 border-slate-200">
                  <th className="text-left p-2">Account</th>
                  <th className="text-left p-2">Status</th>
                  <th className="text-left p-2">Updated</th>
                  <th className="text-left p-2"></th>
                </tr>
              </thead>
              <tbody>
                {takealotAccounts.map(a => (
                  <tr key={a.id} className={`border-b border-slate-200 ${takealotEditingId === a.id ? 'bg-[#eff6ff]' : ''}`}>
                    <td className="p-2 font-semibold">{a.label}</td>
                    <td className="p-2">
                      <span className={a.is_active ? 'text-emerald-600' : 'text-gray-400'}>
                        {a.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="p-2 text-sm text-slate-500">
                      {a.updated_at ? new Date(a.updated_at).toLocaleDateString() : '—'}
                    </td>
                    <td className="p-2 whitespace-nowrap">
                      <button onClick={() => handleTakealotTest(a.id)} disabled={takealotTesting === a.id}
                        className="px-3 py-1 bg-[#6366f1] text-white border-none rounded cursor-pointer text-xs mr-1">
                        {takealotTesting === a.id ? '...' : 'Test'}
                      </button>
                      <button onClick={() => handleTakealotToggle(a.id, a.is_active)}
                        className={`px-3 py-1 text-white border-none rounded cursor-pointer text-xs mr-1 ${a.is_active ? 'bg-amber-600' : 'bg-emerald-600'}`}>
                        {a.is_active ? 'Deactivate' : 'Activate'}
                      </button>
                      <button onClick={() => handleTakealotEdit(a)}
                        className="px-3 py-1 bg-blue-600 text-white border-none rounded cursor-pointer text-xs mr-1">Edit</button>
                      <button onClick={() => handleTakealotDelete(a.id, a.label)} disabled={takealotDeleting === a.id}
                        className="px-3 py-1 bg-red-600 text-white border-none rounded cursor-pointer text-xs mr-1">
                        {takealotDeleting === a.id ? '...' : 'Delete'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="bg-white rounded-lg p-6 shadow-sm mb-4">
          <div className="flex justify-between items-center mb-4">
            <h2>{takealotEditingId ? `Edit — ${takealotForm.label}` : 'Add Takealot Account'}</h2>
            {takealotEditingId && (
              <button onClick={handleTakealotCancelEdit}
                className="px-4 py-1 bg-gray-500 text-white border-none rounded cursor-pointer text-sm">Cancel</button>
            )}
          </div>
          <p className="text-sm text-slate-500 mb-4">
            Takealot Seller Portal API Integration → Authentication sayfasından alınacak.
            channel='takealot' (sales_data tablosunda). Günlük 04:45 UTC sync (siparişler + stok).
          </p>
          <form onSubmit={handleTakealotSubmit}>
            <div className="grid grid-cols-2 gap-x-4">
              <div>
                <label htmlFor="ta-label" className="block mb-1 font-medium">Account Label</label>
                <input id="ta-label" type="text" placeholder="e.g. za-main" value={takealotForm.label}
                  onChange={e => setTakealotForm({ ...takealotForm, label: e.target.value })}
                  className="w-full p-2 border border-gray-300 rounded-md text-sm mb-3" required />
              </div>
              <div>
                <label htmlFor="ta-key" className="block mb-1 font-medium">API Key</label>
                <input id="ta-key" type="password"
                  placeholder={takealotEditingId ? 'Leave blank to keep current' : 'Takealot API Key'}
                  value={takealotForm.api_key}
                  onChange={e => setTakealotForm({ ...takealotForm, api_key: e.target.value })}
                  className="w-full p-2 border border-gray-300 rounded-md text-sm mb-3" required={!takealotEditingId} />
              </div>
            </div>
            <button type="submit" disabled={takealotSaving}
              className={`px-8 py-2 text-white border-none rounded-md cursor-pointer ${takealotEditingId ? 'bg-emerald-600' : 'bg-blue-600'}`}>
              {takealotSaving ? 'Saving...' : takealotEditingId ? 'Update Account' : 'Add Account'}
            </button>
          </form>
        </div>
      </>}

      {activeTab === 'kaufland' && <>
        <div className="bg-white rounded-lg p-6 shadow-sm mb-4">
          <h2 className="mb-4">Kaufland Accounts</h2>
          {kauflandMessage && (
            <p className={`mb-3 ${kauflandMessage.includes('OK') || kauflandMessage.includes('success') || kauflandMessage.includes('Updated') || kauflandMessage.includes('added') ? 'text-emerald-600' : 'text-red-600'}`}>
              {kauflandMessage}
            </p>
          )}
          {kauflandAccounts.length === 0 ? (
            <p className="text-slate-500">No Kaufland accounts configured yet.</p>
          ) : (
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b-2 border-slate-200">
                  <th className="text-left p-2">Account</th>
                  <th className="text-left p-2">Storefront</th>
                  <th className="text-left p-2">Channel</th>
                  <th className="text-left p-2">Status</th>
                  <th className="text-left p-2">Updated</th>
                  <th className="text-left p-2"></th>
                </tr>
              </thead>
              <tbody>
                {kauflandAccounts.map(a => (
                  <tr key={a.id} className={`border-b border-slate-200 ${kauflandEditingId === a.id ? 'bg-[#eff6ff]' : ''}`}>
                    <td className="p-2 font-semibold">{a.label}</td>
                    <td className="p-2 text-sm">{a.storefront}</td>
                    <td className="p-2 font-mono text-xs">{a.channel}</td>
                    <td className="p-2">
                      <span className={a.is_active ? 'text-emerald-600' : 'text-gray-400'}>
                        {a.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="p-2 text-sm text-slate-500">
                      {a.updated_at ? new Date(a.updated_at).toLocaleDateString() : '—'}
                    </td>
                    <td className="p-2 whitespace-nowrap">
                      <button onClick={() => handleKauflandTest(a.id)} disabled={kauflandTesting === a.id}
                        className="px-3 py-1 bg-[#6366f1] text-white border-none rounded cursor-pointer text-xs mr-1">
                        {kauflandTesting === a.id ? '...' : 'Test'}
                      </button>
                      <button onClick={() => handleKauflandToggle(a.id, a.is_active)}
                        className={`px-3 py-1 text-white border-none rounded cursor-pointer text-xs mr-1 ${a.is_active ? 'bg-amber-600' : 'bg-emerald-600'}`}>
                        {a.is_active ? 'Deactivate' : 'Activate'}
                      </button>
                      <button onClick={() => handleKauflandEdit(a)}
                        className="px-3 py-1 bg-blue-600 text-white border-none rounded cursor-pointer text-xs mr-1">Edit</button>
                      <button onClick={() => handleKauflandDelete(a.id, a.label)} disabled={kauflandDeleting === a.id}
                        className="px-3 py-1 bg-red-600 text-white border-none rounded cursor-pointer text-xs mr-1">
                        {kauflandDeleting === a.id ? '...' : 'Delete'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="bg-white rounded-lg p-6 shadow-sm mb-4">
          <div className="flex justify-between items-center mb-4">
            <h2>{kauflandEditingId ? `Edit — ${kauflandForm.label}` : 'Add Kaufland Account'}</h2>
            {kauflandEditingId && (
              <button onClick={handleKauflandCancelEdit}
                className="px-4 py-1 bg-gray-500 text-white border-none rounded cursor-pointer text-sm">Cancel</button>
            )}
          </div>
          <p className="text-sm text-slate-500 mb-4">
            Kaufland Seller Portal → API → Client Key (32 char) + Secret Key (64 char).
            HMAC-SHA256 imzalı request. Günlük 05:00 UTC sync (sipariş + stok).
          </p>
          <form onSubmit={handleKauflandSubmit}>
            <div className="grid grid-cols-2 gap-x-4">
              <div>
                <label htmlFor="kf-label" className="block mb-1 font-medium">Account Label</label>
                <input id="kf-label" type="text" placeholder="e.g. de-main" value={kauflandForm.label}
                  onChange={e => setKauflandForm({ ...kauflandForm, label: e.target.value })}
                  className="w-full p-2 border border-gray-300 rounded-md text-sm mb-3" required />
              </div>
              <div>
                <label htmlFor="kf-storefront" className="block mb-1 font-medium">Storefront</label>
                <select id="kf-storefront" value={kauflandForm.storefront}
                  onChange={e => {
                    const sf = e.target.value;
                    const suffix = sf.split('_')[0].toLowerCase();
                    setKauflandForm({ ...kauflandForm, storefront: sf, channel: `kaufland_${suffix}` });
                  }}
                  className="w-full p-2 border border-gray-300 rounded-md text-sm mb-3">
                  <option value="de_DE">de_DE (Germany)</option>
                  <option value="cs_CZ">cs_CZ (Czech Republic)</option>
                  <option value="sk_SK">sk_SK (Slovakia)</option>
                  <option value="pl_PL">pl_PL (Poland)</option>
                  <option value="de_AT">de_AT (Austria)</option>
                </select>
              </div>
              <div>
                <label htmlFor="kf-channel" className="block mb-1 font-medium">Sales Channel Code</label>
                <input id="kf-channel" type="text" placeholder="kaufland_de" value={kauflandForm.channel}
                  onChange={e => setKauflandForm({ ...kauflandForm, channel: e.target.value })}
                  className="w-full p-2 border border-gray-300 rounded-md text-sm mb-3" required />
              </div>
              <div>
                <label htmlFor="kf-ckey" className="block mb-1 font-medium">Client Key (32 char)</label>
                <input id="kf-ckey" type="text" placeholder="32-char public key"
                  value={kauflandForm.client_key}
                  onChange={e => setKauflandForm({ ...kauflandForm, client_key: e.target.value })}
                  className="w-full p-2 border border-gray-300 rounded-md text-sm mb-3 font-mono" required={!kauflandEditingId} />
              </div>
              <div className="col-span-2">
                <label htmlFor="kf-skey" className="block mb-1 font-medium">Secret Key (64 char)</label>
                <input id="kf-skey" type="password"
                  placeholder={kauflandEditingId ? 'Leave blank to keep current' : '64-char secret'}
                  value={kauflandForm.secret_key}
                  onChange={e => setKauflandForm({ ...kauflandForm, secret_key: e.target.value })}
                  className="w-full p-2 border border-gray-300 rounded-md text-sm mb-3 font-mono" required={!kauflandEditingId} />
              </div>
            </div>
            <button type="submit" disabled={kauflandSaving}
              className={`px-8 py-2 text-white border-none rounded-md cursor-pointer ${kauflandEditingId ? 'bg-emerald-600' : 'bg-blue-600'}`}>
              {kauflandSaving ? 'Saving...' : kauflandEditingId ? 'Update Account' : 'Add Account'}
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
                          aria-label="Ads refresh token"
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
          <label htmlFor="spapi-region" className="block mb-1 font-medium">Region</label>
          <select
            id="spapi-region"
            value={form.region}
            onChange={e => setForm({ ...form, region: e.target.value })}
            className="w-full p-2 border border-gray-300 rounded-md text-sm mb-3 bg-white"
          >
            <option value="NA">NA (North America - US, CA, MX)</option>
            <option value="EU">EU (Europe - UK, DE, FR, IT, ES)</option>
            <option value="FE">FE (Far East - AU, JP, SG)</option>
          </select>

          <label htmlFor="spapi-account-name" className="block mb-1 font-medium">Account Name</label>
          <input
            id="spapi-account-name"
            type="text"
            placeholder="e.g., iwa concept, IWA Concept AU"
            value={form.account_name}
            onChange={e => setForm({ ...form, account_name: e.target.value })}
            className="w-full p-2 border border-gray-300 rounded-md text-sm mb-3"
          />

          <label htmlFor="spapi-seller-id" className="block mb-1 font-medium">Seller ID</label>
          <input
            id="spapi-seller-id"
            type="text"
            placeholder={editingId ? 'Leave blank to keep current' : 'e.g., A2ABC123DEF'}
            value={form.seller_id}
            onChange={e => setForm({ ...form, seller_id: e.target.value })}
            className="w-full p-2 border border-gray-300 rounded-md text-sm mb-3"
            required={!editingId}
          />

          <label htmlFor="spapi-client-id" className="block mb-1 font-medium">Client ID (LWA)</label>
          <input
            id="spapi-client-id"
            type="text"
            placeholder={editingId ? 'Leave blank to keep current' : 'amzn1.application-oa2-client.xxx'}
            value={form.client_id}
            onChange={e => setForm({ ...form, client_id: e.target.value })}
            className="w-full p-2 border border-gray-300 rounded-md text-sm mb-3"
            required={!editingId}
          />

          <label htmlFor="spapi-client-secret" className="block mb-1 font-medium">Client Secret (LWA)</label>
          <input
            id="spapi-client-secret"
            type="password"
            placeholder={editingId ? 'Leave blank to keep current' : 'Client secret from LWA app'}
            value={form.client_secret}
            onChange={e => setForm({ ...form, client_secret: e.target.value })}
            className="w-full p-2 border border-gray-300 rounded-md text-sm mb-3"
            required={!editingId}
          />

          <label htmlFor="spapi-refresh-token" className="block mb-1 font-medium">Refresh Token</label>
          <input
            id="spapi-refresh-token"
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
