/**
 * Kaufland orders + units backfill.
 *
 * Kullanim:
 *   ssh -p 2222 root@78.47.117.36 \
 *     'cd /var/www/databridge && node dist/scripts/kauflandBackfill.js --days 90'
 */
import 'dotenv/config';
import { syncKaufland } from '../services/sync/kauflandOrdersSync';
import { pool, sharedPool } from '../config/database';
import logger from '../config/logger';
import { errMessage } from '../utils/errors';

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
  logger.info(`[KauflandBackfill] Starting (${days} days)`);

  try {
    const rows = await syncKaufland(days);
    const sec = ((Date.now() - startTime) / 1000).toFixed(1);
    logger.info(`[KauflandBackfill] Done — ${rows} rows in ${sec}s`);
  } catch (err: unknown) {
    logger.error(`[KauflandBackfill] Failed: ${errMessage(err)}`);
    if (err instanceof Error && err.stack) logger.error(err.stack);
    await pool.end(); await sharedPool.end();
    process.exit(1);
  }
  await pool.end(); await sharedPool.end();
  process.exit(0);
}

main().catch(err => { logger.error(`[KauflandBackfill] Fatal: ${err.message}`); process.exit(1); });
