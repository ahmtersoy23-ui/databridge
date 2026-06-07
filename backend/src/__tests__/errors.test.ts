import { describe, it, expect } from 'vitest';
import { errMessage, errCode, errStatus } from '../utils/errors';

describe('errMessage', () => {
  it('returns .message for Error instances', () => {
    expect(errMessage(new Error('boom'))).toBe('boom');
    expect(errMessage(new TypeError('bad type'))).toBe('bad type');
  });

  it('stringifies non-Error values', () => {
    expect(errMessage('plain string')).toBe('plain string');
    expect(errMessage(42)).toBe('42');
    expect(errMessage(null)).toBe('null');
    expect(errMessage(undefined)).toBe('undefined');
  });

  it('stringifies objects without throwing', () => {
    expect(errMessage({ foo: 'bar' })).toBe('[object Object]');
  });
});

describe('errCode', () => {
  it('returns code from Node/axios errors', () => {
    const e = Object.assign(new Error('conn reset'), { code: 'ECONNRESET' });
    expect(errCode(e)).toBe('ECONNRESET');
  });

  it('coerces non-string codes to string', () => {
    expect(errCode({ code: 500 })).toBe('500');
  });

  it('returns undefined when no code', () => {
    expect(errCode(new Error('x'))).toBeUndefined();
    expect(errCode('string')).toBeUndefined();
    expect(errCode(null)).toBeUndefined();
    expect(errCode({ code: null })).toBeUndefined();
  });
});

describe('errStatus', () => {
  it('reads axios err.response.status first', () => {
    expect(errStatus({ response: { status: 429 }, status: 500 })).toBe(429);
  });

  it('falls back to err.status then err.statusCode', () => {
    expect(errStatus({ status: 503 })).toBe(503);
    expect(errStatus({ statusCode: 404 })).toBe(404);
  });

  it('returns undefined for non-numeric / missing status', () => {
    expect(errStatus(new Error('x'))).toBeUndefined();
    expect(errStatus({ response: { status: 'oops' } })).toBeUndefined();
    expect(errStatus(null)).toBeUndefined();
    expect(errStatus('string')).toBeUndefined();
  });
});
