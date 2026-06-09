import { describe, it, expect, vi } from 'vitest';

vi.mock('../config/database', () => ({ pool: { query: vi.fn() } }));

import { cleanPhone } from '../routes/veeqoRouting';

describe('cleanPhone', () => {
  it('Amazon relay uzantısını atar, +<rakam> bırakır', () => {
    expect(cleanPhone('+1 347-448-3190 ext. 59392')).toBe('+13474483190');
  });

  it('format/boşluk/tireyi temizler (uzantısız)', () => {
    expect(cleanPhone('(732) 555-0142')).toBe('7325550142');
    expect(cleanPhone('+1 732 555 0142')).toBe('+17325550142');
  });

  it('"x" uzantı formatını da atar', () => {
    expect(cleanPhone('732-555-0142 x123')).toBe('7325550142');
  });

  it('boş/geçersiz → placeholder', () => {
    expect(cleanPhone(undefined)).toBe('0000000000');
    expect(cleanPhone('')).toBe('0000000000');
    expect(cleanPhone('ext. 5')).toBe('0000000000');
  });
});
