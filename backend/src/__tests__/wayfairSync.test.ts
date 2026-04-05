import { describe, it, expect, vi, beforeEach } from 'vitest';

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

const mockFetchInventory = vi.fn().mockResolvedValue([]);
const mockFetchCGOrders = vi.fn().mockResolvedValue([]);
const mockFetchDSOrders = vi.fn().mockResolvedValue([]);
const mockFetchCancellations = vi.fn().mockResolvedValue(new Set());
const mockGetActiveAccounts = vi.fn();

vi.mock('../services/wayfair/inventory', () => ({
  fetchWayfairInventory: (...args: any[]) => mockFetchInventory(...args),
}));
vi.mock('../services/wayfair/purchaseOrders', () => ({
  fetchWayfairPurchaseOrders: (...args: any[]) => mockFetchCGOrders(...args),
}));
vi.mock('../services/wayfair/dropshipOrders', () => ({
  fetchDropshipOrders: (...args: any[]) => mockFetchDSOrders(...args),
}));
vi.mock('../services/wayfair/cancellations', () => ({
  fetchCancellations: (...args: any[]) => mockFetchCancellations(...args),
}));
vi.mock('../services/wayfair/client', () => ({
  getActiveAccounts: () => mockGetActiveAccounts(),
}));

// Mock salesDataWriter's upsertSalesData (used by wayfairSalesDataWriter)
vi.mock('../services/sync/salesDataWriter', () => ({
  upsertSalesData: vi.fn().mockResolvedValue(5),
}));

import { syncWayfairAccount, syncWayfair } from '../services/sync/wayfairSync';

const makeAccount = (overrides = {}) => ({
  id: 1,
  label: 'cg',
  client_id: 'test-id',
  client_secret: 'test-secret',
  use_sandbox: false,
  supplier_id: 123,
  channel: 'wfs',
  warehouse: 'WFS',
  is_active: true,
  ...overrides,
});

describe('syncWayfairAccount', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default mock sequence for a minimal successful sync:
    // 1. createSyncJob INSERT → id=1
    // 2. updateSyncJob (running)
    // 3. loadMappings → part→iwasku mapping
    // 4. getLastOrderDate → null (no previous orders)
    // 5. syncOrders upsert calls
    // 6. wayfairSalesDataWriter pool.query → empty rows
    // 7. updateSyncJob (completed)
    mockPoolQuery.mockImplementation((sql: string, params?: any[]) => {
      if (typeof sql === 'string') {
        if (sql.includes('INSERT INTO sync_jobs')) return { rows: [{ id: 1 }] };
        if (sql.includes('UPDATE sync_jobs')) return {};
        if (sql.includes('wayfair_sku_mapping')) return { rows: [{ part_number: 'WF-001', iwasku: 'TESTSKU00001' }] };
        if (sql.includes('MAX(po_date)')) return { rows: [{ last_date: null }] };
        if (sql.includes('DISTINCT po_number')) return { rows: [] };
        if (sql.includes('FROM wayfair_orders')) return { rows: [] }; // wayfairSalesDataWriter
      }
      return { rows: [], rowCount: 0 };
    });
  });

  it('completes full sync flow: job → mappings → orders → sales → done', async () => {
    mockFetchCGOrders.mockResolvedValue([]);
    mockFetchDSOrders.mockResolvedValue([]);

    await syncWayfairAccount(makeAccount());

    // Verify sync job created & completed
    expect(mockPoolQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO sync_jobs'),
      ['wayfair_sync', 'WF_CG', 'pending'],
    );
    expect(mockPoolQuery).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE sync_jobs'),
      expect.arrayContaining([1, 'completed']),
    );
  });

  it('applies iwasku mapping from wayfair_sku_mapping to CG orders', async () => {
    mockFetchCGOrders.mockResolvedValue([{
      id: '1', poNumber: 'PO-100', poDate: '2026-03-01', supplierId: 123,
      products: [{ partNumber: 'WF-001', quantity: 3, price: 25.0 }],
    }]);
    mockFetchDSOrders.mockResolvedValue([]);

    await syncWayfairAccount(makeAccount());

    // INSERT INTO wayfair_orders should include mapped iwasku
    const insertCall = mockPoolQuery.mock.calls.find(
      (c: any[]) => typeof c[0] === 'string' && c[0].includes('INSERT INTO wayfair_orders'),
    );
    expect(insertCall).toBeDefined();
    // Params: account_id, po_number, po_date, supplier_id, order_type, part_number, iwasku, qty, price, total_cost, is_cancelled
    expect(insertCall![1]).toContain('TESTSKU00001'); // mapped iwasku
  });

  it('deduplicates orders by (po_number, part_number, order_type)', async () => {
    // Same PO+part in CG → only 1 should be inserted
    mockFetchCGOrders.mockResolvedValue([
      {
        id: '1', poNumber: 'PO-100', poDate: '2026-03-01', supplierId: 123,
        products: [{ partNumber: 'WF-001', quantity: 3, price: 25.0 }],
      },
      {
        id: '2', poNumber: 'PO-100', poDate: '2026-03-01', supplierId: 123,
        products: [{ partNumber: 'WF-001', quantity: 3, price: 25.0 }], // duplicate
      },
    ]);
    mockFetchDSOrders.mockResolvedValue([]);

    await syncWayfairAccount(makeAccount());

    const insertCall = mockPoolQuery.mock.calls.find(
      (c: any[]) => typeof c[0] === 'string' && c[0].includes('INSERT INTO wayfair_orders'),
    );
    expect(insertCall).toBeDefined();
    // Only 1 row → 11 params (not 22)
    expect(insertCall![1]).toHaveLength(11);
  });

  it('does NOT dedup across different order_types (CG vs DS)', async () => {
    mockFetchCGOrders.mockResolvedValue([{
      id: '1', poNumber: 'PO-100', poDate: '2026-03-01', supplierId: 123,
      products: [{ partNumber: 'WF-001', quantity: 3, price: 25.0 }],
    }]);
    mockFetchDSOrders.mockResolvedValue([{
      poNumber: 'PO-100', poDate: '2026-03-01', supplierId: 123,
      products: [{ partNumber: 'WF-001', quantity: 3, price: 25.0 }],
    }]);

    await syncWayfairAccount(makeAccount());

    const insertCall = mockPoolQuery.mock.calls.find(
      (c: any[]) => typeof c[0] === 'string' && c[0].includes('INSERT INTO wayfair_orders'),
    );
    expect(insertCall).toBeDefined();
    // 2 rows (CG + DS are different order_types) → 22 params
    expect(insertCall![1]).toHaveLength(22);
  });

  it('marks job as failed when sync throws', async () => {
    mockFetchCGOrders.mockRejectedValue(new Error('API timeout'));
    mockFetchDSOrders.mockRejectedValue(new Error('API timeout'));

    // syncOrders catches internally, but writeWayfairSalesData may still succeed
    // Let's make the sales writer throw to trigger failure
    mockPoolQuery.mockImplementation((sql: string) => {
      if (typeof sql === 'string') {
        if (sql.includes('INSERT INTO sync_jobs')) return { rows: [{ id: 1 }] };
        if (sql.includes('UPDATE sync_jobs')) return {};
        if (sql.includes('wayfair_sku_mapping')) return { rows: [] };
        if (sql.includes('MAX(po_date)')) return { rows: [{ last_date: null }] };
        if (sql.includes('DISTINCT po_number')) return { rows: [] };
        if (sql.includes('FROM wayfair_orders')) throw new Error('DB down');
      }
      return { rows: [], rowCount: 0 };
    });

    await expect(syncWayfairAccount(makeAccount())).rejects.toThrow('DB down');

    expect(mockPoolQuery).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE sync_jobs'),
      expect.arrayContaining([1, 'failed']),
    );
  });

  it('inventory failure is non-fatal — orders still sync', async () => {
    mockFetchInventory.mockRejectedValue(new Error('Inventory API 500'));
    mockFetchCGOrders.mockResolvedValue([]);
    mockFetchDSOrders.mockResolvedValue([]);

    // Should not throw
    await syncWayfairAccount(makeAccount());

    // Job should still complete
    expect(mockPoolQuery).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE sync_jobs'),
      expect.arrayContaining([1, 'completed']),
    );
  });
});

describe('syncWayfair', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('skips when no active accounts', async () => {
    mockGetActiveAccounts.mockResolvedValue([]);

    await syncWayfair();

    // No sync_jobs created
    expect(mockPoolQuery).not.toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO sync_jobs'),
      expect.anything(),
    );
  });

  it('continues to next account if one fails', async () => {
    const account1 = makeAccount({ id: 1, label: 'cg' });
    const account2 = makeAccount({ id: 2, label: 'mdn', channel: 'wfm', warehouse: 'WFM' });
    mockGetActiveAccounts.mockResolvedValue([account1, account2]);

    // Make both accounts run through minimal flow
    let callCount = 0;
    mockPoolQuery.mockImplementation((sql: string) => {
      if (typeof sql === 'string') {
        if (sql.includes('INSERT INTO sync_jobs')) {
          callCount++;
          if (callCount === 1) throw new Error('Account 1 DB error');
          return { rows: [{ id: 2 }] };
        }
        if (sql.includes('UPDATE sync_jobs')) return {};
        if (sql.includes('wayfair_sku_mapping')) return { rows: [] };
        if (sql.includes('MAX(po_date)')) return { rows: [{ last_date: null }] };
        if (sql.includes('DISTINCT po_number')) return { rows: [] };
        if (sql.includes('FROM wayfair_orders')) return { rows: [] };
      }
      return { rows: [], rowCount: 0 };
    });
    mockFetchCGOrders.mockResolvedValue([]);
    mockFetchDSOrders.mockResolvedValue([]);

    // Should not throw even though account1 fails
    await syncWayfair();

    // Account 2 should still be attempted
    expect(callCount).toBe(2);
  });
});
