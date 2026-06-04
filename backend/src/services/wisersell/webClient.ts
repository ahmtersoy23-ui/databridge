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

export interface OrderExcelOptions {
  /** ISO datetime "2025-01-01T00:00:00.000Z" formatında. Tek tarafı boş bırakılabilir. */
  shipmentDateFrom?: string;
  shipmentDateTo?: string;
  /** Default [5, 8] = Kapalı + Teslim Edildi. */
  status?: number[];
  storeFilters?: unknown[];
  globalFilter?: string;
  sorting?: Array<Record<string, unknown>>;
}

/**
 * Wisersell sipariş (Kapalı) Excel'ini buffer olarak döndürür.
 * /api/excel/order endpoint, query base64 filtre, status: [5,8].
 */
export async function downloadOrdersExcel(opts: OrderExcelOptions = {}): Promise<Buffer> {
  const { baseUrl } = await getWebCredentials();
  const filter = {
    shipment_date: [opts.shipmentDateFrom ?? '', opts.shipmentDateTo ?? ''],
    storeFilters: opts.storeFilters ?? [],
    globalFilter: opts.globalFilter ?? '',
    sorting: opts.sorting ?? [],
    status: opts.status ?? [5, 8],
  };
  const query = Buffer.from(JSON.stringify(filter)).toString('base64');

  let token = await getWebToken();
  const doRequest = async (tk: string) => axios.get(`${baseUrl}/api/excel/order`, {
    headers: {
      Authorization: tk,
      query,
      Accept: 'application/json, text/plain, */*',
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/147.0.0.0',
    },
    responseType: 'arraybuffer',
    timeout: 180_000, // büyük dosya — 3 dakika
    validateStatus: () => true,
  });

  let res = await doRequest(token);
  if (res.status === 401) {
    logger.warn('[WisersellWeb] order Excel 401 → token refresh + retry');
    token = await getWebToken(true);
    res = await doRequest(token);
  }

  if (res.status !== 200) {
    const body = Buffer.from(res.data).toString('utf8').slice(0, 300);
    throw new Error(`Wisersell order Excel HTTP ${res.status}: ${body}`);
  }

  const ct = res.headers['content-type'] || '';
  if (!ct.includes('spreadsheetml')) {
    throw new Error(`Wisersell order beklenmeyen content-type: ${ct}`);
  }

  return Buffer.from(res.data);
}

// ── Routing otomasyonu: JSON sipariş poll + yazma (status/update, external-close) ──
// Excel sync'ten ayrı; sık poll + iki yönlü yazma için. Aynı web auth (ham JWT).

const WS_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/147.0.0.0';

export interface WisersellOrderItem {
  id?: number;
  title?: string;
  quantity?: number;
  variant?: string | null;
  marketplace_sku?: string | null;
  listing?: {
    product?: { id?: number; code?: string | null; name?: string | null; tariffCode?: string | null } | null;
  } | null;
}

export interface WisersellOrderRow {
  id: number;
  order_code: string;
  storeId?: number | null;
  countryId?: number | null;
  currency_id?: number | null;
  orderstatus_id?: number | null;
  labelNo?: string | null;
  name?: string | null;
  shipment_date?: string | null;
  created_at?: string | null;
  customer?: { id?: number; name?: string | null } | null;
  orderitems?: WisersellOrderItem[];
  [k: string]: unknown;
}

interface OrdersResponse {
  count: number;
  rows: WisersellOrderRow[];
}

/**
 * Açık siparişleri JSON olarak çeker (GET /api/orders). base64 `query` header'da filtre:
 *   {storeFilters:[], globalFilter:"", pageParam:N, pageSize:50, sorting:[], status:[2,6]}
 * (2026-06-04 DevTools ile doğrulandı). pageParam 0-indexli sonsuz-scroll sayfalama;
 * tüm sayfalar count'a kadar toplanır. storeFilters:[] = tüm store'lar (çağıran filtreler).
 */
export async function getOpenOrders(opts: { status?: number[]; pageSize?: number; maxPages?: number } = {}): Promise<WisersellOrderRow[]> {
  const { baseUrl } = await getWebCredentials();
  const status = opts.status ?? [2, 6];
  const pageSize = opts.pageSize ?? 50;
  const maxPages = opts.maxPages ?? 100;

  const fetchPage = async (pageParam: number): Promise<OrdersResponse> => {
    const filter = { storeFilters: [], globalFilter: '', pageParam, pageSize, sorting: [], status };
    const query = Buffer.from(JSON.stringify(filter)).toString('base64');
    const doRequest = (tk: string) => axios.get(`${baseUrl}/api/orders`, {
      headers: { Authorization: tk, query, Accept: 'application/json, text/plain, */*', 'User-Agent': WS_UA },
      timeout: 30_000,
      validateStatus: () => true,
    });
    let token = await getWebToken();
    let res = await doRequest(token);
    if (res.status === 401) {
      logger.warn('[WisersellWeb] orders poll 401 → token refresh + retry');
      token = await getWebToken(true);
      res = await doRequest(token);
    }
    if (res.status !== 200) {
      const body = typeof res.data === 'string' ? res.data.slice(0, 300) : JSON.stringify(res.data).slice(0, 300);
      throw new Error(`Wisersell GET /orders HTTP ${res.status}: ${body}`);
    }
    const data = res.data;
    if (Array.isArray(data)) return { count: data.length, rows: data };
    return { count: Number(data?.count ?? 0), rows: Array.isArray(data?.rows) ? data.rows : [] };
  };

  const all: WisersellOrderRow[] = [];
  const first = await fetchPage(0);
  all.push(...first.rows);
  const totalPages = Math.min(maxPages, Math.ceil((first.count || all.length) / pageSize));
  for (let p = 1; p < totalPages; p++) {
    const r = await fetchPage(p);
    if (!r.rows.length) break;
    all.push(...r.rows);
  }
  return all;
}

export interface WisersellOrderDetail {
  name: string | null;
  address: string | null;
  firstline: string | null;
  secondline: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  phone: string | null;
  email: string | null;
}

/**
 * Tek siparişin detayını çeker (GET /api/orders/{id}) — liste JSON'da olmayan TAM teslim adresi.
 * (Endpoint 200 yerine 201 dönüyor — Wisersell tuhaflığı, ikisini de kabul et.)
 */
export async function getOrderDetail(orderId: number): Promise<WisersellOrderDetail | null> {
  const { baseUrl } = await getWebCredentials();
  const doRequest = (tk: string) => axios.get(`${baseUrl}/api/orders/${orderId}`, {
    headers: { Authorization: tk, Accept: 'application/json, text/plain, */*', 'User-Agent': WS_UA },
    timeout: 20_000,
    validateStatus: () => true,
  });
  let token = await getWebToken();
  let res = await doRequest(token);
  if (res.status === 401) { token = await getWebToken(true); res = await doRequest(token); }
  if (res.status !== 200 && res.status !== 201) return null;
  const d = res.data || {};
  return {
    name: d.name ?? null, address: d.address ?? null,
    firstline: d.firstline ?? null, secondline: d.secondline ?? null,
    city: d.city ?? null, state: d.state ?? null, zip: d.zip ?? null,
    phone: d.phone ?? null, email: d.email ?? null,
  };
}

/**
 * Sipariş(ler)i hedef statüye geçirir (POST /api/orders/status/update).
 * Kargoya Hazır = 11. ids[] toplu destekli. Etkilenen id dizisini döndürür.
 */
export async function markOrdersStatus(ids: number[], orderstatusId: number): Promise<number[]> {
  if (!ids.length) return [];
  const { baseUrl } = await getWebCredentials();
  const body = { query: { ids, orderstatusId, operationalstatusId: null } };
  const doRequest = (tk: string) => axios.post(`${baseUrl}/api/orders/status/update`, body, {
    headers: { Authorization: tk, 'Content-Type': 'application/json', Accept: 'application/json, text/plain, */*', Origin: baseUrl, 'User-Agent': WS_UA },
    timeout: 30_000,
    validateStatus: () => true,
  });
  let token = await getWebToken();
  let res = await doRequest(token);
  if (res.status === 401) {
    token = await getWebToken(true);
    res = await doRequest(token);
  }
  if (res.status !== 200 && res.status !== 201) {
    const msg = typeof res.data === 'object' ? JSON.stringify(res.data) : String(res.data);
    throw new Error(`Wisersell status/update HTTP ${res.status}: ${msg?.slice(0, 300)}`);
  }
  return Array.isArray(res.data) ? res.data : ids;
}

/**
 * Siparişi tracking ile harici kapatır (POST /api/orders/external-close/{id}).
 * Pratikte yalnız carrierId + trackingCode değişken; ölçüler 0 geçilir.
 */
export async function closeExternalOrder(
  orderId: number,
  carrierId: number,
  trackingCode: string,
): Promise<void> {
  const { baseUrl } = await getWebCredentials();
  const body = {
    orderId, carrierId, trackingCode,
    width: 0, height: 0, length: 0, weight: 0,
    tarifCode: '', deci: 0, price: 0, description: '', quantity: 0,
  };
  const doRequest = (tk: string) => axios.post(`${baseUrl}/api/orders/external-close/${orderId}`, body, {
    headers: { Authorization: tk, 'Content-Type': 'application/json', Accept: 'application/json, text/plain, */*', Origin: baseUrl, 'User-Agent': WS_UA },
    timeout: 30_000,
    validateStatus: () => true,
  });
  let token = await getWebToken();
  let res = await doRequest(token);
  if (res.status === 401) {
    token = await getWebToken(true);
    res = await doRequest(token);
  }
  if (res.status !== 200 && res.status !== 201) {
    const msg = typeof res.data === 'object' ? JSON.stringify(res.data) : String(res.data);
    throw new Error(`Wisersell external-close ${orderId} HTTP ${res.status}: ${msg?.slice(0, 300)}`);
  }
}
