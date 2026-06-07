/**
 * `catch (err: unknown)` bloklarinda guvenli hata okuma yardimcilari.
 *
 * TS-dogrusu olan `unknown` ile yakalanan hatadan mesaj/kod/HTTP-status'u
 * narrowing ile cikarir — `err: any` korlemesi olmadan.
 */

/** Error ise `.message`, degilse string'e cevir. Her zaman string doner. */
export function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Node/axios hata objesindeki `code` (ECONNRESET, ETIMEDOUT, vb.) varsa string olarak doner.
 * Yoksa undefined.
 */
export function errCode(err: unknown): string | undefined {
  if (err && typeof err === 'object' && 'code' in err) {
    const code = (err as { code?: unknown }).code;
    return code == null ? undefined : String(code);
  }
  return undefined;
}

/**
 * HTTP hata status'unu cikarir: axios `err.response.status`, ya da `err.status`/`err.statusCode`.
 * Bulamazsa undefined.
 */
export function errStatus(err: unknown): number | undefined {
  if (!err || typeof err !== 'object') return undefined;
  const e = err as {
    response?: { status?: unknown };
    status?: unknown;
    statusCode?: unknown;
  };
  const raw = e.response?.status ?? e.status ?? e.statusCode;
  return typeof raw === 'number' ? raw : undefined;
}
