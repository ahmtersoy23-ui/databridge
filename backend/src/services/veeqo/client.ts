import axios, { AxiosError, AxiosInstance } from 'axios';
import logger from '../../config/logger';
import { withRetry } from '../../utils/retry';

/**
 * Veeqo Rate Shopping API client (US, Amazon Shipping v2).
 * Docs: https://developers.veeqo.com/rate-shopping-api/
 *
 * Auth: özel (own-account) entegrasyon → `x-api-key` header. OAuth GEREKMEZ
 * (OAuth yalnız Appstore public app'leri için). Sandbox yok, aynı key dev+prod.
 *
 * Akış:
 *   1) getRates()        POST /shipping/api/v1/rates        → quotes[] + remote_shipment_id + request_token
 *   2) bookShipment()    POST /shipping/api/v1/shipments    → etiket SATIN AL (tracking + label) — GERÇEK PARA
 *   3) getLabel()        GET  /shipping/api/v1/shipments/{id}/label.{fmt}
 *   4) cancelShipment()  DELETE /shipping/api/v1/shipments/{id}  → kullanılmaz + ücret iadesi (test)
 *
 * Klasik REST (orders/deliver_to) aynı host + key ile: getOrderByNumber().
 */

const BASE = 'https://api.veeqo.com';
const RS = '/shipping/api/v1';

function getApiKey(): string {
  const key = process.env.VEEQO_API_KEY;
  if (!key) throw new Error('VEEQO_API_KEY environment variable required');
  return key;
}

let _http: AxiosInstance | null = null;
function http(): AxiosInstance {
  // lazy: module-level'da env okumak dotenv öncesi crash eder
  if (!_http) {
    _http = axios.create({
      baseURL: BASE,
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      timeout: 35_000,
    });
  }
  // key her çağrıda header'a (instance cache'lense de key rotasyonuna dayanıklı)
  _http.defaults.headers.common['x-api-key'] = getApiKey();
  return _http;
}

// ---- Tipler ----

export interface VeeqoAddress {
  name: string;
  company?: string;
  phone: string;        // E.164 (+1…) — Amazon ShipFrom intl telefonu reddeder
  email?: string;
  line1: string;
  line2?: string;
  town: string;         // şehir
  county: string;       // eyalet (US state)
  postcode: string;
  country_code: string; // 'US'
}

export interface VeeqoParcel {
  weight: number;
  weight_unit: 'lb' | 'kg' | 'oz' | 'g';
  length: number;
  width: number;
  height: number;
  dimension_unit: 'in' | 'cm';
}

export interface VeeqoRateQuote {
  rate_id: string;            // book için zorunlu kimlik
  service_name: string;       // "USPS Ground Advantage" vb.
  service_carrier: string;    // usps | ups | fedex
  carrier_id?: string;
  total_charge: string;       // "6.40" — string (currency)
  base_rate?: string;
  delivery_estimate?: string;
  charges?: unknown[];
  shipping_service_options?: unknown[];
  [k: string]: unknown;
}

export interface VeeqoRatesResult {
  remote_shipment_id: string;
  request_token: string;
  expires_at: string;
  quotes: VeeqoRateQuote[];
  unavailable_quotes?: unknown[];
}

export interface VeeqoRatesRequest {
  to_address: VeeqoAddress;
  from_address: VeeqoAddress;
  parcels: VeeqoParcel[];
  customer_reference?: string;
  contents?: string;
  is_amazon_order?: boolean;
  channel_items?: unknown[];
}

export interface VeeqoBookedShipment {
  tracking_number: string;
  carrier_id?: string;
  service_carrier?: string;
  service_name?: string;
  service_id?: string;
  label?: string;             // base64 (label_format'a göre)
  total_charge?: { value: number; unit: string };
  charges?: unknown[];
}

export interface VeeqoBookResult {
  /** remote_shipment_id → booked shipment */
  successful: Record<string, VeeqoBookedShipment & { id?: string; shipment_id?: string }>;
  failed: Record<string, { remote_shipment_id?: string; error_messages?: string[] }>;
}

// ---- Hata özetleme (carrier nested error'larını okunaklı string'e çevir) ----

function veeqoErr(err: unknown, label: string): Error {
  const ax = err as AxiosError;
  const status = ax.response?.status;
  const data = ax.response?.data as { error_messages?: unknown[]; error?: string } | undefined;
  let detail: string;
  if (data?.error_messages?.length) detail = data.error_messages.map((m) => (typeof m === 'string' ? m : JSON.stringify(m))).join('; ');
  else if (data?.error) detail = data.error;
  else detail = ax.message;
  return new Error(`Veeqo ${label}${status ? ` [HTTP ${status}]` : ''}: ${detail}`.slice(0, 600));
}

// ---- Endpoint'ler ----

/** Oranları çek (idempotent okuma → withRetry uygun). */
export async function getRates(req: VeeqoRatesRequest): Promise<VeeqoRatesResult> {
  try {
    return await withRetry(async () => {
      const res = await http().post(`${RS}/rates`, req);
      return res.data as VeeqoRatesResult;
    }, { label: 'veeqo-rates', maxRetries: 3, baseDelayMs: 3_000 });
  } catch (err) {
    throw veeqoErr(err, 'rates');
  }
}

/**
 * Etiket SATIN AL — GERÇEK PARA. Tek deneme, RETRY YOK:
 * başarılı ama yanıtı kaybolan istekte retry = çift etiket + çift ücret.
 */
export async function bookShipment(input: {
  remoteShipmentId: string;
  rateId: string;
  requestToken?: string;
  labelFormat?: 'PDF' | 'PNG' | 'ZPL' | 'JPEG';
  options?: Record<string, unknown>; // value_added_service__*, liability_amount...
}): Promise<VeeqoBookResult> {
  const body = {
    label_format: input.labelFormat ?? 'PDF',
    ...(input.requestToken ? { request_token: input.requestToken } : {}),
    shipments: [{ remote_shipment_id: input.remoteShipmentId, rate_id: input.rateId, ...(input.options ?? {}) }],
  };
  try {
    const res = await http().post(`${RS}/shipments`, body);
    return res.data as VeeqoBookResult;
  } catch (err) {
    throw veeqoErr(err, 'book-shipment');
  }
}

/** Etiket dosyasını indir (binary). format label_format ile uyumlu olmalı. */
export async function getLabel(shipmentId: string, format: 'pdf' | 'png' | 'zpl' | 'jpeg' = 'pdf'): Promise<Buffer> {
  try {
    const res = await http().get(`${RS}/shipments/${encodeURIComponent(shipmentId)}/label.${format}`, {
      responseType: 'arraybuffer',
      headers: { accept: 'application/octet-stream' },
    });
    return Buffer.from(res.data as ArrayBuffer);
  } catch (err) {
    throw veeqoErr(err, 'get-label');
  }
}

/** Shipment'ı iptal et (test → kullanılmaz + ücret iadesi). */
export async function cancelShipment(shipmentId: string): Promise<void> {
  try {
    await http().delete(`${RS}/shipments/${encodeURIComponent(shipmentId)}`);
  } catch (err) {
    throw veeqoErr(err, 'cancel-shipment');
  }
}

/** Klasik REST: Amazon order no ile Veeqo siparişini bul (deliver_to + line_items.remote_id için). */
export async function getOrderByNumber(amazonOrderNumber: string): Promise<Record<string, unknown> | null> {
  try {
    return await withRetry(async () => {
      const res = await http().get('/orders', { params: { query: amazonOrderNumber, page_size: 5 } });
      const arr = Array.isArray(res.data) ? res.data : (res.data?.orders ?? []);
      const exact = arr.find((o: { number?: string }) => o.number === amazonOrderNumber) ?? arr[0] ?? null;
      return exact;
    }, { label: 'veeqo-order-lookup', maxRetries: 3, baseDelayMs: 2_000 });
  } catch (err) {
    throw veeqoErr(err, 'order-lookup');
  }
}

/** quotes'tan en ucuzu seç (servis allow-list ile filtrelenmiş liste verilmeli). */
export function cheapestQuote(quotes: VeeqoRateQuote[]): VeeqoRateQuote | null {
  if (!quotes?.length) return null;
  return [...quotes].sort((a, b) => parseFloat(a.total_charge) - parseFloat(b.total_charge))[0];
}

let _ranLog = false;
export function logVeeqoOnce(): void {
  if (_ranLog) return;
  _ranLog = true;
  logger.info('[Veeqo] Rate Shopping client hazır (x-api-key)');
}
