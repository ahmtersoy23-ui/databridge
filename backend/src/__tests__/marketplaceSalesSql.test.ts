import { describe, it, expect, beforeEach } from 'vitest';
import { newDb, type IMemoryDb } from 'pg-mem';
import { WALMART_ROLLING_WINDOW_SQL } from '../services/sync/walmartSalesDataWriter';
import { TAKEALOT_ROLLING_WINDOW_SQL } from '../services/sync/takealotSalesDataWriter';
import { BOL_ROLLING_WINDOW_SQL } from '../services/sync/bolSalesDataWriter';
import { KAUFLAND_ROLLING_WINDOW_SQL } from '../services/sync/kauflandSalesDataWriter';

// Marketplace rolling-window agregasyonlari (walmart/bol/takealot/kaufland) →
// sales_data'ya yazilir, StockPulse o pazar yerinin talep sinyali olarak okur.
// Amazon writer'i (salesRollingSql.test) pg-mem ile kapaliydi ama bu 4'u
// CALISTIRILMAYAN SQL string'iydi (coverage ~%20, func %0). Burada in-memory PG
// ile gercek fixture uzerinde kosturup pencere matematigini + marketplace'e ozgu
// iptal/quantity/iwasku/param filtrelerini dogruluyoruz.

let db: IMemoryDb;
let query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }>;
const ins = (sql: string) => db.public.none(sql);

beforeEach(() => {
  db = newDb();
  db.public.none(`CREATE TABLE walmart_raw_orders (iwasku text, sku text, quantity int, order_status text, order_date_local date)`);
  db.public.none(`CREATE TABLE takealot_raw_orders (iwasku text, sku text, quantity int, sale_status boolean, order_date_local date)`);
  db.public.none(`CREATE TABLE bol_raw_orders (account_id int, iwasku text, sku text, quantity int, is_cancelled boolean, order_date_local date)`);
  db.public.none(`CREATE TABLE kaufland_raw_orders (iwasku text, offer_sku text, quantity int, is_cancelled boolean, storefront text, order_date_local date)`);
  const pg = db.adapters.createPg();
  const pool = new pg.Pool();
  query = (sql, params) => pool.query(sql, params);
});

describe('WALMART_ROLLING_WINDOW_SQL', () => {
  // gun1 Delivered 5, gun1 NULL-status 7 (NULL-guvenli sayilir), gun20 Shipped 3,
  // gun1 Cancelled 9 (#3 HARIC), iwasku NULL 50 (HARIC), quantity 0 (HARIC)
  it('pencere toplamlari + Cancelled/quantity/iwasku filtreleri', async () => {
    ins(`INSERT INTO walmart_raw_orders (iwasku, sku, quantity, order_status, order_date_local) VALUES
      ('IW1','S1', 5, 'Delivered', CURRENT_DATE - 1),
      ('IW1','S1', 7, NULL,        CURRENT_DATE - 1),
      ('IW1','S1', 3, 'Shipped',   CURRENT_DATE - 20),
      ('IW1','S1', 9, 'Cancelled', CURRENT_DATE - 1),
      (NULL, 'S2', 50,'Delivered', CURRENT_DATE - 1),
      ('IW2','S3', 0, 'Delivered', CURRENT_DATE - 1)`);
    const { rows } = await query(WALMART_ROLLING_WINDOW_SQL);
    expect(rows).toHaveLength(1);
    expect(rows[0].iwasku).toBe('IW1');
    expect(rows[0].last3).toBe(12);   // 5 + 7 (gun20 disi, Cancelled haric)
    expect(rows[0].last30).toBe(15);  // 5 + 7 + 3
  });
});

describe('TAKEALOT_ROLLING_WINDOW_SQL', () => {
  // sale_status: true=satis, false=iptal(HARIC), NULL=COALESCE true(sayilir)
  it('COALESCE(sale_status,true): false HARIC, NULL satis sayilir', async () => {
    ins(`INSERT INTO takealot_raw_orders (iwasku, sku, quantity, sale_status, order_date_local) VALUES
      ('IW1','S1', 5, true,  CURRENT_DATE - 1),
      ('IW1','S1', 4, NULL,  CURRENT_DATE - 1),
      ('IW1','S1', 9, false, CURRENT_DATE - 1)`);
    const { rows } = await query(TAKEALOT_ROLLING_WINDOW_SQL);
    expect(rows).toHaveLength(1);
    expect(rows[0].last30).toBe(9);   // 5 + 4 (false 9 haric)
  });
});

describe('BOL_ROLLING_WINDOW_SQL', () => {
  // $1=account_id; account 2 ve is_cancelled=true HARIC
  it('account_id param + is_cancelled filtresi', async () => {
    ins(`INSERT INTO bol_raw_orders (account_id, iwasku, sku, quantity, is_cancelled, order_date_local) VALUES
      (1,'IW1','S1', 5,  false, CURRENT_DATE - 1),
      (1,'IW1','S1', 9,  true,  CURRENT_DATE - 1),
      (2,'IW1','S1', 50, false, CURRENT_DATE - 1)`);
    const { rows } = await query(BOL_ROLLING_WINDOW_SQL, [1]);
    expect(rows).toHaveLength(1);
    expect(rows[0].last30).toBe(5);
  });
});

describe('KAUFLAND_ROLLING_WINDOW_SQL', () => {
  // $1=storefront; FR storefront ve is_cancelled=true HARIC
  it('storefront param + is_cancelled filtresi', async () => {
    ins(`INSERT INTO kaufland_raw_orders (iwasku, offer_sku, quantity, is_cancelled, storefront, order_date_local) VALUES
      ('IW1','S1', 5,  false, 'DE', CURRENT_DATE - 1),
      ('IW1','S1', 9,  true,  'DE', CURRENT_DATE - 1),
      ('IW1','S1', 50, false, 'FR', CURRENT_DATE - 1)`);
    const { rows } = await query(KAUFLAND_ROLLING_WINDOW_SQL, ['DE']);
    expect(rows).toHaveLength(1);
    expect(rows[0].last30).toBe(5);
  });
});
