import { Request, Response, NextFunction } from 'express';
import axios from 'axios';
import logger from '../config/logger';

interface SSOUser {
  id: number;
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

export async function authMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;
  const token = authHeader?.replace('Bearer ', '');

  if (!token) {
    res.status(401).json({ success: false, error: 'No token provided' });
    return;
  }

  try {
    const response = await axios.post(getSSOVerifyUrl(), {
      token,
      appCode: getSSOAppCode(),
    }, { timeout: 5000 });

    if (response.data?.success && response.data?.data?.user) {
      req.user = response.data.data.user;
      next();
    } else {
      res.status(401).json({ success: false, error: 'Invalid token' });
    }
  } catch (err: any) {
    logger.error('[Auth] SSO verification failed:', err.message);
    res.status(401).json({ success: false, error: 'Authentication failed' });
  }
}
