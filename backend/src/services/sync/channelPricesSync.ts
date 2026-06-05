import { pool, sharedPool } from '../../config/database';
import logger from '../../config/logger';
import { notify } from '../../utils/notify';
import { getSafetyDropThreshold } from '../../utils/safetyThreshold';
import { getActiveAccounts } from '../walmart/client';
import { fetchAllItems } from '../walmart/items';
import { fetchMerchantListings } from '../spApi/listings';
import type { MarketplaceConfig } from '../../types';

/**
 * PriceLab "Fiyat Kiyas" (channel_prices, pricelab_db) icin canli listing fiyati sync'i.
 * - Amazon US: GET_MERCHANT_LISTINGS_ALL_DATA -> amazon_fba / amazon_fbm
 * - Walmart:   GET /v3/items                  -> walmart
 * Manuel CSV upload yerine otomatik; eski seed/CSV satirlarini ayni anahtarla gunceller.
 */

interface PriceRow {
  marketplace_sku: string;
  price: number | null;
  status: string | null;
  extra: Record<string, unknown> | null;
}

/** SKU -> iwasku (sku/asin/fnsku/iwasku + products.product_sku). walmartOrdersSync ile ayni mantik. */
async function resolveIwaskuMap(skus: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (skus.length === 0) return map;
  const res = await sharedPool.query<{ lookup_key: string; iwasku: string }>(
    `SELECT DISTINCT ON (lookup_key) lookup_key, iwasku FROM (
       SELECT sku    AS lookup_key, iwasku, marketplace, 1 AS priority
         FROM sku_master WHERE iwasku IS NOT NULL AND sku = ANY($1)
       UNION ALL
       SELECT asin   AS lookup_key, iwasku, marketplace, 2 AS priority
         FROM sku_master WHERE iwasku IS NOT NULL AND asin = ANY($1)
       UNION ALL
       SELECT fnsku  AS lookup_key, iwasku, marketplace, 3 AS priority
         FROM sku_master WHERE iwasku IS NOT NULL AND fnsku = ANY($1)
       UNION ALL
       SELECT iwasku AS lookup_key, iwasku, marketplace, 4 AS priority
         FROM sku_master WHERE iwasku IS NOT NULL AND iwasku = ANY($1)
       UNION ALL
       SELECT product_sku AS lookup_key, product_sku AS iwasku, 'catalog' AS marketplace, 5 AS priority
         FROM products WHERE product_sku IS NOT NULL AND product_sku = ANY($1)
     ) u
     ORDER BY lookup_key, priority`,
    [skus],
  );
  for (const row of res.rows) map.set(row.lookup_key, row.iwasku);
  return map;
}

/**
 * channel_prices'a (pricelab_db) upsert. Manuel eslestirme (resolved_by='L3_mapping')
 * olan satirlarin iwasku'sunu KORUR (fiyati yine gunceller). Safety threshold ile
 * suspheli kuculmelerde yazmayi atlar.
 */
async function upsertChannelPrices(
  channelCode: string,
  countryCode: string,
  rows: PriceRow[],
  source: string,
): Promise<number> {
  if (rows.length === 0) {
    logger.info(`[ChannelPrices] ${channelCode}/${countryCode}: 0 satir, atlaniyor`);
    return 0;
  }

  // Safety: yeni veri mevcut verinin threshold'undan az ise yazma
  const existing = await sharedPool.query<{ cnt: string }>(
    'SELECT COUNT(*)::text AS cnt FROM channel_prices WHERE channel_code = $1 AND country_code = $2',
    [channelCode, countryCode],
  );
  const existingCount = parseInt(existing.rows[0].cnt, 10);
  const threshold = getSafetyDropThreshold('CHANNEL_PRICES');
  if (existingCount > 10 && rows.length < existingCount * threshold) {
    const msg = `[ChannelPrices] ${channelCode}/${countryCode} SKIPPED — ${rows.length} vs ${existingCount} mevcut (threshold ${threshold})`;
    logger.error(msg);
    await notify(`⚠️ ${msg}`);
    return 0;
  }

  const iwaskuMap = await resolveIwaskuMap([...new Set(rows.map(r => r.marketplace_sku))]);

  const CHUNK = 500;
  let written = 0;
  const client = await sharedPool.connect();
  try {
    await client.query('BEGIN');
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      const values: unknown[] = [];
      const placeholders: string[] = [];
      chunk.forEach((row, idx) => {
        const b = idx * 9;
        placeholders.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8}::jsonb,$${b + 9},NOW(),NOW())`);
        const iwasku = iwaskuMap.get(row.marketplace_sku) ?? null;
        const resolvedBy = iwasku ? (iwasku === row.marketplace_sku ? 'L1_direct' : 'L2_sku_master') : null;
        values.push(
          channelCode,
          countryCode,
          row.marketplace_sku,
          iwasku,
          resolvedBy,
          row.price,
          row.status,
          row.extra ? JSON.stringify(row.extra) : null,
          source,
        );
      });

      const sql = `
        INSERT INTO channel_prices
          (channel_code, country_code, marketplace_sku, iwasku, resolved_by, price, status, extra, source, captured_at, updated_at)
        VALUES ${placeholders.join(',')}
        ON CONFLICT (channel_code, country_code, marketplace_sku) DO UPDATE SET
          price       = EXCLUDED.price,
          status      = EXCLUDED.status,
          extra       = EXCLUDED.extra,
          source      = EXCLUDED.source,
          iwasku      = CASE WHEN channel_prices.resolved_by = 'L3_mapping' THEN channel_prices.iwasku ELSE EXCLUDED.iwasku END,
          resolved_by = CASE WHEN channel_prices.resolved_by = 'L3_mapping' THEN 'L3_mapping' ELSE EXCLUDED.resolved_by END,
          captured_at = NOW(),
          updated_at  = NOW()
      `;
      const r = await client.query(sql, values);
      written += r.rowCount ?? 0;
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  logger.info(`[ChannelPrices] ${channelCode}/${countryCode}: ${written} satir yazildi (${rows.length} cekildi)`);
  return written;
}

/** Amazon US listing fiyatlari -> amazon_fba + amazon_fbm */
export async function syncAmazonListingPrices(): Promise<number> {
  const mpRes = await pool.query<MarketplaceConfig>(
    "SELECT * FROM marketplace_config WHERE country_code = 'US' AND is_active = true LIMIT 1",
  );
  if (mpRes.rows.length === 0) {
    logger.warn('[ChannelPrices] US marketplace_config bulunamadi, Amazon atlaniyor');
    return 0;
  }
  const listings = await fetchMerchantListings(mpRes.rows[0]);

  const toRow = (l: { sku: string; asin: string | null; price: number | null; status: string | null }): PriceRow => ({
    marketplace_sku: l.sku,
    price: l.price,
    status: l.status,
    extra: l.asin ? { asin: l.asin } : null,
  });

  const fba = listings.filter(l => l.fulfillment === 'FBA').map(toRow);
  const fbm = listings.filter(l => l.fulfillment === 'FBM').map(toRow);

  let total = 0;
  total += await upsertChannelPrices('amazon_fba', 'US', fba, 'spapi');
  total += await upsertChannelPrices('amazon_fbm', 'US', fbm, 'spapi');
  return total;
}

/** Walmart listing fiyatlari -> walmart (US) */
export async function syncWalmartListingPrices(): Promise<number> {
  const accounts = await getActiveAccounts();
  if (accounts.length === 0) {
    logger.info('[ChannelPrices] Walmart aktif hesap yok, atlaniyor');
    return 0;
  }
  // Tum hesaplarin item'larini birlestir (genelde tek US hesabi)
  const all: PriceRow[] = [];
  for (const account of accounts) {
    try {
      const items = await fetchAllItems(account);
      for (const it of items) {
        all.push({
          marketplace_sku: it.sku,
          price: it.price,
          status: it.status,
          extra: { wpid: it.wpid, gtin: it.gtin },
        });
      }
    } catch (err: any) {
      logger.error(`[ChannelPrices] Walmart '${account.label}' items fetch failed: ${err.message}`);
    }
  }
  // Ayni SKU birden fazla hesaptan gelirse sonuncusu kazanir (dedup)
  const dedup = new Map<string, PriceRow>();
  for (const r of all) dedup.set(r.marketplace_sku, r);
  return upsertChannelPrices('walmart', 'US', [...dedup.values()], 'walmart_api');
}

/** Birlesik job — Amazon + Walmart canli listing fiyatlari. */
export async function runChannelPricesSync(): Promise<number> {
  let total = 0;
  try {
    total += await syncAmazonListingPrices();
  } catch (err: any) {
    logger.error(`[ChannelPrices] Amazon listing sync failed: ${err.message}`);
  }
  try {
    total += await syncWalmartListingPrices();
  } catch (err: any) {
    logger.error(`[ChannelPrices] Walmart listing sync failed: ${err.message}`);
  }
  return total;
}
