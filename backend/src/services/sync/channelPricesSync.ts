import { pool, sharedPool } from '../../config/database';
import { errMessage } from '../../utils/errors';
import logger from '../../config/logger';
import { notify } from '../../utils/notify';
import { getSafetyDropThreshold } from '../../utils/safetyThreshold';
import { getActiveAccounts } from '../walmart/client';
import { fetchAllItemsViaReport } from '../walmart/itemReport';
import { fetchMerchantListings } from '../spApi/listings';
import type { MarketplaceConfig } from '../../types';

/**
 * PriceLab "Fiyat Kiyas" (channel_prices, pricelab_db) icin canli listing fiyati sync'i.
 * - Amazon US: GET_MERCHANT_LISTINGS_ALL_DATA -> amazon_fba / amazon_fbm
 * - Walmart:   ITEM raporu (Reports API)      -> walmart
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

  // GTIN/EAN'i bu fonksiyon GORMEZ (sadece SKU). EAN fallback upsertChannelPrices'ta
  // resolveIwaskuByEan ile ayri yapilir (SKU eslesmeyen — or. "Antrasit"/"Ceviz" renk-adi
  // Walmart SKU'lari — rapor GTIN'i verir → products.eans → iwasku).

  // Prefix fallback: tam SKU eslesmeyenlerde "-"/"_" oncesi parca gecerli bir
  // product_sku ise onu kullan. Varyant SKU'lari (or. IM299009QB7W_MS_L,
  // DS027004CRSP-GRAPHITE-P9) sku_master'a girmeden cozulur. >=6 char guard:
  // kisa/numerik prefix'lerde (5N, SSC, 3DMAP05, numerik) yanlis eslesme olmasin.
  const unresolved = skus.filter((s) => !map.has(s));
  if (unresolved.length) {
    const prefixOf = (s: string) => s.split(/[-_]/)[0];
    const prefixes = [...new Set(unresolved.map(prefixOf).filter((p) => p.length >= 6))];
    if (prefixes.length) {
      const pres = await sharedPool.query<{ product_sku: string }>(
        'SELECT product_sku FROM products WHERE product_sku = ANY($1)',
        [prefixes],
      );
      const validPrefix = new Set(pres.rows.map((r) => r.product_sku));
      for (const s of unresolved) {
        const p = prefixOf(s);
        if (validPrefix.has(p)) map.set(s, p);
      }
    }
  }
  return map;
}

/** GTIN/EAN'i normalize et: rakam-disi ve bastaki sifirlari at (GTIN-14 "08684..." → EAN-13 "8684..."). */
function normEan(raw: string): string {
  return raw.replace(/\D/g, '').replace(/^0+/, '');
}

/**
 * SKU ile cozulemeyen satirlar icin GTIN→EAN fallback: rapor GTIN'i (channel_prices.extra.gtin)
 * → pricelab.products.eans → product_sku (=iwasku). Walmart'ta merchant SKU'su saçma (renk adi
 * gibi) olsa bile GTIN katalog EAN'ine eslesirse iwasku cozulur. Donen Map: normEan → iwasku.
 */
async function resolveIwaskuByEan(gtins: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const cleaned = [...new Set(gtins.map(normEan).filter((e) => e.length >= 8))];
  if (cleaned.length === 0) return map;
  const res = await sharedPool.query<{ ean: string; product_sku: string }>(
    `SELECT ltrim(regexp_replace(ean, '\\D', '', 'g'), '0') AS ean, product_sku
       FROM products, jsonb_array_elements_text(eans) AS ean
      WHERE product_sku IS NOT NULL
        AND ltrim(regexp_replace(ean, '\\D', '', 'g'), '0') = ANY($1)`,
    [cleaned],
  );
  for (const row of res.rows) if (!map.has(row.ean)) map.set(row.ean, row.product_sku);
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
  pruneStale = true,   // false ise full-snapshot delete-stale calismaz (eksik pull guvenligi)
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

  // SKU ile cozulemeyenler icin GTIN→EAN fallback (or. Walmart renk-adi SKU'lari).
  const gtinOf = (r: PriceRow) => (typeof r.extra?.gtin === 'string' ? r.extra.gtin : null);
  const unresolvedGtins = rows
    .filter((r) => !iwaskuMap.has(r.marketplace_sku))
    .map(gtinOf)
    .filter((g): g is string => !!g);
  const eanMap = unresolvedGtins.length ? await resolveIwaskuByEan(unresolvedGtins) : new Map<string, string>();

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
        const skuIwasku = iwaskuMap.get(row.marketplace_sku) ?? null;
        const gtin = gtinOf(row);
        const eanIwasku = !skuIwasku && gtin ? eanMap.get(normEan(gtin)) ?? null : null;
        const iwasku = skuIwasku ?? eanIwasku;
        const resolvedBy = skuIwasku
          ? (skuIwasku === row.marketplace_sku ? 'L1_direct' : 'L2_sku_master')
          : (eanIwasku ? 'L2_ean' : null);
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

    // Full-snapshot semantigi: bu kanal+ulke icin bu run'da DOKUNULMAYAN satirlari sil.
    // Postgres NOW() transaction boyunca sabittir; yeni upsert'lenen satirlarin
    // captured_at'i = NOW(), eski (seed / artik listede olmayan / inactive olmus /
    // bayat csv_import) satirlar < NOW() -> silinir. Manuel eslestirmeler korunur.
    // pruneStale=false ise (eksik/partial pull) bu adim atlanir -> veri kaybi olmaz.
    if (pruneStale) {
      const del = await client.query(
        `DELETE FROM channel_prices
         WHERE channel_code = $1 AND country_code = $2
           AND captured_at < NOW()
           AND COALESCE(resolved_by, '') <> 'L3_mapping'`,
        [channelCode, countryCode],
      );
      if ((del.rowCount ?? 0) > 0) {
        logger.info(`[ChannelPrices] ${channelCode}/${countryCode}: ${del.rowCount} bayat satir temizlendi`);
      }
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
  let allComplete = true; // bir hesap bile eksik/hata ise delete-stale yapma
  for (const account of accounts) {
    try {
      const { items, complete } = await fetchAllItemsViaReport(account);
      if (!complete) allComplete = false;
      for (const it of items) {
        all.push({
          marketplace_sku: it.sku,
          price: it.price,
          status: it.status,
          extra: { wpid: it.wpid, gtin: it.gtin, fulfillmentType: it.fulfillmentType },
        });
      }
    } catch (err: unknown) {
      logger.error(`[ChannelPrices] Walmart '${account.label}' items fetch failed: ${errMessage(err)}`);
      allComplete = false;
    }
  }
  if (!allComplete) {
    logger.warn('[ChannelPrices] Walmart pull eksik — delete-stale atlaniyor (veri kaybini onlemek icin)');
  }
  // Ayni SKU birden fazla hesaptan gelirse sonuncusu kazanir (dedup)
  const dedup = new Map<string, PriceRow>();
  for (const r of all) dedup.set(r.marketplace_sku, r);
  return upsertChannelPrices('walmart', 'US', [...dedup.values()], 'walmart_api', allComplete);
}

/** Birlesik job — Amazon + Walmart canli listing fiyatlari. */
export async function runChannelPricesSync(): Promise<number> {
  let total = 0;
  try {
    total += await syncAmazonListingPrices();
  } catch (err: unknown) {
    logger.error(`[ChannelPrices] Amazon listing sync failed: ${errMessage(err)}`);
  }
  try {
    total += await syncWalmartListingPrices();
  } catch (err: unknown) {
    logger.error(`[ChannelPrices] Walmart listing sync failed: ${errMessage(err)}`);
  }
  return total;
}
