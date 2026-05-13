/**
 * Bol.com orders backfill (multi-account).
 *
 * Default 80 gun (Bol API "older than 3 months" hatasini onlemek icin guvenli kenar).
 * --days N ile ayarlanabilir; syncBolOrdersForAccount BOL_MAX_HISTORY_DAYS=80 ile clamp eder.
 *
 * Kullanim:
 *   ssh -p 2222 root@78.47.117.36 \
 *     'cd /var/www/databridge && node dist/scripts/bolBackfill.js --days 80'
 */
import 'dotenv/config';
import { syncBolOrders } from '../services/sync/bolOrdersSync';
import { pool, sharedPool } from '../config/database';
import logger from '../config/logger';

function parseDays(): number {
  const idx = process.argv.indexOf('--days');
  if (idx !== -1 && process.argv[idx + 1]) {
    const n = parseInt(process.argv[idx + 1], 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 80;
}

async function main(): Promise<void> {
  const days = parseDays();
  const startTime = Date.now();
  logger.info(`[BolBackfill] Starting backfill for last ${days} days`);

  try {
    const inserted = await syncBolOrders(days);
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
