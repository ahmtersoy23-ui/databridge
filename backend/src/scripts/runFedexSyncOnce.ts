import 'dotenv/config';
import { syncFedex } from '../services/sync/fedexSync';
import { pool } from '../config/database';
import logger from '../config/logger';

/**
 * Tek seferlik FedEx Track sync runner.
 * Lokal'de SSH tunnel üstünden sunucu DB'ye yazmak için:
 *   DB_PORT=5433 DB_USER=pricelab_user DB_PASSWORD=... \
 *     npx ts-node src/scripts/runFedexSyncOnce.ts [limit]
 *
 * limit verilmezse default (5000) kullanılır.
 */

async function main(): Promise<void> {
  const limitArg = process.argv[2];
  const limit = limitArg ? parseInt(limitArg, 10) : undefined;
  if (limitArg && (!Number.isFinite(limit) || limit! <= 0)) {
    console.error(`Geçersiz limit: ${limitArg}`);
    process.exit(1);
  }

  logger.info(`[runFedexSyncOnce] Başlıyor (limit=${limit ?? 'default'})`);
  const start = Date.now();
  const fetched = await syncFedex(limit ? { limit } : {});
  const sec = ((Date.now() - start) / 1000).toFixed(1);
  logger.info(`[runFedexSyncOnce] Bitti, ${fetched} tracking işlendi, ${sec}s`);

  await pool.end();
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    logger.error('[runFedexSyncOnce] FATAL:', err.message);
    if (err.stack) logger.error(err.stack);
    process.exit(1);
  });
