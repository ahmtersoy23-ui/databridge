/**
 * Takealot orders + inventory backfill.
 *
 * Kullanim:
 *   ssh -p 2222 root@78.47.117.36 \
 *     'cd /var/www/databridge && node dist/scripts/takealotBackfill.js --days 90'
 */
import 'dotenv/config';
import { syncTakealot } from '../services/sync/takealotOrdersSync';
import { pool, sharedPool } from '../config/database';
import logger from '../config/logger';

function parseDays(): number {
  const idx = process.argv.indexOf('--days');
  if (idx !== -1 && process.argv[idx + 1]) {
    const n = parseInt(process.argv[idx + 1], 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 90;
}

async function main(): Promise<void> {
  const days = parseDays();
  const startTime = Date.now();
  logger.info(`[TakealotBackfill] Starting (${days} days)`);

  try {
    const rows = await syncTakealot(days);
    const sec = ((Date.now() - startTime) / 1000).toFixed(1);
    logger.info(`[TakealotBackfill] Done — ${rows} rows in ${sec}s`);
  } catch (err: any) {
    logger.error(`[TakealotBackfill] Failed: ${err.message}`);
    if (err.stack) logger.error(err.stack);
    await pool.end(); await sharedPool.end();
    process.exit(1);
  }
  await pool.end(); await sharedPool.end();
  process.exit(0);
}

main().catch(err => { logger.error(`[TakealotBackfill] Fatal: ${err.message}`); process.exit(1); });
