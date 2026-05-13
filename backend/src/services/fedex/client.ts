import axios, { AxiosError } from 'axios';
import logger from '../../config/logger';

/**
 * FedEx Basic Integrated Visibility (Track API) client.
 * Docs: https://developer.fedex.com/api/en-us/catalog/track/docs.html
 *
 * - OAuth2 client_credentials grant (token TTL ~1h)
 * - In-memory token cache, auto-refresh 60s before expiry
 * - 401 üzerine bir kez force-refresh + retry
 * - Track endpoint max 30 tracking number / call (FedEx limit)
 */

const TOKEN_REFRESH_BUFFER_SEC = 60;
export const TRACK_BATCH_LIMIT = 30;

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

let cachedToken: CachedToken | null = null;

interface FedexConfig {
  apiBase: string;
  clientId: string;
  clientSecret: string;
  accountNumber: string;
}

function getConfig(): FedexConfig {
  const apiBase = process.env.FEDEX_API_BASE || 'https://apis.fedex.com';
  const clientId = process.env.FEDEX_CLIENT_ID;
  const clientSecret = process.env.FEDEX_CLIENT_SECRET;
  const accountNumber = process.env.FEDEX_ACCOUNT_NUMBER;
  if (!clientId || !clientSecret || !accountNumber) {
    throw new Error('FEDEX_CLIENT_ID, FEDEX_CLIENT_SECRET, FEDEX_ACCOUNT_NUMBER environment variables required');
  }
  return { apiBase, clientId, clientSecret, accountNumber };
}

async function fetchToken(): Promise<CachedToken> {
  const cfg = getConfig();
  const url = `${cfg.apiBase}/oauth/token`;
  const params = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
  });

  const response = await axios.post(url, params.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 15_000,
  });

  const data = response.data || {};
  if (typeof data.access_token !== 'string' || typeof data.expires_in !== 'number') {
    throw new Error(`FedEx OAuth invalid response: ${JSON.stringify(data).slice(0, 200)}`);
  }

  return {
    accessToken: data.access_token,
    expiresAt: Date.now() + (data.expires_in - TOKEN_REFRESH_BUFFER_SEC) * 1000,
  };
}

export async function getAccessToken(forceRefresh = false): Promise<string> {
  if (!forceRefresh && cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.accessToken;
  }
  cachedToken = await fetchToken();
  const ttl = Math.round((cachedToken.expiresAt - Date.now()) / 1000);
  logger.info(`[FedEx] OAuth2 token refreshed (TTL ${ttl}s)`);
  return cachedToken.accessToken;
}

export interface FedexTrackResult {
  trackingNumber: string;
  notFound: boolean;
  /** Transient API error (INTERNAL.SERVER.ERROR vs) — caller bunu DB'ye yazmamalı, retry edilsin. */
  isTransient?: boolean;
  errorCode?: string;
  errorMessage?: string;
  raw?: any;
}

async function postTrack(token: string, body: unknown): Promise<any> {
  const cfg = getConfig();
  const url = `${cfg.apiBase}/track/v1/trackingnumbers`;
  const response = await axios.post(url, body, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-locale': 'en_US',
    },
    timeout: 30_000,
  });
  return response.data;
}

export async function trackBatch(trackingNumbers: string[]): Promise<FedexTrackResult[]> {
  if (trackingNumbers.length === 0) return [];
  if (trackingNumbers.length > TRACK_BATCH_LIMIT) {
    throw new Error(`FedEx Track API max ${TRACK_BATCH_LIMIT} numbers per call, got ${trackingNumbers.length}`);
  }

  const body = {
    includeDetailedScans: true,
    trackingInfo: trackingNumbers.map(tn => ({ trackingNumberInfo: { trackingNumber: tn } })),
  };

  let token = await getAccessToken();
  let data;
  try {
    data = await postTrack(token, body);
  } catch (err) {
    const status = (err as AxiosError).response?.status;
    if (status === 401) {
      token = await getAccessToken(true);
      data = await postTrack(token, body);
    } else {
      throw err;
    }
  }

  const completeResults = data?.output?.completeTrackResults || [];
  const out: FedexTrackResult[] = [];

  for (const cr of completeResults) {
    const tn: string = cr.trackingNumber;
    const tr = cr.trackResults?.[0];

    if (!tr) {
      out.push({ trackingNumber: tn, notFound: true });
      continue;
    }

    if (tr.error) {
      // FedEx Track API "gerçek yok" vs "geçici hata" ayrımı:
      //   TRACKING.TRACKINGNUMBER.NOTFOUND → kalıcı, not_found=true
      //   INTERNAL.SERVER.ERROR / SYSTEM.UNEXPECTED.ERROR / vs → transient,
      //     retry edilmeli (caller DB'ye yazmamalı)
      // Önceden tüm error'lar not_found=true sayılıyordu → 35 tracking yanlış
      // işaretlenmiş (2026-05-13 audit).
      const isPermanentNotFound = tr.error.code === 'TRACKING.TRACKINGNUMBER.NOTFOUND';
      out.push({
        trackingNumber: tn,
        notFound: isPermanentNotFound,
        isTransient: !isPermanentNotFound,
        errorCode: tr.error.code,
        errorMessage: tr.error.message,
        raw: tr,
      });
      continue;
    }

    out.push({ trackingNumber: tn, notFound: false, raw: tr });
  }

  // FedEx sometimes returns fewer entries than requested if numbers are invalid;
  // fill missing ones as not_found so caller doesn't lose them.
  const returned = new Set(out.map(o => o.trackingNumber));
  for (const tn of trackingNumbers) {
    if (!returned.has(tn)) {
      out.push({ trackingNumber: tn, notFound: true, errorMessage: 'Not in API response' });
    }
  }

  return out;
}
