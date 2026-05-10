import 'dotenv/config';
import axios from 'axios';
import { pool } from '../config/database';
import { decryptCredential } from '../utils/crypto';

/**
 * Wisersell API'sinde shipment/order endpoint'i var mi kesfetmek icin probe.
 * Token catalog sync icin zaten kullaniliyor — ayni token ile diger endpoint'leri dene.
 */

const CANDIDATES = [
  '/products',          // bilinen endpoint, control
  '/categories',        // bilinen
  '/orders',
  '/order',
  '/salesorders',
  '/sales-orders',
  '/sales/orders',
  '/shipments',
  '/shipment',
  '/shippings',
  '/shipping',
  '/sevkiyat',
  '/kargo',
  '/kargolar',
  '/cargo',
  '/cargos',
  '/labels',
  '/label',
  '/tracking',
  '/trackings',
  '/customers',
  '/clients',
  '/marketplaces',
  '/stores',
];

async function main(): Promise<void> {
  const credsR = await pool.query(
    'SELECT email, password, api_url FROM wisersell_credentials WHERE id = 1',
  );
  if (!credsR.rows.length) {
    console.error('Wisersell credentials yok');
    process.exit(1);
  }
  const { email, password: encPwd, api_url } = credsR.rows[0];
  const password = decryptCredential(encPwd);
  const baseUrl = api_url.replace(/\/$/, '');

  // Token
  console.log(`[wisersell] base: ${baseUrl}`);
  const tokenRes = await axios.post(`${baseUrl}/token`, { email, password });
  const token = tokenRes.data.token;
  console.log('[wisersell] token OK');

  console.log('\n--- ENDPOINT PROBE ---');
  for (const ep of CANDIDATES) {
    try {
      const res = await axios.get(`${baseUrl}${ep}`, {
        headers: { Authorization: `Bearer ${token}` },
        params: { size: 1, page: 1 },
        timeout: 8000,
        validateStatus: () => true,
      });
      const status = res.status;
      const sample =
        typeof res.data === 'object'
          ? JSON.stringify(res.data).slice(0, 220)
          : String(res.data).slice(0, 120);
      const mark = status >= 200 && status < 300 ? '✓' : '✗';
      console.log(`${mark} ${ep.padEnd(20)} → ${status}  ${sample}`);
    } catch (err: any) {
      console.log(`✗ ${ep.padEnd(20)} → NET  ${err.message?.slice(0, 80) || ''}`);
    }
    // küçük gap rate-limit'e takılmayalım
    await new Promise(r => setTimeout(r, 200));
  }

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
