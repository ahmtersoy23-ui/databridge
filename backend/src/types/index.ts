export interface SpApiCredentials {
  id: number;
  region: string;
  seller_id: string;
  account_name: string;
  refresh_token: string;
  client_id: string;
  client_secret: string;
  is_active: boolean;
}

export interface MarketplaceConfig {
  marketplace_id: string;
  country_code: string;
  channel: string;
  warehouse: string;
  region: string;
  timezone_offset: number;
  is_active: boolean;
  credential_id: number | null;
}

export interface SyncJob {
  id: number;
  job_type: string;
  marketplace: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  started_at: Date | null;
  completed_at: Date | null;
  records_processed: number;
  error_message: string | null;
}

export interface RawOrder {
  marketplace_id: string;
  channel: string;
  amazon_order_id: string;
  purchase_date: Date;
  purchase_date_local: string;
  sku: string;
  asin: string;
  iwasku: string | null;
  quantity: number;
  item_price: number;
  currency: string;
  order_status: string;
  fulfillment_channel: string;
}

export interface FbaInventoryItem {
  warehouse: string;
  marketplace_id: string;
  sku: string;
  asin: string;
  fnsku: string;
  iwasku: string | null;
  fulfillable_quantity: number;
  total_reserved_quantity: number;
  pending_customer_order_quantity: number;
  pending_transshipment_quantity: number;
  fc_processing_quantity: number;
  total_unfulfillable_quantity: number;
  customer_damaged_quantity: number;
  warehouse_damaged_quantity: number;
  distributor_damaged_quantity: number;
  inbound_shipped_quantity: number;
  inbound_working_quantity: number;
  inbound_receiving_quantity: number;
}

// AmzSellMetrics-compatible financial transaction
export interface FinancialTransaction {
  transaction_id: string;
  file_name: string;
  transaction_date: Date;
  date_only: string;
  type: string;
  category_type: string;
  order_id: string;
  sku: string;
  description: string;
  marketplace: string;
  marketplace_code: string;
  fulfillment: string;
  order_postal: string;
  quantity: number;
  product_sales: number;
  promotional_rebates: number;
  selling_fees: number;
  fba_fees: number;
  other_transaction_fees: number;
  other: number;
  vat: number;
  liquidations: number;
  total: number;
  credential_id: number | null;
  // Finances API v2024-06-19 additions (DD+7 deferred reserve rollout, Apr 2026)
  transaction_status?: string | null;
  maturity_date?: Date | null;
  deferral_reason?: string | null;
}

// StockPulse-compatible sales response item
export interface SalesResponseItem {
  iwasku: string;
  asin: string;
  last7: number;
  last30: number;
  last90: number;
  last180: number;
  last366: number;
  preYearLast7: number;
  preYearLast30: number;
  preYearLast90: number;
  preYearLast180: number;
  preYearLast365: number;
  preYearNext7: number;
  preYearNext30: number;
  preYearNext90: number;
  preYearNext180: number;
}

// Review tracking types
export interface TrackedAsin {
  id: number;
  asin: string;
  country_code: string;
  label: string | null;
  is_active: boolean;
}

export interface ProductReview {
  id: number;
  asin: string;
  country_code: string;
  rating: number | null;
  review_count: number;
  last_review_text: string | null;
  last_review_title: string | null;
  last_review_rating: number | null;
  last_review_date: string | null;
  last_review_author: string | null;
  is_blocked: boolean;
  block_count: number;
  checked_at: Date | null;
}

export interface ReviewHistory {
  id: number;
  asin: string;
  country_code: string;
  rating: number | null;
  review_count: number;
  recorded_at: Date;
}

export interface FbaInventoryAgingItem {
  warehouse: string;
  marketplace_id: string;
  snapshot_date: string | null;
  sku: string;
  fnsku: string | null;
  asin: string | null;
  iwasku: string | null;
  product_name: string | null;
  condition: string | null;
  available_quantity: number;
  qty_with_removals_in_progress: number;
  inv_age_0_to_90_days: number;
  inv_age_91_to_180_days: number;
  inv_age_181_to_270_days: number;
  inv_age_271_to_365_days: number;
  inv_age_366_to_455_days: number;
  inv_age_456_plus_days: number;
  currency: string | null;
  estimated_storage_cost_next_month: number;
  units_shipped_last_7_days: number;
  units_shipped_last_30_days: number;
  units_shipped_last_60_days: number;
  units_shipped_last_90_days: number;
  recommended_removal_quantity: number;
  alert: string | null;
  your_price: number | null;
  sales_price: number | null;
  sell_through: number | null;
  storage_type: string | null;
  recommended_action: string | null;
  days_of_supply: number | null;
  estimated_excess_quantity: number;
  weeks_of_cover_t30: number | null;
  weeks_of_cover_t90: number | null;
  no_sale_last_6_months: number;
  inbound_quantity: number;
  sales_rank: number | null;
  product_group: string | null;
}

// StockPulse-compatible inventory response item
export interface InventoryResponseItem {
  iwasku: string;
  asin: string;
  fnsku: string;
  fulfillable_quantity: number;
  total_reserved_quantity: number;
  pending_customer_order_quantity: number;
  pending_transshipment_quantity: number;
  fc_processing_quantity: number;
  total_unfulfillable_quantity: number;
  customer_damaged_quantity: number;
  warehouse_damaged_quantity: number;
  distributor_damaged_quantity: number;
  inbound_shipped_quantity: number;
  inbound_working_quantity: number;
  inbound_receiving_quantity: number;
}
