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
