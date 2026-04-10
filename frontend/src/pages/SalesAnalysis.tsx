import { useState, useEffect, useMemo } from 'react';
import axios from 'axios';

interface SalesRow {
  iwasku: string;
  asin: string;
  last7: number; last30: number; last90: number; last180: number; last366: number;
  preYearLast7: number; preYearLast30: number; preYearLast90: number;
  preYearLast180: number; preYearLast365: number;
  preYearNext7: number; preYearNext30: number; preYearNext90: number; preYearNext180: number;
}

const CHANNELS = ['us', 'ca', 'au', 'ae', 'sa', 'uk', 'de', 'fr', 'it', 'es', 'eu'];

const CHANNEL_LABELS: Record<string, string> = { eu: 'EU (All)' };

const COL_GREEN = 'text-emerald-600';
const COL_BLUE = 'text-blue-600';
const COL_PURPLE = 'text-violet-600';
const COL_GREEN_HEX = '#059669';
const COL_BLUE_HEX = '#2563eb';
const COL_PURPLE_HEX = '#7c3aed';

type SortKey = keyof SalesRow;

const columns: { key: SortKey; label: string; group: string; colorClass: string; colorHex: string }[] = [
  { key: 'iwasku', label: 'SKU', group: 'id', colorClass: '', colorHex: '' },
  { key: 'asin', label: 'ASIN', group: 'id', colorClass: '', colorHex: '' },
  { key: 'last7', label: '7', group: 'current', colorClass: COL_GREEN, colorHex: COL_GREEN_HEX },
  { key: 'last30', label: '30', group: 'current', colorClass: COL_GREEN, colorHex: COL_GREEN_HEX },
  { key: 'last90', label: '90', group: 'current', colorClass: COL_GREEN, colorHex: COL_GREEN_HEX },
  { key: 'last180', label: '180', group: 'current', colorClass: COL_GREEN, colorHex: COL_GREEN_HEX },
  { key: 'last366', label: '366', group: 'current', colorClass: COL_GREEN, colorHex: COL_GREEN_HEX },
  { key: 'preYearLast7', label: '7', group: 'pyLast', colorClass: COL_BLUE, colorHex: COL_BLUE_HEX },
  { key: 'preYearLast30', label: '30', group: 'pyLast', colorClass: COL_BLUE, colorHex: COL_BLUE_HEX },
  { key: 'preYearLast90', label: '90', group: 'pyLast', colorClass: COL_BLUE, colorHex: COL_BLUE_HEX },
  { key: 'preYearLast180', label: '180', group: 'pyLast', colorClass: COL_BLUE, colorHex: COL_BLUE_HEX },
  { key: 'preYearLast365', label: '365', group: 'pyLast', colorClass: COL_BLUE, colorHex: COL_BLUE_HEX },
  { key: 'preYearNext7', label: '7', group: 'pyNext', colorClass: COL_PURPLE, colorHex: COL_PURPLE_HEX },
  { key: 'preYearNext30', label: '30', group: 'pyNext', colorClass: COL_PURPLE, colorHex: COL_PURPLE_HEX },
  { key: 'preYearNext90', label: '90', group: 'pyNext', colorClass: COL_PURPLE, colorHex: COL_PURPLE_HEX },
  { key: 'preYearNext180', label: '180', group: 'pyNext', colorClass: COL_PURPLE, colorHex: COL_PURPLE_HEX },
];

const groupHeaders: { label: string; span: number; colorHex: string; colorClass: string }[] = [
  { label: '', span: 2, colorHex: '', colorClass: 'text-slate-500' },
  { label: 'Current', span: 5, colorHex: COL_GREEN_HEX, colorClass: COL_GREEN },
  { label: 'PY Last', span: 5, colorHex: COL_BLUE_HEX, colorClass: COL_BLUE },
  { label: 'PY Next', span: 4, colorHex: COL_PURPLE_HEX, colorClass: COL_PURPLE },
];

export default function SalesAnalysis() {
  const [channel, setChannel] = useState('us');
  const [rows, setRows] = useState<SalesRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('last30');
  const [sortAsc, setSortAsc] = useState(false);

  const fetchData = async (ch: string) => {
    setLoading(true);
    try {
      const res = await axios.get(`/api/v1/amazonsales/${ch}`);
      setRows(Array.isArray(res.data) ? res.data : []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(channel); }, [channel]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(false);
    }
  };

  const filtered = useMemo(() => {
    let data = rows;
    if (search) {
      const q = search.toLowerCase();
      data = data.filter(r => r.iwasku?.toLowerCase().includes(q) || r.asin?.toLowerCase().includes(q));
    }
    data = [...data].sort((a, b) => {
      const av = a[sortKey] ?? '';
      const bv = b[sortKey] ?? '';
      if (sortKey !== 'iwasku' && sortKey !== 'asin') {
        const na = Number(av) || 0;
        const nb = Number(bv) || 0;
        return sortAsc ? na - nb : nb - na;
      }
      return sortAsc
        ? String(av).localeCompare(String(bv))
        : String(bv).localeCompare(String(av));
    });
    return data;
  }, [rows, search, sortKey, sortAsc]);

  const fmtNum = (v: number | null | undefined, colorClass: string) => {
    const n = Number(v) || 0;
    return {
      text: n === 0 ? '-' : n.toLocaleString(),
      cls: n === 0 ? 'text-gray-300' : colorClass,
    };
  };

  return (
    <div className="-mx-8">
      <h1 className="mb-4 px-8">Sales Analysis</h1>

      {/* Channel tabs + search */}
      <div className="bg-white rounded-lg p-6 shadow-sm mx-8 mb-4">
        <div className="flex justify-between items-center flex-wrap gap-3">
          <div className="flex gap-2">
            {CHANNELS.map(ch => (
              <button
                key={ch}
                onClick={() => setChannel(ch)}
                className={`px-4 py-2 border border-gray-300 rounded-md cursor-pointer text-sm ${channel === ch ? 'bg-slate-700 text-white font-semibold' : 'bg-slate-100 text-slate-600 font-normal'}`}
              >
                {CHANNEL_LABELS[ch] || ch.toUpperCase()}
              </button>
            ))}
          </div>
          <div className="flex gap-2 items-center">
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search SKU / ASIN..."
              className="px-2 py-1.5 border border-gray-300 rounded-md text-sm min-w-[180px]"
            />
            <span className="text-xs text-slate-500">{filtered.length} items</span>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg shadow-sm mx-8 p-0">
        {loading ? (
          <p className="p-6 text-slate-500">Loading...</p>
        ) : filtered.length === 0 ? (
          <p className="p-6 text-slate-500">No sales data found.</p>
        ) : (
          <table className="w-full border-collapse" style={{ tableLayout: 'fixed' }}>
            <colgroup>
              <col style={{ width: '110px' }} />
              <col style={{ width: '105px' }} />
              {columns.filter(c => c.group !== 'id').map(c => (
                <col key={c.key} style={{ width: `${(1 / 14) * 100}%` }} />
              ))}
            </colgroup>
            {/* Group headers */}
            <thead>
              <tr className="border-b border-slate-200">
                {groupHeaders.map((g, i) => (
                  <th
                    key={i}
                    colSpan={g.span}
                    className={`px-1.5 py-1 text-center text-[0.68rem] font-semibold tracking-wide uppercase ${g.colorClass}`}
                  >
                    {g.label}
                  </th>
                ))}
              </tr>
              {/* Column headers */}
              <tr className="border-b-2 border-slate-200">
                {columns.map(col => (
                  <th
                    key={col.key}
                    onClick={() => handleSort(col.key)}
                    className={`px-1.5 py-1 cursor-pointer select-none whitespace-nowrap text-xs font-semibold ${col.group === 'id' ? 'text-left' : 'text-right'} ${col.colorClass || 'text-slate-600'}`}
                  >
                    {col.label} {sortKey === col.key ? (sortAsc ? '\u2191' : '\u2193') : ''}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => (
                <tr key={i} className="border-b border-slate-100">
                  {columns.map(col => {
                    if (col.group === 'id') {
                      return (
                        <td
                          key={col.key}
                          className="px-1.5 py-1 font-mono text-xs tabular-nums overflow-hidden text-ellipsis whitespace-nowrap"
                          title={String(r[col.key])}
                        >
                          {r[col.key]}
                        </td>
                      );
                    }
                    const { text, cls } = fmtNum(r[col.key] as number, col.colorClass);
                    return (
                      <td key={col.key} className={`px-1.5 py-1 text-right font-mono text-xs tabular-nums ${cls}`}>
                        {text}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
