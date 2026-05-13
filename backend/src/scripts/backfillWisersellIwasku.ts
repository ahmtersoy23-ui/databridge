/**
 * Mevcut wisersell_orders satırlarına iwasku resolution uygula (backfill).
 *
 * Kullanım:
 *   ts-node src/scripts/backfillWisersellIwasku.ts            # sadece NULL satırlar
 *   ts-node src/scripts/backfillWisersellIwasku.ts --all      # tüm satırlar (resolve_by sıfırlanır)
 *
 * Sunucuda:
 *   ssh -p 2222 root@78.47.117.36 'cd /var/www/databridge && \
 *     sudo -u iwaapps npx ts-node src/scripts/backfillWisersellIwasku.ts'
 */
import 'dotenv/config';
import { backfillResolution } from '../services/wisersell/iwaskuResolver';
import { pool, sharedPool } from '../config/database';
import logger from '../config/logger';

async function main() {
  const onlyNull = !process.argv.includes('--all');
  logger.info(`[Backfill] Başlıyor (onlyNull=${onlyNull})`);
  const result = await backfillResolution(onlyNull);
  logger.info(`[Backfill] Tamamlandı: ${JSON.stringify(result)}`);
  await pool.end();
  await sharedPool.end();
  process.exit(0);
}

main().catch(err => {
  logger.error(`[Backfill] Hata: ${err.message}\n${err.stack}`);
  process.exit(1);
});
