import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

vi.mock('../config/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ssoAuthMiddleware'i mock'la — adminOpsAuth Mode 2'de SSO'ya inip kontrol ediyor.
// Mock pattern: __mocks__ value via verifySSO
const mockSsoVerify = vi.fn();
vi.mock('../middleware/ssoAuth', () => ({
  ssoAuthMiddleware: async (req: Request, _res: Response, next: NextFunction) => {
    const result = await mockSsoVerify(req);
    if (result) {
      (req as Request & { user?: { role: string } }).user = result;
    }
    next();
  },
}));

import { adminOpsAuth } from '../middleware/adminOps';

const mockRes = (): Response => {
  const res = {} as Response;
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

describe('adminOpsAuth — Mode 1: Internal API Key', () => {
  const next = vi.fn() as NextFunction;
  const ORIGINAL_KEY = process.env.INTERNAL_API_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (ORIGINAL_KEY === undefined) delete process.env.INTERNAL_API_KEY;
    else process.env.INTERNAL_API_KEY = ORIGINAL_KEY;
  });

  it('passes when header matches configured INTERNAL_API_KEY', () => {
    process.env.INTERNAL_API_KEY = 'secret-123';
    const req = { headers: { 'x-internal-api-key': 'secret-123' } } as unknown as Request;
    const res = mockRes();
    adminOpsAuth(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('rejects with 401 when header is wrong', () => {
    process.env.INTERNAL_API_KEY = 'secret-123';
    const req = { headers: { 'x-internal-api-key': 'wrong' } } as unknown as Request;
    const res = mockRes();
    adminOpsAuth(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects with 401 when header sent but server has no INTERNAL_API_KEY (deny by default)', () => {
    delete process.env.INTERNAL_API_KEY;
    const req = { headers: { 'x-internal-api-key': 'something' } } as unknown as Request;
    const res = mockRes();
    adminOpsAuth(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});

describe('adminOpsAuth — Mode 2: SSO admin', () => {
  const next = vi.fn() as NextFunction;

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.INTERNAL_API_KEY;
  });

  it('passes when SSO user has admin role', async () => {
    mockSsoVerify.mockResolvedValueOnce({ id: '1', email: 'admin@x', name: 'Admin', role: 'admin' });
    const req = { headers: {} } as Request;
    const res = mockRes();
    adminOpsAuth(req, res, next);
    await new Promise(r => setTimeout(r, 10));
    expect(next).toHaveBeenCalled();
  });

  it('rejects with 403 when SSO user is not admin', async () => {
    mockSsoVerify.mockResolvedValueOnce({ id: '1', email: 'viewer@x', name: 'Viewer', role: 'viewer' });
    const req = { headers: {} } as Request;
    const res = mockRes();
    adminOpsAuth(req, res, next);
    await new Promise(r => setTimeout(r, 10));
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: 'DataBridge admin role required' });
  });

  it('rejects when SSO returns no user (unauthenticated)', async () => {
    mockSsoVerify.mockResolvedValueOnce(null);
    const req = { headers: {} } as Request;
    const res = mockRes();
    adminOpsAuth(req, res, next);
    await new Promise(r => setTimeout(r, 10));
    expect(res.status).toHaveBeenCalledWith(403);
  });

  // REGRESSION: header sent ile SSO check arasinda dogru mode secimi.
  // Header set ise SSO'ya inme; SSO check sadece header yokken yapilmali.
  it('does not fall through to SSO when header is sent', () => {
    process.env.INTERNAL_API_KEY = 'real-key';
    const req = { headers: { 'x-internal-api-key': 'wrong' } } as unknown as Request;
    const res = mockRes();
    adminOpsAuth(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(mockSsoVerify).not.toHaveBeenCalled();
  });
});
