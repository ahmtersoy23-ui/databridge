import { sharedPool } from '../config/database';
import logger from '../config/logger';

interface SkuMapping {
  sku: string;
  iwasku: string;
  asin: string;
  country_code: string;
}

// In-memory cache for SKU mappings
let skuCache: Map<string, SkuMapping> | null = null;
let cacheLoadedAt = 0;
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

export async function loadSkuMappings(): Promise<Map<string, SkuMapping>> {
  if (skuCache && Date.now() - cacheLoadedAt < CACHE_TTL) {
    return skuCache;
  }

  const result = await sharedPool.query(
    'SELECT sku, iwasku, asin, country_code FROM sku_master WHERE marketplace = $1',
    ['amazon']
  );

  const map = new Map<string, SkuMapping>();
  for (const row of result.rows) {
    // Key: "sku|country_code" for precise matching
    const key = `${row.sku}|${row.country_code}`;
    map.set(key, row);
    // Also index by just SKU for fallback
    if (!map.has(row.sku)) {
      map.set(row.sku, row);
    }
  }

  skuCache = map;
  cacheLoadedAt = Date.now();
  logger.info(`[SKU Mapper] Loaded ${result.rows.length} SKU mappings from sku_master`);
  return map;
}

export async function mapSkuToIwasku(sku: string, countryCode: string): Promise<string | null> {
  const mappings = await loadSkuMappings();

  // Try precise match first: sku + country_code
  const preciseKey = `${sku}|${countryCode.toUpperCase()}`;
  const precise = mappings.get(preciseKey);
  if (precise) return precise.iwasku;

  // Fallback: just SKU
  const fallback = mappings.get(sku);
  if (fallback) return fallback.iwasku;

  return null;
}

export async function mapBulkSkusToIwasku(
  items: Array<{ sku: string; countryCode: string }>
): Promise<Map<string, string | null>> {
  const mappings = await loadSkuMappings();
  const result = new Map<string, string | null>();

  for (const item of items) {
    const preciseKey = `${item.sku}|${item.countryCode.toUpperCase()}`;
    const precise = mappings.get(preciseKey);
    if (precise) {
      result.set(item.sku, precise.iwasku);
    } else {
      const fallback = mappings.get(item.sku);
      result.set(item.sku, fallback?.iwasku || null);
    }
  }

  return result;
}

export function invalidateSkuCache(): void {
  skuCache = null;
  cacheLoadedAt = 0;
}
