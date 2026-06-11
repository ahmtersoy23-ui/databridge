import { describe, it, expect, vi } from 'vitest';
import zlib from 'zlib';

// Saf parse/unzip mantigini test et. Ag fonksiyonlari (request/poll/download) icin
// client'i mock'la ki import zinciri config/database'i cekmesin.
vi.mock('../config/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../services/walmart/client', () => ({
  walmartGet: vi.fn(),
  walmartPost: vi.fn(),
}));

import { parseCsvLine, parseItemReportCsv, unzipSingle } from '../services/walmart/itemReport';

/** Tek-entry ZIP olustur (DEFLATE) — unzipSingle round-trip testi icin. */
function makeDeflateZip(name: string, content: string): Buffer {
  const nameBuf = Buffer.from(name, 'utf8');
  const raw = Buffer.from(content, 'utf8');
  const comp = zlib.deflateRawSync(raw);

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);   // local file header sig
  local.writeUInt16LE(20, 4);           // version needed
  local.writeUInt16LE(0, 6);            // flags
  local.writeUInt16LE(8, 8);            // method = deflate
  local.writeUInt16LE(0, 10);           // time
  local.writeUInt16LE(0, 12);           // date
  local.writeUInt32LE(0, 14);           // crc (unzipSingle dogrulamiyor)
  local.writeUInt32LE(comp.length, 18); // comp size
  local.writeUInt32LE(raw.length, 22);  // uncomp size
  local.writeUInt16LE(nameBuf.length, 26);
  local.writeUInt16LE(0, 28);           // extra len
  const localBlock = Buffer.concat([local, nameBuf, comp]);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0); // central dir sig
  central.writeUInt16LE(20, 4);         // version made by
  central.writeUInt16LE(20, 6);         // version needed
  central.writeUInt16LE(0, 8);          // flags
  central.writeUInt16LE(8, 10);         // method
  central.writeUInt16LE(0, 12);
  central.writeUInt16LE(0, 14);
  central.writeUInt32LE(0, 16);         // crc
  central.writeUInt32LE(comp.length, 20);
  central.writeUInt32LE(raw.length, 24);
  central.writeUInt16LE(nameBuf.length, 28);
  central.writeUInt16LE(0, 30);         // extra
  central.writeUInt16LE(0, 32);         // comment
  central.writeUInt16LE(0, 34);         // disk
  central.writeUInt16LE(0, 36);         // internal attr
  central.writeUInt32LE(0, 38);         // external attr
  central.writeUInt32LE(0, 42);         // local header offset
  const centralBlock = Buffer.concat([central, nameBuf]);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(1, 8);             // entries this disk
  eocd.writeUInt16LE(1, 10);            // total entries
  eocd.writeUInt32LE(centralBlock.length, 12); // central dir size
  eocd.writeUInt32LE(localBlock.length, 16);   // central dir offset
  eocd.writeUInt16LE(0, 20);            // comment len

  return Buffer.concat([localBlock, centralBlock, eocd]);
}

// Gercek ITEM raporu v4 basligi (47 kolon) — onemli kolonlar dogru index'te.
const HEADER = 'SKU,Item ID,Product Name,Lifecycle Status,Publish Status,Status Change Reason,Product Category,Price,Currency,Buy Box Item Price,Buy Box Shipping Price,Buy Box Eligible,MSRP,Product Tax Code,Ship Methods,Shipping Weight,Shipping Weight Unit,Fulfillment Lag Time,Fulfillment Type,WFS Sales Restriction,WPID,GTIN,UPC';

describe('parseCsvLine', () => {
  it('basit alanlari ayristirir', () => {
    expect(parseCsvLine('a,b,c')).toEqual(['a', 'b', 'c']);
  });
  it('tirnakli alan ici virgulu korur', () => {
    expect(parseCsvLine('a,"b,c",d')).toEqual(['a', 'b,c', 'd']);
  });
  it('cift-tirnak kacisini cozer', () => {
    expect(parseCsvLine('"a""b",c')).toEqual(['a"b', 'c']);
  });
  it('sondaki bos alani korur', () => {
    expect(parseCsvLine('a,b,')).toEqual(['a', 'b', '']);
  });
});

describe('parseItemReportCsv', () => {
  it('kolonu basliga gore eslestirir, sku/price/status/lag/fulfillmentType dondurur', () => {
    const csv = [
      HEADER,
      'CM20700VZ3Z1,123,Coffee Table,ACTIVE,PUBLISHED,,Furniture,179.0,USD,,,true,,,,10,lb,1,Seller Fulfilled,,4SYIDCT2Y939,00123,00123',
      'KV18300TY0FW,456,Vase,ARCHIVED,SYSTEM_PROBLEM,Issue,Decor,98.9,USD,,,false,,,,5,lb,0,Walmart Fulfilled,,5O2ZM58G0VIO,00456,00456',
    ].join('\n');
    const rows = parseItemReportCsv(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      sku: 'CM20700VZ3Z1', price: 179, currency: 'USD', status: 'PUBLISHED',
      lifecycle: 'ACTIVE', fulfillmentType: 'Seller Fulfilled', lagTime: 1, wpid: '4SYIDCT2Y939', gtin: '00123',
    });
    expect(rows[1]).toMatchObject({
      sku: 'KV18300TY0FW', status: 'SYSTEM_PROBLEM', fulfillmentType: 'Walmart Fulfilled', lagTime: 0,
    });
  });

  it('sku bos satiri atlar; price bos -> null', () => {
    const csv = [
      HEADER,
      ',1,No SKU,ACTIVE,PUBLISHED,,Cat,10,USD,,,,,,,,,0,Seller Fulfilled,,W1,G1,U1',
      'OK1,2,Has SKU,ACTIVE,PUBLISHED,,Cat,,USD,,,,,,,,,0,Seller Fulfilled,,W2,G2,U2',
    ].join('\n');
    const rows = parseItemReportCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0].sku).toBe('OK1');
    expect(rows[0].price).toBeNull();
  });

  it('SKU kolonu yoksa hata firlatir', () => {
    expect(() => parseItemReportCsv('Foo,Bar\n1,2')).toThrow(/SKU kolonu yok/);
  });

  it('bos csv -> bos dizi', () => {
    expect(parseItemReportCsv('')).toEqual([]);
  });
});

describe('unzipSingle', () => {
  it('DEFLATE tek-entry zip i acar', () => {
    const content = `${HEADER}\nCM20700VZ3Z1,1,X,ACTIVE,PUBLISHED,,Cat,179.0,USD,,,,,,,,,1,Seller Fulfilled,,W,G,U`;
    const zip = makeDeflateZip('ItemReport.csv', content);
    expect(unzipSingle(zip)).toBe(content);
  });

  it('rapor zip -> parse zinciri (315 benzeri) tutarli', () => {
    const lines = [HEADER];
    for (let i = 0; i < 50; i++) {
      lines.push(`SKU${i},${i},Item ${i},ACTIVE,PUBLISHED,,Cat,${i}.5,USD,,,,,,,,,1,Seller Fulfilled,,W${i},G${i},U${i}`);
    }
    const zip = makeDeflateZip('ItemReport.csv', lines.join('\n'));
    const rows = parseItemReportCsv(unzipSingle(zip));
    expect(rows).toHaveLength(50);
    expect(rows.every((r) => r.status === 'PUBLISHED')).toBe(true);
    expect(rows[10].sku).toBe('SKU10');
  });

  it('gecersiz buffer -> hata', () => {
    expect(() => unzipSingle(Buffer.from('not a zip'))).toThrow(/ZIP/);
  });
});
