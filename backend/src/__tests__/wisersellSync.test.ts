import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Bu dosya wisersellSync icin smoke test'leri tutar. syncWisersell ve syncProductsTable
// karmasik dis bagimliliklari (axios + 2 pool) oldugu icin tam mock'lamak yerine kritik
// SQL dedupe garantisini source-level regression test ile koruruz.
//
// Context: 2026-04-30 audit'inde "ON CONFLICT DO UPDATE command cannot affect row a
// second time" hatasi 3+ gundur sync'i kiliyordu. Sebep: wisersell_products icinde 44
// duplicate `code` (ayni SKU farkli id ile). DISTINCT ON ile dedupe ekledik.

describe('wisersellSync — DISTINCT ON dedupe regression', () => {
  const filePath = resolve(__dirname, '../services/sync/wisersellSync.ts');
  const source = readFileSync(filePath, 'utf-8');

  it('SELECT query uses DISTINCT ON (wp.code) to dedupe before products UPSERT', () => {
    expect(source).toContain('DISTINCT ON (wp.code)');
  });

  it('ORDER BY clause picks newest id per code (wp.id DESC)', () => {
    expect(source).toMatch(/ORDER BY\s+wp\.code,\s*wp\.id\s+DESC/i);
  });

  it('preserves the products UPSERT with ON CONFLICT (product_sku)', () => {
    // Dedupe sonrasinda hala UPSERT olmali — DISTINCT ON sadece girdi tarafini temizler
    expect(source).toContain('ON CONFLICT (product_sku) DO UPDATE');
  });
});
