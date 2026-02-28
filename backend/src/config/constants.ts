export const DB_MAX_CONNECTIONS = 15;
export const DB_IDLE_TIMEOUT_MS = 30_000;
export const DB_CONNECTION_TIMEOUT_MS = 5_000;

export const SHARED_DB_MAX_CONNECTIONS = 5;

export const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 min
export const RATE_LIMIT_MAX_REQUESTS = 200;

export const SYNC_INVENTORY_CRON = '0 */4 * * *'; // Every 4 hours
export const SYNC_SALES_CRON = '0 3 * * *';        // Daily at 03:00 UTC
export const SALES_OVERLAP_DAYS = 2;                // Fetch last 2 days for overlap

export const SP_API_REGIONS = {
  NA: { endpoint: 'https://sellingpartnerapi-na.amazon.com', awsRegion: 'us-east-1' },
  EU: { endpoint: 'https://sellingpartnerapi-eu.amazon.com', awsRegion: 'eu-west-1' },
  FE: { endpoint: 'https://sellingpartnerapi-fe.amazon.com', awsRegion: 'us-west-2' },
} as const;

export const MARKETPLACE_IDS: Record<string, string> = {
  US: 'ATVPDKIKX0DER',
  CA: 'A2EUQ1WTGCTBG2',
  UK: 'A1F83G8C2ARO7P',
  DE: 'A1PA6795UKMFR9',
  FR: 'A13V1IB3VIYZZH',
  IT: 'APJ6JRA9NG5V4',
  ES: 'A1RKKUPIHCS9HS',
  AU: 'A39IBJ37TRP1C6',
  AE: 'A2VIGQ35RCS4UG',
  SA: 'A17E79C6D8DWNP',
};

// Channel → warehouse mapping (StockPulse uyumlu)
export const CHANNEL_WAREHOUSE_MAP: Record<string, string> = {
  us: 'US',
  ca: 'CA',
  uk: 'UK',
  de: 'EU',
  fr: 'EU',
  it: 'EU',
  es: 'EU',
  au: 'AU',
};

// Marketplace → channel mapping
export const MARKETPLACE_CHANNEL_MAP: Record<string, string> = {
  ATVPDKIKX0DER: 'us',
  A2EUQ1WTGCTBG2: 'ca',
  A1F83G8C2ARO7P: 'uk',
  A1PA6795UKMFR9: 'de',
  A13V1IB3VIYZZH: 'fr',
  APJ6JRA9NG5V4: 'it',
  A1RKKUPIHCS9HS: 'es',
  A39IBJ37TRP1C6: 'au',
};

// Timezone offsets for marketplace date conversion
export const MARKETPLACE_TIMEZONE_OFFSETS: Record<string, number> = {
  us: -8,
  ca: -8,
  uk: 0,
  de: 1,
  fr: 1,
  it: 1,
  es: 1,
  au: 10,
  ae: 4,
  sa: 3,
};
