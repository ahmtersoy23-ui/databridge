import { Router, Request, Response } from 'express';
import { Sentry } from '../instrument';

/**
 * Sentry kurulumunu doğrulamak için kalıcı endpoint (ManuMaestro pattern).
 *
 * Kullanım:
 *   curl "https://databridge.../api/v1/sentry-verify?token=<SENTRY_VERIFY_TOKEN>"
 *   curl "https://databridge.../api/v1/sentry-verify?token=<SENTRY_VERIFY_TOKEN>&throw=1"
 *
 * `SENTRY_VERIFY_TOKEN` env yoksa endpoint 404 döner — production'da
 * abuse/quota tüketimine karşı zorunlu.
 */
const router = Router();

router.get('/', async (req: Request, res: Response) => {
  const expected = process.env.SENTRY_VERIFY_TOKEN;
  const provided = req.query.token;

  if (!expected || provided !== expected) {
    res.status(404).json({ error: 'not found' });
    return;
  }

  if (!Sentry.isInitialized()) {
    res.status(503).json({ error: 'Sentry not initialized (SENTRY_DSN missing)' });
    return;
  }

  const shouldThrow = req.query.throw === '1';
  if (shouldThrow) {
    throw new Error('Sentry verify: intentional server-side error');
  }

  Sentry.captureMessage('Sentry verify: server-side captureMessage', {
    level: 'info',
    tags: { route: 'sentry-verify' },
  });
  await Sentry.flush(2000);

  res.json({
    success: true,
    info: 'Mesaj Sentry\'ye gönderildi. Issues sekmesinde görünmesi 30-60 saniye sürebilir.',
    next: 'Server-side error test için: ?throw=1 parametresi ekle.',
  });
});

export default router;
