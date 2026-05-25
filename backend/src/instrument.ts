/**
 * Sentry instrumentation — Node SDK v10+ auto-instrumentation için Node modülleri
 * yüklenmeden ÖNCE çağrılmalı. Bu yüzden `src/index.ts`'in EN ÜSTÜNDE import edilir.
 *
 * DSN yoksa init no-op; uygulama Sentry olmadan çalışır (development/test).
 *
 * Quota stratejisi (Sentry Free 5K events/ay, org-paylaşımlı):
 *   - tracesSampleRate=0 → performance off
 *   - beforeSend filter → bilinen transient hataları (429, 5xx, network code) drop eder
 *   - Asıl kullanım: withSyncLog catch'inde manuel captureException
 *     (yani retry tükendikten sonraki "kalıcı fail" anında Sentry'ye düşer)
 */
import * as Sentry from '@sentry/node';

const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENV || process.env.NODE_ENV || 'production',
    release: process.env.SENTRY_RELEASE,

    tracesSampleRate: 0,
    sendDefaultPii: false,

    beforeSend(event, hint) {
      const err = hint.originalException as
        | { code?: string; message?: string; response?: { status?: number }; status?: number; statusCode?: number }
        | undefined;

      const status =
        err?.response?.status ?? err?.status ?? err?.statusCode;

      if (status === 429) return null;
      if (typeof status === 'number' && status >= 500 && status < 600) return null;

      const code = err?.code || '';
      if (/^(ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|EPIPE|EHOSTUNREACH|ENETUNREACH)$/.test(code)) {
        return null;
      }

      return event;
    },
  });
}

export function captureIfInitialized(err: unknown, context?: { tags?: Record<string, string>; extra?: Record<string, unknown> }): void {
  if (!Sentry.isInitialized()) return;
  Sentry.captureException(err, {
    tags: context?.tags,
    extra: context?.extra,
  });
}

export { Sentry };
