import { Request, Response, NextFunction } from 'express';
import logger from '../config/logger';

/**
 * Internal API key authentication.
 *
 * Sunucu-icinden tetiklenen endpoint'ler icin (sync trigger gibi). Nginx'in
 * 127.0.0.1 kisitlamasina ek olarak ikinci katman koruma. INTERNAL_API_KEY
 * env'de set edilmemisse endpoint kapali kalir (deny by default).
 */
export function internalAuth(req: Request, res: Response, next: NextFunction): void {
  const configuredKey = process.env.INTERNAL_API_KEY;
  const providedKey = req.headers['x-internal-api-key'];

  if (!configuredKey) {
    logger.error('[InternalAuth] INTERNAL_API_KEY not configured — denying all requests');
    res.status(503).json({ success: false, error: 'Internal API not configured on server' });
    return;
  }

  if (!providedKey || providedKey !== configuredKey) {
    res.status(401).json({ success: false, error: 'Unauthorized' });
    return;
  }

  next();
}
