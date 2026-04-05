import { pool, sharedPool } from '../../config/database';
import logger from '../../config/logger';
import { notify } from '../../utils/notify';

/**
 * Warehouse → sku_master country_code mapping
 * EU warehouse serves UK/DE/FR/IT/ES (same FNSKU), AE serves AE/UAE, etc.
 */
const WAREHOUSE_TO_COUNTRY_CODES: Record<string, string[]> = {
  US: ['US'],
  UK: ['UK'],
  EU: ['DE', 'FR', 'IT', 'ES'],
  AU: ['AU'],
  CA: ['CA'],
  AE: ['AE', 'UAE'],
  SA: ['SA'],
};

interface DiffResult {
  missingSku: number;
  fnskuChanged: number;
  asinMismatch: number;
  iwaskuMissing: number;
  details: string[];
}

/**
 * Compare fba_inventory (databridge_db) vs sku_master (pricelab_db)
 * Returns diff summary — does NOT update anything
 */
export async function runSkuMasterDiff(): Promise<number> {
  logger.info('[sku-master-diff] Starting weekly diff...');

  const diff = await computeDiff();
  const total = diff.missingSku + diff.fnskuChanged + diff.asinMismatch + diff.iwaskuMissing;

  if (total === 0) {
    logger.info('[sku-master-diff] No differences found');
    await notify('✅ [sku-master-diff] Haftalık kontrol: fark yok');
    return 0;
  }

  const lines = [
    `📊 [sku-master-diff] Haftalık Rapor`,
    `• ${diff.missingSku} yeni SKU (sku_master'da yok)`,
    `• ${diff.fnskuChanged} FNSKU değişikliği`,
    `• ${diff.asinMismatch} ASIN uyumsuzluğu`,
    `• ${diff.iwaskuMissing} iwasku eşleşmemiş`,
  ];

  if (diff.details.length > 0) {
    lines.push('', 'Detay (ilk 10):');
    lines.push(...diff.details.slice(0, 10));
  }

  lines.push('', '→ Onaylamak için: POST /api/v1/sync/trigger { "type": "sku_master_update" }');

  await notify(lines.join('\n'));
  logger.info(`[sku-master-diff] Found ${total} differences`);

  return total;
}

/**
 * Apply FNSKU updates from fba_inventory to sku_master
 * Called manually after user approves the diff report
 */
export async function applySkuMasterUpdate(): Promise<number> {
  logger.info('[sku-master-update] Applying FNSKU updates...');

  let totalUpdated = 0;

  // Get all distinct SKU+FNSKU+ASIN+warehouse from fba_inventory
  const { rows: inventoryRows } = await pool.query(`
    SELECT DISTINCT sku, fnsku, asin, warehouse
    FROM fba_inventory
    WHERE fnsku IS NOT NULL
      AND sku NOT LIKE 'amzn.gr.%'
  `);

  // Group by warehouse and build updates
  for (const [warehouse, countryCodes] of Object.entries(WAREHOUSE_TO_COUNTRY_CODES)) {
    const warehouseItems = inventoryRows.filter(r => r.warehouse === warehouse);
    if (warehouseItems.length === 0) continue;

    for (const item of warehouseItems) {
      const placeholders = countryCodes.map((_, i) => `$${i + 4}`);
      const result = await sharedPool.query(`
        UPDATE sku_master
        SET fnsku = $1, updated_at = NOW()
        WHERE sku = $2
          AND fulfillment = 'FBA'
          AND marketplace = 'amazon'
          AND country_code IN (${placeholders.join(',')})
          AND (fnsku IS DISTINCT FROM $1)
      `, [item.fnsku, item.sku, ...countryCodes]);

      totalUpdated += result.rowCount || 0;
    }
  }

  const msg = `✅ [sku-master-update] Güncellendi: ${totalUpdated} satır fnsku güncellendi`;
  logger.info(msg);
  await notify(msg);

  return totalUpdated;
}

async function computeDiff(): Promise<DiffResult> {
  const result: DiffResult = {
    missingSku: 0,
    fnskuChanged: 0,
    asinMismatch: 0,
    iwaskuMissing: 0,
    details: [],
  };

  // Get fba_inventory data (databridge_db)
  const { rows: invRows } = await pool.query(`
    SELECT DISTINCT sku, fnsku, asin, warehouse
    FROM fba_inventory
    WHERE fnsku IS NOT NULL
      AND sku NOT LIKE 'amzn.gr.%'
  `);

  // Get sku_master FBA data (pricelab_db)
  const { rows: masterRows } = await sharedPool.query(`
    SELECT sku, country_code, fnsku, asin, iwasku
    FROM sku_master
    WHERE marketplace = 'amazon' AND fulfillment = 'FBA'
  `);

  // Index sku_master by sku|country_code
  const masterMap = new Map<string, typeof masterRows[0]>();
  for (const row of masterRows) {
    masterMap.set(`${row.sku}|${row.country_code}`, row);
  }

  // Compare each inventory row against sku_master
  const seen = new Set<string>();

  for (const inv of invRows) {
    const countryCodes = WAREHOUSE_TO_COUNTRY_CODES[inv.warehouse] || [];

    for (const cc of countryCodes) {
      const key = `${inv.sku}|${cc}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const master = masterMap.get(key);

      if (!master) {
        result.missingSku++;
        if (result.details.length < 10) {
          result.details.push(`  NEW: ${inv.sku} (${cc}) fnsku=${inv.fnsku}`);
        }
        continue;
      }

      // FNSKU mismatch
      if (master.fnsku && master.fnsku !== inv.fnsku) {
        result.fnskuChanged++;
        if (result.details.length < 10) {
          result.details.push(`  FNSKU: ${inv.sku} (${cc}) ${master.fnsku} → ${inv.fnsku}`);
        }
      }

      // ASIN mismatch
      if (master.asin && inv.asin && master.asin !== inv.asin) {
        result.asinMismatch++;
        if (result.details.length < 10) {
          result.details.push(`  ASIN: ${inv.sku} (${cc}) ${master.asin} → ${inv.asin}`);
        }
      }

      // Missing iwasku
      if (!master.iwasku) {
        result.iwaskuMissing++;
      }
    }
  }

  return result;
}
