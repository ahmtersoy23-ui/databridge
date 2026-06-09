import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import path from 'path';

// YAPISAL TRIPWIRE (davranış kanıtı DEĞİL): pricelab_db (sharedPool) içindeki
// fba_inventory / sales_data tablolarına DOĞRUDAN yazan her dosya
// getSafetyDropThreshold guard'ı içermeli (invariant #2). Wayfair fba_inventory
// yazımı tam da böyle bir tripwire olmadığı için eşiksiz kalmıştı (2026-06-07).
//
// Kapsam DIŞI (bilinçli):
//   - databridge_db.fba_inventory STAGING yazımı (inventorySync.ts, `pool` ile) —
//     guard, staging→shared sınırındaki inventoryDataWriter'da. sharedPool referansı
//     olmadığı için bu test onu zaten elemez.
//   - fba_inventory_aging gibi farklı tablolar — tablo adı word-boundary ile ayrılır.
//   - upsertSalesData() ile yazan marketplace writer'ları — guard o helper'ın içinde
//     (salesDataWriter); tabloyu doğrudan yazmadıkları için eşleşmezler.

const SRC = path.resolve(__dirname, '..');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__' || entry === 'node_modules') continue;
      out.push(...walk(full));
    } else if (entry.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

// (INSERT INTO|DELETE FROM) fba_inventory|sales_data — word-boundary fba_inventory_aging'i eler
const WRITE_RE = /(INSERT INTO|DELETE FROM)\s+(fba_inventory|sales_data)\b/;

describe('sharedPool writer safety-threshold tripwire (invariant #2)', () => {
  it('fba_inventory/sales_data sharedPool yazan her dosya getSafetyDropThreshold içerir', () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const src = readFileSync(file, 'utf8');
      const writesSharedTable = WRITE_RE.test(src) && src.includes('sharedPool');
      if (writesSharedTable && !src.includes('getSafetyDropThreshold')) {
        offenders.push(path.relative(SRC, file));
      }
    }
    expect(
      offenders,
      `Bu dosyalar sharedPool fba_inventory/sales_data'ya yazıyor ama %20 safety ` +
      `threshold guard'ı (getSafetyDropThreshold) YOK. Ekle (inventoryDataWriter.ts ` +
      `kalıbı) ya da upsertSalesData() üzerinden yaz:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('en az bir bilinen guard\'lı writer yakalanıyor (tripwire gerçekten çalışıyor)', () => {
    // Tripwire'ın no-op olmadığının kanıtı: bilinen writer'lar regex'e takılıyor.
    const guarded = walk(SRC).filter(f => {
      const src = readFileSync(f, 'utf8');
      return WRITE_RE.test(src) && src.includes('sharedPool');
    }).map(f => path.basename(f));
    expect(guarded).toContain('salesDataWriter.ts');
    expect(guarded).toContain('inventoryDataWriter.ts');
    expect(guarded).toContain('wayfairSync.ts');
  });
});
