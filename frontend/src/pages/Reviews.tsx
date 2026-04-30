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
  prev_rating: string | null;
  prev_review_count: number | null;
  rating_7d: string | null;
  count_7d: number | null;
  rating_30d: string | null;
  count_30d: number | null;
  rating_90d: string | null;
  count_90d: number | null;
}

interface FetchStatus {
  lastJob: { status: string; started_at: string; completed_at: string | null; records_processed: number } | null;
  nextAvailableAt: string | null;
}

interface TrackedRow {
  id: number;
  asin: string;
  country_code: string;
  label: string | null;
  iwasku: string | null;
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
  const [addIwasku, setAddIwasku] = useState('');
  const [adding, setAdding] = useState(false);

  // Inline edit iwasku
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editIwasku, setEditIwasku] = useState('');
  const [savingIwasku, setSavingIwasku] = useState(false);

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

  // Fetch status
  const [fetchStatus, setFetchStatus] = useState<FetchStatus | null>(null);
  const [fetching, setFetching] = useState(false);

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

  // --- Fetch status (for Fetch Reviews button) ---
  useEffect(() => {
    axios.get('/api/v1/reviews/fetch-status').then(res => {
      if (res.data.success) setFetchStatus(res.data.data);
    }).catch(() => {});
  }, []);

  // --- Trigger review fetch ---
  const handleFetch = async () => {
    setFetching(true);
    setMessage('');
    try {
      const res = await axios.post('/api/v1/reviews/fetch');
      setMessage(res.data.message || 'Fetch started');
      // Refresh fetch status
      const statusRes = await axios.get('/api/v1/reviews/fetch-status');
      if (statusRes.data.success) setFetchStatus(statusRes.data.data);
    } catch (err: any) {
      setMessage(err.response?.data?.error || 'Fetch failed');
    } finally {
      setFetching(false);
    }
  };

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
        iwasku: addIwasku.trim() || undefined,
      });
      setAddAsin('');
      setAddLabel('');
      setAddIwasku('');
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

      const items: Array<{ asin: string; country_code: string; label?: string; iwasku?: string }> = [];
      for (const row of rawRows) {
        const asin = String(row['asin'] ?? row['ASIN'] ?? '').trim().toUpperCase();
        const cc = String(row['country_code'] ?? row['marketplace'] ?? row['MARKETPLACE'] ?? 'US').trim().toUpperCase();
        const label = String(row['label'] ?? row['LABEL'] ?? '').trim();
        const iwasku = String(row['iwasku'] ?? row['IWASKU'] ?? '').trim();
        if (asin) items.push({ asin, country_code: cc, ...(label ? { label } : {}), ...(iwasku ? { iwasku } : {}) });
      }

      if (items.length === 0) {
        setMessage('No valid rows. Excel must have an "asin" column. Optional: "country_code", "label", "iwasku".');
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
    if (!d) return '\u2014';
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

  const getStatus = (r: ReviewRow): { label: string; color: string; bg: string } | null => {
    if (r.prev_review_count == null) return null; // no previous data
    if (r.review_count === r.prev_review_count && r.rating === r.prev_rating) return null; // no change

    const countChanged = r.review_count !== r.prev_review_count;
    const currRating = r.rating ? parseFloat(r.rating) : null;
    const prevRating = r.prev_rating ? parseFloat(r.prev_rating) : null;

    if (countChanged && currRating != null && prevRating != null && currRating < prevRating) {
      return { label: 'Rating Down', color: '#dc2626', bg: '#fef2f2' };
    }
    if (countChanged && currRating != null && prevRating != null && currRating > prevRating) {
      return { label: 'Rating Up', color: '#059669', bg: '#f0fdf4' };
    }
    if (countChanged) {
      return { label: 'Count Changed', color: '#d97706', bg: '#fffbeb' };
    }
    // only rating changed (without count change)
    if (currRating != null && prevRating != null && currRating < prevRating) {
      return { label: 'Rating Down', color: '#dc2626', bg: '#fef2f2' };
    }
    if (currRating != null && prevRating != null && currRating > prevRating) {
      return { label: 'Rating Up', color: '#059669', bg: '#f0fdf4' };
    }
    return null;
  };

  return (
    <div>
      <h1 className="mb-4">Reviews</h1>

      {/* Tabs */}
      <div className="flex gap-1 border-b-2 border-slate-200 mb-4">
        <button
          className={`px-4 py-2 bg-transparent border-none cursor-pointer text-sm -mb-[2px] ${
            tab === 'reviews' ? 'font-semibold text-[#0891b2] border-b-2 border-[#0891b2]' : 'text-slate-500 border-b-2 border-transparent'
          }`}
          onClick={() => setTab('reviews')}
        >
          Review Data
        </button>
        <button
          className={`px-4 py-2 bg-transparent border-none cursor-pointer text-sm -mb-[2px] ${
            tab === 'tracked' ? 'font-semibold text-[#0891b2] border-b-2 border-[#0891b2]' : 'text-slate-500 border-b-2 border-transparent'
          }`}
          onClick={() => setTab('tracked')}
        >
          Tracked ASINs
        </button>
      </div>

      {/* Message */}
      {message && (
        <div
          role={message.toLowerCase().includes('fail') || message.toLowerCase().includes('error') ? 'alert' : 'status'}
          aria-live="polite"
          className={`px-4 py-3 rounded-md mb-4 border flex justify-between items-center ${
            message.toLowerCase().includes('fail') || message.toLowerCase().includes('error')
              ? 'bg-red-50 text-red-600 border-[#fecaca]'
              : 'bg-[#f0fdf4] text-emerald-600 border-[#bbf7d0]'
          }`}
        >
          <span>{message}</span>
          <button
            type="button"
            onClick={() => setMessage('')}
            aria-label="Dismiss message"
            className="bg-transparent border-none cursor-pointer text-slate-400 text-base"
          >
            {'\u2715'}
          </button>
        </div>
      )}

      {/* ===== REVIEWS TAB ===== */}
      {tab === 'reviews' && (
        <>
          {/* Filters */}
          <div className="bg-white rounded-lg p-6 shadow-sm mb-4 flex gap-3 items-center flex-wrap">
            <select
              value={countryFilter}
              onChange={e => setCountryFilter(e.target.value)}
              aria-label="Filter by country"
              className="px-3 py-1 border border-gray-300 rounded-md text-sm"
            >
              <option value="">All Countries</option>
              {COUNTRY_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
            </select>

            <input
              type="text"
              placeholder="Search ASIN or label..."
              value={searchFilter}
              onChange={e => setSearchFilter(e.target.value)}
              aria-label="Search ASIN or label"
              className="px-3 py-1 border border-gray-300 rounded-md text-sm w-[200px]"
            />

            <button onClick={() => fetchReviews()} className="px-4 py-1.5 bg-blue-600 text-white border-none rounded-md cursor-pointer text-sm">
              Refresh
            </button>

            <div className="ml-auto flex gap-3 items-center">
              <button onClick={handleResetBlocks} className="px-4 py-1.5 bg-amber-600 text-white border-none rounded-md cursor-pointer text-sm">
                Reset Blocks
              </button>
              <div className="flex flex-col items-center gap-0.5">
                <button
                  onClick={handleFetch}
                  disabled={fetching || (fetchStatus?.nextAvailableAt ? new Date(fetchStatus.nextAvailableAt) > new Date() : false)}
                  className={`px-4 py-1.5 text-white border-none rounded-md text-sm ${
                    fetching || (fetchStatus?.nextAvailableAt ? new Date(fetchStatus.nextAvailableAt) > new Date() : false)
                      ? 'bg-gray-400 cursor-default'
                      : 'bg-[#7c3aed] cursor-pointer'
                  }`}
                >
                  {fetching ? 'Fetching...' : 'Fetch Reviews'}
                </button>
                {fetchStatus?.nextAvailableAt && new Date(fetchStatus.nextAvailableAt) > new Date() && (
                  <span className="text-[0.7rem] text-slate-400">
                    Next: {new Date(fetchStatus.nextAvailableAt).toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                  </span>
                )}
                {fetchStatus?.lastJob && (
                  <span className="text-[0.7rem] text-slate-400">
                    Last: {new Date(fetchStatus.lastJob.started_at).toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' })} ({fetchStatus.lastJob.records_processed} processed)
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Summary */}
          <div className="text-xs text-slate-500 mb-3">
            {reviewsLoading ? 'Loading...' : `${filteredReviews.length} products`}
            {reviews.some(r => r.is_blocked) && (
              <span className="text-red-600 ml-3">
                ({reviews.filter(r => r.is_blocked).length} blocked)
              </span>
            )}
          </div>

          {/* Reviews table */}
          <div className="bg-white rounded-lg p-6 shadow-sm mb-4 overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b-2 border-slate-200">
                  <th className="text-center p-2 w-[90px]">Status</th>
                  <th className="text-left p-2">ASIN</th>
                  <th className="text-left p-2">Country</th>
                  <th className="text-right p-2">Rating</th>
                  <th className="text-right p-2">Reviews</th>
                  <th className="text-center p-2 w-[60px]">7d</th>
                  <th className="text-center p-2 w-[60px]">30d</th>
                  <th className="text-center p-2 w-[60px]">90d</th>
                  <th className="text-left p-2">Fetched Review</th>
                  <th className="text-left p-2">Checked</th>
                  <th className="p-2 w-[70px]"></th>
                </tr>
              </thead>
              <tbody>
                {filteredReviews.map(r => (
                  <tr key={`${r.asin}-${r.country_code}`} className={`border-b border-slate-100 ${r.is_blocked ? 'opacity-50' : ''}`}>
                    <td className="p-2 text-center">
                      {(() => {
                        const status = getStatus(r);
                        if (!status) return <span className="text-slate-300 text-xs">{'\u2014'}</span>;
                        return (
                          <span
                            className="text-[0.72rem] font-semibold px-2 py-0.5 rounded whitespace-nowrap"
                            style={{ background: status.bg, color: status.color }}
                          >
                            {status.label}
                          </span>
                        );
                      })()}
                    </td>
                    <td className="p-2">
                      <div className="font-mono text-sm">{r.asin}</div>
                      {r.label && <div className="text-xs text-slate-400">{r.label}</div>}
                    </td>
                    <td className="p-2">
                      <span className="bg-slate-100 px-2 py-0.5 rounded text-xs font-medium">
                        {r.country_code}
                      </span>
                    </td>
                    <td className="p-2 text-right font-semibold text-base" style={{ color: ratingColor(r.rating) }}>
                      {r.rating ? `${Number(r.rating).toFixed(1)}` : '\u2014'}
                    </td>
                    <td className="p-2 text-right font-mono">
                      {r.review_count.toLocaleString()}
                    </td>
                    {/* 7d / 30d / 90d diff columns */}
                    {([
                      { count: r.count_7d, rating: r.rating_7d },
                      { count: r.count_30d, rating: r.rating_30d },
                      { count: r.count_90d, rating: r.rating_90d },
                    ] as const).map((period, idx) => {
                      const diff = period.count != null ? r.review_count - period.count : null;
                      const currRating = r.rating ? parseFloat(r.rating) : null;
                      const periodRating = period.rating ? parseFloat(period.rating) : null;
                      const ratingUp = currRating != null && periodRating != null && currRating > periodRating;
                      const ratingDown = currRating != null && periodRating != null && currRating < periodRating;
                      return (
                        <td key={idx} className="p-2 text-center font-mono text-xs w-[60px]">
                          {diff == null ? (
                            <span className="text-slate-300">{'\u2014'}</span>
                          ) : (
                            <span>
                              <span className={diff > 0 ? 'text-emerald-600' : 'text-slate-500'}>
                                {diff > 0 ? `+${diff}` : diff === 0 ? '0' : String(diff)}
                              </span>
                              {ratingUp && <span className="text-emerald-600 text-[0.7rem] ml-0.5">{'\u25B2'}</span>}
                              {ratingDown && <span className="text-red-600 text-[0.7rem] ml-0.5">{'\u25BC'}</span>}
                            </span>
                          )}
                        </td>
                      );
                    })}
                    <td className="p-2 max-w-[250px]">
                      {r.last_review_title ? (
                        <div title={r.last_review_text || ''}>
                          <div className="text-xs font-medium overflow-hidden text-ellipsis whitespace-nowrap">
                            {r.last_review_rating != null && (
                              <span className="mr-1.5" style={{ color: ratingColor(String(r.last_review_rating)) }}>
                                {'\u2605'.repeat(r.last_review_rating)}
                              </span>
                            )}
                            {r.last_review_title}
                          </div>
                          <div className="text-xs text-slate-400">
                            {r.last_review_author} {'\u00B7'} {r.last_review_date}
                          </div>
                        </div>
                      ) : (
                        <span className="text-slate-300 text-xs">{'\u2014'}</span>
                      )}
                    </td>
                    <td className="p-2 text-xs text-slate-500">
                      {fmtDate(r.checked_at)}
                    </td>
                    <td className="p-2">
                      <button
                        onClick={() => openHistory(r.asin, r.country_code)}
                        className="px-2 py-0.5 bg-transparent border border-gray-300 rounded cursor-pointer text-xs text-slate-500"
                      >
                        History
                      </button>
                    </td>
                  </tr>
                ))}
                {!reviewsLoading && filteredReviews.length === 0 && (
                  <tr>
                    <td colSpan={11} className="p-8 text-center text-slate-400">
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
          <div className="bg-white rounded-lg p-6 shadow-sm mb-4 flex gap-3 items-center flex-wrap">
            <input
              type="text"
              placeholder="ASIN"
              value={addAsin}
              onChange={e => setAddAsin(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleAdd(); }}
              aria-label="ASIN"
              className="px-3 py-1 border border-gray-300 rounded-md text-sm w-[130px] font-mono"
            />
            <select
              value={addCountry}
              onChange={e => setAddCountry(e.target.value)}
              aria-label="Country code"
              className="px-3 py-1 border border-gray-300 rounded-md text-sm"
            >
              {COUNTRY_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <input
              type="text"
              placeholder="Label (optional)"
              value={addLabel}
              onChange={e => setAddLabel(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleAdd(); }}
              aria-label="Label"
              className="px-3 py-1 border border-gray-300 rounded-md text-sm w-[160px]"
            />
            <input
              type="text"
              placeholder="IWASKU (optional)"
              value={addIwasku}
              onChange={e => setAddIwasku(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleAdd(); }}
              aria-label="IWASKU"
              className="px-3 py-1 border border-gray-300 rounded-md text-sm w-[140px] font-mono"
            />
            <button
              onClick={handleAdd}
              disabled={adding || !addAsin.trim()}
              className={`px-4 py-1.5 text-white border-none rounded-md text-sm ${
                adding || !addAsin.trim() ? 'bg-gray-400 cursor-default' : 'bg-emerald-600 cursor-pointer'
              }`}
            >
              {adding ? 'Adding...' : 'Add'}
            </button>

            <div className="ml-auto flex gap-2">
              <label className="px-4 py-1.5 bg-[#7c3aed] text-white border-none rounded-md cursor-pointer text-sm inline-block">
                {importing ? 'Importing...' : 'Import Excel'}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls"
                  aria-label="Import tracked ASINs from Excel file"
                  className="hidden"
                  onChange={handleImport}
                  disabled={importing}
                />
              </label>
            </div>
          </div>

          <div className="text-xs text-slate-500 mb-3">
            Excel: <code>asin</code> (required), <code>country_code</code> (default: US), <code>label</code>, <code>iwasku</code> (optional)
            {' \u00B7 '}{trackedLoading ? 'Loading...' : `${tracked.length} tracked ASINs`}
          </div>

          {/* Tracked table */}
          <div className="bg-white rounded-lg p-6 shadow-sm mb-4">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b-2 border-slate-200">
                  <th className="text-left p-2">ASIN</th>
                  <th className="text-left p-2">Country</th>
                  <th className="text-left p-2">Label</th>
                  <th className="text-left p-2">IWASKU</th>
                  <th className="text-left p-2">Added</th>
                  <th className="p-2 w-[80px]"></th>
                </tr>
              </thead>
              <tbody>
                {tracked.map(t => (
                  <tr key={t.id} className="border-b border-slate-100">
                    <td className="p-2 font-mono text-sm">{t.asin}</td>
                    <td className="p-2">
                      <span className="bg-slate-100 px-2 py-0.5 rounded text-xs font-medium">
                        {t.country_code}
                      </span>
                    </td>
                    <td className={`p-2 text-sm ${t.label ? 'text-slate-900' : 'text-slate-300'}`}>
                      {t.label || '\u2014'}
                    </td>
                    <td className="p-2 font-mono text-sm">
                      {editingId === t.id ? (
                        <span className="flex gap-1 items-center">
                          <input
                            value={editIwasku}
                            onChange={e => setEditIwasku(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') {
                                setSavingIwasku(true);
                                axios.post('/api/v1/reviews/tracked', { asin: t.asin, country_code: t.country_code, iwasku: editIwasku.trim() })
                                  .then(() => { setEditingId(null); fetchTracked(); })
                                  .catch((err: any) => setMessage(err.response?.data?.error || 'Save failed'))
                                  .finally(() => setSavingIwasku(false));
                              }
                              if (e.key === 'Escape') setEditingId(null);
                            }}
                            autoFocus
                            aria-label={`Edit IWASKU for ${t.asin}`}
                            className="px-1.5 py-0.5 border border-gray-300 rounded text-sm w-[120px] font-mono"
                          />
                          <button
                            type="button"
                            disabled={savingIwasku}
                            onClick={() => {
                              setSavingIwasku(true);
                              axios.post('/api/v1/reviews/tracked', { asin: t.asin, country_code: t.country_code, iwasku: editIwasku.trim() })
                                .then(() => { setEditingId(null); fetchTracked(); })
                                .catch((err: any) => setMessage(err.response?.data?.error || 'Save failed'))
                                .finally(() => setSavingIwasku(false));
                            }}
                            aria-label="Save IWASKU"
                            className="px-1.5 py-0.5 bg-emerald-600 text-white border-none rounded cursor-pointer text-[0.72rem]"
                          >
                            {savingIwasku ? '...' : '\u2713'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingId(null)}
                            aria-label="Cancel IWASKU edit"
                            className="px-1.5 py-0.5 bg-transparent text-slate-400 border border-gray-300 rounded cursor-pointer text-[0.72rem]"
                          >{'\u2715'}</button>
                        </span>
                      ) : (
                        <span
                          onClick={() => { setEditingId(t.id); setEditIwasku(t.iwasku || ''); }}
                          className={`cursor-pointer border-b border-dashed border-gray-300 ${t.iwasku ? 'text-slate-900' : 'text-slate-300'}`}
                          title="Click to edit"
                        >
                          {t.iwasku || '\u2014'}
                        </span>
                      )}
                    </td>
                    <td className="p-2 text-xs text-slate-500">
                      {fmtDate(t.created_at)}
                    </td>
                    <td className="p-2">
                      <button
                        onClick={() => handleDelete(t.id, t.asin)}
                        className="px-2 py-0.5 bg-transparent text-red-500 border border-[#fca5a5] rounded cursor-pointer text-xs"
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
                {!trackedLoading && tracked.length === 0 && (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-slate-400">
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
          className="fixed inset-0 bg-black/40 flex items-center justify-center z-[1000]"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="review-history-modal-title"
            onClick={e => e.stopPropagation()}
            className="bg-white rounded-xl p-6 w-[600px] max-h-[75vh] overflow-auto shadow-[0_20px_60px_rgba(0,0,0,0.3)]"
          >
            <div className="flex justify-between items-center mb-3">
              <h3 id="review-history-modal-title" className="m-0">
                <span className="font-mono">{historyAsin}</span>
                <span className="text-xs text-slate-500 ml-2">({historyCountry})</span>
              </h3>
              <button
                type="button"
                onClick={() => setHistoryAsin(null)}
                aria-label="Close history dialog"
                className="bg-transparent border-none cursor-pointer text-xl text-slate-400"
              >
                {'\u2715'}
              </button>
            </div>

            {/* Modal tabs */}
            <div className="flex gap-1 border-b-2 border-slate-200 mb-4">
              <button
                className={`px-4 py-2 bg-transparent border-none cursor-pointer text-sm -mb-[2px] ${
                  modalTab === 'history' ? 'font-semibold text-[#0891b2] border-b-2 border-[#0891b2]' : 'text-slate-500 border-b-2 border-transparent'
                }`}
                onClick={() => setModalTab('history')}
              >
                History
              </button>
              <button
                className={`px-4 py-2 bg-transparent border-none cursor-pointer text-sm -mb-[2px] ${
                  modalTab === 'items' ? 'font-semibold text-[#0891b2] border-b-2 border-[#0891b2]' : 'text-slate-500 border-b-2 border-transparent'
                }`}
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
                  <p className="text-slate-400">Loading...</p>
                ) : history.length === 0 ? (
                  <p className="text-slate-400">No history records yet.</p>
                ) : (
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="border-b-2 border-slate-200">
                        <th className="text-left p-2">Date</th>
                        <th className="text-right p-2">Rating</th>
                        <th className="text-right p-2">Reviews</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.map((h, i) => {
                        const prev = history[i + 1];
                        const countDiff = prev ? h.review_count - prev.review_count : 0;
                        return (
                          <tr key={i} className="border-b border-slate-100">
                            <td className="p-2 text-xs text-slate-500">
                              {fmtDate(h.recorded_at)}
                            </td>
                            <td className="p-2 text-right font-semibold" style={{ color: ratingColor(h.rating) }}>
                              {h.rating ? Number(h.rating).toFixed(1) : '\u2014'}
                            </td>
                            <td className="p-2 text-right font-mono">
                              {h.review_count.toLocaleString()}
                              {countDiff > 0 && (
                                <span className="text-emerald-600 text-xs ml-1.5">
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
                  <p className="text-slate-400">Loading...</p>
                ) : reviewItems.length === 0 ? (
                  <p className="text-slate-400">No review items yet. Run the fetcher first.</p>
                ) : (
                  <div className="flex flex-col gap-3">
                    {reviewItems.map(item => (
                      <div key={item.id} className="p-3 border border-slate-200 rounded-lg bg-[#fafafa]">
                        <div className="flex justify-between items-center mb-1.5">
                          <div className="flex items-center gap-2">
                            {item.rating && (
                              <span className="font-semibold text-sm" style={{ color: ratingColor(item.rating) }}>
                                {'\u2605'.repeat(Math.round(Number(item.rating)))}{'\u2606'.repeat(5 - Math.round(Number(item.rating)))}
                              </span>
                            )}
                            {item.is_verified && (
                              <span className="bg-blue-100 text-blue-600 text-[0.7rem] px-1.5 py-0.5 rounded">
                                Verified
                              </span>
                            )}
                          </div>
                          <span className="text-xs text-slate-400">
                            {item.author}
                          </span>
                        </div>
                        {item.title && (
                          <div className="font-semibold text-sm mb-1">
                            {item.title}
                          </div>
                        )}
                        {item.body && (
                          <div className="text-sm text-gray-700 leading-normal">
                            {item.body.length > 200 ? item.body.substring(0, 200) + '...' : item.body}
                          </div>
                        )}
                        {item.review_date && (
                          <div className="text-[0.72rem] text-slate-400 mt-1.5">
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
