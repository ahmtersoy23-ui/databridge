import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

vi.mock('../config/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { internalAuth } from '../middleware/internalAuth';

const mockRes = (): Response => {
  const res = {} as Response;
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

describe('internalAuth middleware', () => {
  const next = vi.fn() as NextFunction;
  const ORIGINAL_KEY = process.env.INTERNAL_API_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (ORIGINAL_KEY === undefined) {
      delete process.env.INTERNAL_API_KEY;
    } else {
      process.env.INTERNAL_API_KEY = ORIGINAL_KEY;
    }
  });

  it('returns 503 when INTERNAL_API_KEY is not configured (deny by default)', () => {
    delete process.env.INTERNAL_API_KEY;
    const req = { headers: {} } as Request;
    const res = mockRes();

    internalAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: 'Internal API not configured on server',
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when no header provided', () => {
    process.env.INTERNAL_API_KEY = 'secret-key-123';
    const req = { headers: {} } as Request;
    const res = mockRes();

    internalAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when header value is wrong', () => {
    process.env.INTERNAL_API_KEY = 'secret-key-123';
    const req = { headers: { 'x-internal-api-key': 'wrong' } } as unknown as Request;
    const res = mockRes();

    internalAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next() when header matches configured key', () => {
    process.env.INTERNAL_API_KEY = 'secret-key-123';
    const req = { headers: { 'x-internal-api-key': 'secret-key-123' } } as unknown as Request;
    const res = mockRes();

    internalAuth(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  // REGRESSION: Endpoint daha onceden auth gate'siz idi (sadece nginx 127.0.0.1).
  // Bu test, header gondermeyenler reddedildigini garanti eder.
  it('rejects request without header even when key is configured', () => {
    process.env.INTERNAL_API_KEY = 'secret-key-123';
    const req = { headers: { 'authorization': 'Bearer something' } } as unknown as Request;
    const res = mockRes();

    internalAuth(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});
