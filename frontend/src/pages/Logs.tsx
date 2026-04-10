import { useState, useEffect } from 'react';
import axios from 'axios';

interface SyncJob {
  id: number;
  job_type: string;
  marketplace: string;
  status: string;
  started_at: string | null;
  completed_at: string | null;
  records_processed: number;
  error_message: string | null;
  created_at: string;
}

const statusColors: Record<string, string> = {
  completed: 'text-emerald-600',
  failed: 'text-red-600',
  running: 'text-amber-600',
  pending: 'text-gray-500',
};

const jobTypeLabels: Record<string, string> = {
  sales_sync: 'sales_sync (orders)',
  sales_backfill: 'sales_backfill (orders)',
  transaction_sync: 'finance_sync',
  transaction_backfill: 'finance_backfill',
};

export default function Logs() {
  const [jobs, setJobs] = useState<SyncJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedError, setExpandedError] = useState<number | null>(null);

  const fetchJobs = async () => {
    try {
      const res = await axios.get('/api/v1/sync/jobs');
      setJobs(res.data.data);
    } catch {
      // Not authenticated
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchJobs(); }, []);

  const formatDuration = (started: string | null, completed: string | null): string => {
    if (!started || !completed) return '-';
    const ms = new Date(completed).getTime() - new Date(started).getTime();
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60_000).toFixed(1)}m`;
  };

  return (
    <div>
      <h1 className="mb-6">Sync Logs</h1>

      <div className="bg-white rounded-lg p-6 shadow-sm">
        <div className="flex justify-between items-center mb-4">
          <h2>Recent Jobs</h2>
          <button
            onClick={fetchJobs}
            className="px-4 py-1.5 bg-slate-100 border border-gray-300 rounded-md cursor-pointer"
          >
            Refresh
          </button>
        </div>

        {loading ? (
          <p>Loading...</p>
        ) : jobs.length === 0 ? (
          <p className="text-slate-500">No sync jobs recorded yet.</p>
        ) : (
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b-2 border-slate-200">
                <th className="text-left p-2">ID</th>
                <th className="text-left p-2">Type</th>
                <th className="text-left p-2">Market</th>
                <th className="text-left p-2">Status</th>
                <th className="text-left p-2">Records</th>
                <th className="text-left p-2">Duration</th>
                <th className="text-left p-2">Time</th>
                <th className="text-left p-2">Error</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map(job => (
                <tr key={job.id} className="border-b border-slate-200">
                  <td className="p-2">{job.id}</td>
                  <td className="p-2">{jobTypeLabels[job.job_type] || job.job_type}</td>
                  <td className="p-2">{job.marketplace}</td>
                  <td className="p-2">
                    <span className={`${statusColors[job.status] || 'text-gray-500'} font-medium`}>
                      {job.status}
                    </span>
                  </td>
                  <td className="p-2">{job.records_processed}</td>
                  <td className="p-2">{formatDuration(job.started_at, job.completed_at)}</td>
                  <td className="p-2 whitespace-nowrap">{new Date(job.created_at).toLocaleString()}</td>
                  <td className="p-2 text-sm max-w-[400px]">
                    {job.error_message ? (
                      <span
                        onClick={() => setExpandedError(expandedError === job.id ? null : job.id)}
                        className={`text-red-600 cursor-pointer block break-words ${
                          expandedError === job.id
                            ? 'whitespace-normal overflow-visible'
                            : 'whitespace-nowrap overflow-hidden text-ellipsis'
                        }`}
                        title="Click to expand"
                      >
                        {job.error_message}
                      </span>
                    ) : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
