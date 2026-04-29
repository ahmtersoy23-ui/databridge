import axios from 'axios';
import { pool, sharedPool } from '../../config/database';
import logger from '../../config/logger';
import { decryptCredential } from '../../utils/crypto';

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

interface WisersellCategory {
  id: number;
  name: string;
}

// In-memory token cache
let cachedToken: string | null = null;
let tokenExpiry = 0;

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

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
  const row = result.rows[0];
  return { ...row, password: decryptCredential(row.password) };
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
      const waitSec = retryAfter ? Math.ceil(Number(retryAfter)) : 60;
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

// pageSize max 100 per Wisersell API docs. Paginate with 1100ms delay between pages (1 req/sec limit).
async function fetchAllProducts(token: string, apiUrl: string): Promise<WisersellProduct[]> {
  const url = apiUrl.replace(/\/$/, '');
  const all: WisersellProduct[] = [];
  let page = 0;

  while (true) {
    const res = await axios.post(
      `${url}/product/search`,
      { page, pageSize: 100 },
      { headers: { Authorization: `Bearer ${token}` }, timeout: 60_000 }
    );
    const rows: WisersellProduct[] = Array.isArray(res.data) ? res.data : (res.data?.rows ?? []);
    if (rows.length === 0) break;
    all.push(...rows);
    logger.info(`[WisersellSync] Page ${page}: ${rows.length} products (total: ${all.length})`);
    if (rows.length < 100) break;
    page++;
    await delay(1100); // respect 1 req/sec rate limit
  }
  return all;
}

async function fetchCategories(token: string, apiUrl: string): Promise<WisersellCategory[]> {
  const url = apiUrl.replace(/\/$/, '');
  const res = await axios.get(`${url}/category`, {
    headers: { Authorization: `Bearer ${token}` },
    timeout: 30_000,
  });
  return Array.isArray(res.data) ? res.data : [];
}

async function upsertCategories(categories: WisersellCategory[]): Promise<void> {
  if (categories.length === 0) return;
  const values: string[] = [];
  const params: unknown[] = [];
  categories.forEach((c, idx) => {
    values.push(`($${idx * 2 + 1}, $${idx * 2 + 2})`);
    params.push(c.id, c.name || null);
  });
  await pool.query(`
    INSERT INTO wisersell_categories (id, name)
    VALUES ${values.join(', ')}
    ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, synced_at = NOW()
  `, params);
}

async function upsertProducts(products: WisersellProduct[]): Promise<void> {
  const BATCH_SIZE = 500;

  for (let i = 0; i < products.length; i += BATCH_SIZE) {
    const batch = products.slice(i, i + BATCH_SIZE);
    const values: string[] = [];
    const params: unknown[] = [];

    batch.forEach((p, idx) => {
      const offset = idx * 13;
      values.push(
        `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10}, $${offset + 11}, $${offset + 12}, $${offset + 13})`
      );
      params.push(
        p.id,
        p.name || null,
        p.code || null,
        p.weight != null ? parseFloat(String(p.weight)) : null,
        p.deci != null ? parseFloat(String(p.deci)) : null,
        p.width != null ? parseFloat(String(p.width)) : null,
        p.length != null ? parseFloat(String(p.length)) : null,
        p.height != null ? parseFloat(String(p.height)) : null,
        p.arrsku ? JSON.stringify(p.arrsku) : null,
        p.categoryId ?? null,
        p.extradata ? JSON.stringify(p.extradata) : null,
        p.extradata?.['Size'] != null ? String(p.extradata['Size']) : null,
        p.extradata?.['Color'] != null ? String(p.extradata['Color']) : null,
      );
    });

    await pool.query(`
      INSERT INTO wisersell_products
        (id, name, code, weight, deci, width, length, height, arr_sku, category_id, extra_data, size, color)
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
        size = EXCLUDED.size,
        color = EXCLUDED.color,
        synced_at = NOW()
    `, params);
  }
}

interface ChangeSample {
  sku: string;
  old_name?: string | null;
  new_name?: string | null;
  old_category?: string | null;
  new_category?: string | null;
}

/**
 * Sync wisersell_products → pricelab_db.products
 * Existing products: updates name and category only.
 * New products: inserts with all available data (name, category, weight, size, dimensions).
 */
async function syncProductsTable(): Promise<{ updated: number; inserted: number; samples: ChangeSample[] }> {
  // Read from wisersell_products + categories (databridge_db).
  // DISTINCT ON (code) + ORDER BY id DESC: ayni code icin birden fazla wisersell kaydi
  // varsa (gozlem: 44 duplicate code mevcut) en yeni id'yi tut. Aksi takdirde alttaki
  // ON CONFLICT DO UPDATE ayni product_sku'yu batch icinde iki kez gorur ve fail eder
  // ("ON CONFLICT DO UPDATE command cannot affect row a second time").
  const result = await pool.query(`
    SELECT DISTINCT ON (wp.code)
           wp.code, wp.name, wp.weight, wp.deci,
           wp.width, wp.length, wp.height,
           wc.name AS category_name
    FROM wisersell_products wp
    LEFT JOIN wisersell_categories wc ON wp.category_id = wc.id
    WHERE wp.code IS NOT NULL AND wp.code != '' AND wp.name IS NOT NULL
    ORDER BY wp.code, wp.id DESC
  `);

  if (result.rows.length === 0) return { updated: 0, inserted: 0, samples: [] };

  const BATCH = 200;
  const SAMPLE_LIMIT = 100;
  let updated = 0;
  let inserted = 0;
  const samples: ChangeSample[] = [];

  for (let i = 0; i < result.rows.length; i += BATCH) {
    const batch = result.rows.slice(i, i + BATCH);

    const codes = batch.map((r: { code: string }) => r.code);
    const names = batch.map((r: { name: string }) => r.name);
    const categories = batch.map((r: { category_name: string | null }) => r.category_name || null);
    const weights = batch.map((r: { weight: string | null }) => r.weight != null ? parseFloat(r.weight) : null);
    const sizes = batch.map((r: { deci: string | null }) => r.deci != null ? parseFloat(r.deci) : null);
    const widths = batch.map((r: { width: string | null }) => r.width != null ? parseFloat(r.width) : null);
    const lengths = batch.map((r: { length: string | null }) => r.length != null ? parseFloat(r.length) : null);
    const heights = batch.map((r: { height: string | null }) => r.height != null ? parseFloat(r.height) : null);

    // Diff için mevcut kayıtları önceden çek (sample_changes audit'i için)
    let existingMap = new Map<string, { name: string | null; category: string | null }>();
    if (samples.length < SAMPLE_LIMIT) {
      const existing = await sharedPool.query(
        `SELECT product_sku, name, category FROM products WHERE product_sku = ANY($1::text[])`,
        [codes]
      );
      existingMap = new Map(
        existing.rows.map((r: { product_sku: string; name: string | null; category: string | null }) => [
          r.product_sku, { name: r.name, category: r.category },
        ])
      );
    }

    const res = await sharedPool.query(`
      INSERT INTO products (product_sku, name, category, weight, size, width, length, height, source)
      SELECT t.product_sku, t.name, t.category, t.weight, t.size, t.width, t.length, t.height, 'wisersell'
      FROM UNNEST(
        $1::text[], $2::text[], $3::text[],
        $4::numeric[], $5::numeric[], $6::numeric[], $7::numeric[], $8::numeric[]
      ) AS t(product_sku, name, category, weight, size, width, length, height)
      ON CONFLICT (product_sku) DO UPDATE SET
        name = EXCLUDED.name,
        category = COALESCE(EXCLUDED.category, products.category),
        updated_at = NOW()
      WHERE products.name IS DISTINCT FROM EXCLUDED.name
         OR products.category IS DISTINCT FROM EXCLUDED.category
    `, [codes, names, categories, weights, sizes, widths, lengths, heights]);

    const affected = (res as unknown as { rowCount?: number }).rowCount || 0;
    updated += affected;

    // Bu batch'teki gerçek değişiklikleri sample'a ekle (cap: SAMPLE_LIMIT)
    for (let j = 0; j < codes.length && samples.length < SAMPLE_LIMIT; j++) {
      const old = existingMap.get(codes[j]);
      if (!old) continue; // yeni insert — UPDATE değişikliği değil
      const newCat = categories[j] ?? old.category;
      const nameChanged = old.name !== names[j];
      const categoryChanged = old.category !== newCat;
      if (nameChanged || categoryChanged) {
        samples.push({
          sku: codes[j],
          old_name: nameChanged ? old.name : undefined,
          new_name: nameChanged ? names[j] : undefined,
          old_category: categoryChanged ? old.category : undefined,
          new_category: categoryChanged ? newCat : undefined,
        });
      }
    }
  }

  // Count actual new inserts (products with source='wisersell' created recently)
  const newCount = await sharedPool.query(
    `SELECT COUNT(*) as cnt FROM products WHERE source = 'wisersell' AND created_at > NOW() - INTERVAL '1 minute'`
  );
  inserted = parseInt(newCount.rows[0]?.cnt || '0');
  updated = updated - inserted;

  logger.info(`[WisersellSync] Products table sync: ${updated} updated, ${inserted} inserted, ${samples.length} sample changes`);
  return { updated, inserted, samples };
}

export async function syncWisersell(): Promise<number> {
  const jobId = await createSyncJob('wisersell_sync', 'WISERSELL');

  try {
    await updateSyncJob(jobId, 'running');

    const creds = await getCredentials();
    const token = await getToken();
    await delay(1100); // respect 1 req/sec after token fetch

    const products = await fetchAllProducts(token, creds.api_url);
    await delay(1100); // respect 1 req/sec before categories

    const categories = await fetchCategories(token, creds.api_url);
    logger.info(`[WisersellSync] Fetched ${categories.length} categories`);
    await upsertCategories(categories);

    if (products.length === 0) {
      await updateSyncJob(jobId, 'completed', 0);
      return 0;
    }

    await upsertProducts(products);

    // Sync wisersell_products → pricelab_db.products (name, category, dimensions)
    const startedAt = new Date();
    const { updated, inserted, samples } = await syncProductsTable();

    // Hafif audit log: sync başına özet + ilk 100 değişikliğin diff örneği
    try {
      await pool.query(
        `INSERT INTO wisersell_sync_log (started_at, finished_at, inserted_count, updated_count, sample_changes)
         VALUES ($1, NOW(), $2, $3, $4)`,
        [startedAt, inserted, updated, JSON.stringify(samples)]
      );
    } catch (logErr: any) {
      logger.error('[WisersellSync] Failed to write sync log:', logErr.message);
    }

    await updateSyncJob(jobId, 'completed', products.length);
    logger.info(`[WisersellSync] Completed: ${products.length} products, ${categories.length} categories`);
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
