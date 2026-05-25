import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  SALES_CHANNEL_TO_CHANNEL,
  getWisersellPendingRetentionDays,
  getWisersellPendingStaleAgeDays,
} from '../config/constants';

describe('SALES_CHANNEL_TO_CHANNEL', () => {
  it('maps major Amazon domains to correct channels', () => {
    expect(SALES_CHANNEL_TO_CHANNEL['Amazon.com']).toBe('us');
    expect(SALES_CHANNEL_TO_CHANNEL['Amazon.co.uk']).toBe('uk');
    expect(SALES_CHANNEL_TO_CHANNEL['Amazon.de']).toBe('de');
    expect(SALES_CHANNEL_TO_CHANNEL['Amazon.com.au']).toBe('au');
    expect(SALES_CHANNEL_TO_CHANNEL['Amazon.ae']).toBe('ae');
    expect(SALES_CHANNEL_TO_CHANNEL['Amazon.sa']).toBe('sa');
    expect(SALES_CHANNEL_TO_CHANNEL['Amazon.ca']).toBe('ca');
  });

  it('maps each EU marketplace to its own channel', () => {
    expect(SALES_CHANNEL_TO_CHANNEL['Amazon.se']).toBe('se');
    expect(SALES_CHANNEL_TO_CHANNEL['Amazon.nl']).toBe('nl');
    expect(SALES_CHANNEL_TO_CHANNEL['Amazon.pl']).toBe('pl');
    expect(SALES_CHANNEL_TO_CHANNEL['Amazon.com.be']).toBe('be');
    expect(SALES_CHANNEL_TO_CHANNEL['Amazon.com.tr']).toBe('tr');
  });

  it('returns undefined for unknown domains', () => {
    expect(SALES_CHANNEL_TO_CHANNEL['Amazon.co.jp']).toBeUndefined();
  });
});

describe('getWisersellPendingRetentionDays', () => {
  const original = process.env.WISERSELL_PENDING_RETENTION_DAYS;
  beforeEach(() => { delete process.env.WISERSELL_PENDING_RETENTION_DAYS; });
  afterEach(() => {
    if (original === undefined) delete process.env.WISERSELL_PENDING_RETENTION_DAYS;
    else process.env.WISERSELL_PENDING_RETENTION_DAYS = original;
  });

  it('default 30', () => {
    expect(getWisersellPendingRetentionDays()).toBe(30);
  });

  it('env override (valid range)', () => {
    process.env.WISERSELL_PENDING_RETENTION_DAYS = '60';
    expect(getWisersellPendingRetentionDays()).toBe(60);
  });

  it('rejects invalid (0, negative, >365, NaN) → default', () => {
    process.env.WISERSELL_PENDING_RETENTION_DAYS = '0';
    expect(getWisersellPendingRetentionDays()).toBe(30);
    process.env.WISERSELL_PENDING_RETENTION_DAYS = '-5';
    expect(getWisersellPendingRetentionDays()).toBe(30);
    process.env.WISERSELL_PENDING_RETENTION_DAYS = '400';
    expect(getWisersellPendingRetentionDays()).toBe(30);
    process.env.WISERSELL_PENDING_RETENTION_DAYS = 'abc';
    expect(getWisersellPendingRetentionDays()).toBe(30);
  });

  it('reads env lazily (runtime change uygulanır)', () => {
    expect(getWisersellPendingRetentionDays()).toBe(30);
    process.env.WISERSELL_PENDING_RETENTION_DAYS = '45';
    expect(getWisersellPendingRetentionDays()).toBe(45);
  });
});

describe('getWisersellPendingStaleAgeDays', () => {
  const original = process.env.WISERSELL_PENDING_STALE_AGE_DAYS;
  beforeEach(() => { delete process.env.WISERSELL_PENDING_STALE_AGE_DAYS; });
  afterEach(() => {
    if (original === undefined) delete process.env.WISERSELL_PENDING_STALE_AGE_DAYS;
    else process.env.WISERSELL_PENDING_STALE_AGE_DAYS = original;
  });

  it('default 90', () => {
    expect(getWisersellPendingStaleAgeDays()).toBe(90);
  });

  it('env override (valid range)', () => {
    process.env.WISERSELL_PENDING_STALE_AGE_DAYS = '120';
    expect(getWisersellPendingStaleAgeDays()).toBe(120);
  });

  it('rejects >730 → default', () => {
    process.env.WISERSELL_PENDING_STALE_AGE_DAYS = '800';
    expect(getWisersellPendingStaleAgeDays()).toBe(90);
  });
});
