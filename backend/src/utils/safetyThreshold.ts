/**
 * Sync writer'ların "yeni veri < mevcut × threshold ise YAZMA" guardı için ortak helper.
 *
 * Threshold sırası (öncelik → fallback):
 *   1. SAFETY_DROP_THRESHOLD_<JOB>  (örn. SAFETY_DROP_THRESHOLD_SALES_DATA=0.3)
 *   2. SAFETY_DROP_THRESHOLD         (genel default)
 *   3. 0.2                           (kod default — geri uyumluluk)
 *
 * Sezonsal dipte alarm fatigue olursa, kalıcı kod değişikliği yerine env tuning ile
 * geçici gevşetme yapılır.
 */
const DEFAULT_THRESHOLD = 0.2;

function parseThreshold(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = parseFloat(raw);
  if (Number.isNaN(n) || n <= 0 || n > 1) return null;
  return n;
}

/**
 * @param jobLabel Job-specific override env var lookup için. Örn 'SALES_DATA',
 *   'INVENTORY', 'BOL_ORDERS', 'WALMART_ORDERS', 'TAKEALOT_ORDERS',
 *   'KAUFLAND_ORDERS', 'SYNC_LOG_ROW_DROP'. UPPER_SNAKE_CASE.
 */
export function getSafetyDropThreshold(jobLabel?: string): number {
  if (jobLabel) {
    const specific = parseThreshold(process.env[`SAFETY_DROP_THRESHOLD_${jobLabel}`]);
    if (specific !== null) return specific;
  }
  const general = parseThreshold(process.env.SAFETY_DROP_THRESHOLD);
  if (general !== null) return general;
  return DEFAULT_THRESHOLD;
}
