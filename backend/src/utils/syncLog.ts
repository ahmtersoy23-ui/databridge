import { pool } from '../config/database';
import logger from '../config/logger';
import { notify } from './notify';

export async function withSyncLog(
  jobName: string,
  fn: () => Promise<number | void>,
): Promise<void> {
  const start = Date.now();
  const { rows } = await pool.query(
    'INSERT INTO sync_log (job_name, status) VALUES ($1, $2) RETURNING id',
    [jobName, 'running'],
  );
  const logId = rows[0].id;

  try {
    const rowCount = await fn();
    const durationMs = Date.now() - start;
    await pool.query(
      'UPDATE sync_log SET status=$1, rows_processed=$2, duration_ms=$3, finished_at=NOW() WHERE id=$4',
      ['success', rowCount ?? null, durationMs, logId],
    );
    logger.info(`[SyncLog] ${jobName} completed in ${(durationMs / 1000).toFixed(1)}s${rowCount != null ? `, ${rowCount} rows` : ''}`);

    // Alert if row count dropped significantly vs previous run
    if (rowCount != null) {
      const prev = await pool.query(
        `SELECT rows_processed FROM sync_log WHERE job_name=$1 AND status='success' AND id < $2 ORDER BY id DESC LIMIT 1`,
        [jobName, logId],
      );
      if (prev.rows.length && prev.rows[0].rows_processed > 0) {
        const ratio = rowCount / prev.rows[0].rows_processed;
        if (ratio < 0.2) {
          await notify(`⚠️ [${jobName}] Row count dropped ${prev.rows[0].rows_processed} → ${rowCount} (${Math.round(ratio * 100)}%)`);
        }
      }
    }
  } catch (err: any) {
    const durationMs = Date.now() - start;
    await pool.query(
      'UPDATE sync_log SET status=$1, error_message=$2, duration_ms=$3, finished_at=NOW() WHERE id=$4',
      ['failed', err.message?.slice(0, 500), durationMs, logId],
    ).catch(() => {}); // don't throw on logging failure
    logger.error(`[SyncLog] ${jobName} FAILED after ${(durationMs / 1000).toFixed(1)}s:`, err.message);
    await notify(`🔴 [${jobName}] Sync failed: ${err.message?.slice(0, 200)}`);
    throw err; // re-throw so caller's catch still works
  }
}
