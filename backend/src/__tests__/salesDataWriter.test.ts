import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../utils/notify', () => ({
  notify: vi.fn(),
}));

const mockPoolQuery = vi.fn();
const mockSharedQuery = vi.fn();
const mockClientQuery = vi.fn();
const mockClientRelease = vi.fn();

vi.mock('../config/database', () => ({
  pool: { query: (...args: any[]) => mockPoolQuery(...args) },
  sharedPool: {
    query: (...args: any[]) => mockSharedQuery(...args),
    connect: vi.fn().mockResolvedValue({
      query: (...args: any[]) => mockClientQuery(...args),
      release: () => mockClientRelease(),
    }),
  },
}));

import { writeSalesData, upsertSalesData, type SalesRow } from '../services/sync/salesDataWriter';
import { notify } from '../utils/notify';

function makeSalesRow(overrides: Partial<SalesRow> = {}): SalesRow {
  return {
    iwasku: 'TESTSKU00001',
    asin: 'B0TESTASIN1',
    last3: 1, last7: 3, last30: 10, last90: 30, last180: 60, last366: 100,
    pre_year_last7: 2, pre_year_last30: 8, pre_year_last90: 25,
    pre_year_last180: 50, pre_year_last365: 90,
    pre_year_next7: 3, pre_year_next30: 12, pre_year_next90: 35, pre_year_next180: 65,
    ...overrides,
  };
}

describe('upsertSalesData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 0 for empty rows', async () => {
    const count = await upsertSalesData('us', []);
    expect(count).toBe(0);
  });

  it('writes rows in a transaction (BEGIN, DELETE, INSERT, COMMIT)', async () => {
    const rows = [makeSalesRow()];
    const count = await upsertSalesData('us', rows);

    expect(count).toBe(1);
    expect(mockClientQuery).toHaveBeenCalledWith('BEGIN');
    expect(mockClientQuery).toHaveBeenCalledWith(
      'DELETE FROM sales_data WHERE channel = $1',
      ['us'],
    );
    expect(mockClientQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO sales_data'),
      expect.arrayContaining(['us', 'TESTSKU00001']),
    );
    expect(mockClientQuery).toHaveBeenCalledWith('COMMIT');
    expect(mockClientRelease).toHaveBeenCalled();
  });

  it('rolls back on error and re-throws', async () => {
    mockClientQuery.mockReset();
    mockClientQuery
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce(undefined) // DELETE
      .mockRejectedValueOnce(new Error('DB error')); // INSERT fails

    await expect(upsertSalesData('uk', [makeSalesRow()])).rejects.toThrow('DB error');
    expect(mockClientQuery).toHaveBeenCalledWith('ROLLBACK');
    expect(mockClientRelease).toHaveBeenCalled();
  });
});

describe('writeSalesData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('skips channel when safety threshold triggers (new < 20% of existing)', async () => {
    // Active channels: only 'us'
    mockPoolQuery
      .mockResolvedValueOnce({ rows: [{ channel: 'us' }] }) // active channels
      .mockResolvedValueOnce({ rows: [makeSalesRow()] }); // rolling window query → 1 row

    // Existing count: 100 → new (1) < 100 * 0.2 = 20 → SKIP
    mockSharedQuery.mockResolvedValueOnce({ rows: [{ cnt: 100 }] });

    await writeSalesData();

    expect(notify).toHaveBeenCalledWith(expect.stringContaining('skipped'));
    // upsertSalesData should NOT have been called (no client connect)
    expect(mockClientQuery).not.toHaveBeenCalled();
  });

  it('does not skip when existing count <= 10', async () => {
    mockPoolQuery
      .mockResolvedValueOnce({ rows: [{ channel: 'us' }] })
      .mockResolvedValueOnce({ rows: [makeSalesRow()] });

    // Existing count: 5 → threshold not applied (existingCount <= 10)
    mockSharedQuery.mockResolvedValueOnce({ rows: [{ cnt: 5 }] });

    await writeSalesData();

    expect(notify).not.toHaveBeenCalled();
    // upsertSalesData called → client query was invoked
    expect(mockClientQuery).toHaveBeenCalledWith('BEGIN');
  });

  it('does not skip when new rows >= 20% of existing', async () => {
    const rows = Array.from({ length: 25 }, (_, i) =>
      makeSalesRow({ iwasku: `SKU${String(i).padStart(8, '0')}` }),
    );
    mockPoolQuery
      .mockResolvedValueOnce({ rows: [{ channel: 'de' }] })
      .mockResolvedValueOnce({ rows })
      .mockResolvedValueOnce({ rows: [makeSalesRow()] }); // EU aggregate query

    // Existing: 100, new: 25 → 25% ≥ 20% → OK
    mockSharedQuery.mockResolvedValueOnce({ rows: [{ cnt: 100 }] });

    await writeSalesData();

    expect(notify).not.toHaveBeenCalled();
    expect(mockClientQuery).toHaveBeenCalledWith('BEGIN');
  });

  it('writes EU aggregate when any EU channel is active', async () => {
    // Active: 'de' (an EU channel)
    mockPoolQuery
      .mockResolvedValueOnce({ rows: [{ channel: 'de' }] })
      .mockResolvedValueOnce({ rows: [makeSalesRow()] }) // de rolling window
      .mockResolvedValueOnce({ rows: [makeSalesRow()] }); // EU aggregate query

    mockSharedQuery.mockResolvedValueOnce({ rows: [{ cnt: 0 }] }); // existing de

    await writeSalesData();

    // EU aggregate SQL should have been called (3rd pool.query call)
    expect(mockPoolQuery).toHaveBeenCalledTimes(3);
  });

  it('skips EU aggregate when no EU channel is active', async () => {
    // Active: only 'us' (not EU)
    mockPoolQuery
      .mockResolvedValueOnce({ rows: [{ channel: 'us' }] })
      .mockResolvedValueOnce({ rows: [makeSalesRow()] });

    mockSharedQuery.mockResolvedValueOnce({ rows: [{ cnt: 0 }] });

    await writeSalesData();

    // Only 2 pool.query calls (active channels + us rolling window), no EU aggregate
    expect(mockPoolQuery).toHaveBeenCalledTimes(2);
  });
});
