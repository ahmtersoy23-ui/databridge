/**
 * Cron job tetiklenmesinden önce eklenen rastgele gecikme.
 *
 * Sebep: 15+ cron aynı dakikada tetiklenirse (örn. 00:00 UTC) DB pool contention
 * + dış API hammer'ı oluşur. 0-30sn rastgele jitter çakışmaları yumuşatır.
 *
 * SAFETY: jitter sadece cron handler'ın başında çalışır; cron schedule'ı kaymaz
 * (cron interval'ı node-cron tarafından korunur).
 *
 * Env: CRON_JITTER_MAX_SEC (default 30). 0 verilirse jitter kapanır (test/dev).
 */
const DEFAULT_MAX_JITTER_SEC = 30;

export function getCronJitterMaxMs(): number {
  const raw = process.env.CRON_JITTER_MAX_SEC;
  if (raw !== undefined) {
    const n = parseInt(raw, 10);
    if (Number.isFinite(n) && n >= 0 && n <= 600) return n * 1000;
  }
  return DEFAULT_MAX_JITTER_SEC * 1000;
}

export function getCronJitterMs(): number {
  return Math.floor(Math.random() * getCronJitterMaxMs());
}
