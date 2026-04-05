/**
 * Schema Contract Tests
 *
 * These tests verify that the shared pricelab_db tables have the columns
 * that downstream apps (StockPulse, AmzSellMetrics, SwiftStock, PriceLab) expect.
 *
 * If a migration changes these tables, update the snapshots below AND verify
 * that ALL consumer apps still work.
 *
 * Shared tables: sales_data, fba_inventory, sku_master
 * Writer: DataBridge
 * Readers: StockPulse, AmzSellMetrics, SwiftStock, PriceLab
 */
import { describe, it, expect } from 'vitest';

// ============================================
// SCHEMA SNAPSHOTS (source of truth from pricelab_db)
// Last verified: 2026-04-04
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
  'name', 'parent', 'category', 'cost', 'size',
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
  // All apps read: iwasku, asin, name, parent, category
  const COMMON_READS = ['iwasku', 'sku', 'asin', 'name', 'parent', 'category', 'marketplace'];

  // AmzSellMetrics reads: cost, size, custom_shipping, fbm_source
  const AMZSELLMETRICS_READS = [...COMMON_READS, 'cost', 'size', 'custom_shipping', 'fbm_source'];

  // StockPulse reads: iwasku, category
  const STOCKPULSE_READS = ['iwasku', 'asin', 'category', 'name'];

  // PriceLab writes: all columns
  const PRICELAB_WRITES = [
    'sku', 'marketplace', 'country_code', 'asin', 'iwasku',
    'name', 'parent', 'category', 'cost', 'size',
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
    expect(SKU_MASTER_COLUMNS).toHaveLength(16);
  });
});
