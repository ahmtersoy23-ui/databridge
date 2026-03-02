import axios from 'axios';
import { pool } from '../../config/database';
import logger from '../../config/logger';
import { NJ_WAREHOUSE_CSV_URL } from '../../config/constants';

interface NJWarehouseRow {
  fnsku: string;
  name: string;
  category: string;
  count_in_ship: number;
  count_in_raf: number;
  total_count: number;
}

interface EnrichedNJRow extends NJWarehouseRow {
  iwasku: string | null;
  asin: string | null;
}

export async function syncNJWarehouse(): Promise<number> {
  const jobId = await createSyncJob('nj_warehouse_sync', 'NJ');

  try {
    await updateSyncJob(jobId, 'running');

    // 1. Fetch CSV
    const response = await axios.get(NJ_WAREHOUSE_CSV_URL, { responseType: 'text', timeout: 30_000 });
    const rows = parseCSV(response.data);

    if (rows.length === 0) {
      await updateSyncJob(jobId, 'completed', 0);
      return 0;
    }

    // 2. Enrich with iwasku/asin via FNSKU lookup from fba_inventory
    const enriched = await enrichWithFnsku(rows);

    // 3. Upsert into nj_warehouse_inventory
    await upsertNJWarehouse(enriched);

    await updateSyncJob(jobId, 'completed', enriched.length);
    logger.info(`[NJSync] Completed: ${enriched.length} items (${enriched.filter(r => r.iwasku).length} enriched with iwasku)`);
    return enriched.length;
  } catch (err: any) {
    logger.error('[NJSync] Failed:', err.message);
    await updateSyncJob(jobId, 'failed', 0, err.message);
    throw err;
  }
}

function parseCSV(text: string): NJWarehouseRow[] {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  if (lines.length < 2) return [];

  // Skip header row: Name, Category, FNSKU, Count in Ship, Count in Raf, Total Count
  const rows: NJWarehouseRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map(c => c.trim());
    if (cols.length < 6) continue;

    const fnsku = cols[2];
    if (!fnsku) continue;

    rows.push({
      name: cols[0] || '',
      category: cols[1] || '',
      fnsku,
      count_in_ship: parseInt(cols[3], 10) || 0,
      count_in_raf: parseInt(cols[4], 10) || 0,
      total_count: parseInt(cols[5], 10) || 0,
    });
  }
  return rows;
}

async function enrichWithFnsku(rows: NJWarehouseRow[]): Promise<EnrichedNJRow[]> {
  const fnskus = rows.map(r => r.fnsku);

  const result = await pool.query<{ fnsku: string; iwasku: string | null; asin: string | null }>(`
    SELECT DISTINCT ON (fnsku) fnsku, iwasku, asin
    FROM fba_inventory
    WHERE fnsku = ANY($1)
    ORDER BY fnsku, fulfillable_quantity DESC
  `, [fnskus]);

  const lookup = new Map(result.rows.map(r => [r.fnsku, { iwasku: r.iwasku, asin: r.asin }]));

  return rows.map(row => ({
    ...row,
    iwasku: lookup.get(row.fnsku)?.iwasku ?? null,
    asin: lookup.get(row.fnsku)?.asin ?? null,
  }));
}

async function upsertNJWarehouse(rows: EnrichedNJRow[]): Promise<void> {
  const BATCH_SIZE = 500;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const values: string[] = [];
    const params: any[] = [];

    batch.forEach((row, idx) => {
      const offset = idx * 8;
      values.push(`($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8})`);
      params.push(
        row.fnsku,
        row.name,
        row.category,
        row.count_in_ship,
        row.count_in_raf,
        row.total_count,
        row.iwasku,
        row.asin,
      );
    });

    await pool.query(`
      INSERT INTO nj_warehouse_inventory
        (fnsku, name, category, count_in_ship, count_in_raf, total_count, iwasku, asin)
      VALUES ${values.join(', ')}
      ON CONFLICT (fnsku) DO UPDATE SET
        name = EXCLUDED.name,
        category = EXCLUDED.category,
        count_in_ship = EXCLUDED.count_in_ship,
        count_in_raf = EXCLUDED.count_in_raf,
        total_count = EXCLUDED.total_count,
        iwasku = EXCLUDED.iwasku,
        asin = EXCLUDED.asin,
        synced_at = NOW()
    `, params);
  }
}

async function createSyncJob(jobType: string, marketplace: string): Promise<number> {
  const result = await pool.query(
    'INSERT INTO sync_jobs (job_type, marketplace, status) VALUES ($1, $2, $3) RETURNING id',
    [jobType, marketplace, 'pending']
  );
  return result.rows[0].id;
}

async function updateSyncJob(
  id: number,
  status: string,
  recordsProcessed?: number,
  errorMessage?: string
): Promise<void> {
  const fields = ['status = $2'];
  const params: any[] = [id, status];
  let idx = 3;

  if (status === 'running') {
    fields.push(`started_at = NOW()`);
  }
  if (status === 'completed' || status === 'failed') {
    fields.push(`completed_at = NOW()`);
  }
  if (recordsProcessed !== undefined) {
    fields.push(`records_processed = $${idx}`);
    params.push(recordsProcessed);
    idx++;
  }
  if (errorMessage) {
    fields.push(`error_message = $${idx}`);
    params.push(errorMessage);
  }

  await pool.query(`UPDATE sync_jobs SET ${fields.join(', ')} WHERE id = $1`, params);
}
