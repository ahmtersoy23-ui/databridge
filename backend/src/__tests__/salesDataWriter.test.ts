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

  it('writes rows with combined tag (NULL) in a transaction', async () => {
    const rows = [makeSalesRow()];
    const count = await upsertSalesData('us', rows, null);

    expect(count).toBe(1);
    expect(mockClientQuery).toHaveBeenCalledWith('BEGIN');
    expect(mockClientQuery).toHaveBeenCalledWith(
      'DELETE FROM sales_data WHERE channel = $1 AND fulfillment_channel IS NULL',
      ['us'],
    );
    expect(mockClientQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO sales_data'),
      expect.arrayContaining(['us', 'TESTSKU00001', 'B0TESTASIN1', null]),
    );
    expect(mockClientQuery).toHaveBeenCalledWith('COMMIT');
    expect(mockClientRelease).toHaveBeenCalled();
  });

  it('writes FBA satırları sadece Amazon fulfillment ile siler', async () => {
    await upsertSalesData('us', [makeSalesRow()], 'Amazon');

    expect(mockClientQuery).toHaveBeenCalledWith(
      'DELETE FROM sales_data WHERE channel = $1 AND fulfillment_channel = $2',
      ['us', 'Amazon'],
    );
    expect(mockClientQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO sales_data'),
      expect.arrayContaining(['us', 'TESTSKU00001', 'B0TESTASIN1', 'Amazon']),
    );
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
    // Aktif kanal: us
    // pool.query çağrı sırası: 1) activeChannels 2) combined query
    // (safety SKIP nedeniyle FBA/FBM query'lerine ulaşmaz)
    mockPoolQuery
      .mockResolvedValueOnce({ rows: [{ channel: 'us' }] })
      .mockResolvedValueOnce({ rows: [makeSalesRow()] });

    // Existing count: 100 → new (1) < 20 → SKIP
    mockSharedQuery.mockResolvedValueOnce({ rows: [{ cnt: 100 }] });

    await writeSalesData();

    expect(notify).toHaveBeenCalledWith(expect.stringContaining('skipped'));
    expect(mockClientQuery).not.toHaveBeenCalled();
  });

  it('writes combined + FBA + FBM rows when existing count <= 10', async () => {
    // pool.query sırası: activeChannels, combined, FBA, FBM
    mockPoolQuery
      .mockResolvedValueOnce({ rows: [{ channel: 'us' }] })
      .mockResolvedValueOnce({ rows: [makeSalesRow()] }) // combined
      .mockResolvedValueOnce({ rows: [makeSalesRow()] }) // FBA
      .mockResolvedValueOnce({ rows: [makeSalesRow()] }); // FBM

    mockSharedQuery.mockResolvedValueOnce({ rows: [{ cnt: 5 }] });

    await writeSalesData();

    expect(notify).not.toHaveBeenCalled();
    expect(mockClientQuery).toHaveBeenCalledWith('BEGIN');
    // 3 farklı DELETE çağrısı (combined NULL + FBA Amazon + FBM Merchant)
    expect(mockClientQuery).toHaveBeenCalledWith(
      'DELETE FROM sales_data WHERE channel = $1 AND fulfillment_channel IS NULL',
      ['us'],
    );
    expect(mockClientQuery).toHaveBeenCalledWith(
      'DELETE FROM sales_data WHERE channel = $1 AND fulfillment_channel = $2',
      ['us', 'Amazon'],
    );
    expect(mockClientQuery).toHaveBeenCalledWith(
      'DELETE FROM sales_data WHERE channel = $1 AND fulfillment_channel = $2',
      ['us', 'Merchant'],
    );
  });

  it('writes EU aggregate (combined + FBA + FBM) when any EU channel is active', async () => {
    // de → 4 query (active, combined, fba, fbm) + EU aggregate 3 query = 7 total
    mockPoolQuery
      .mockResolvedValueOnce({ rows: [{ channel: 'de' }] })
      .mockResolvedValueOnce({ rows: [makeSalesRow()] }) // de combined
      .mockResolvedValueOnce({ rows: [makeSalesRow()] }) // de FBA
      .mockResolvedValueOnce({ rows: [makeSalesRow()] }) // de FBM
      .mockResolvedValueOnce({ rows: [makeSalesRow()] }) // EU combined
      .mockResolvedValueOnce({ rows: [makeSalesRow()] }) // EU FBA
      .mockResolvedValueOnce({ rows: [makeSalesRow()] }); // EU FBM

    mockSharedQuery.mockResolvedValueOnce({ rows: [{ cnt: 0 }] });

    await writeSalesData();

    expect(mockPoolQuery).toHaveBeenCalledTimes(7);
  });

  it('skips EU aggregate when no EU channel is active', async () => {
    // Sadece us — 4 query (active, combined, fba, fbm). EU yok.
    mockPoolQuery
      .mockResolvedValueOnce({ rows: [{ channel: 'us' }] })
      .mockResolvedValueOnce({ rows: [makeSalesRow()] })
      .mockResolvedValueOnce({ rows: [makeSalesRow()] })
      .mockResolvedValueOnce({ rows: [makeSalesRow()] });

    mockSharedQuery.mockResolvedValueOnce({ rows: [{ cnt: 0 }] });

    await writeSalesData();

    expect(mockPoolQuery).toHaveBeenCalledTimes(4);
  });
});
