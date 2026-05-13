import { sharedPool, pool } from '../../config/database';
import logger from '../../config/logger';

/**
 * Wisersell siparişleri için iwasku resolution — 4 katmanlı fallback chain.
 *
 * Cargolens'in (apps/cargolens/backend/src/routes/invoices.ts) kullandığı zincir
 * burada batch-friendly halde:
 *   L1: urun_kodu / sku → products.product_sku           (en güçlü, doğrudan iwasku)
 *   L2: sku_master.sku VEYA .asin → iwasku                (Amazon MSKU/ASIN)
 *   L3: wisersell_sku_mappings.marketplace_sku → iwasku   (manuel eşleşmeler)
 *   L4: urun_basligi → products.name birebir              (title match — memory'de "en güçlü fallback")
 *
 * Hesaplama %99.93 kapsama veriyor (2026-05-12 analizi, 75K → 53 unmatched).
 * Resolution değişmez veri üzerinde çalışır (sku_master, products, mappings),
 * sync sırasında tek seferlik hesap ucuzdur.
 */

interface ResolverDictionaries {
  iwasku: Set<string>;                // products.product_sku
  skuMasterSku: Map<string, string>;  // sku_master.sku → iwasku
  skuMasterAsin: Map<string, string>; // sku_master.asin → iwasku
  woMappings: Map<string, string>;    // wisersell_sku_mappings.marketplace_sku → iwasku
  productName: Map<string, string>;   // products.name → product_sku
}

let cachedDicts: ResolverDictionaries | null = null;
let cacheLoadedAt = 0;
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 dk

export function clearResolverCache(): void {
  cachedDicts = null;
  cacheLoadedAt = 0;
}

async function loadDictionaries(): Promise<ResolverDictionaries> {
  if (cachedDicts && Date.now() - cacheLoadedAt < CACHE_TTL_MS) {
    return cachedDicts;
  }

  // Paralel sözlük yüklemesi (3 pricelab + 1 databridge query)
  const [productsRes, skuMasterRes, woMappingsRes] = await Promise.all([
    sharedPool.query<{ product_sku: string; name: string | null }>(
      'SELECT product_sku, name FROM products WHERE product_sku IS NOT NULL',
    ),
    sharedPool.query<{ sku: string | null; asin: string | null; iwasku: string }>(
      `SELECT DISTINCT ON (key) key, iwasku FROM (
         SELECT sku   AS key, iwasku FROM sku_master WHERE sku   IS NOT NULL AND iwasku IS NOT NULL
         UNION ALL
         SELECT asin  AS key, iwasku FROM sku_master WHERE asin  IS NOT NULL AND iwasku IS NOT NULL
       ) t
       ORDER BY key, iwasku`,
    ),
    pool.query<{ marketplace_sku: string; iwasku: string }>(
      `SELECT marketplace_sku, iwasku
       FROM wisersell_sku_mappings
       WHERE iwasku IS NOT NULL AND marketplace_sku IS NOT NULL`,
    ),
  ]);

  // Index'leri kur
  const iwasku = new Set<string>();
  const productName = new Map<string, string>();
  for (const row of productsRes.rows) {
    iwasku.add(row.product_sku);
    if (row.name && !productName.has(row.name)) {
      productName.set(row.name, row.product_sku);
    }
  }

  // Tek bir map — UNION ALL sayesinde hem sku hem asin → iwasku
  const skuMasterSku = new Map<string, string>();
  const skuMasterAsin = new Map<string, string>();
  // İkili map iç içe değil; aslında UNION sonucu tek map'te tutulabilir ama
  // istatistik/audit için ayrı tutalım. Yeniden sorgu ile ayrılalım — küçük ek yük:
  const smSepRes = await sharedPool.query<{ sku: string | null; asin: string | null; iwasku: string }>(
    `SELECT sku, asin, iwasku FROM sku_master WHERE iwasku IS NOT NULL`,
  );
  for (const row of smSepRes.rows) {
    if (row.sku && !skuMasterSku.has(row.sku)) skuMasterSku.set(row.sku, row.iwasku);
    if (row.asin && !skuMasterAsin.has(row.asin)) skuMasterAsin.set(row.asin, row.iwasku);
  }

  const woMappings = new Map<string, string>();
  for (const row of woMappingsRes.rows) {
    if (!woMappings.has(row.marketplace_sku)) {
      woMappings.set(row.marketplace_sku, row.iwasku);
    }
  }

  // skuMasterRes aslında L2 birleşik sözlük — yedek olarak da tutalım
  void skuMasterRes;

  cachedDicts = { iwasku, skuMasterSku, skuMasterAsin, woMappings, productName };
  cacheLoadedAt = Date.now();
  logger.info(
    `[IwaskuResolver] Sözlük yüklendi: iwasku=${iwasku.size}, ` +
    `sku_master.sku=${skuMasterSku.size}, sku_master.asin=${skuMasterAsin.size}, ` +
    `wo_mappings=${woMappings.size}, products.name=${productName.size}`,
  );
  return cachedDicts;
}

export type ResolutionLayer = 'L1_direct' | 'L2_sku_master' | 'L3_mapping' | 'L4_title' | null;

export interface IwaskuResolution {
  iwasku: string | null;
  resolved_by: ResolutionLayer;
}

/**
 * Tek satır için 4-katmanlı resolution.
 * Önce L1 (en güçlü), sonra L2/L3/L4 sırayla.
 */
function resolveSingle(
  dicts: ResolverDictionaries,
  urun_kodu: string | null,
  sku: string | null,
  urun_basligi: string | null,
): IwaskuResolution {
  const candidate = urun_kodu || sku; // cargolens ile aynı: önce urun_kodu, yoksa sku

  if (candidate) {
    // L1: direkt iwasku
    if (dicts.iwasku.has(candidate)) {
      return { iwasku: candidate, resolved_by: 'L1_direct' };
    }
    // L2: sku_master (önce sku, sonra asin)
    const viaSku = dicts.skuMasterSku.get(candidate);
    if (viaSku && dicts.iwasku.has(viaSku)) {
      return { iwasku: viaSku, resolved_by: 'L2_sku_master' };
    }
    const viaAsin = dicts.skuMasterAsin.get(candidate);
    if (viaAsin && dicts.iwasku.has(viaAsin)) {
      return { iwasku: viaAsin, resolved_by: 'L2_sku_master' };
    }
    // L3: manuel mapping
    const viaMapping = dicts.woMappings.get(candidate);
    if (viaMapping && dicts.iwasku.has(viaMapping)) {
      return { iwasku: viaMapping, resolved_by: 'L3_mapping' };
    }
  }

  // L4: başlık birebir eşleşmesi
  if (urun_basligi) {
    const viaTitle = dicts.productName.get(urun_basligi);
    if (viaTitle) {
      return { iwasku: viaTitle, resolved_by: 'L4_title' };
    }
  }

  return { iwasku: null, resolved_by: null };
}

/**
 * Çoklu satır için resolution. Sözlükler bir kere yüklenir, satırlar O(1) lookup.
 */
export async function resolveBatch(
  rows: Array<{ urun_kodu: string | null; sku: string | null; urun_basligi: string | null }>,
): Promise<IwaskuResolution[]> {
  const dicts = await loadDictionaries();
  return rows.map(r => resolveSingle(dicts, r.urun_kodu, r.sku, r.urun_basligi));
}

/**
 * Tek satır için resolution — sözlükler zaten cache'te.
 */
export async function resolveOne(
  urun_kodu: string | null,
  sku: string | null,
  urun_basligi: string | null,
): Promise<IwaskuResolution> {
  const dicts = await loadDictionaries();
  return resolveSingle(dicts, urun_kodu, sku, urun_basligi);
}

/**
 * Mevcut wisersell_orders'taki tüm satırları (veya iwasku=NULL olanları) yeniden çöz.
 * Backfill veya periyodik düzeltme için. Verimli: distinct (urun_kodu, sku, urun_basligi)
 * üzerinden çalışır, sonra UPDATE yayar.
 *
 * @param onlyNull true ise sadece iwasku IS NULL satırları kapsa
 * @returns {processed, matched, byLayer}
 */
export async function backfillResolution(onlyNull = true): Promise<{
  processed: number;
  matched: number;
  byLayer: Record<string, number>;
}> {
  const where = onlyNull ? 'WHERE iwasku IS NULL' : '';
  const distinctRes = await pool.query<{ urun_kodu: string | null; sku: string | null; urun_basligi: string | null }>(
    `SELECT DISTINCT urun_kodu, sku, urun_basligi
     FROM wisersell_orders
     ${where}`,
  );
  logger.info(`[IwaskuResolver] Backfill: ${distinctRes.rows.length} distinct kombinasyon`);

  const dicts = await loadDictionaries();
  const byLayer: Record<string, number> = { L1_direct: 0, L2_sku_master: 0, L3_mapping: 0, L4_title: 0, UNMATCHED: 0 };
  let matched = 0;
  let processed = 0;
  const BATCH = 200;

  // Distinct kombinasyonları çöz, sonra her birini UPDATE
  for (let i = 0; i < distinctRes.rows.length; i += BATCH) {
    const slice = distinctRes.rows.slice(i, i + BATCH);
    for (const r of slice) {
      const res = resolveSingle(dicts, r.urun_kodu, r.sku, r.urun_basligi);
      processed++;
      if (res.iwasku) {
        matched++;
        byLayer[res.resolved_by as string] = (byLayer[res.resolved_by as string] || 0) + 1;
      } else {
        byLayer.UNMATCHED++;
      }
      await pool.query(
        `UPDATE wisersell_orders
         SET iwasku = $1, resolved_by = $2
         WHERE urun_kodu IS NOT DISTINCT FROM $3
           AND sku IS NOT DISTINCT FROM $4
           AND urun_basligi IS NOT DISTINCT FROM $5
           ${onlyNull ? 'AND iwasku IS NULL' : ''}`,
        [res.iwasku, res.resolved_by, r.urun_kodu, r.sku, r.urun_basligi],
      );
    }
    if ((i + BATCH) % 1000 < BATCH) {
      logger.info(`[IwaskuResolver] Backfill ilerleme: ${Math.min(i + BATCH, distinctRes.rows.length)}/${distinctRes.rows.length}`);
    }
  }

  logger.info(
    `[IwaskuResolver] Backfill bitti: ${processed} kombo işlendi, ${matched} eşleşti ` +
    `(L1=${byLayer.L1_direct}, L2=${byLayer.L2_sku_master}, L3=${byLayer.L3_mapping}, L4=${byLayer.L4_title}, UNMATCHED=${byLayer.UNMATCHED})`,
  );
  return { processed, matched, byLayer };
}
