import { Router, Request, Response } from 'express';
import { errMessage } from '../utils/errors';
import { ssoAuthMiddleware, deleteSession } from '../middleware/ssoAuth';

const router = Router();

// GET /api/v1/auth/me — Session check + SSO token exchange
router.get('/me', ssoAuthMiddleware, (req: Request, res: Response) => {
  res.json({ success: true, user: req.user });
});

// POST /api/v1/auth/logout — Destroy session
router.post('/logout', ssoAuthMiddleware, async (req: Request, res: Response) => {
  try {
    const token = req.cookies?.auth_token;
    if (token) {
      await deleteSession(token);
    }
    res.clearCookie('auth_token', { path: '/' });
    res.json({ success: true });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: errMessage(err) });
  }
});

export default router;
