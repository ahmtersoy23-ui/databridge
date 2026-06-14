import { getSpApiClient, getCredentialsById } from './client';
import { getListingState } from './listingsPush';
import { pool } from '../../config/database';
import { withRetry } from '../../utils/retry';
import logger from '../../config/logger';

/**
 * Geçici diagnostik (10 gün): 50 Amazon FBM SKU'sunun anlık fulfillment_availability.quantity'sini
 * 30 dk'da bir snapshot'lar → fbm_qty_tracking. Amaç: bizim push'umuz dışında bir kaynağın
 * stoğu 0'ladığını zaman çizelgesiyle yakalamak (DS-002 P9 sorunlu set + farklı kategorilerden 43).
 * ~2026-06-24'ten sonra job kendini durdurur (zorunlu temizlik deploy'u olmasın). Sonra kod silinir.
 */

const US_MARKETPLACE = 'ATVPDKIKX0DER';
const CRED_ID = 1; // US = MDN / NA credential
// 2026-06-25 00:00 UTC sonrası snapshot alınmaz (10 günlük pencere doldu).
const END_AT = Date.UTC(2026, 5, 25, 0, 0, 0); // ay 0-indexli: 5 = Haziran

// 7 DS-002 P9 (sorunlu/referans set — Part 2 reconcile de bunları kapsar) + 43 çeşitli (her kategoriden).
export const TRACKED_FBM_SKUS: string[] = [
  // --- DS-002 P9 (Alsat — sorunlu set) ---
  'DS00200XD8T2-Gemstone-P9', 'DS002006YCQQ-Vermilion-P9', 'DS002009CZ36-Babylon-P9',
  'DS002004XJ7N-Earthcore-P9', 'DS002006EKMH-Silverstone-P9', 'DS00200FNYJ3-Shadowstone-P9',
  'DS00200SK91Z-Sandstone-P9',
  // --- Alsat (diğer) ---
  'AHM_91_Walnut', 'AHM_91_White',
  // --- CFW Ahşap Harita ---
  '0N-Q4GS-NFOT', '3DMAP01-FBM', '4P-VV7R-RWWE', 'AHM-48_B3_BALL',
  // --- CFW Metal ---
  '09-6LW4-SWNC', '0C-Y0FW-LC64-FBM', '0L-5VG8-DAFOM', '0T-YSWL-8JBM',
  // --- CFW Metal Üstü Ahşap ---
  'CCMA-5_MIX_LAR', 'CCMA-5_MIX_MED',
  // --- Döküm ---
  'CR00100D6NNZ', 'CR00100ZAFQX', 'CR00200SWXGE', 'CR00200VA5JN',
  // --- İslami Takı ---
  'IJ-3-GOLD', 'IJ-3-SILVER',
  // --- IWA Ahşap ---
  '05-V9D4-NM8C', '0K-M6GG-GYKK', '0N-468L-VJFX', '0O-1G55-SGFH',
  // --- IWA Metal ---
  '03-Z2GQ-K9XT', '0O-H36E-9S6U-FBM', '0U-5RNH-KAON', '17-NR2U-3Q55',
  // --- IWA Tabletop ---
  '4C-50GL-0361', '6P-4JDK-YFRG', 'HF-SJIM-VP5L-fbm', 'I8-U25Q-C5EK',
  // --- Kanvas ---
  '02-FVXC-15U8', '0L-0RT2-6EIE', '16-UGYL-0RU9', '1C-V5FS-4BY4',
  // --- Mobilya ---
  '6H-73UK-4MO4', 'AHM1240DTXP3', 'AHM1240HTMCY',
  // --- Montaj Atölyesi ---
  'AHM_138', 'AHM_145_White',
  // --- Shukran Cam ---
  '00-C7TP-0V4V', '03-1TJN-HW3U', '4A-38H0-4WVH', '4T-A7Y3-NYHM',
];

/**
 * Tüm izlenen SKU'lar için Amazon FBM quantity oku ve snapshot satırı yaz.
 * Salt-okuma (getListingsItem) + INSERT; Amazon'a YAZMAZ. withSyncLog döndürdüğü sayı = yazılan satır.
 */
export async function snapshotFbmQty(): Promise<number> {
  if (Date.now() >= END_AT) {
    logger.info('[fbmQtyTracker] 10 günlük pencere doldu — snapshot atlandı (kod silinebilir)');
    return 0;
  }
  const creds = await getCredentialsById(CRED_ID);
  if (!creds?.seller_id) throw new Error(`cred ${CRED_ID} için seller_id yok`);
  const sellerId = creds.seller_id;
  const client = await getSpApiClient(CRED_ID);

  let written = 0;
  for (const sku of TRACKED_FBM_SKUS) {
    try {
      const st = await withRetry(() => getListingState(client, sellerId, sku, US_MARKETPLACE), {
        label: 'fbm-track-get',
        maxRetries: 3,
        baseDelayMs: 2_000,
      });
      await pool.query(
        'INSERT INTO fbm_qty_tracking (seller_sku, amazon_qty, listing_exists) VALUES ($1, $2, $3)',
        [sku, st.quantity, st.exists],
      );
      written++;
    } catch (err) {
      const msg = ((err as { message?: string })?.message ?? String(err)).slice(0, 200);
      logger.warn(`[fbmQtyTracker] ${sku} okunamadı: ${msg}`);
      await pool
        .query('INSERT INTO fbm_qty_tracking (seller_sku, amazon_qty, listing_exists, error) VALUES ($1, NULL, NULL, $2)', [sku, msg])
        .catch(() => { /* snapshot akışı bozulmasın */ });
    }
  }
  logger.info(`[fbmQtyTracker] ${written}/${TRACKED_FBM_SKUS.length} SKU snapshot alındı`);
  return written;
}
