import axios from 'axios';
import { pool } from '../../config/database';
import { decryptCredential } from '../../utils/crypto';
import logger from '../../config/logger';

/**
 * Wisersell WEB APP client (REST API'den ayrı sistem).
 *
 * Auth: POST /api/auth/login { data: base64({userInfo:{email,password}}) } → JWT (4h)
 * Excel: GET /api/excel/shipment, custom 'query' header (base64 JSON filtre) → xlsx binary
 *
 * REST API client (wisersellSync.ts) catalog sync için. Bu client shipment Excel için.
 */

const TOKEN_REFRESH_BUFFER_SEC = 300; // 5 dk önce yenile

interface WebCredentials {
  email: string;
  password: string;
  baseUrl: string;
}

interface CachedToken {
  jwt: string;
  expiresAt: number;
}

let cachedToken: CachedToken | null = null;

export function clearWisersellWebTokenCache(): void {
  cachedToken = null;
}

async function getWebCredentials(): Promise<WebCredentials> {
  const r = await pool.query(
    'SELECT web_email, web_password, web_url FROM wisersell_credentials WHERE id = 1',
  );
  if (!r.rows.length || !r.rows[0].web_email || !r.rows[0].web_password) {
    throw new Error('Wisersell web credentials yapılandırılmamış (web_email / web_password). Settings UI üzerinden ekleyin.');
  }
  const row = r.rows[0];
  return {
    email: row.web_email,
    password: decryptCredential(row.web_password),
    baseUrl: (row.web_url || 'https://www.wisersell.com').replace(/\/$/, ''),
  };
}

function decodeJwtExp(jwt: string): number {
  try {
    const payload = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString());
    return (payload.exp || 0) * 1000;
  } catch {
    return Date.now() + 3_600_000; // fallback: 1 saat
  }
}

async function login(): Promise<CachedToken> {
  const { email, password, baseUrl } = await getWebCredentials();
  const data = Buffer.from(JSON.stringify({ userInfo: { email, password } })).toString('base64');

  const res = await axios.post(
    `${baseUrl}/api/auth/login`,
    { data },
    {
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/plain, */*',
        Origin: baseUrl,
        Referer: `${baseUrl}/ws/auth/login`,
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/147.0.0.0',
      },
      timeout: 15_000,
      validateStatus: () => true,
    },
  );

  if (res.status !== 200 || !res.data?.token) {
    const msg = typeof res.data === 'object' ? res.data.message : String(res.data);
    throw new Error(`Wisersell web login failed (${res.status}): ${msg}`);
  }

  const jwt = res.data.token as string;
  const expiresAt = decodeJwtExp(jwt) - TOKEN_REFRESH_BUFFER_SEC * 1000;
  return { jwt, expiresAt };
}

export async function getWebToken(forceRefresh = false): Promise<string> {
  if (!forceRefresh && cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.jwt;
  }
  cachedToken = await login();
  const ttl = Math.round((cachedToken.expiresAt - Date.now()) / 1000);
  logger.info(`[WisersellWeb] login OK, JWT cached (TTL ${ttl}s)`);
  return cachedToken.jwt;
}

export interface ShipmentExcelOptions {
  /** Status array — varsayılan [1] (Gönderilmiş). [1,2,3,...] çoklu */
  status?: number[];
  globalFilter?: string;
  sorting?: Array<Record<string, unknown>>;
}

/**
 * Wisersell shipment Excel'ini buffer olarak döndürür.
 * Custom 'query' header'da base64 JSON filtre.
 */
export async function downloadShipmentsExcel(opts: ShipmentExcelOptions = {}): Promise<Buffer> {
  const { baseUrl } = await getWebCredentials();
  const filter = {
    globalFilter: opts.globalFilter ?? '',
    sorting: opts.sorting ?? [],
    status: opts.status ?? [1],
  };
  const query = Buffer.from(JSON.stringify(filter)).toString('base64');

  let token = await getWebToken();
  let res = await axios.get(`${baseUrl}/api/excel/shipment`, {
    headers: {
      Authorization: token,
      query,
      Accept: 'application/json, text/plain, */*',
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/147.0.0.0',
    },
    responseType: 'arraybuffer',
    timeout: 60_000,
    validateStatus: () => true,
  });

  // 401 → token expired, force refresh + retry
  if (res.status === 401) {
    logger.warn('[WisersellWeb] 401 → token refresh + retry');
    token = await getWebToken(true);
    res = await axios.get(`${baseUrl}/api/excel/shipment`, {
      headers: {
        Authorization: token,
        query,
        Accept: 'application/json, text/plain, */*',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/147.0.0.0',
      },
      responseType: 'arraybuffer',
      timeout: 60_000,
      validateStatus: () => true,
    });
  }

  if (res.status !== 200) {
    const body = Buffer.from(res.data).toString('utf8').slice(0, 300);
    throw new Error(`Wisersell shipment Excel HTTP ${res.status}: ${body}`);
  }

  const ct = res.headers['content-type'] || '';
  if (!ct.includes('spreadsheetml')) {
    throw new Error(`Wisersell shipment beklenmeyen content-type: ${ct}`);
  }

  return Buffer.from(res.data);
}
