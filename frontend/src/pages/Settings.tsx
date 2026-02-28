import { useState, useEffect } from 'react';
import axios from 'axios';

interface Credential {
  id: number;
  region: string;
  seller_id: string;
  is_active: boolean;
  refresh_token_preview: string;
  client_id_preview: string;
  created_at: string;
}

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

export default function Settings() {
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [form, setForm] = useState({ region: 'NA', seller_id: '', refresh_token: '', client_id: '', client_secret: '' });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const fetchCredentials = async () => {
    try {
      const res = await axios.get('/api/v1/credentials');
      setCredentials(res.data.data);
    } catch {
      // Not authenticated or no credentials
    }
  };

  useEffect(() => { fetchCredentials(); }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage('');

    try {
      await axios.post('/api/v1/credentials', form);
      setMessage('Credentials saved successfully!');
      setForm({ region: 'NA', seller_id: '', refresh_token: '', client_id: '', client_secret: '' });
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
                <th style={{ textAlign: 'left', padding: '0.5rem' }}>Seller ID</th>
                <th style={{ textAlign: 'left', padding: '0.5rem' }}>Client ID</th>
                <th style={{ textAlign: 'left', padding: '0.5rem' }}>Status</th>
                <th style={{ textAlign: 'left', padding: '0.5rem' }}>Added</th>
              </tr>
            </thead>
            <tbody>
              {credentials.map(c => (
                <tr key={c.id} style={{ borderBottom: '1px solid #e2e8f0' }}>
                  <td style={{ padding: '0.5rem' }}>{c.region}</td>
                  <td style={{ padding: '0.5rem' }}>{c.seller_id}</td>
                  <td style={{ padding: '0.5rem' }}>{c.client_id_preview}</td>
                  <td style={{ padding: '0.5rem' }}>
                    <span style={{ color: c.is_active ? '#059669' : '#9ca3af' }}>
                      {c.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td style={{ padding: '0.5rem' }}>{new Date(c.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Add credentials form */}
      <div style={cardStyle}>
        <h2 style={{ marginBottom: '1rem' }}>Add SP-API Credentials</h2>
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

          <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: 500 }}>Seller ID</label>
          <input
            type="text"
            placeholder="e.g., A2ABC123DEF"
            value={form.seller_id}
            onChange={e => setForm({ ...form, seller_id: e.target.value })}
            style={inputStyle}
            required
          />

          <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: 500 }}>Client ID (LWA)</label>
          <input
            type="text"
            placeholder="amzn1.application-oa2-client.xxx"
            value={form.client_id}
            onChange={e => setForm({ ...form, client_id: e.target.value })}
            style={inputStyle}
            required
          />

          <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: 500 }}>Client Secret (LWA)</label>
          <input
            type="password"
            placeholder="Client secret from LWA app"
            value={form.client_secret}
            onChange={e => setForm({ ...form, client_secret: e.target.value })}
            style={inputStyle}
            required
          />

          <label style={{ display: 'block', marginBottom: '0.25rem', fontWeight: 500 }}>Refresh Token</label>
          <input
            type="password"
            placeholder="Atzr|xxx..."
            value={form.refresh_token}
            onChange={e => setForm({ ...form, refresh_token: e.target.value })}
            style={inputStyle}
            required
          />

          {message && (
            <p style={{ color: message.includes('success') ? '#059669' : '#dc2626', marginBottom: '0.75rem' }}>
              {message}
            </p>
          )}

          <button
            type="submit"
            disabled={saving}
            style={{ padding: '0.5rem 2rem', background: '#2563eb', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer' }}
          >
            {saving ? 'Saving...' : 'Save Credentials'}
          </button>
        </form>
      </div>
    </div>
  );
}
