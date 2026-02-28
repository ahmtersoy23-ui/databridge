import { useState, useEffect } from 'react';
import axios from 'axios';

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

export default function Settings() {
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [deleting, setDeleting] = useState<number | null>(null);

  const fetchCredentials = async () => {
    try {
      const res = await axios.get('/api/v1/credentials');
      setCredentials(res.data.data);
    } catch {
      // Not authenticated or no credentials
    }
  };

  useEffect(() => { fetchCredentials(); }, []);

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

  return (
    <div>
      <h1 style={{ marginBottom: '1.5rem' }}>Settings</h1>

      {/* Existing credentials */}
      <div style={cardStyle}>
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
      </div>

      {/* Add/Edit credentials form */}
      <div style={cardStyle}>
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
      </div>
    </div>
  );
}
