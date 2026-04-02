import { pool } from './config';
import { fetchReviewsPage, randomDelay, shuffle, ParsedReview } from './reviewFetcher';
import logger from './config';

const MAX_CONSECUTIVE_BLOCKS = 5;
const CIRCUIT_BREAKER_PAUSE_MS = 30 * 60 * 1000; // 30 min
const DAILY_ACTIVE_DAYS = 6; // Tue–Sun (Monday off)

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
  // Monday off (defense-in-depth — launchd also skips Monday)
  const dayOfWeek = new Date().getDay(); // 0=Sun, 1=Mon
  if (dayOfWeek === 1) {
    logger.info('[ReviewSync] Monday — rest day, skipping');
    return;
  }

  // Daily guard — skip if already ran in last 20 hours
  const catchUp = !!process.env.CATCHUP;
  if (!catchUp) {
    const cooldownResult = await pool.query(
      "SELECT MAX(started_at) AS last_fetch FROM sync_jobs WHERE job_type = 'review_tracking' AND status = 'completed'"
    );
    const lastFetch = cooldownResult.rows[0]?.last_fetch;
    if (lastFetch) {
      const hoursSince = (Date.now() - new Date(lastFetch).getTime()) / (1000 * 60 * 60);
      if (hoursSince < 20) {
        logger.info(`[ReviewSync] Skipping — last fetch was ${hoursSince.toFixed(1)} hours ago (min 20h)`);
        return;
      }
    }
  }

  const jobId = await createSyncJob();

  try {
    await updateSyncJob(jobId, 'running');

    const rawBatch = await getDailyBatch();
    if (rawBatch.length === 0) {
      logger.info('[ReviewSync] No ASINs due for checking');
      await updateSyncJob(jobId, 'completed', 0);
      return;
    }

    const tracked = shuffle(rawBatch);
    logger.info(`[ReviewSync] Daily batch: ${tracked.length} ASINs (shuffled)`);

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

      // Existing data for change detection
      const existing = await getExistingReview(item.asin, item.country_code);

      // Single request: product page has rating + count + ~8 reviews
      const result = await fetchReviewsPage(item.asin, item.country_code);

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

async function getDailyBatch(): Promise<TrackedAsin[]> {
  // Calculate batch size: ceil(total / 6 active days), or BATCH_SIZE env override for catch-up
  const countResult = await pool.query(
    'SELECT count(*)::int AS cnt FROM review_tracked_asins WHERE is_active = true'
  );
  const total = countResult.rows[0]?.cnt ?? 0;
  if (total === 0) return [];
  const batchSize = process.env.BATCH_SIZE ? parseInt(process.env.BATCH_SIZE, 10) : Math.ceil(total / DAILY_ACTIVE_DAYS);

  // Pick ASINs with oldest checked_at (never-checked first)
  const result = await pool.query(`
    SELECT t.id, t.asin, t.country_code, t.label
    FROM review_tracked_asins t
    LEFT JOIN product_reviews pr ON pr.asin = t.asin AND pr.country_code = t.country_code
    WHERE t.is_active = true
      AND (pr.is_blocked IS NULL OR pr.is_blocked = false OR pr.block_count < 3)
    ORDER BY pr.checked_at ASC NULLS FIRST
    LIMIT $1
  `, [batchSize]);
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
