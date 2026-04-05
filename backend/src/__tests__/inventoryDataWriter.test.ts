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

import { writeInventoryData } from '../services/sync/inventoryDataWriter';
import { notify } from '../utils/notify';

function makeInventoryRow(iwasku = 'TESTSKU00001') {
  return {
    iwasku,
    asin: 'B0TEST00001',
    fnsku: 'X00TEST001',
    sku_list: 'SKU1',
    fulfillable_quantity: 50,
    total_reserved_quantity: 5,
    pending_customer_order_quantity: 2,
    pending_transshipment_quantity: 1,
    fc_processing_quantity: 0,
    total_unfulfillable_quantity: 3,
    customer_damaged_quantity: 1,
    warehouse_damaged_quantity: 1,
    distributor_damaged_quantity: 1,
    inbound_shipped_quantity: 10,
    inbound_working_quantity: 5,
    inbound_receiving_quantity: 2,
    total_quantity: 75,
  };
}

describe('writeInventoryData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('skips warehouse when safety threshold triggers', async () => {
    // Active warehouses: US
    mockPoolQuery
      .mockResolvedValueOnce({ rows: [{ warehouse: 'US' }] })
      .mockResolvedValueOnce({ rows: [makeInventoryRow()] }); // 1 row from raw

    // Existing: 200 → new (1) < 200 * 0.2 = 40 → SKIP
    mockSharedQuery.mockResolvedValueOnce({ rows: [{ cnt: 200 }] });

    await writeInventoryData();

    expect(notify).toHaveBeenCalledWith(expect.stringContaining('skipped'));
    expect(mockClientQuery).not.toHaveBeenCalled();
  });

  it('does not skip when existing count is small (<= 10)', async () => {
    mockPoolQuery
      .mockResolvedValueOnce({ rows: [{ warehouse: 'EU' }] })
      .mockResolvedValueOnce({ rows: [makeInventoryRow()] });

    mockSharedQuery.mockResolvedValueOnce({ rows: [{ cnt: 8 }] });

    await writeInventoryData();

    expect(notify).not.toHaveBeenCalled();
    expect(mockClientQuery).toHaveBeenCalledWith('BEGIN');
  });

  it('processes multiple warehouses independently', async () => {
    // Two active warehouses
    mockPoolQuery
      .mockResolvedValueOnce({ rows: [{ warehouse: 'US' }, { warehouse: 'UK' }] })
      .mockResolvedValueOnce({ rows: [makeInventoryRow('US_SKU00001')] }) // US query
      .mockResolvedValueOnce({ rows: [makeInventoryRow('UK_SKU00001')] }); // UK query

    mockSharedQuery
      .mockResolvedValueOnce({ rows: [{ cnt: 0 }] }) // US existing
      .mockResolvedValueOnce({ rows: [{ cnt: 0 }] }); // UK existing

    await writeInventoryData();

    // Both warehouses processed → 2 BEGIN calls
    const beginCalls = mockClientQuery.mock.calls.filter(
      (c: any[]) => c[0] === 'BEGIN',
    );
    expect(beginCalls).toHaveLength(2);
  });

  it('writes correct columns in INSERT (includes warehouse, total_quantity)', async () => {
    mockPoolQuery
      .mockResolvedValueOnce({ rows: [{ warehouse: 'CA' }] })
      .mockResolvedValueOnce({ rows: [makeInventoryRow()] });

    mockSharedQuery.mockResolvedValueOnce({ rows: [{ cnt: 0 }] });

    await writeInventoryData();

    const insertCall = mockClientQuery.mock.calls.find(
      (c: any[]) => typeof c[0] === 'string' && c[0].includes('INSERT INTO fba_inventory'),
    );
    expect(insertCall).toBeDefined();
    // Params should include warehouse 'CA' at position index 2 (after iwasku, asin)
    expect(insertCall![1]).toContain('CA');
  });

  it('skips only the failing warehouse and continues others', async () => {
    mockPoolQuery
      .mockResolvedValueOnce({ rows: [{ warehouse: 'US' }, { warehouse: 'AU' }] })
      .mockResolvedValueOnce({ rows: [makeInventoryRow()] }) // US: 1 row
      .mockResolvedValueOnce({ rows: [makeInventoryRow()] }); // AU: 1 row

    mockSharedQuery
      .mockResolvedValueOnce({ rows: [{ cnt: 100 }] }) // US existing: 100 → 1 < 20 → SKIP
      .mockResolvedValueOnce({ rows: [{ cnt: 0 }] }); // AU existing: 0 → no threshold → OK

    await writeInventoryData();

    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('US'));
    // AU should still be written
    expect(mockClientQuery).toHaveBeenCalledWith('BEGIN');
  });
});
