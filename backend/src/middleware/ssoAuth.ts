import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import axios from 'axios';
import { pool } from '../config/database';
import logger from '../config/logger';

interface SSOUser {
  id: string;
  email: string;
  name: string;
  role: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: SSOUser;
    }
  }
}

const getSSOVerifyUrl = () => process.env.SSO_VERIFY_URL || 'https://apps.iwa.web.tr/api/auth/verify';
const getSSOAppCode = () => process.env.SSO_APP_CODE || 'databridge';
const getSSOPortalUrl = () => process.env.SSO_PORTAL_URL || 'https://apps.iwa.web.tr';

const SESSION_EXPIRY_DAYS = 7;

async function verifySSOToken(token: string): Promise<{ user: { id: string; email: string; name: string }; role: string } | null> {
  try {
    const res = await axios.post(getSSOVerifyUrl(), {
      token,
      app_code: getSSOAppCode(),
    }, { timeout: 5000 });

    if (res.data?.success && res.data?.data?.user) {
      return {
        user: res.data.data.user,
        role: res.data.data.role || 'viewer',
      };
    }
    return null;
  } catch (err: any) {
    logger.error('[SSOAuth] Verify failed:', err.message);
    return null;
  }
}

async function getSessionByToken(token: string): Promise<SSOUser | null> {
  try {
    const result = await pool.query(
      'SELECT sso_user_id, email, name, role FROM databridge_sessions WHERE token = $1 AND expires_at > NOW()',
      [token]
    );
    if (result.rows.length === 0) return null;
    const row = result.rows[0];
    return { id: row.sso_user_id, email: row.email, name: row.name, role: row.role };
  } catch {
    return null;
  }
}

async function createSession(user: SSOUser): Promise<string> {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

  await pool.query(
    `INSERT INTO databridge_sessions (sso_user_id, email, name, role, token, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [user.id, user.email, user.name, user.role, token, expiresAt]
  );

  return token;
}

export async function ssoAuthMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  // Dev bypass
  if (process.env.NODE_ENV === 'development' && (req.hostname === 'localhost' || req.hostname === '127.0.0.1')) {
    req.user = { id: '0', email: 'dev@local', name: 'Developer', role: 'admin' };
    next();
    return;
  }

  // Phase 1: Check session cookie
  const cookieToken = req.cookies?.auth_token;
  if (cookieToken) {
    const user = await getSessionByToken(cookieToken);
    if (user) {
      req.user = user;
      next();
      return;
    }
  }

  // Phase 2: Check Bearer token (SSO JWT from frontend)
  const authHeader = req.headers.authorization;
  const bearerToken = authHeader?.replace('Bearer ', '');

  if (bearerToken) {
    const ssoResult = await verifySSOToken(bearerToken);
    if (ssoResult) {
      const user: SSOUser = {
        id: ssoResult.user.id,
        email: ssoResult.user.email,
        name: ssoResult.user.name,
        role: ssoResult.role,
      };

      // Create local session
      const sessionToken = await createSession(user);

      // Set cookie
      const isProduction = process.env.NODE_ENV === 'production';
      res.cookie('auth_token', sessionToken, {
        httpOnly: true,
        secure: isProduction,
        sameSite: 'lax',
        maxAge: SESSION_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
        path: '/',
      });

      req.user = user;
      next();
      return;
    }
  }

  // Not authenticated
  res.status(401).json({
    success: false,
    error: 'Authentication required',
    redirectTo: getSSOPortalUrl(),
  });
}

export async function deleteSession(token: string): Promise<void> {
  await pool.query('DELETE FROM databridge_sessions WHERE token = $1', [token]);
}

// Cleanup expired sessions (call periodically)
export async function cleanupExpiredSessions(): Promise<number> {
  const result = await pool.query('DELETE FROM databridge_sessions WHERE expires_at < NOW()');
  return result.rowCount || 0;
}
