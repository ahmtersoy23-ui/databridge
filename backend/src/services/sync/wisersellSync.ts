import axios from 'axios';
import { pool } from '../../config/database';
import logger from '../../config/logger';

interface WisersellProduct {
  id: number;
  name: string;
  code: string;
  weight: number | null;
  deci: number | null;
  width: number | null;
  length: number | null;
  height: number | null;
  arrsku: string[] | null;
  categoryId: number | null;
  extradata: Record<string, unknown> | null;
}

// In-memory token cache
let cachedToken: string | null = null;
let tokenExpiry = 0;

export function clearWisersellTokenCache(): void {
  cachedToken = null;
  tokenExpiry = 0;
}

async function getCredentials(): Promise<{ email: string; password: string; api_url: string }> {
  const result = await pool.query(
    'SELECT email, password, api_url FROM wisersell_credentials WHERE id = 1'
  );
  if (!result.rows.length) {
    throw new Error('Wisersell credentials not configured. Add them in Settings.');
  }
  return result.rows[0];
}

async function getToken(): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiry - 60_000) return cachedToken;

  const creds = await getCredentials();
  const apiUrl = creds.api_url.replace(/\/$/, '');

  let res;
  try {
    res = await axios.post(`${apiUrl}/token`, {
      email: creds.email,
      password: creds.password,
    }, { timeout: 15_000 });
  } catch (err: any) {
    if (err.response?.status === 429) {
      const retryAfter = err.response.headers['retry-after'];
      const resetAt = err.response.headers['x-ratelimit-reset'];
      const waitSec = retryAfter ? Math.ceil(Number(retryAfter)) : 300;
      const resetTime = resetAt ? new Date(Number(resetAt) * 1000).toISOString() : 'unknown';
      throw new Error(`Wisersell token rate-limited (429). Retry after ${waitSec}s (resets at ${resetTime})`);
    }
    throw err;
  }

  const token: string = res.data.token;
  if (!token) throw new Error('Wisersell token response missing "token" field');

  // Decode JWT exp claim
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
    tokenExpiry = (payload.exp || 0) * 1000;
  } catch {
    tokenExpiry = Date.now() + 3_600_000; // default 1h if decode fails
  }

  cachedToken = token;
  return token;
}

async function fetchAllProducts(token: string, apiUrl: string): Promise<WisersellProduct[]> {
  const all: WisersellProduct[] = [];
  let page = 0;
  const url = apiUrl.replace(/\/$/, '');

  while (true) {
    const res = await axios.post(
      `${url}/product/search`,
      { page, pageSize: 100 },
      { headers: { Authorization: `Bearer ${token}` }, timeout: 30_000 }
    );

    const rows = Array.isArray(res.data) ? res.data : (res.data?.rows ?? []);
    const items: WisersellProduct[] = rows;
    if (items.length === 0) break;
    all.push(...items);
    if (items.length < 100) break;
    page++;
  }

  return all;
}

async function upsertProducts(products: WisersellProduct[]): Promise<void> {
  const BATCH_SIZE = 500;

  for (let i = 0; i < products.length; i += BATCH_SIZE) {
    const batch = products.slice(i, i + BATCH_SIZE);
    const values: string[] = [];
    const params: unknown[] = [];

    batch.forEach((p, idx) => {
      const offset = idx * 11;
      values.push(
        `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10}, $${offset + 11})`
      );
      params.push(
        p.id,
        p.name || null,
        p.code || null,
        p.weight ?? null,
        p.deci ?? null,
        p.width ?? null,
        p.length ?? null,
        p.height ?? null,
        p.arrsku ? JSON.stringify(p.arrsku) : null,
        p.categoryId ?? null,
        p.extradata ? JSON.stringify(p.extradata) : null,
      );
    });

    await pool.query(`
      INSERT INTO wisersell_products
        (id, name, code, weight, deci, width, length, height, arr_sku, category_id, extra_data)
      VALUES ${values.join(', ')}
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        code = EXCLUDED.code,
        weight = EXCLUDED.weight,
        deci = EXCLUDED.deci,
        width = EXCLUDED.width,
        length = EXCLUDED.length,
        height = EXCLUDED.height,
        arr_sku = EXCLUDED.arr_sku,
        category_id = EXCLUDED.category_id,
        extra_data = EXCLUDED.extra_data,
        synced_at = NOW()
    `, params);
  }
}

export async function syncWisersell(): Promise<number> {
  const jobId = await createSyncJob('wisersell_sync', 'WISERSELL');

  try {
    await updateSyncJob(jobId, 'running');

    const creds = await getCredentials();
    const token = await getToken();
    const products = await fetchAllProducts(token, creds.api_url);

    if (products.length === 0) {
      await updateSyncJob(jobId, 'completed', 0);
      return 0;
    }

    await upsertProducts(products);

    await updateSyncJob(jobId, 'completed', products.length);
    logger.info(`[WisersellSync] Completed: ${products.length} products`);
    return products.length;
  } catch (err: any) {
    logger.error('[WisersellSync] Failed:', err.message);
    await updateSyncJob(jobId, 'failed', 0, err.message);
    throw err;
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
  const params: unknown[] = [id, status];
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
  }

  await pool.query(`UPDATE sync_jobs SET ${fields.join(', ')} WHERE id = $1`, params);
}
