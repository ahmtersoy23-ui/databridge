import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../config/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const mockPoolQuery = vi.fn();
const mockClientQuery = vi.fn();
const mockClientRelease = vi.fn();

vi.mock('../config/database', () => ({
  pool: { query: (...args: any[]) => mockPoolQuery(...args) },
  sharedPool: {
    connect: vi.fn().mockResolvedValue({
      query: (...args: any[]) => mockClientQuery(...args),
      release: () => mockClientRelease(),
    }),
  },
}));

import { writeTransactionData, cleanupOldTransactions } from '../services/sync/transactionDataWriter';

function makeTransaction(overrides: Record<string, any> = {}) {
  return {
    transaction_id: 'TXN-001',
    transaction_date: '2026-04-02T10:00:00Z',
    date_only: '2026-04-02',
    type: 'Order',
    category_type: 'Order',
    order_id: 'ORD-001',
    sku: 'TESTSKU00001',
    description: 'Test product',
    marketplace: 'Amazon.com',
    marketplace_code: 'us',
    fulfillment: 'Amazon',
    order_postal: '10001',
    quantity: 1,
    product_sales: 29.99,
    promotional_rebates: 0,
    selling_fees: -4.50,
    fba_fees: -5.00,
    other_transaction_fees: 0,
    other: 0,
    vat: 0,
    liquidations: 0,
    total: 20.49,
    ...overrides,
  };
}

// Compute expected month boundaries same way as production code (timezone-safe)
function getExpectedMonthBounds(fakeNow: Date) {
  const monthStart = new Date(fakeNow.getFullYear(), fakeNow.getMonth(), 1).toISOString().split('T')[0];
  const monthEnd = new Date(fakeNow.getFullYear(), fakeNow.getMonth() + 1, 0).toISOString().split('T')[0];
  return { monthStart, monthEnd };
}

describe('writeTransactionData', () => {
  const fakeNow = new Date('2026-04-15T12:00:00Z');
  let bounds: { monthStart: string; monthEnd: string };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(fakeNow);
    bounds = getExpectedMonthBounds(fakeNow);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does nothing when no Order/Refund rows exist for current month', async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [] });

    await writeTransactionData();

    // No client connect → no transaction started
    expect(mockClientQuery).not.toHaveBeenCalled();
  });

  it('queries with month boundaries matching production logic', async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [] });

    await writeTransactionData();

    expect(mockPoolQuery).toHaveBeenCalledWith(
      expect.stringContaining('category_type'),
      [bounds.monthStart, bounds.monthEnd],
    );
  });

  it('deletes existing sp-api-sync rows then batch inserts', async () => {
    const txns = [makeTransaction()];
    mockPoolQuery.mockResolvedValueOnce({ rows: txns });
    mockClientQuery.mockResolvedValue({ rowCount: 1 }); // generic success

    await writeTransactionData();

    expect(mockClientQuery).toHaveBeenCalledWith('BEGIN');
    // Delete call with sp-api-sync filter
    expect(mockClientQuery).toHaveBeenCalledWith(
      expect.stringContaining("file_name = 'sp-api-sync'"),
      [bounds.monthStart, bounds.monthEnd],
    );
    // INSERT call with ON CONFLICT
    expect(mockClientQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO amz_transactions'),
      expect.arrayContaining(['TXN-001', 'sp-api-sync']),
    );
    expect(mockClientQuery).toHaveBeenCalledWith('COMMIT');
  });

  it('rolls back on error', async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [makeTransaction()] });
    mockClientQuery
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce({ rowCount: 0 }) // DELETE
      .mockRejectedValueOnce(new Error('Insert failed')); // INSERT fails

    await expect(writeTransactionData()).rejects.toThrow('Insert failed');
    expect(mockClientQuery).toHaveBeenCalledWith('ROLLBACK');
    expect(mockClientRelease).toHaveBeenCalled();
  });

  it('handles month boundary for January', async () => {
    const janNow = new Date('2026-01-20T12:00:00Z');
    vi.setSystemTime(janNow);
    const janBounds = getExpectedMonthBounds(janNow);
    mockPoolQuery.mockResolvedValueOnce({ rows: [] });

    await writeTransactionData();

    expect(mockPoolQuery).toHaveBeenCalledWith(
      expect.any(String),
      [janBounds.monthStart, janBounds.monthEnd],
    );
  });
});

describe('cleanupOldTransactions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-15T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('deletes rows older than 35 days', async () => {
    mockPoolQuery.mockResolvedValueOnce({ rowCount: 50 });

    await cleanupOldTransactions();

    // 2026-04-15 minus 35 days = 2026-03-11
    expect(mockPoolQuery).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM financial_transactions'),
      ['2026-03-11'],
    );
  });
});
