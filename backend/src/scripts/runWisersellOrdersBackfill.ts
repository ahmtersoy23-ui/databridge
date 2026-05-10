import 'dotenv/config';
import { syncWisersellOrders } from '../services/sync/wisersellOrderSync';
import { pool } from '../config/database';
import logger from '../config/logger';

/**
 * Wisersell Kapalı sipariş tek seferlik backfill.
 * Default: 2025-01-01'den itibaren tüm kapalı siparişler.
 *
 * Run (sunucuda):
 *   cd /var/www/databridge && node dist/scripts/runWisersellOrdersBackfill.js [from_iso] [to_iso]
 *
 * Örnek:
 *   node dist/scripts/runWisersellOrdersBackfill.js 2025-01-01T00:00:00.000Z
 */

async function main(): Promise<void> {
  const arg = process.argv[2];
  // Eğer arg .xlsx ile bitiyorsa lokal dosya modu (API çağrısı yok)
  const isLocal = arg && (arg.endsWith('.xlsx') || arg.endsWith('.xls'));
  const from = isLocal ? '' : (arg || '2025-01-01T00:00:00.000Z');
  const to = process.argv[3] || '';

  if (isLocal) {
    logger.info(`[OrdersBackfill] Başlıyor — LOKAL DOSYA: ${arg}`);
  } else {
    logger.info(`[OrdersBackfill] Başlıyor (from=${from}, to=${to || 'şimdi'})`);
  }
  const start = Date.now();
  const r = await syncWisersellOrders({
    shipmentDateFrom: isLocal ? undefined : from,
    shipmentDateTo: to || undefined,
    mode: 'append',
    filePath: isLocal ? arg : undefined,
  });
  const sec = ((Date.now() - start) / 1000).toFixed(1);
  logger.info(
    `[OrdersBackfill] Bitti (${sec}s): ${r.inserted} insert, ${r.updated} update, ` +
    `${r.skipped} skip, ${r.errors} err / ${r.fetchedRows ?? '-'} satır`,
  );
  await pool.end();
}

main().then(() => process.exit(0)).catch(err => {
  logger.error('[OrdersBackfill] FATAL:', err.message);
  if (err.stack) logger.error(err.stack);
  process.exit(1);
});
