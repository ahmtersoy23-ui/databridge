import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';

/* ---------- types ---------- */
interface SummaryData {
  spend: number;
  sales: number;
  acos: number;
  roas: number;
  impressions: number;
  clicks: number;
  ctr: number;
  cpc: number;
  orders: number;
  period: { from: string | null; to: string | null };
}

interface SearchTermRow {
  searchTerm: string;
  impressions: number;
  clicks: number;
  ctr: number;
  cpc: number;
  spend: number;
  sales: number;
  acos: number;
  orders: number;
}

interface CampaignRow {
  campaignName: string;
  impressions: number;
  clicks: number;
  spend: number;
  sales: number;
  acos: number;
  orders: number;
}

/* ---------- helpers ---------- */
const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtInt = (n: number) => n.toLocaleString('en-US');

function acosColor(acos: number): string {
  if (acos >= 999) return '#dc2626';
  if (acos > 40) return '#dc2626';
  if (acos < 20) return '#059669';
  return '#d97706';
}

function acosBg(acos: number): string {
  if (acos >= 999) return 'bg-red-50';
  if (acos > 40) return 'bg-red-50';
  if (acos < 20) return 'bg-[#f0fdf4]';
  return 'bg-transparent';
}

const DAY_OPTIONS = [14, 30, 60, 90] as const;
const PAGE_SIZE = 100;

/* ---------- component ---------- */
export default function Ads() {
  const [days, setDays] = useState<number>(14);
  const [loading, setLoading] = useState(true);

  // Summary
  const [summary, setSummary] = useState<SummaryData | null>(null);

  // Search terms
  const [stRows, setStRows] = useState<SearchTermRow[]>([]);
  const [stTotal, setStTotal] = useState(0);
  const [stOffset, setStOffset] = useState(0);
  const [stSort, setStSort] = useState<{ col: string; order: 'asc' | 'desc' }>({ col: 'spend', order: 'desc' });
  const [wastedFilter, setWastedFilter] = useState(false);

  // Campaigns
  const [campRows, setCampRows] = useState<CampaignRow[]>([]);
  const [campSort, setCampSort] = useState<{ col: string; order: 'asc' | 'desc' }>({ col: 'spend', order: 'desc' });

  /* --- fetchers --- */
  const fetchSummary = useCallback(async (d: number) => {
    try {
      const res = await axios.get('/api/v1/ads-analysis/summary', { params: { days: d } });
      setSummary(res.data.data);
    } catch { setSummary(null); }
  }, []);

  const fetchSearchTerms = useCallback(async (d: number, sort: string, order: string, offset: number) => {
    try {
      const res = await axios.get('/api/v1/ads-analysis/search-terms', {
        params: { days: d, sort, order, limit: PAGE_SIZE, offset },
      });
      setStRows(res.data.data.rows);
      setStTotal(res.data.data.total);
    } catch { setStRows([]); setStTotal(0); }
  }, []);

  const fetchCampaigns = useCallback(async (d: number, sort: string, order: string) => {
    try {
      const res = await axios.get('/api/v1/ads-analysis/campaigns', {
        params: { days: d, sort, order },
      });
      setCampRows(res.data.data.rows);
    } catch { setCampRows([]); }
  }, []);

  /* --- effects --- */
  useEffect(() => {
    setLoading(true);
    setStOffset(0);
    Promise.all([
      fetchSummary(days),
      fetchSearchTerms(days, stSort.col, stSort.order, 0),
      fetchCampaigns(days, campSort.col, campSort.order),
    ]).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days]);

  // Re-fetch search terms on sort / offset change
  useEffect(() => {
    fetchSearchTerms(days, stSort.col, stSort.order, stOffset);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stSort, stOffset]);

  // Re-fetch campaigns on sort change
  useEffect(() => {
    fetchCampaigns(days, campSort.col, campSort.order);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campSort]);

  /* --- search-term sort handler --- */
  const handleStSort = (col: string) => {
    setStSort(prev => ({
      col,
      order: prev.col === col && prev.order === 'desc' ? 'asc' : 'desc',
    }));
    setStOffset(0);
  };

  /* --- campaign sort handler --- */
  const handleCampSort = (col: string) => {
    setCampSort(prev => ({
      col,
      order: prev.col === col && prev.order === 'desc' ? 'asc' : 'desc',
    }));
  };

  const sortArrow = (current: { col: string; order: string }, col: string) =>
    current.col === col ? (current.order === 'asc' ? ' \u25B2' : ' \u25BC') : '';

  /* --- filtered rows for wasted spend --- */
  const displayStRows = wastedFilter
    ? stRows.filter(r => Number(r.clicks) >= 20 && Number(r.orders) === 0)
    : stRows;

  /* --- pagination --- */
  const totalPages = Math.ceil(stTotal / PAGE_SIZE);
  const currentPage = Math.floor(stOffset / PAGE_SIZE) + 1;

  if (loading && !summary) {
    return (
      <div className="text-center p-16 text-slate-400">
        Loading ads data...
      </div>
    );
  }

  if (!summary || (summary.impressions === 0 && summary.spend === 0)) {
    return (
      <div className="text-center p-16 text-slate-400">
        No ads data available.
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-xl font-bold mb-4">Ads Dashboard</h1>

      {/* Day filter */}
      <div className="flex gap-2 mb-6">
        {DAY_OPTIONS.map(d => (
          <button
            key={d}
            onClick={() => setDays(d)}
            className={`px-4 py-2 border border-gray-300 rounded-md cursor-pointer text-sm ${
              days === d ? 'bg-slate-700 text-white font-semibold' : 'bg-slate-100 text-slate-600'
            }`}
          >
            {d} days
          </button>
        ))}
        {summary.period.from && summary.period.to && (
          <span className="ml-4 text-slate-400 text-sm self-center">
            {summary.period.from} &mdash; {summary.period.to}
          </span>
        )}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        {/* Spend */}
        <div className="bg-white rounded-lg p-6 shadow-sm border-t-3 border-[#0891b2]">
          <div className="text-xs text-slate-500 mb-1">Total Spend</div>
          <div className="text-2xl font-bold text-[#0891b2]">${fmt(summary.spend)}</div>
          <div className="text-xs text-slate-400 mt-1">
            {fmtInt(summary.clicks)} clicks &middot; CPC ${fmt(summary.cpc)}
          </div>
        </div>

        {/* Sales */}
        <div className="bg-white rounded-lg p-6 shadow-sm border-t-3 border-emerald-600">
          <div className="text-xs text-slate-500 mb-1">Total Sales</div>
          <div className="text-2xl font-bold text-emerald-600">${fmt(summary.sales)}</div>
          <div className="text-xs text-slate-400 mt-1">
            {fmtInt(summary.orders)} orders &middot; {fmtInt(summary.impressions)} impr.
          </div>
        </div>

        {/* ACOS */}
        <div className="bg-white rounded-lg p-6 shadow-sm" style={{ borderTop: `3px solid ${acosColor(summary.acos)}` }}>
          <div className="text-xs text-slate-500 mb-1">ACOS</div>
          <div className="text-2xl font-bold" style={{ color: acosColor(summary.acos) }}>
            {summary.acos >= 999 ? 'N/A' : `${fmt(summary.acos)}%`}
          </div>
          <div className="text-xs text-slate-400 mt-1">
            CTR {fmt(summary.ctr)}%
          </div>
        </div>

        {/* ROAS */}
        <div className="bg-white rounded-lg p-6 shadow-sm border-t-3 border-emerald-600">
          <div className="text-xs text-slate-500 mb-1">ROAS</div>
          <div className="text-2xl font-bold text-emerald-600">{fmt(summary.roas)}x</div>
          <div className="text-xs text-slate-400 mt-1">
            return on ad spend
          </div>
        </div>
      </div>

      {/* Search Terms Table */}
      <div className="bg-white rounded-lg shadow-sm mb-8 px-6 py-4">
        <div className="flex justify-between items-center mb-3">
          <h2 className="text-lg font-semibold m-0">Search Terms</h2>
          <label className="text-sm text-slate-500 cursor-pointer flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={wastedFilter}
              onChange={e => setWastedFilter(e.target.checked)}
            />
            Wasted spend (20+ clicks, 0 sales)
          </label>
        </div>

        {displayStRows.length === 0 ? (
          <div className="p-8 text-center text-slate-400">
            {wastedFilter ? 'No wasted spend terms found.' : 'No search term data.'}
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b-2 border-slate-200">
                    {[
                      { key: 'customer_search_term', label: 'Search Term' },
                      { key: 'impressions', label: 'Impressions' },
                      { key: 'clicks', label: 'Clicks' },
                      { key: 'ctr', label: 'CTR%' },
                      { key: 'cpc', label: 'CPC' },
                      { key: 'spend', label: 'Spend' },
                      { key: 'sales', label: 'Sales' },
                      { key: 'acos', label: 'ACOS%' },
                      { key: 'orders', label: 'Orders' },
                    ].map(c => (
                      <th key={c.key} className="text-left px-3 py-2 text-sm text-slate-600 cursor-pointer select-none whitespace-nowrap" onClick={() => handleStSort(c.key)}>
                        {c.label}{sortArrow(stSort, c.key)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {displayStRows.map((r, i) => (
                    <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-[#fafbfc]'}>
                      <td className="px-3 py-2 text-sm border-b border-slate-100 max-w-[300px] overflow-hidden text-ellipsis whitespace-nowrap">
                        {r.searchTerm}
                      </td>
                      <td className="px-3 py-2 text-sm border-b border-slate-100 text-right">{fmtInt(Number(r.impressions))}</td>
                      <td className="px-3 py-2 text-sm border-b border-slate-100 text-right">{fmtInt(Number(r.clicks))}</td>
                      <td className="px-3 py-2 text-sm border-b border-slate-100 text-right">{fmt(Number(r.ctr))}%</td>
                      <td className="px-3 py-2 text-sm border-b border-slate-100 text-right">${fmt(Number(r.cpc))}</td>
                      <td className="px-3 py-2 text-sm border-b border-slate-100 text-right">${fmt(Number(r.spend))}</td>
                      <td className="px-3 py-2 text-sm border-b border-slate-100 text-right">${fmt(Number(r.sales))}</td>
                      <td className={`px-3 py-2 text-sm border-b border-slate-100 text-right font-semibold ${acosBg(Number(r.acos))}`} style={{ color: acosColor(Number(r.acos)) }}>
                        {Number(r.acos) >= 999 ? 'N/A' : `${fmt(Number(r.acos))}%`}
                      </td>
                      <td className="px-3 py-2 text-sm border-b border-slate-100 text-right">{fmtInt(Number(r.orders))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {!wastedFilter && totalPages > 1 && (
              <div className="flex justify-center items-center gap-4 mt-4">
                <button
                  disabled={currentPage <= 1}
                  onClick={() => setStOffset(prev => Math.max(0, prev - PAGE_SIZE))}
                  className={`px-3 py-1.5 border border-gray-300 rounded text-sm ${
                    currentPage <= 1 ? 'bg-slate-100 cursor-default text-slate-300' : 'bg-white cursor-pointer text-slate-600'
                  }`}
                >
                  Previous
                </button>
                <span className="text-sm text-slate-500">
                  Page {currentPage} of {totalPages} ({fmtInt(stTotal)} terms)
                </span>
                <button
                  disabled={currentPage >= totalPages}
                  onClick={() => setStOffset(prev => prev + PAGE_SIZE)}
                  className={`px-3 py-1.5 border border-gray-300 rounded text-sm ${
                    currentPage >= totalPages ? 'bg-slate-100 cursor-default text-slate-300' : 'bg-white cursor-pointer text-slate-600'
                  }`}
                >
                  Next
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Campaign Performance Table */}
      <div className="bg-white rounded-lg shadow-sm px-6 py-4">
        <h2 className="text-lg font-semibold mb-3">Campaign Performance</h2>

        {campRows.length === 0 ? (
          <div className="p-8 text-center text-slate-400">
            No campaign data.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b-2 border-slate-200">
                  {[
                    { key: 'campaign_name', label: 'Campaign' },
                    { key: 'impressions', label: 'Impressions' },
                    { key: 'clicks', label: 'Clicks' },
                    { key: 'spend', label: 'Spend' },
                    { key: 'sales', label: 'Sales' },
                    { key: 'acos', label: 'ACOS%' },
                    { key: 'orders', label: 'Orders' },
                  ].map(c => (
                    <th key={c.key} className="text-left px-3 py-2 text-sm text-slate-600 cursor-pointer select-none whitespace-nowrap" onClick={() => handleCampSort(c.key)}>
                      {c.label}{sortArrow(campSort, c.key)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {campRows.map((r, i) => (
                  <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-[#fafbfc]'}>
                    <td className="px-3 py-2 text-sm border-b border-slate-100 max-w-[350px] overflow-hidden text-ellipsis whitespace-nowrap">
                      {r.campaignName}
                    </td>
                    <td className="px-3 py-2 text-sm border-b border-slate-100 text-right">{fmtInt(Number(r.impressions))}</td>
                    <td className="px-3 py-2 text-sm border-b border-slate-100 text-right">{fmtInt(Number(r.clicks))}</td>
                    <td className="px-3 py-2 text-sm border-b border-slate-100 text-right">${fmt(Number(r.spend))}</td>
                    <td className="px-3 py-2 text-sm border-b border-slate-100 text-right">${fmt(Number(r.sales))}</td>
                    <td className={`px-3 py-2 text-sm border-b border-slate-100 text-right font-semibold ${acosBg(Number(r.acos))}`} style={{ color: acosColor(Number(r.acos)) }}>
                      {Number(r.acos) >= 999 ? 'N/A' : `${fmt(Number(r.acos))}%`}
                    </td>
                    <td className="px-3 py-2 text-sm border-b border-slate-100 text-right">{fmtInt(Number(r.orders))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
