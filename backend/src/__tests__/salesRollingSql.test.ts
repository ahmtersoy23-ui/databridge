import { describe, it, expect, beforeEach } from 'vitest';
import { newDb, type IMemoryDb } from 'pg-mem';
import {
  ROLLING_WINDOW_SQL,
  ROLLING_WINDOW_FBA_SQL,
  EU_AGGREGATE_SQL,
  EU_AGGREGATE_FBA_SQL,
} from '../services/sync/salesDataWriter';

// buildRollingSql, StockPulse/AmzSellMetrics'in CANLI okudugu sales_data
// aritmetigini uretir. Onceden hic CALISTIRILMAYAN SQL string'iydi. Burada
// pg-mem (in-memory Postgres) ile gercek fixture'lar uzerinde kosturup
// rolling-window matematigini, filtreleri, fulfillment ayrimini ve EU
// re-aggregation'i (invariant) dogruluyoruz.

let db: IMemoryDb;
let query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }>;

function seed(rows: Array<{
  iwasku?: string | null; sku: string; asin?: string; channel: string;
  fulfillment?: string; qty: number; price?: number; daysAgo: number;
}>) {
  for (const r of rows) {
    db.public.none(
      `INSERT INTO raw_orders (iwasku, sku, asin, channel, fulfillment_channel, quantity, item_price, purchase_date_local)
       VALUES (${r.iwasku === undefined ? `'${r.sku}'` : r.iwasku === null ? 'NULL' : `'${r.iwasku}'`},
               '${r.sku}', '${r.asin ?? 'ASIN'}', '${r.channel}', '${r.fulfillment ?? 'Amazon'}',
               ${r.qty}, ${r.price ?? 10}, CURRENT_DATE - ${r.daysAgo})`,
    );
  }
}

beforeEach(() => {
  db = newDb();
  db.public.none(`
    CREATE TABLE raw_orders (
      iwasku text, sku text, asin text, channel text,
      fulfillment_channel text, quantity int, item_price numeric,
      purchase_date_local date
    );
  `);
  const pg = db.adapters.createPg();
  const pool = new pg.Pool();
  query = (sql, params) => pool.query(sql, params);
});

describe('ROLLING_WINDOW_SQL — trailing pencereler', () => {
  it('last3/last7/last30/last90 dogru kumulatif toplar', async () => {
    seed([
      { sku: 'AHM1', channel: 'us', qty: 5, daysAgo: 1 },   // last3,7,30,90
      { sku: 'AHM1', channel: 'us', qty: 3, daysAgo: 5 },   // last7,30,90
      { sku: 'AHM1', channel: 'us', qty: 2, daysAgo: 20 },  // last30,90
      { sku: 'AHM1', channel: 'us', qty: 4, daysAgo: 60 },  // last90
    ]);
    const { rows } = await query(ROLLING_WINDOW_SQL, ['us']);
    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(r.last3).toBe(5);
    expect(r.last7).toBe(8);
    expect(r.last30).toBe(10);
    expect(r.last90).toBe(14);
  });

  it('2 yildan eski siparis tamamen haric', async () => {
    seed([
      { sku: 'AHM1', channel: 'us', qty: 5, daysAgo: 1 },
      { sku: 'AHM1', channel: 'us', qty: 99, daysAgo: 800 }, // >2 yil → hic sayilmaz
    ]);
    const { rows } = await query(ROLLING_WINDOW_SQL, ['us']);
    expect(rows[0].last366).toBe(5); // 800 gun once olan 99 dahil degil
  });

  it('COALESCE(iwasku, sku) — iwasku NULL ise sku ile gruplar', async () => {
    seed([{ iwasku: null, sku: 'RAWSKU', channel: 'us', qty: 7, daysAgo: 1 }]);
    const { rows } = await query(ROLLING_WINDOW_SQL, ['us']);
    expect(rows[0].iwasku).toBe('RAWSKU');
  });
});

describe('ROLLING_WINDOW_SQL — filtreler (invariant)', () => {
  it("amzn.gr.% SKU'lari haric", async () => {
    seed([
      { sku: 'AHM1', channel: 'us', qty: 5, daysAgo: 1 },
      { iwasku: null, sku: 'amzn.gr.RETURN', channel: 'us', qty: 99, daysAgo: 1 },
    ]);
    const { rows } = await query(ROLLING_WINDOW_SQL, ['us']);
    expect(rows).toHaveLength(1);
    expect(rows[0].iwasku).toBe('AHM1');
    expect(rows[0].last3).toBe(5);
  });

  it('item_price = 0 (bedava/iptal) haric', async () => {
    seed([
      { sku: 'AHM1', channel: 'us', qty: 5, price: 10, daysAgo: 1 },
      { sku: 'AHM1', channel: 'us', qty: 99, price: 0, daysAgo: 1 },
    ]);
    const { rows } = await query(ROLLING_WINDOW_SQL, ['us']);
    expect(rows[0].last3).toBe(5);
  });

  it('sadece istenen channel — baska channel sizmaz', async () => {
    seed([
      { sku: 'AHM1', channel: 'us', qty: 5, daysAgo: 1 },
      { sku: 'AHM1', channel: 'de', qty: 99, daysAgo: 1 },
    ]);
    const { rows } = await query(ROLLING_WINDOW_SQL, ['us']);
    expect(rows[0].last3).toBe(5);
  });
});

describe('ROLLING_WINDOW_FBA_SQL — fulfillment ayrimi + param index ($1=channel, $2=fulfillment)', () => {
  beforeEach(() => {
    seed([
      { sku: 'AHM1', channel: 'us', fulfillment: 'Amazon', qty: 5, daysAgo: 1 },
      { sku: 'AHM1', channel: 'us', fulfillment: 'Merchant', qty: 3, daysAgo: 1 },
    ]);
  });

  it('Amazon (FBA) sadece FBA satirlarini sayar', async () => {
    const { rows } = await query(ROLLING_WINDOW_FBA_SQL, ['us', 'Amazon']);
    expect(rows[0].last3).toBe(5);
  });

  it('Merchant (FBM) sadece FBM satirlarini sayar', async () => {
    const { rows } = await query(ROLLING_WINDOW_FBA_SQL, ['us', 'Merchant']);
    expect(rows[0].last3).toBe(3);
  });
});

describe('EU_AGGREGATE_SQL — de+fr+it+es+others tek iwasku altinda toplanir (invariant)', () => {
  it('5 EU channel tek satira toplanir, us haric', async () => {
    seed([
      { sku: 'AHM1', channel: 'de', qty: 2, daysAgo: 1 },
      { sku: 'AHM1', channel: 'fr', qty: 3, daysAgo: 1 },
      { sku: 'AHM1', channel: 'it', qty: 1, daysAgo: 1 },
      { sku: 'AHM1', channel: 'es', qty: 4, daysAgo: 1 },
      { sku: 'AHM1', channel: 'others', qty: 5, daysAgo: 1 },
      { sku: 'AHM1', channel: 'us', qty: 99, daysAgo: 1 }, // EU disi → haric
    ]);
    const { rows } = await query(EU_AGGREGATE_SQL);
    expect(rows).toHaveLength(1);
    expect(rows[0].last3).toBe(15); // 2+3+1+4+5
  });

  it('uk EU aggregate disinda (ayri channel)', async () => {
    seed([{ sku: 'AHM1', channel: 'uk', qty: 99, daysAgo: 1 }]);
    const { rows } = await query(EU_AGGREGATE_SQL);
    expect(rows).toHaveLength(0);
  });

  it('se/nl/pl/be EU agregatina dahil, tr (AB-disi) HARIC', async () => {
    seed([
      { sku: 'AHM1', channel: 'se', qty: 2, daysAgo: 1 },
      { sku: 'AHM1', channel: 'nl', qty: 3, daysAgo: 1 },
      { sku: 'AHM1', channel: 'pl', qty: 1, daysAgo: 1 },
      { sku: 'AHM1', channel: 'be', qty: 4, daysAgo: 1 },
      { sku: 'AHM1', channel: 'tr', qty: 50, daysAgo: 1 }, // AB-disi → haric
    ]);
    const { rows } = await query(EU_AGGREGATE_SQL);
    expect(rows).toHaveLength(1);
    expect(rows[0].last3).toBe(10); // 2+3+1+4, tr 50 HARIC
  });
});

describe('EU_AGGREGATE_FBA_SQL — EU + fulfillment, param index ($1=fulfillment)', () => {
  it('EU aggregate + sadece FBA (param $1 fulfillment olarak dogru baglanir)', async () => {
    seed([
      { sku: 'AHM1', channel: 'de', fulfillment: 'Amazon', qty: 2, daysAgo: 1 },
      { sku: 'AHM1', channel: 'fr', fulfillment: 'Amazon', qty: 3, daysAgo: 1 },
      { sku: 'AHM1', channel: 'de', fulfillment: 'Merchant', qty: 50, daysAgo: 1 },
    ]);
    const { rows } = await query(EU_AGGREGATE_FBA_SQL, ['Amazon']);
    expect(rows[0].last3).toBe(5); // 2+3, Merchant 50 haric
  });
});

describe('pre-year pencereleri (gecen yil ayni donem)', () => {
  it('gecen yil ~350 gun once → pre_year_next30 icine duser, bu yil last30 disinda', async () => {
    // 350 gun once = (CURRENT_DATE - 1 yil ≈ 365g) ile +30 forward penceresi
    // [~365g, ~335g] icinde; artik-yil ±1 fuzz'undan uzak.
    seed([{ sku: 'AHM1', channel: 'us', qty: 8, daysAgo: 350 }]);
    const { rows } = await query(ROLLING_WINDOW_SQL, ['us']);
    expect(rows[0].last30).toBe(0);           // bu yil son 30 gunde yok
    expect(rows[0].pre_year_next30).toBe(8);  // gecen yil bugun..+30 penceresinde
    expect(rows[0].pre_year_last30).toBe(0);  // gecen yilin OncesI degil
  });
});
