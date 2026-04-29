import { Request, Response, NextFunction } from 'express';
import { ssoAuthMiddleware } from './ssoAuth';

/**
 * Dual-mode authorization for admin operations.
 *
 * - Mode 1 (server-to-server): `x-internal-api-key` header eslesmeli
 * - Mode 2 (UI): SSO auth + databridge `admin` role
 *
 * Sync trigger ve detayli status gibi yetkili islemler icin. Cron/script'ler
 * header ile cagirir; admin UI'i SSO cookie/Bearer ile cagirir. Iki yol da
 * ayni endpoint'e ulasir; herhangi biri yeterli olur.
 */
export function adminOpsAuth(req: Request, res: Response, next: NextFunction): void {
  const apiKey = req.headers['x-internal-api-key'];

  // Mode 1: Internal API key (deny by default if not configured)
  if (apiKey) {
    if (process.env.INTERNAL_API_KEY && apiKey === process.env.INTERNAL_API_KEY) {
      next();
      return;
    }
    res.status(401).json({ success: false, error: 'Invalid API key' });
    return;
  }

  // Mode 2: SSO + admin role
  ssoAuthMiddleware(req, res, () => {
    if (req.user?.role === 'admin') {
      next();
      return;
    }
    res.status(403).json({ success: false, error: 'DataBridge admin role required' });
  });
}
