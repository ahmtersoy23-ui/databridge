import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const mockGraphql = vi.fn();
vi.mock('../services/wayfair/client', () => ({
  graphqlQuery: (...args: any[]) => mockGraphql(...args),
  getSupplierId: vi.fn().mockResolvedValue(275550),
  getDropshipApiBase: () => 'https://api.wayfair.com/v1/graphql',
}));

// withRetry: çağrıyı olduğu gibi koştur (gerçek backoff'a gerek yok)
vi.mock('../utils/retry', () => ({
  withRetry: (fn: () => unknown) => fn(),
}));

import { pushWayfairInventory } from '../services/wayfair/inventoryPush';

const account: any = { id: 2, label: 'mdn', use_sandbox: false, supplier_id: 275550 };

beforeEach(() => {
  mockGraphql.mockReset();
});

describe('pushWayfairInventory', () => {
  it('dryRun=true → tüm kalemler dryrun, save dryRun:true ve DIFFERENTIAL ile çağrılır, kaydetmez', async () => {
    mockGraphql.mockResolvedValue({ inventory: { save: { handle: 'H1' } } });
    const items = [
      { sku: 'PART-A', quantity: 5 },
      { sku: 'PART-B', quantity: 0 },
    ];
    const res = await pushWayfairInventory(account, items, { dryRun: true });

    expect(res.map((r) => r.status)).toEqual(['dryrun', 'dryrun']);
    expect(mockGraphql).toHaveBeenCalledTimes(1);
    const [, , vars, endpoint] = mockGraphql.mock.calls[0];
    expect(endpoint).toBe('https://api.wayfair.com/v1/graphql');
    expect(vars.dryRun).toBe(true);
    expect(vars.feedKind).toBe('DIFFERENTIAL');
    expect(vars.inventory).toEqual([
      { supplierId: 275550, supplierPartNumber: 'PART-A', quantityOnHand: 5 },
      { supplierId: 275550, supplierPartNumber: 'PART-B', quantityOnHand: 0 },
    ]);
  });

  it('canlı push → pushed, feedKind TRUE_UP geçirilebilir', async () => {
    mockGraphql.mockResolvedValue({ inventory: { save: { handle: 'H2' } } });
    const res = await pushWayfairInventory(account, [{ sku: 'X', quantity: 3 }], {
      feedKind: 'TRUE_UP',
    });
    expect(res[0]).toMatchObject({ sku: 'X', status: 'pushed', to: 3 });
    expect(mockGraphql.mock.calls[0][2].feedKind).toBe('TRUE_UP');
    expect(mockGraphql.mock.calls[0][2].dryRun).toBe(false);
  });

  it('mutation hata verirse o chunk failed işaretlenir', async () => {
    mockGraphql.mockRejectedValue(new Error('Wayfair GraphQL error: nope'));
    const res = await pushWayfairInventory(account, [{ sku: 'Y', quantity: 1 }], {});
    expect(res[0].status).toBe('failed');
    expect(res[0].error).toContain('nope');
  });
});
