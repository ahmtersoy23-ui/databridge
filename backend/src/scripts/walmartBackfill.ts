/**
 * Walmart Marketplace orders backfill.
 *
 * Default 180 gun (Walmart API'nin documented max'i). Daha buyuk dene-sini
 * `--days N` ile zorlayabilirsin; API limit'i asarsa hata firlatir.
 *
 * Kullanim:
 *   ts-node src/scripts/walmartBackfill.ts            # 180 gun (default)
 *   ts-node src/scripts/walmartBackfill.ts --days 90  # daha kisa pencere
 *   ts-node src/scripts/walmartBackfill.ts --days 365 # 180 ustunu dene
 *
 * Sunucuda (deploy edilmis dist'ten):
 *   ssh -p 2222 root@78.47.117.36 \
 *     'cd /var/www/databridge && node dist/scripts/walmartBackfill.js --days 180'
 */
import 'dotenv/config';
import { syncWalmartOrders } from '../services/sync/walmartOrdersSync';
import { pool, sharedPool } from '../config/database';
import logger from '../config/logger';

function parseDays(): number {
  const idx = process.argv.indexOf('--days');
  if (idx !== -1 && process.argv[idx + 1]) {
    const n = parseInt(process.argv[idx + 1], 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 180;
}

async function main(): Promise<void> {
  const days = parseDays();
  const startTime = Date.now();
  logger.info(`[WalmartBackfill] Starting backfill for last ${days} days`);

  try {
    const inserted = await syncWalmartOrders(days);
    const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);
    logger.info(
      `[WalmartBackfill] Done — ${inserted} rows upserted in ${durationSec}s`
    );
  } catch (err: any) {
    logger.error(`[WalmartBackfill] Failed: ${err.message}`);
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
  logger.error(`[WalmartBackfill] Fatal: ${err.message}`);
  process.exit(1);
});
