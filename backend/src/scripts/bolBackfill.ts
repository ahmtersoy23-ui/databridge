/**
 * Bol.com shipments backfill (multi-account).
 *
 * /shipments endpoint son 3 ayın TÜM FBR siparişlerini döner (orders endpoint'in 48h sınırı yok).
 * Default mode='shipments'. --mode orders-recent ile /orders status=ALL kullanılabilir (test için).
 *
 * Kullanim:
 *   ssh -p 2222 root@78.47.117.36 \
 *     'cd /var/www/databridge && node dist/scripts/bolBackfill.js'
 */
import 'dotenv/config';
import { syncBolOrders } from '../services/sync/bolOrdersSync';
import { pool, sharedPool } from '../config/database';
import logger from '../config/logger';

function parseMode(): 'shipments' | 'orders-recent' {
  const idx = process.argv.indexOf('--mode');
  if (idx !== -1 && process.argv[idx + 1] === 'orders-recent') return 'orders-recent';
  return 'shipments';
}

async function main(): Promise<void> {
  const mode = parseMode();
  const startTime = Date.now();
  logger.info(`[BolBackfill] Starting backfill (mode=${mode})`);

  try {
    const inserted = await syncBolOrders(undefined, mode);
    const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);
    logger.info(`[BolBackfill] Done — ${inserted} rows upserted in ${durationSec}s`);
  } catch (err: any) {
    logger.error(`[BolBackfill] Failed: ${err.message}`);
    if (err.stack) logger.error(err.stack);
    await pool.end();
    await sharedPool.end();
    process.exit(1);
  }

  await pool.end();
  await sharedPool.end();
  process.exit(0);
}

main().catch(err => {
  logger.error(`[BolBackfill] Fatal: ${err.message}`);
  process.exit(1);
});
