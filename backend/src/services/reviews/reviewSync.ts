import { pool } from '../../config/database';
import { fetchReviewsPage, randomDelay, shuffle, ParsedReview } from './reviewFetcher';
import logger from '../../config/logger';

const MAX_CONSECUTIVE_BLOCKS = 5;
const CIRCUIT_BREAKER_PAUSE_MS = 30 * 60 * 1000; // 30 min

interface TrackedAsin {
  id: number;
  asin: string;
  country_code: string;
  label: string | null;
}

interface ExistingReview {
  rating: number | null;
  review_count: number;
  is_blocked: boolean;
  block_count: number;
}

export async function runReviewTracking(): Promise<void> {
  const jobId = await createSyncJob();

  try {
    await updateSyncJob(jobId, 'running');

    const rawTracked = await getTrackedAsins();
    if (rawTracked.length === 0) {
      logger.info('[ReviewSync] No tracked ASINs found');
      await updateSyncJob(jobId, 'completed', 0);
      return;
    }

    const tracked = shuffle(rawTracked);
    logger.info(`[ReviewSync] Starting review tracking for ${tracked.length} ASINs (shuffled)`);

    let processed = 0;
    let consecutiveBlocks = 0;

    for (const item of tracked) {
      // Circuit breaker
      if (consecutiveBlocks >= MAX_CONSECUTIVE_BLOCKS) {
        logger.warn(`[ReviewSync] Circuit breaker triggered (${consecutiveBlocks} consecutive blocks). Pausing ${CIRCUIT_BREAKER_PAUSE_MS / 60000} min...`);
        await new Promise(resolve => setTimeout(resolve, CIRCUIT_BREAKER_PAUSE_MS));
        consecutiveBlocks = 0;

        const testResult = await fetchReviewsPage(item.asin, item.country_code);
        if (!testResult) {
          logger.error('[ReviewSync] Still blocked after pause. Aborting run.');
          await updateSyncJob(jobId, 'failed', processed, 'Circuit breaker: persistent blocking');
          return;
        }
        consecutiveBlocks = 0;
      }

      // Skip persistently blocked ASINs
      const existing = await getExistingReview(item.asin, item.country_code);
      if (existing?.is_blocked && existing.block_count >= 3) {
        logger.debug(`[ReviewSync] Skipping blocked ASIN ${item.asin} (${item.country_code})`);
        continue;
      }

      // Single request: reviews page has rating + count + reviews
      const result = await fetchReviewsPage(item.asin, item.country_code, 1);

      if (!result) {
        consecutiveBlocks++;
        await markBlocked(item.asin, item.country_code);
        await randomDelay();
        continue;
      }

      consecutiveBlocks = 0;
      const rating = result.rating ?? 0;
      const reviewCount = result.reviewCount ?? 0;

      // Upsert product_reviews (last_review_* = first review on page = most recent)
      const latestReview = result.reviews.length > 0 ? result.reviews[0] : null;
      await upsertProductReview(item.asin, item.country_code, rating, reviewCount, latestReview);

      // Insert history if rating or count changed
      const changed = !existing || existing.review_count !== reviewCount || existing.rating !== rating;
      if (changed) {
        await insertHistory(item.asin, item.country_code, rating, reviewCount);
      }

      // Archive review items
      let newReviewCount = 0;
      if (result.reviews.length > 0) {
        newReviewCount = await insertReviewItems(item.asin, item.country_code, result.reviews);
        logger.info(`[ReviewSync] ${item.asin} (${item.country_code}): ${rating}★, ${reviewCount} reviews, ${newReviewCount} new archived`);
      }

      // Smart pagination: all 10 reviews were new → check page 2
      if (newReviewCount === result.reviews.length && result.reviews.length >= 10) {
        logger.info(`[ReviewSync] All ${newReviewCount} reviews new for ${item.asin} — fetching page 2`);
        await randomDelay();
        const page2 = await fetchReviewsPage(item.asin, item.country_code, 2);
        if (page2 && page2.reviews.length > 0) {
          const newPage2 = await insertReviewItems(item.asin, item.country_code, page2.reviews);
          logger.info(`[ReviewSync] Page 2: ${newPage2} new reviews archived`);
        }
      }

      processed++;
      await randomDelay();
    }

    await updateSyncJob(jobId, 'completed', processed);
    logger.info(`[ReviewSync] Completed. Processed ${processed}/${tracked.length} ASINs`);
  } catch (err: any) {
    logger.error('[ReviewSync] Fatal error:', err.message);
    await updateSyncJob(jobId, 'failed', 0, err.message);
    throw err;
  }
}

// --- DB helpers ---

async function getTrackedAsins(): Promise<TrackedAsin[]> {
  const result = await pool.query(
    'SELECT id, asin, country_code, label FROM review_tracked_asins WHERE is_active = true ORDER BY country_code, asin'
  );
  return result.rows;
}

async function getExistingReview(asin: string, countryCode: string): Promise<ExistingReview | null> {
  const result = await pool.query(
    'SELECT rating, review_count, is_blocked, block_count FROM product_reviews WHERE asin = $1 AND country_code = $2',
    [asin, countryCode]
  );
  return result.rows[0] || null;
}

async function markBlocked(asin: string, countryCode: string): Promise<void> {
  await pool.query(`
    INSERT INTO product_reviews (asin, country_code, is_blocked, block_count, checked_at)
    VALUES ($1, $2, true, 1, NOW())
    ON CONFLICT (asin, country_code) DO UPDATE SET
      is_blocked = true,
      block_count = product_reviews.block_count + 1,
      checked_at = NOW(),
      updated_at = NOW()
  `, [asin, countryCode]);
}

async function upsertProductReview(
  asin: string,
  countryCode: string,
  rating: number,
  reviewCount: number,
  latestReview: ParsedReview | null
): Promise<void> {
  if (latestReview) {
    await pool.query(`
      INSERT INTO product_reviews (asin, country_code, rating, review_count,
        last_review_title, last_review_text, last_review_rating, last_review_date, last_review_author,
        is_blocked, block_count, checked_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, false, 0, NOW())
      ON CONFLICT (asin, country_code) DO UPDATE SET
        rating = $3, review_count = $4,
        last_review_title = $5, last_review_text = $6, last_review_rating = $7,
        last_review_date = $8, last_review_author = $9,
        is_blocked = false, block_count = 0,
        checked_at = NOW(), updated_at = NOW()
    `, [asin, countryCode, rating, reviewCount,
        latestReview.title, latestReview.body, latestReview.rating, latestReview.date, latestReview.author]);
  } else {
    await pool.query(`
      INSERT INTO product_reviews (asin, country_code, rating, review_count, is_blocked, block_count, checked_at)
      VALUES ($1, $2, $3, $4, false, 0, NOW())
      ON CONFLICT (asin, country_code) DO UPDATE SET
        rating = $3, review_count = $4,
        is_blocked = false, block_count = 0,
        checked_at = NOW(), updated_at = NOW()
    `, [asin, countryCode, rating, reviewCount]);
  }
}

async function insertReviewItems(asin: string, countryCode: string, reviews: ParsedReview[]): Promise<number> {
  let newCount = 0;
  for (const r of reviews) {
    if (!r.author || !r.date) continue;
    const result = await pool.query(`
      INSERT INTO product_review_items (asin, country_code, title, body, rating, review_date, author, is_verified)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (asin, country_code, author, review_date) DO NOTHING
      RETURNING id
    `, [asin, countryCode, r.title, r.body, r.rating, r.date, r.author, r.isVerified]);
    if (result.rowCount && result.rowCount > 0) newCount++;
  }
  return newCount;
}

async function insertHistory(asin: string, countryCode: string, rating: number, reviewCount: number): Promise<void> {
  await pool.query(
    'INSERT INTO product_reviews_history (asin, country_code, rating, review_count) VALUES ($1, $2, $3, $4)',
    [asin, countryCode, rating, reviewCount]
  );
}

// --- Sync job tracking ---

async function createSyncJob(): Promise<number> {
  const result = await pool.query(
    "INSERT INTO sync_jobs (job_type, marketplace, status) VALUES ('review_tracking', 'ALL', 'pending') RETURNING id"
  );
  return result.rows[0].id;
}

async function updateSyncJob(id: number, status: string, recordsProcessed?: number, errorMessage?: string): Promise<void> {
  const fields = ['status = $2'];
  const params: any[] = [id, status];
  let idx = 3;

  if (status === 'running') fields.push('started_at = NOW()');
  if (status === 'completed' || status === 'failed') fields.push('completed_at = NOW()');

  if (recordsProcessed !== undefined) {
    fields.push(`records_processed = $${idx}`);
    params.push(recordsProcessed);
    idx++;
  }
  if (errorMessage) {
    fields.push(`error_message = $${idx}`);
    params.push(errorMessage);
    idx++;
  }

  await pool.query(`UPDATE sync_jobs SET ${fields.join(', ')} WHERE id = $1`, params);
}
