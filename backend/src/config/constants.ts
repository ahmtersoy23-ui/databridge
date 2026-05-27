export const DB_MAX_CONNECTIONS = 15;
export const DB_IDLE_TIMEOUT_MS = 30_000;
export const DB_CONNECTION_TIMEOUT_MS = 5_000;

export const SHARED_DB_MAX_CONNECTIONS = 10;

export const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 min
export const RATE_LIMIT_MAX_REQUESTS = 200;

export const SYNC_INVENTORY_CRON = '0 */8 * * *'; // Every 8 hours
export const SYNC_SALES_CRON = '0 3 * * *';        // Daily at 03:00 UTC
export const SYNC_NJ_WAREHOUSE_CRON = '0 */8 * * *'; // Every 8 hours
export const SYNC_WISERSELL_CRON = '0 4,12,20 * * *'; // Every 8h at 04:00, 12:00, 20:00 UTC (offset from inventory/NJ at 00/08/16)
export const SYNC_WAYFAIR_CRON = '0 1,9,17 * * *';    // Every 8h at 01:00, 09:00, 17:00 UTC
export const SALES_OVERLAP_DAYS = 5;                // Fetch last 5 days for overlap
export const SYNC_TRANSACTIONS_CRON = '0 5 * * *';  // Daily at 05:00 UTC
export const TRANSACTION_OVERLAP_DAYS = 35;          // Fetch last 35 days (settlement delays)
export const SYNC_ADS_CRON = '0 6 * * *';           // Daily at 06:00 UTC (after transactions)
export const SYNC_AGING_CRON = '0 2 * * *';          // Daily at 02:00 UTC (once per 24h — Amazon limit)
export const SYNC_SKU_MASTER_DIFF_CRON = '0 0 * * 0'; // Weekly Sunday 00:00 UTC
export const SYNC_BUSINESS_REPORT_CRON = '0 7 * * *'; // Daily at 07:00 UTC (after ads sync)
export const SYNC_CAMPAIGN_SNAPSHOT_CRON = '30 6 * * *'; // Daily at 06:30 UTC (during ads sync window)
export const SYNC_BRAND_ANALYTICS_CRON = '0 8 * * 1'; // Weekly Monday 08:00 UTC
export const SYNC_SB_ADS_CRON = '45 6 * * *';         // Daily at 06:45 UTC (after SP ads at 06:00) (previous week data)
export const SYNC_SD_ADS_CRON = '15 7 * * *';         // Daily at 07:15 UTC (after SB at 06:45)
export const DATA_QUALITY_CRON = '0 9 * * *';          // Daily at 09:00 UTC (after all syncs complete)
export const FEE_RATES_CRON = '0 10 3 * *';            // Monthly 3rd day at 10:00 UTC
// Wisersell sabah 04:30'da tek run (yeni tracking'ler oms_shipments'a).
// FedEx Track 4x/gün, iki ayrı job ismiyle (sync_log baseline'ı doğru karşılaşsın diye):
//   - FULL (05/17 UTC): 6 saatten eski açık tracking'ler de dahil → ~500-750 satır
//   - DELTA (11/23 UTC): sadece fedex_synced_at IS NULL yeni eklenenler → ~0-130 satır
// İş mantığı aynı (runFedexSync), sadece iki ayrı sync_log entry'si.
export const SYNC_WISERSELL_SHIPMENT_CRON = '30 4 * * *';        // 04:30 UTC (07:30 TR)
export const SYNC_FEDEX_TRACK_FULL_CRON   = '0 5,17 * * *';      // 05/17 UTC — open tracking refresh dahil
export const SYNC_FEDEX_TRACK_DELTA_CRON  = '0 11,23 * * *';     // 11/23 UTC — yeni shipment delta
export const SYNC_WISERSELL_ORDERS_CRON   = '0 9 * * *';          // 09:00 UTC (12:00 TR) — ABD gecesi, son 14 gün rolling
// Pending sync (open + ready_to_ship) — closed sync'in 15 dk arkasından. Stok istatistiği için günde 1 snapshot yeterli.
export const SYNC_WISERSELL_PENDING_CRON  = '15 9 * * *';         // 09:15 UTC (12:15 TR) — closed sync 09:00'da bitince

// Walmart Marketplace orders sync — daily after Amazon sales window.
// Token TTL 15 dk, max 200 limit/page, son 30 gün rolling (kullanıcı tercihi).
export const SYNC_WALMART_ORDERS_CRON = '0 4 * * *';              // 04:00 UTC (Amazon sales 03:00'ten sonra)

// Bol.com Retailer orders sync (Pera + OneBV, FBR fulfilment).
// Token TTL 299s, max 3 ay history, az volume (~3 siparis/gun toplam).
export const SYNC_BOL_ORDERS_CRON = '15 4 * * *';                 // 04:15 UTC (Walmart'tan 15dk sonra)

// Takealot Seller API (single account ZA). API key auth, /v2/sales + /v2/offers.
export const SYNC_TAKEALOT_CRON = '45 4 * * *';                   // 04:45 UTC (Bol'dan 30dk sonra)

// Kaufland Marketplace Seller API (HMAC-SHA256 auth, /v2/orders + /v2/units).
// Detail-per-order pattern (~600ms throttle), modest volume.
export const SYNC_KAUFLAND_CRON = '0 5 * * *';                    // 05:00 UTC (Takealot'tan 15dk sonra)
// Review tracking runs locally (residential IP) via launchd — no server cron needed

// Wisersell status code haritası (Excel /api/excel/order query filtresinden gözlemlendi)
// Wisersell tarafında değişirse buradan ayarlanır — magic number yok.
export const WISERSELL_STATUS_CODES: Record<'open' | 'ready_to_ship' | 'closed', number[]> = {
  open:          [2, 6],   // /ws/order/open — yeni gelen, henüz işleme alınmamış
  ready_to_ship: [11],     // /ws/order/waiting — kargoya hazır, sevkiyat bekliyor
  closed:        [5, 8],   // /ws/order/closed — kapalı + teslim edildi
};

// Wisersell Amazon platformları — sales_data'da zaten kapsama alındığı için pending sync'te dışlanır.
// Sadece sales_data'da olmayan iki Amazon kanalı (CITI = ayrı seller hesabı, SGP = SP-API kapsamı dışı) dahil edilir.
export const WISERSELL_AMAZON_PLATFORMS_DUPLICATE = new Set<string>([
  'Ama_US', 'AMA_CA', 'AMA_UK', 'AMA_Alm', 'Ama_BAE', 'AMA_Fra', 'AMA_ita',
  'AMA_isp', 'AmaAvust', 'Amazon_SA', 'AMA_Bel', 'AMA_Hol', 'AMA_isv',
  'AMA_Pol', 'Ama_Tr', 'Amazon_IRL',
]);
export const WISERSELL_AMAZON_PLATFORMS_KEEP = new Set<string>(['Ama_CITI', 'Ama_SGP']);

function parseEnvInt(envName: string, def: number, min: number, max: number): number {
  const raw = process.env[envName];
  if (raw === undefined) return def;
  const n = parseInt(raw, 10);
  if (Number.isFinite(n) && n >= min && n <= max) return n;
  return def;
}

/**
 * Pending snapshot retention — default 30 gün trend için yeterli, sonrası silinir.
 * Sezonsal yoğunluk (Q4 holiday backlog) için WISERSELL_PENDING_RETENTION_DAYS env ile gevşetilir.
 * Lazy getter — module yükleme sırası dotenv.config()'i bekler.
 */
export function getWisersellPendingRetentionDays(): number {
  return parseEnvInt('WISERSELL_PENDING_RETENTION_DAYS', 30, 1, 365);
}

/**
 * Stale işaretleme: sipariş tarihi N günden eskiyse "stale" (operasyonel kapanmamış hayalet).
 * WISERSELL_PENDING_STALE_AGE_DAYS env ile override.
 */
export function getWisersellPendingStaleAgeDays(): number {
  return parseEnvInt('WISERSELL_PENDING_STALE_AGE_DAYS', 90, 1, 730);
}

export const NJ_WAREHOUSE_CSV_URL = 'https://iwarden.iwaconcept.com/iwabot/warehouse/report.php?csv=1';

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
  ae: 'AE',
  sa: 'SA',
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
  A2VIGQ35RCS4UG: 'ae',
  A17E79C6D8DWNP: 'sa',
};

// Amazon sales-channel → internal channel mapping
export const SALES_CHANNEL_TO_CHANNEL: Record<string, string> = {
  'Amazon.com': 'us',
  'Amazon.ca': 'ca',
  'Amazon.co.uk': 'uk',
  'Amazon.de': 'de',
  'Amazon.fr': 'fr',
  'Amazon.it': 'it',
  'Amazon.es': 'es',
  'Amazon.com.au': 'au',
  'Amazon.ae': 'ae',
  'Amazon.sa': 'sa',
  'Amazon.se': 'se',
  'Amazon.nl': 'nl',
  'Amazon.pl': 'pl',
  'Amazon.com.be': 'be',
  'Amazon.com.tr': 'tr',
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
  others: 1,
};
