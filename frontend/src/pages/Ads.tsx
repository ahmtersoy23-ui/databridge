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

/* ---------- styles ---------- */
const cardStyle = {
  background: '#fff',
  borderRadius: '8px',
  padding: '1.5rem',
  boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
} as const;

const btnGroup = (active: boolean) => ({
  padding: '0.5rem 1.2rem',
  background: active ? '#334155' : '#f1f5f9',
  color: active ? '#fff' : '#475569',
  border: '1px solid #d1d5db',
  borderRadius: '6px',
  cursor: 'pointer' as const,
  fontSize: '0.9rem',
  fontWeight: active ? 600 : 400,
});

const thStyle = {
  textAlign: 'left' as const,
  padding: '0.6rem 0.75rem',
  fontSize: '0.82rem',
  color: '#475569',
  cursor: 'pointer' as const,
  userSelect: 'none' as const,
  whiteSpace: 'nowrap' as const,
};

const tdStyle = {
  padding: '0.5rem 0.75rem',
  fontSize: '0.85rem',
  borderBottom: '1px solid #f1f5f9',
};

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
  if (acos >= 999) return '#fef2f2';
  if (acos > 40) return '#fef2f2';
  if (acos < 20) return '#f0fdf4';
  return 'transparent';
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
      <div style={{ textAlign: 'center', padding: '4rem', color: '#94a3b8' }}>
        Loading ads data...
      </div>
    );
  }

  if (!summary || (summary.impressions === 0 && summary.spend === 0)) {
    return (
      <div style={{ textAlign: 'center', padding: '4rem', color: '#94a3b8' }}>
        No ads data available.
      </div>
    );
  }

  return (
    <div>
      <h1 style={{ fontSize: '1.4rem', fontWeight: 700, marginBottom: '1rem' }}>Ads Dashboard</h1>

      {/* Day filter */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem' }}>
        {DAY_OPTIONS.map(d => (
          <button key={d} style={btnGroup(days === d)} onClick={() => setDays(d)}>
            {d} days
          </button>
        ))}
        {summary.period.from && summary.period.to && (
          <span style={{ marginLeft: '1rem', color: '#94a3b8', fontSize: '0.85rem', alignSelf: 'center' }}>
            {summary.period.from} &mdash; {summary.period.to}
          </span>
        )}
      </div>

      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1rem', marginBottom: '2rem' }}>
        {/* Spend */}
        <div style={{ ...cardStyle, borderTop: '3px solid #0891b2' }}>
          <div style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: '0.25rem' }}>Total Spend</div>
          <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#0891b2' }}>${fmt(summary.spend)}</div>
          <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '0.25rem' }}>
            {fmtInt(summary.clicks)} clicks &middot; CPC ${fmt(summary.cpc)}
          </div>
        </div>

        {/* Sales */}
        <div style={{ ...cardStyle, borderTop: '3px solid #059669' }}>
          <div style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: '0.25rem' }}>Total Sales</div>
          <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#059669' }}>${fmt(summary.sales)}</div>
          <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '0.25rem' }}>
            {fmtInt(summary.orders)} orders &middot; {fmtInt(summary.impressions)} impr.
          </div>
        </div>

        {/* ACOS */}
        <div style={{ ...cardStyle, borderTop: `3px solid ${acosColor(summary.acos)}` }}>
          <div style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: '0.25rem' }}>ACOS</div>
          <div style={{ fontSize: '1.5rem', fontWeight: 700, color: acosColor(summary.acos) }}>
            {summary.acos >= 999 ? 'N/A' : `${fmt(summary.acos)}%`}
          </div>
          <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '0.25rem' }}>
            CTR {fmt(summary.ctr)}%
          </div>
        </div>

        {/* ROAS */}
        <div style={{ ...cardStyle, borderTop: '3px solid #059669' }}>
          <div style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: '0.25rem' }}>ROAS</div>
          <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#059669' }}>{fmt(summary.roas)}x</div>
          <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '0.25rem' }}>
            return on ad spend
          </div>
        </div>
      </div>

      {/* Search Terms Table */}
      <div style={{ ...cardStyle, marginBottom: '2rem', padding: '1rem 1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
          <h2 style={{ fontSize: '1.1rem', fontWeight: 600, margin: 0 }}>Search Terms</h2>
          <label style={{ fontSize: '0.85rem', color: '#64748b', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <input
              type="checkbox"
              checked={wastedFilter}
              onChange={e => setWastedFilter(e.target.checked)}
            />
            Wasted spend (20+ clicks, 0 sales)
          </label>
        </div>

        {displayStRows.length === 0 ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8' }}>
            {wastedFilter ? 'No wasted spend terms found.' : 'No search term data.'}
          </div>
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid #e2e8f0' }}>
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
                      <th key={c.key} style={thStyle} onClick={() => handleStSort(c.key)}>
                        {c.label}{sortArrow(stSort, c.key)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {displayStRows.map((r, i) => (
                    <tr key={i} style={{ background: i % 2 === 0 ? '#fff' : '#fafbfc' }}>
                      <td style={{ ...tdStyle, maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {r.searchTerm}
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>{fmtInt(Number(r.impressions))}</td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>{fmtInt(Number(r.clicks))}</td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>{fmt(Number(r.ctr))}%</td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>${fmt(Number(r.cpc))}</td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>${fmt(Number(r.spend))}</td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>${fmt(Number(r.sales))}</td>
                      <td style={{
                        ...tdStyle,
                        textAlign: 'right',
                        color: acosColor(Number(r.acos)),
                        background: acosBg(Number(r.acos)),
                        fontWeight: 600,
                      }}>
                        {Number(r.acos) >= 999 ? 'N/A' : `${fmt(Number(r.acos))}%`}
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>{fmtInt(Number(r.orders))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {!wastedFilter && totalPages > 1 && (
              <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '1rem', marginTop: '1rem' }}>
                <button
                  disabled={currentPage <= 1}
                  onClick={() => setStOffset(prev => Math.max(0, prev - PAGE_SIZE))}
                  style={{
                    padding: '0.4rem 0.8rem', border: '1px solid #d1d5db', borderRadius: '4px',
                    background: currentPage <= 1 ? '#f1f5f9' : '#fff', cursor: currentPage <= 1 ? 'default' : 'pointer',
                    color: currentPage <= 1 ? '#cbd5e1' : '#475569', fontSize: '0.85rem',
                  }}
                >
                  Previous
                </button>
                <span style={{ fontSize: '0.85rem', color: '#64748b' }}>
                  Page {currentPage} of {totalPages} ({fmtInt(stTotal)} terms)
                </span>
                <button
                  disabled={currentPage >= totalPages}
                  onClick={() => setStOffset(prev => prev + PAGE_SIZE)}
                  style={{
                    padding: '0.4rem 0.8rem', border: '1px solid #d1d5db', borderRadius: '4px',
                    background: currentPage >= totalPages ? '#f1f5f9' : '#fff', cursor: currentPage >= totalPages ? 'default' : 'pointer',
                    color: currentPage >= totalPages ? '#cbd5e1' : '#475569', fontSize: '0.85rem',
                  }}
                >
                  Next
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Campaign Performance Table */}
      <div style={{ ...cardStyle, padding: '1rem 1.5rem' }}>
        <h2 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '0.75rem' }}>Campaign Performance</h2>

        {campRows.length === 0 ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8' }}>
            No campaign data.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #e2e8f0' }}>
                  {[
                    { key: 'campaign_name', label: 'Campaign' },
                    { key: 'impressions', label: 'Impressions' },
                    { key: 'clicks', label: 'Clicks' },
                    { key: 'spend', label: 'Spend' },
                    { key: 'sales', label: 'Sales' },
                    { key: 'acos', label: 'ACOS%' },
                    { key: 'orders', label: 'Orders' },
                  ].map(c => (
                    <th key={c.key} style={thStyle} onClick={() => handleCampSort(c.key)}>
                      {c.label}{sortArrow(campSort, c.key)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {campRows.map((r, i) => (
                  <tr key={i} style={{ background: i % 2 === 0 ? '#fff' : '#fafbfc' }}>
                    <td style={{ ...tdStyle, maxWidth: '350px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {r.campaignName}
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>{fmtInt(Number(r.impressions))}</td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>{fmtInt(Number(r.clicks))}</td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>${fmt(Number(r.spend))}</td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>${fmt(Number(r.sales))}</td>
                    <td style={{
                      ...tdStyle,
                      textAlign: 'right',
                      color: acosColor(Number(r.acos)),
                      background: acosBg(Number(r.acos)),
                      fontWeight: 600,
                    }}>
                      {Number(r.acos) >= 999 ? 'N/A' : `${fmt(Number(r.acos))}%`}
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>{fmtInt(Number(r.orders))}</td>
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
