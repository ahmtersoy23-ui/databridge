import { describe, it, expect } from 'vitest';
import { SALES_CHANNEL_TO_CHANNEL } from '../config/constants';

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
