import { runReviewTracking } from './reviewSync';
import { pool } from './config';
import logger from './config';

async function main() {
  logger.info('[LocalReview] Starting weekly review fetch');

  try {
    await runReviewTracking();
    logger.info('[LocalReview] Completed successfully');
  } catch (err: any) {
    logger.error(`[LocalReview] Failed: ${err.message}`);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
