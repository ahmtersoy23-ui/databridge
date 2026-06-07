/**
 * Schema Contract Tests
 *
 * pricelab_db tablolarinin (sales_data, fba_inventory, sku_master) downstream
 * app'lerin (StockPulse, AmzSellMetrics, SwiftStock, PriceLab) bekledigi
 * kolonlara sahip oldugunu dogrular.
 *
 * IKI KATMAN:
 *  1. STATIK (her zaman kosar): consumer contract'lari (her app'in okudugu/yazdigi
 *     kolonlar) asagidaki SNAPSHOT'a karsi tutarli mi? Bu, snapshot'in GERCEK DB ile
 *     ayni oldugunu KANITLAMAZ — sadece developer'in contract listesini snapshot'a
 *     uygun tuttugunu yakalar (manuel bakim). Migration DB'de kolon dusurse YESIL kalir.
 *  2. CANLI DB (TEST_PRICELAB_DB_URL set ise; CI'da skip): contract kolonlarinin
 *     gercekten `information_schema.columns`'ta var oldugunu dogrular = gercek drift
 *     koruması. Lokal/integration kosumunda: `TEST_PRICELAB_DB_URL=postgres://... npm test`.
 *
 * Migration bu tablolara dokunursa: snapshot'i guncelle + TUM consumer'lari dogrula.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';

// ============================================
// SCHEMA SNAPSHOT — son bilinen sema (2026-04-04 dogrulandi).
// DEGIL "source of truth": gercek kaynak pricelab_db. Bu sadece statik katman
// icin referans + canli katmanin drift karsilastirma tabani.
// ============================================

const SALES_DATA_COLUMNS = [
  'id', 'iwasku', 'asin', 'channel',
  'last3', 'last7', 'last30', 'last90', 'last180', 'last366',
  'pre_year_last7', 'pre_year_last30', 'pre_year_last90',
  'pre_year_last180', 'pre_year_last365',
  'pre_year_next7', 'pre_year_next30', 'pre_year_next90', 'pre_year_next180',
  'updated_at',
];

const FBA_INVENTORY_COLUMNS = [
  'id', 'iwasku', 'asin', 'warehouse', 'sku_list',
  'total_quantity', 'fc_processing_quantity', 'total_reserved_quantity',
  'pending_customer_order_quantity', 'pending_transshipment_quantity',
  'fulfillable_quantity',
  'total_researching_quantity', 'future_supply_buyable_quantity',
  'reserved_future_supply_quantity', 'expired_quantity', 'defective_quantity',
  'carrier_damaged_quantity', 'customer_damaged_quantity',
  'warehouse_damaged_quantity', 'distributor_damaged_quantity',
  'total_unfulfillable_quantity',
  'inbound_shipped_quantity', 'inbound_working_quantity', 'inbound_receiving_quantity',
  'updated_at', 'fnsku', 'shipping_cost',
];

const SKU_MASTER_COLUMNS = [
  'id', 'sku', 'marketplace', 'country_code', 'asin', 'iwasku',
  'custom_shipping', 'fbm_source',
  'created_at', 'updated_at', 'fulfillment',
];

// ============================================
// CONSUMER CONTRACTS: what each app reads
// ============================================

describe('sales_data schema contract', () => {
  // StockPulse reads: channel, iwasku, last7/30/90/180/366, pre_year_*
  const STOCKPULSE_READS = [
    'iwasku', 'asin', 'channel',
    'last7', 'last30', 'last90', 'last180', 'last366',
    'pre_year_last7', 'pre_year_last30', 'pre_year_last90',
    'pre_year_last180', 'pre_year_last365',
    'pre_year_next7', 'pre_year_next30', 'pre_year_next90', 'pre_year_next180',
  ];

  // AmzSellMetrics reads: iwasku, channel for filtering
  const AMZSELLMETRICS_READS = ['iwasku', 'asin', 'channel', 'last30', 'last90'];

  // DataBridge writes: all rolling window columns
  const DATABRIDGE_WRITES = [
    'channel', 'iwasku', 'asin',
    'last3', 'last7', 'last30', 'last90', 'last180', 'last366',
    'pre_year_last7', 'pre_year_last30', 'pre_year_last90',
    'pre_year_last180', 'pre_year_last365',
    'pre_year_next7', 'pre_year_next30', 'pre_year_next90', 'pre_year_next180',
  ];

  it('has all columns StockPulse reads', () => {
    for (const col of STOCKPULSE_READS) {
      expect(SALES_DATA_COLUMNS, `Missing column: ${col}`).toContain(col);
    }
  });

  it('has all columns AmzSellMetrics reads', () => {
    for (const col of AMZSELLMETRICS_READS) {
      expect(SALES_DATA_COLUMNS, `Missing column: ${col}`).toContain(col);
    }
  });

  it('has all columns DataBridge writes', () => {
    for (const col of DATABRIDGE_WRITES) {
      expect(SALES_DATA_COLUMNS, `Missing column: ${col}`).toContain(col);
    }
  });

  it('snapshot has expected column count', () => {
    expect(SALES_DATA_COLUMNS).toHaveLength(20);
  });
});

describe('fba_inventory schema contract', () => {
  // StockPulse reads: warehouse, iwasku, fulfillable_quantity, inbound_*, total_quantity
  const STOCKPULSE_READS = [
    'iwasku', 'asin', 'warehouse',
    'fulfillable_quantity', 'total_quantity',
    'inbound_shipped_quantity', 'inbound_working_quantity', 'inbound_receiving_quantity',
    'total_reserved_quantity', 'total_unfulfillable_quantity',
  ];

  // SwiftStock reads: warehouse, iwasku, fulfillable_quantity, fnsku
  const SWIFTSTOCK_READS = [
    'iwasku', 'warehouse', 'fulfillable_quantity', 'fnsku', 'total_quantity',
  ];

  // DataBridge writes (Amazon): all quantity columns
  const DATABRIDGE_AMAZON_WRITES = [
    'iwasku', 'asin', 'warehouse', 'fnsku', 'sku_list', 'total_quantity',
    'fc_processing_quantity', 'total_reserved_quantity',
    'pending_customer_order_quantity', 'pending_transshipment_quantity',
    'fulfillable_quantity',
    'total_researching_quantity', 'future_supply_buyable_quantity',
    'reserved_future_supply_quantity', 'expired_quantity', 'defective_quantity',
    'carrier_damaged_quantity', 'customer_damaged_quantity',
    'warehouse_damaged_quantity', 'distributor_damaged_quantity',
    'total_unfulfillable_quantity',
    'inbound_shipped_quantity', 'inbound_working_quantity', 'inbound_receiving_quantity',
  ];

  // DataBridge writes (Wayfair): subset
  const DATABRIDGE_WAYFAIR_WRITES = [
    'iwasku', 'warehouse', 'fulfillable_quantity', 'total_quantity', 'asin', 'shipping_cost',
  ];

  it('has all columns StockPulse reads', () => {
    for (const col of STOCKPULSE_READS) {
      expect(FBA_INVENTORY_COLUMNS, `Missing column: ${col}`).toContain(col);
    }
  });

  it('has all columns SwiftStock reads', () => {
    for (const col of SWIFTSTOCK_READS) {
      expect(FBA_INVENTORY_COLUMNS, `Missing column: ${col}`).toContain(col);
    }
  });

  it('has all columns DataBridge writes (Amazon)', () => {
    for (const col of DATABRIDGE_AMAZON_WRITES) {
      expect(FBA_INVENTORY_COLUMNS, `Missing column: ${col}`).toContain(col);
    }
  });

  it('has all columns DataBridge writes (Wayfair)', () => {
    for (const col of DATABRIDGE_WAYFAIR_WRITES) {
      expect(FBA_INVENTORY_COLUMNS, `Missing column: ${col}`).toContain(col);
    }
  });

  it('snapshot has expected column count', () => {
    expect(FBA_INVENTORY_COLUMNS).toHaveLength(27);
  });
});

describe('sku_master schema contract', () => {
  // All apps read SKU-level fields only; product fields come via JOIN products (sm.iwasku = p.product_sku)
  const COMMON_READS = ['iwasku', 'sku', 'asin', 'marketplace'];

  // AmzSellMetrics reads: custom_shipping, fbm_source (product fields via JOIN products)
  const AMZSELLMETRICS_READS = [...COMMON_READS, 'custom_shipping', 'fbm_source'];

  // StockPulse reads: iwasku, asin (product fields via JOIN products)
  const STOCKPULSE_READS = ['iwasku', 'asin'];

  // PriceLab writes: SKU-level columns only (product fields live in products table)
  const PRICELAB_WRITES = [
    'sku', 'marketplace', 'country_code', 'asin', 'iwasku',
    'custom_shipping', 'fbm_source', 'fulfillment',
  ];

  it('has all common columns apps read', () => {
    for (const col of COMMON_READS) {
      expect(SKU_MASTER_COLUMNS, `Missing column: ${col}`).toContain(col);
    }
  });

  it('has all columns AmzSellMetrics reads', () => {
    for (const col of AMZSELLMETRICS_READS) {
      expect(SKU_MASTER_COLUMNS, `Missing column: ${col}`).toContain(col);
    }
  });

  it('has all columns StockPulse reads', () => {
    for (const col of STOCKPULSE_READS) {
      expect(SKU_MASTER_COLUMNS, `Missing column: ${col}`).toContain(col);
    }
  });

  it('has all columns PriceLab writes', () => {
    for (const col of PRICELAB_WRITES) {
      expect(SKU_MASTER_COLUMNS, `Missing column: ${col}`).toContain(col);
    }
  });

  it('snapshot has expected column count', () => {
    expect(SKU_MASTER_COLUMNS).toHaveLength(11);
  });
});

// ============================================
// KATMAN 2 — CANLI DB DRIFT KONTROLU (DB-gated)
// TEST_PRICELAB_DB_URL set degilse (CI) tum suite skip edilir.
// ============================================

const DB_URL = process.env.TEST_PRICELAB_DB_URL;

// Her tablo icin downstream'in GERCEKTEN bagimli oldugu kolonlar (read ∪ write).
// Bunlar canli sema'da YOKSA bir consumer kirilir.
const REQUIRED: Record<string, string[]> = {
  sales_data: [
    'iwasku', 'asin', 'channel', 'fulfillment_channel', 'updated_at',
    'last3', 'last7', 'last30', 'last90', 'last180', 'last366',
    'pre_year_last7', 'pre_year_last30', 'pre_year_last90', 'pre_year_last180', 'pre_year_last365',
    'pre_year_next7', 'pre_year_next30', 'pre_year_next90', 'pre_year_next180',
  ],
  fba_inventory: [
    'iwasku', 'asin', 'warehouse', 'fnsku', 'fulfillable_quantity', 'total_quantity',
    'inbound_shipped_quantity', 'inbound_working_quantity', 'inbound_receiving_quantity',
    'total_reserved_quantity', 'total_unfulfillable_quantity', 'shipping_cost', 'updated_at',
  ],
  sku_master: [
    'sku', 'marketplace', 'country_code', 'asin', 'iwasku',
    'custom_shipping', 'fbm_source', 'fulfillment',
  ],
};

describe.skipIf(!DB_URL)('CANLI pricelab_db drift kontrolu', () => {
  let pool: Pool;
  const liveColumns: Record<string, Set<string>> = {};

  beforeAll(async () => {
    pool = new Pool({ connectionString: DB_URL });
    for (const table of Object.keys(REQUIRED)) {
      const { rows } = await pool.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = $1`,
        [table],
      );
      liveColumns[table] = new Set(rows.map(r => r.column_name));
    }
  });

  afterAll(async () => { await pool?.end(); });

  for (const [table, cols] of Object.entries(REQUIRED)) {
    it(`${table}: tum gerekli kolonlar canli sema'da var`, () => {
      const live = liveColumns[table];
      expect(live.size, `${table} bos/yok — DB baglantisi?`).toBeGreaterThan(0);
      const missing = cols.filter(c => !live.has(c));
      expect(missing, `${table} canli sema'da EKSIK kolon(lar): ${missing.join(', ')}`).toEqual([]);
    });
  }
});
