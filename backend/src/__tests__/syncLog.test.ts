import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../utils/notify', () => ({
  notify: vi.fn(),
}));

// Mock pool
const mockQuery = vi.fn();
vi.mock('../config/database', () => ({
  pool: { query: (...args: any[]) => mockQuery(...args) },
}));

import { withSyncLog } from '../utils/syncLog';
import { notify } from '../utils/notify';

describe('withSyncLog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: INSERT returns id=1, UPDATE succeeds, no previous run
    mockQuery
      .mockResolvedValueOnce({ rows: [{ id: 1 }] }) // INSERT
      .mockResolvedValueOnce({}) // UPDATE success
      .mockResolvedValueOnce({ rows: [] }); // SELECT previous (none)
  });

  it('logs success with row count', async () => {
    const fn = vi.fn().mockResolvedValue(42);
    await withSyncLog('test-job', fn);
    expect(fn).toHaveBeenCalledTimes(1);
    // INSERT call
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO sync_log'),
      ['test-job', 'running'],
    );
    // UPDATE call with success
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("status=$1"),
      expect.arrayContaining(['success', 42]),
    );
  });

  it('logs failure and sends Slack notification', async () => {
    mockQuery
      .mockReset()
      .mockResolvedValueOnce({ rows: [{ id: 1 }] }) // INSERT
      .mockResolvedValueOnce({}); // UPDATE failed

    const fn = vi.fn().mockRejectedValue(new Error('API down'));
    await expect(withSyncLog('test-job', fn)).rejects.toThrow('API down');
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('API down'));
  });

  it('alerts on row count anomaly', async () => {
    mockQuery
      .mockReset()
      .mockResolvedValueOnce({ rows: [{ id: 2 }] }) // INSERT
      .mockResolvedValueOnce({}) // UPDATE success
      .mockResolvedValueOnce({ rows: [{ rows_processed: 1000 }] }); // previous run had 1000 rows

    const fn = vi.fn().mockResolvedValue(5); // only 5 rows now (0.5%)
    await withSyncLog('test-job', fn);
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('Row count dropped'));
  });

  it('does not alert when row count is stable', async () => {
    mockQuery
      .mockReset()
      .mockResolvedValueOnce({ rows: [{ id: 2 }] }) // INSERT
      .mockResolvedValueOnce({}) // UPDATE success
      .mockResolvedValueOnce({ rows: [{ rows_processed: 100 }] }); // previous 100

    const fn = vi.fn().mockResolvedValue(95); // 95% of previous — fine
    await withSyncLog('test-job', fn);
    expect(notify).not.toHaveBeenCalled();
  });
});
