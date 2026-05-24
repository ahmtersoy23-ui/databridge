import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getSafetyDropThreshold } from '../utils/safetyThreshold';

describe('getSafetyDropThreshold', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.SAFETY_DROP_THRESHOLD;
    delete process.env.SAFETY_DROP_THRESHOLD_SALES_DATA;
    delete process.env.SAFETY_DROP_THRESHOLD_INVENTORY;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('returns default 0.2 when no env is set', () => {
    expect(getSafetyDropThreshold()).toBe(0.2);
    expect(getSafetyDropThreshold('SALES_DATA')).toBe(0.2);
  });

  it('honors generic SAFETY_DROP_THRESHOLD', () => {
    process.env.SAFETY_DROP_THRESHOLD = '0.35';
    expect(getSafetyDropThreshold()).toBe(0.35);
    expect(getSafetyDropThreshold('SALES_DATA')).toBe(0.35);
  });

  it('per-job override takes precedence over generic', () => {
    process.env.SAFETY_DROP_THRESHOLD = '0.3';
    process.env.SAFETY_DROP_THRESHOLD_SALES_DATA = '0.5';
    expect(getSafetyDropThreshold('SALES_DATA')).toBe(0.5);
    expect(getSafetyDropThreshold('INVENTORY')).toBe(0.3);
  });

  it('rejects invalid values (negatif, NaN, >1)', () => {
    process.env.SAFETY_DROP_THRESHOLD = '-0.1';
    expect(getSafetyDropThreshold()).toBe(0.2);

    process.env.SAFETY_DROP_THRESHOLD = 'abc';
    expect(getSafetyDropThreshold()).toBe(0.2);

    process.env.SAFETY_DROP_THRESHOLD = '1.5';
    expect(getSafetyDropThreshold()).toBe(0.2);

    process.env.SAFETY_DROP_THRESHOLD = '0';
    expect(getSafetyDropThreshold()).toBe(0.2);
  });

  it('accepts 1.0 (disable guard) at boundary', () => {
    process.env.SAFETY_DROP_THRESHOLD = '1';
    expect(getSafetyDropThreshold()).toBe(1);
  });
});
