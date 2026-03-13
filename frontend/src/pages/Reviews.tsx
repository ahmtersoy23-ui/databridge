import { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import * as XLSX from 'xlsx';

interface ReviewRow {
  asin: string;
  country_code: string;
  rating: string | null;
  review_count: number;
  last_review_title: string | null;
  last_review_text: string | null;
  last_review_rating: number | null;
  last_review_date: string | null;
  last_review_author: string | null;
  is_blocked: boolean;
  checked_at: string | null;
  updated_at: string | null;
  label: string | null;
}

interface TrackedRow {
  id: number;
  asin: string;
  country_code: string;
  label: string | null;
  is_active: boolean;
  created_at: string;
}

interface HistoryRow {
  rating: string | null;
  review_count: number;
  recorded_at: string;
}

interface ReviewItem {
  id: number;
  title: string | null;
  body: string | null;
  rating: string | null;
  review_date: string | null;
  author: string | null;
  is_verified: boolean;
  fetched_at: string;
}

const cardStyle = {
  background: '#fff',
  borderRadius: '8px',
  padding: '1.5rem',
  boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
  marginBottom: '1rem',
} as const;

const tabBtn = (active: boolean) => ({
  padding: '0.5rem 1.25rem',
  background: 'none',
  border: 'none',
  borderBottom: active ? '2px solid #0891b2' : '2px solid transparent',
  color: active ? '#0891b2' : '#64748b',
  fontWeight: active ? 600 : 400,
  cursor: 'pointer' as const,
  fontSize: '0.9rem',
});

const btnStyle = (bg: string, disabled?: boolean) => ({
  padding: '0.4rem 1rem',
  background: disabled ? '#9ca3af' : bg,
  color: '#fff',
  border: 'none',
  borderRadius: '6px',
  cursor: disabled ? 'default' : 'pointer' as const,
  fontSize: '0.85rem',
});

const COUNTRY_OPTIONS = ['US', 'UK', 'DE', 'FR', 'IT', 'ES', 'CA', 'AU', 'AE', 'SA'];

export default function Reviews() {
  const [tab, setTab] = useState<'reviews' | 'tracked'>('reviews');

  // Reviews tab state
  const [reviews, setReviews] = useState<ReviewRow[]>([]);
  const [reviewsLoading, setReviewsLoading] = useState(true);
  const [countryFilter, setCountryFilter] = useState('');
  const [searchFilter, setSearchFilter] = useState('');

  // Tracked tab state
  const [tracked, setTracked] = useState<TrackedRow[]>([]);
  const [trackedLoading, setTrackedLoading] = useState(true);

  // Add form
  const [addAsin, setAddAsin] = useState('');
  const [addCountry, setAddCountry] = useState('US');
  const [addLabel, setAddLabel] = useState('');
  const [adding, setAdding] = useState(false);

  // Excel import
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // History/Review items modal
  const [historyAsin, setHistoryAsin] = useState<string | null>(null);
  const [historyCountry, setHistoryCountry] = useState('');
  const [modalTab, setModalTab] = useState<'history' | 'items'>('history');
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [reviewItems, setReviewItems] = useState<ReviewItem[]>([]);
  const [reviewItemsLoading, setReviewItemsLoading] = useState(false);

  // Message
  const [message, setMessage] = useState('');

  // --- Fetch reviews ---
  const fetchReviews = async () => {
    setReviewsLoading(true);
    try {
      const params: Record<string, string> = {};
      if (countryFilter) params.country_code = countryFilter;
      const res = await axios.get('/api/v1/reviews', { params });
      if (res.data.success) setReviews(res.data.data);
    } catch {
      // ignore
    } finally {
      setReviewsLoading(false);
    }
  };

  // --- Fetch tracked ---
  const fetchTracked = async () => {
    setTrackedLoading(true);
    try {
      const res = await axios.get('/api/v1/reviews/tracked');
      if (res.data.success) setTracked(res.data.data);
    } catch {
      // ignore
    } finally {
      setTrackedLoading(false);
    }
  };

  useEffect(() => {
    if (tab === 'reviews') fetchReviews();
    else fetchTracked();
  }, [tab]);

  // --- Fetch history ---
  const openHistory = async (asin: string, countryCode: string) => {
    setHistoryAsin(asin);
    setHistoryCountry(countryCode);
    setModalTab('history');
    setHistoryLoading(true);
    setHistory([]);
    setReviewItems([]);
    try {
      const res = await axios.get(`/api/v1/reviews/${asin}/history`, {
        params: { country_code: countryCode },
      });
      if (res.data.success) setHistory(res.data.data);
    } catch {
      // ignore
    } finally {
      setHistoryLoading(false);
    }
  };

  const fetchReviewItems = async (asin: string, countryCode: string) => {
    setReviewItemsLoading(true);
    setReviewItems([]);
    try {
      const res = await axios.get(`/api/v1/reviews/${asin}/items`, {
        params: { country_code: countryCode },
      });
      if (res.data.success) setReviewItems(res.data.data);
    } catch {
      // ignore
    } finally {
      setReviewItemsLoading(false);
    }
  };

  // --- Add single ASIN ---
  const handleAdd = async () => {
    if (!addAsin.trim()) return;
    setAdding(true);
    setMessage('');
    try {
      await axios.post('/api/v1/reviews/tracked', {
        asin: addAsin.trim().toUpperCase(),
        country_code: addCountry,
        label: addLabel.trim() || undefined,
      });
      setAddAsin('');
      setAddLabel('');
      setMessage('ASIN added.');
      fetchTracked();
    } catch (err: any) {
      setMessage(err.response?.data?.error || 'Add failed');
    } finally {
      setAdding(false);
    }
  };

  // --- Delete ASIN ---
  const handleDelete = async (id: number, asin: string) => {
    if (!confirm(`Remove ${asin} from tracking?`)) return;
    try {
      await axios.delete(`/api/v1/reviews/tracked/${id}`);
      fetchTracked();
    } catch (err: any) {
      setMessage(err.response?.data?.error || 'Delete failed');
    }
  };

  // --- Excel import ---
  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImporting(true);
    setMessage('');

    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });

      const items: Array<{ asin: string; country_code: string; label?: string }> = [];
      for (const row of rawRows) {
        const asin = String(row['asin'] ?? row['ASIN'] ?? '').trim().toUpperCase();
        const cc = String(row['country_code'] ?? row['marketplace'] ?? row['MARKETPLACE'] ?? 'US').trim().toUpperCase();
        const label = String(row['label'] ?? row['LABEL'] ?? '').trim();
        if (asin) items.push({ asin, country_code: cc, ...(label ? { label } : {}) });
      }

      if (items.length === 0) {
        setMessage('No valid rows. Excel must have an "asin" column. Optional: "country_code", "label".');
        return;
      }

      const res = await axios.post('/api/v1/reviews/tracked/bulk', { items });
      setMessage(res.data.message || `${items.length} ASINs imported.`);
      fetchTracked();
    } catch (err: any) {
      setMessage(err.response?.data?.error || 'Import failed');
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // --- Reset blocks ---
  const handleResetBlocks = async () => {
    try {
      const res = await axios.post('/api/v1/reviews/reset-blocks');
      setMessage(res.data.message || 'Blocks reset.');
      fetchReviews();
    } catch (err: any) {
      setMessage(err.response?.data?.error || 'Reset failed');
    }
  };

  // --- Filtered reviews ---
  const filteredReviews = reviews.filter(r => {
    if (searchFilter) {
      const s = searchFilter.toLowerCase();
      if (!r.asin.toLowerCase().includes(s) && !(r.label || '').toLowerCase().includes(s)) return false;
    }
    return true;
  });

  // --- Format helpers ---
  const fmtDate = (d: string | null) => {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  const ratingColor = (r: string | null) => {
    if (!r) return '#94a3b8';
    const v = parseFloat(r);
    if (v >= 4.5) return '#059669';
    if (v >= 4.0) return '#0891b2';
    if (v >= 3.5) return '#d97706';
    return '#dc2626';
  };

  return (
    <div>
      <h1 style={{ marginBottom: '1rem' }}>Reviews</h1>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '0.25rem', borderBottom: '2px solid #e2e8f0', marginBottom: '1rem' }}>
        <button style={tabBtn(tab === 'reviews')} onClick={() => setTab('reviews')}>
          Review Data
        </button>
        <button style={tabBtn(tab === 'tracked')} onClick={() => setTab('tracked')}>
          Tracked ASINs
        </button>
      </div>

      {/* Message */}
      {message && (
        <div style={{
          padding: '0.75rem 1rem', borderRadius: '6px', marginBottom: '1rem',
          background: message.toLowerCase().includes('fail') || message.toLowerCase().includes('error') ? '#fef2f2' : '#f0fdf4',
          color: message.toLowerCase().includes('fail') || message.toLowerCase().includes('error') ? '#dc2626' : '#059669',
          border: '1px solid',
          borderColor: message.toLowerCase().includes('fail') || message.toLowerCase().includes('error') ? '#fecaca' : '#bbf7d0',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <span>{message}</span>
          <button onClick={() => setMessage('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: '1rem' }}>✕</button>
        </div>
      )}

      {/* ===== REVIEWS TAB ===== */}
      {tab === 'reviews' && (
        <>
          {/* Filters */}
          <div style={{ ...cardStyle, display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <select
              value={countryFilter}
              onChange={e => setCountryFilter(e.target.value)}
              style={{ padding: '0.35rem 0.75rem', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '0.85rem' }}
            >
              <option value="">All Countries</option>
              {COUNTRY_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
            </select>

            <input
              type="text"
              placeholder="Search ASIN or label..."
              value={searchFilter}
              onChange={e => setSearchFilter(e.target.value)}
              style={{ padding: '0.35rem 0.75rem', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '0.85rem', width: '200px' }}
            />

            <button onClick={() => fetchReviews()} style={btnStyle('#2563eb')}>
              Refresh
            </button>

            <div style={{ marginLeft: 'auto' }}>
              <button onClick={handleResetBlocks} style={btnStyle('#d97706')}>
                Reset Blocks
              </button>
            </div>
          </div>

          {/* Summary */}
          <div style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: '0.75rem' }}>
            {reviewsLoading ? 'Loading...' : `${filteredReviews.length} products`}
            {reviews.some(r => r.is_blocked) && (
              <span style={{ color: '#dc2626', marginLeft: '0.75rem' }}>
                ({reviews.filter(r => r.is_blocked).length} blocked)
              </span>
            )}
          </div>

          {/* Reviews table */}
          <div style={{ ...cardStyle, overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #e2e8f0' }}>
                  <th style={{ textAlign: 'left', padding: '0.5rem' }}>ASIN</th>
                  <th style={{ textAlign: 'left', padding: '0.5rem' }}>Country</th>
                  <th style={{ textAlign: 'right', padding: '0.5rem' }}>Rating</th>
                  <th style={{ textAlign: 'right', padding: '0.5rem' }}>Reviews</th>
                  <th style={{ textAlign: 'left', padding: '0.5rem' }}>Latest Review</th>
                  <th style={{ textAlign: 'left', padding: '0.5rem' }}>Checked</th>
                  <th style={{ padding: '0.5rem', width: '70px' }}></th>
                </tr>
              </thead>
              <tbody>
                {filteredReviews.map(r => (
                  <tr key={`${r.asin}-${r.country_code}`} style={{
                    borderBottom: '1px solid #f1f5f9',
                    opacity: r.is_blocked ? 0.5 : 1,
                  }}>
                    <td style={{ padding: '0.5rem' }}>
                      <div style={{ fontFamily: 'monospace', fontSize: '0.82rem' }}>{r.asin}</div>
                      {r.label && <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>{r.label}</div>}
                    </td>
                    <td style={{ padding: '0.5rem' }}>
                      <span style={{
                        background: '#f1f5f9', padding: '0.15rem 0.5rem', borderRadius: '4px',
                        fontSize: '0.8rem', fontWeight: 500,
                      }}>
                        {r.country_code}
                      </span>
                    </td>
                    <td style={{ padding: '0.5rem', textAlign: 'right', fontWeight: 600, color: ratingColor(r.rating), fontSize: '0.95rem' }}>
                      {r.rating ? `${Number(r.rating).toFixed(1)}` : '—'}
                    </td>
                    <td style={{ padding: '0.5rem', textAlign: 'right', fontFamily: 'monospace' }}>
                      {r.review_count.toLocaleString()}
                    </td>
                    <td style={{ padding: '0.5rem', maxWidth: '250px' }}>
                      {r.last_review_title ? (
                        <div title={r.last_review_text || ''}>
                          <div style={{ fontSize: '0.8rem', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {r.last_review_rating != null && (
                              <span style={{ color: ratingColor(String(r.last_review_rating)), marginRight: '0.35rem' }}>
                                {'★'.repeat(r.last_review_rating)}
                              </span>
                            )}
                            {r.last_review_title}
                          </div>
                          <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                            {r.last_review_author} · {r.last_review_date}
                          </div>
                        </div>
                      ) : (
                        <span style={{ color: '#d1d5db', fontSize: '0.8rem' }}>—</span>
                      )}
                    </td>
                    <td style={{ padding: '0.5rem', fontSize: '0.8rem', color: '#64748b' }}>
                      {fmtDate(r.checked_at)}
                    </td>
                    <td style={{ padding: '0.5rem' }}>
                      <button
                        onClick={() => openHistory(r.asin, r.country_code)}
                        style={{ padding: '0.2rem 0.5rem', background: 'none', border: '1px solid #d1d5db', borderRadius: '4px', cursor: 'pointer', fontSize: '0.75rem', color: '#64748b' }}
                      >
                        History
                      </button>
                    </td>
                  </tr>
                ))}
                {!reviewsLoading && filteredReviews.length === 0 && (
                  <tr>
                    <td colSpan={7} style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8' }}>
                      No review data yet. Add ASINs and run the fetcher.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ===== TRACKED TAB ===== */}
      {tab === 'tracked' && (
        <>
          {/* Add form + Import */}
          <div style={{ ...cardStyle, display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              type="text"
              placeholder="ASIN"
              value={addAsin}
              onChange={e => setAddAsin(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleAdd(); }}
              style={{ padding: '0.35rem 0.75rem', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '0.85rem', width: '130px', fontFamily: 'monospace' }}
            />
            <select
              value={addCountry}
              onChange={e => setAddCountry(e.target.value)}
              style={{ padding: '0.35rem 0.75rem', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '0.85rem' }}
            >
              {COUNTRY_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <input
              type="text"
              placeholder="Label (optional)"
              value={addLabel}
              onChange={e => setAddLabel(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleAdd(); }}
              style={{ padding: '0.35rem 0.75rem', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '0.85rem', width: '160px' }}
            />
            <button onClick={handleAdd} disabled={adding || !addAsin.trim()} style={btnStyle('#059669', adding || !addAsin.trim())}>
              {adding ? 'Adding...' : 'Add'}
            </button>

            <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.5rem' }}>
              <label style={{ ...btnStyle('#7c3aed'), display: 'inline-block' }}>
                {importing ? 'Importing...' : 'Import Excel'}
                <input ref={fileInputRef} type="file" accept=".xlsx,.xls" style={{ display: 'none' }} onChange={handleImport} disabled={importing} />
              </label>
            </div>
          </div>

          <div style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: '0.75rem' }}>
            Excel: <code>asin</code> (required), <code>country_code</code> (default: US), <code>label</code> (optional)
            {' · '}{trackedLoading ? 'Loading...' : `${tracked.length} tracked ASINs`}
          </div>

          {/* Tracked table */}
          <div style={cardStyle}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #e2e8f0' }}>
                  <th style={{ textAlign: 'left', padding: '0.5rem' }}>ASIN</th>
                  <th style={{ textAlign: 'left', padding: '0.5rem' }}>Country</th>
                  <th style={{ textAlign: 'left', padding: '0.5rem' }}>Label</th>
                  <th style={{ textAlign: 'left', padding: '0.5rem' }}>Added</th>
                  <th style={{ padding: '0.5rem', width: '80px' }}></th>
                </tr>
              </thead>
              <tbody>
                {tracked.map(t => (
                  <tr key={t.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '0.5rem', fontFamily: 'monospace', fontSize: '0.82rem' }}>{t.asin}</td>
                    <td style={{ padding: '0.5rem' }}>
                      <span style={{ background: '#f1f5f9', padding: '0.15rem 0.5rem', borderRadius: '4px', fontSize: '0.8rem', fontWeight: 500 }}>
                        {t.country_code}
                      </span>
                    </td>
                    <td style={{ padding: '0.5rem', color: t.label ? '#0f172a' : '#d1d5db', fontSize: '0.85rem' }}>
                      {t.label || '—'}
                    </td>
                    <td style={{ padding: '0.5rem', fontSize: '0.8rem', color: '#64748b' }}>
                      {fmtDate(t.created_at)}
                    </td>
                    <td style={{ padding: '0.5rem' }}>
                      <button
                        onClick={() => handleDelete(t.id, t.asin)}
                        style={{ padding: '0.15rem 0.5rem', background: 'none', color: '#ef4444', border: '1px solid #fca5a5', borderRadius: '4px', cursor: 'pointer', fontSize: '0.75rem' }}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
                {!trackedLoading && tracked.length === 0 && (
                  <tr>
                    <td colSpan={5} style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8' }}>
                      No tracked ASINs. Add some above or import from Excel.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ===== HISTORY MODAL ===== */}
      {historyAsin && (
        <div
          onClick={() => setHistoryAsin(null)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: '#fff', borderRadius: '12px', padding: '1.5rem',
              width: '600px', maxHeight: '75vh', overflow: 'auto',
              boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
              <h3 style={{ margin: 0 }}>
                <span style={{ fontFamily: 'monospace' }}>{historyAsin}</span>
                <span style={{ fontSize: '0.8rem', color: '#64748b', marginLeft: '0.5rem' }}>({historyCountry})</span>
              </h3>
              <button onClick={() => setHistoryAsin(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.2rem', color: '#94a3b8' }}>✕</button>
            </div>

            {/* Modal tabs */}
            <div style={{ display: 'flex', gap: '0.25rem', borderBottom: '2px solid #e2e8f0', marginBottom: '1rem' }}>
              <button
                style={tabBtn(modalTab === 'history')}
                onClick={() => setModalTab('history')}
              >
                History
              </button>
              <button
                style={tabBtn(modalTab === 'items')}
                onClick={() => {
                  setModalTab('items');
                  if (reviewItems.length === 0 && !reviewItemsLoading) {
                    fetchReviewItems(historyAsin!, historyCountry);
                  }
                }}
              >
                Reviews
              </button>
            </div>

            {/* History tab */}
            {modalTab === 'history' && (
              <>
                {historyLoading ? (
                  <p style={{ color: '#94a3b8' }}>Loading...</p>
                ) : history.length === 0 ? (
                  <p style={{ color: '#94a3b8' }}>No history records yet.</p>
                ) : (
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                    <thead>
                      <tr style={{ borderBottom: '2px solid #e2e8f0' }}>
                        <th style={{ textAlign: 'left', padding: '0.5rem' }}>Date</th>
                        <th style={{ textAlign: 'right', padding: '0.5rem' }}>Rating</th>
                        <th style={{ textAlign: 'right', padding: '0.5rem' }}>Reviews</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.map((h, i) => {
                        const prev = history[i + 1];
                        const countDiff = prev ? h.review_count - prev.review_count : 0;
                        return (
                          <tr key={i} style={{ borderBottom: '1px solid #f1f5f9' }}>
                            <td style={{ padding: '0.5rem', fontSize: '0.8rem', color: '#64748b' }}>
                              {fmtDate(h.recorded_at)}
                            </td>
                            <td style={{ padding: '0.5rem', textAlign: 'right', fontWeight: 600, color: ratingColor(h.rating) }}>
                              {h.rating ? Number(h.rating).toFixed(1) : '—'}
                            </td>
                            <td style={{ padding: '0.5rem', textAlign: 'right', fontFamily: 'monospace' }}>
                              {h.review_count.toLocaleString()}
                              {countDiff > 0 && (
                                <span style={{ color: '#059669', fontSize: '0.75rem', marginLeft: '0.35rem' }}>
                                  +{countDiff}
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </>
            )}

            {/* Review items tab */}
            {modalTab === 'items' && (
              <>
                {reviewItemsLoading ? (
                  <p style={{ color: '#94a3b8' }}>Loading...</p>
                ) : reviewItems.length === 0 ? (
                  <p style={{ color: '#94a3b8' }}>No review items yet. Run the fetcher first.</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    {reviewItems.map(item => (
                      <div key={item.id} style={{
                        padding: '0.75rem', border: '1px solid #e2e8f0', borderRadius: '8px',
                        background: '#fafafa',
                      }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            {item.rating && (
                              <span style={{ color: ratingColor(item.rating), fontWeight: 600, fontSize: '0.85rem' }}>
                                {'★'.repeat(Math.round(Number(item.rating)))}{'☆'.repeat(5 - Math.round(Number(item.rating)))}
                              </span>
                            )}
                            {item.is_verified && (
                              <span style={{ background: '#dbeafe', color: '#2563eb', fontSize: '0.7rem', padding: '0.1rem 0.4rem', borderRadius: '3px' }}>
                                Verified
                              </span>
                            )}
                          </div>
                          <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                            {item.author}
                          </span>
                        </div>
                        {item.title && (
                          <div style={{ fontWeight: 600, fontSize: '0.85rem', marginBottom: '0.25rem' }}>
                            {item.title}
                          </div>
                        )}
                        {item.body && (
                          <div style={{ fontSize: '0.82rem', color: '#374151', lineHeight: 1.5 }}>
                            {item.body.length > 200 ? item.body.substring(0, 200) + '...' : item.body}
                          </div>
                        )}
                        {item.review_date && (
                          <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: '0.35rem' }}>
                            {item.review_date}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
