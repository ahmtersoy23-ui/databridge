import { describe, it, expect, vi } from 'vitest';

// Modül import'unda DB/logger yan etkisi olmasın (saf fonksiyon test ediliyor).
vi.mock('../config/database', () => ({ pool: { query: vi.fn() } }));
vi.mock('../config/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { resolveRegion } from '../services/sync/wisersellRoutingPoll';

const order = (countryId?: number) => ({ countryId } as unknown as Parameters<typeof resolveRegion>[0]);
const store = (region: string | null) => ({ region } as unknown as Parameters<typeof resolveRegion>[1]);

describe('resolveRegion (adres-bazlı)', () => {
  it('ABD varışı (238) → US, mağaza allowlist\'te olmasa bile', () => {
    expect(resolveRegion(order(238), undefined)).toBe('US');     // eBay-UK / Shopify US siparişi (asıl fix)
    expect(resolveRegion(order(238), store('US'))).toBe('US');
    expect(resolveRegion(order(238), store('EU'))).toBe('US');   // EU mağaza ama US varış
  });

  it('ABD-dışı varış: US-mağaza bile olsa kapsam dışı', () => {
    expect(resolveRegion(order(77), store('US'))).toBeNull();    // US Etsy ama UK varış → US deposundan gitmez
    expect(resolveRegion(order(undefined), store('US'))).toBeNull();
  });

  it('ABD-dışı varış: mağaza kendi region\'ı / listede yoksa elenir', () => {
    expect(resolveRegion(order(77), store('EU'))).toBe('EU');
    expect(resolveRegion(order(77), undefined)).toBeNull();
  });
});
