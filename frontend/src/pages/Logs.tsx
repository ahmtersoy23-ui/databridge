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

const cardStyle = {
  background: '#fff',
  borderRadius: '8px',
  padding: '1.5rem',
  boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
} as const;

const statusColors: Record<string, string> = {
  completed: '#059669',
  failed: '#dc2626',
  running: '#d97706',
  pending: '#6b7280',
};

export default function Logs() {
  const [jobs, setJobs] = useState<SyncJob[]>([]);
  const [loading, setLoading] = useState(true);

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
      <h1 style={{ marginBottom: '1.5rem' }}>Sync Logs</h1>

      <div style={cardStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <h2>Recent Jobs</h2>
          <button
            onClick={fetchJobs}
            style={{ padding: '0.4rem 1rem', background: '#f1f5f9', border: '1px solid #d1d5db', borderRadius: '6px', cursor: 'pointer' }}
          >
            Refresh
          </button>
        </div>

        {loading ? (
          <p>Loading...</p>
        ) : jobs.length === 0 ? (
          <p style={{ color: '#64748b' }}>No sync jobs recorded yet.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #e2e8f0' }}>
                <th style={{ textAlign: 'left', padding: '0.5rem' }}>ID</th>
                <th style={{ textAlign: 'left', padding: '0.5rem' }}>Type</th>
                <th style={{ textAlign: 'left', padding: '0.5rem' }}>Market</th>
                <th style={{ textAlign: 'left', padding: '0.5rem' }}>Status</th>
                <th style={{ textAlign: 'left', padding: '0.5rem' }}>Records</th>
                <th style={{ textAlign: 'left', padding: '0.5rem' }}>Duration</th>
                <th style={{ textAlign: 'left', padding: '0.5rem' }}>Time</th>
                <th style={{ textAlign: 'left', padding: '0.5rem' }}>Error</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map(job => (
                <tr key={job.id} style={{ borderBottom: '1px solid #e2e8f0' }}>
                  <td style={{ padding: '0.5rem' }}>{job.id}</td>
                  <td style={{ padding: '0.5rem' }}>{job.job_type}</td>
                  <td style={{ padding: '0.5rem' }}>{job.marketplace}</td>
                  <td style={{ padding: '0.5rem' }}>
                    <span style={{ color: statusColors[job.status] || '#6b7280', fontWeight: 500 }}>
                      {job.status}
                    </span>
                  </td>
                  <td style={{ padding: '0.5rem' }}>{job.records_processed}</td>
                  <td style={{ padding: '0.5rem' }}>{formatDuration(job.started_at, job.completed_at)}</td>
                  <td style={{ padding: '0.5rem' }}>{new Date(job.created_at).toLocaleString()}</td>
                  <td style={{ padding: '0.5rem', color: '#dc2626', fontSize: '0.85rem', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {job.error_message || '-'}
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
