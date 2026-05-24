import { describe, it, expect } from 'vitest';
import { shouldSkipForAmazonDuplicate, computeEffectiveStatus } from '../services/sync/wisersellPendingSync';

describe('shouldSkipForAmazonDuplicate', () => {
  it('sales_data kapsamındaki Amazon platformlarını skip eder', () => {
    expect(shouldSkipForAmazonDuplicate('Ama_US')).toBe(true);
    expect(shouldSkipForAmazonDuplicate('AMA_CA')).toBe(true);
    expect(shouldSkipForAmazonDuplicate('AMA_UK')).toBe(true);
    expect(shouldSkipForAmazonDuplicate('AMA_Alm')).toBe(true);
    expect(shouldSkipForAmazonDuplicate('Ama_BAE')).toBe(true);
    expect(shouldSkipForAmazonDuplicate('Amazon_SA')).toBe(true);
    expect(shouldSkipForAmazonDuplicate('AmaAvust')).toBe(true);
    // sales_data "others" channel'ı içinde (Amazon EU SE+NL+PL+BE+TR aggregate)
    expect(shouldSkipForAmazonDuplicate('AMA_Bel')).toBe(true);
    expect(shouldSkipForAmazonDuplicate('AMA_Hol')).toBe(true);
    expect(shouldSkipForAmazonDuplicate('AMA_isv')).toBe(true);
    expect(shouldSkipForAmazonDuplicate('Ama_Tr')).toBe(true);
  });

  it('sales_data\'da olmayan Amazon kanallarını DAHIL eder (Ama_CITI + Ama_SGP)', () => {
    expect(shouldSkipForAmazonDuplicate('Ama_CITI')).toBe(false);
    expect(shouldSkipForAmazonDuplicate('Ama_SGP')).toBe(false);
  });

  it('non-Amazon platformları dokunmaz', () => {
    expect(shouldSkipForAmazonDuplicate('Etsy IWA')).toBe(false);
    expect(shouldSkipForAmazonDuplicate('S_IWAUS')).toBe(false);
    expect(shouldSkipForAmazonDuplicate('T_IWA')).toBe(false);
    expect(shouldSkipForAmazonDuplicate('HepsiB.')).toBe(false);
    expect(shouldSkipForAmazonDuplicate('eBay-eBay-UK')).toBe(false);
    expect(shouldSkipForAmazonDuplicate('WhatsApp')).toBe(false);
    expect(shouldSkipForAmazonDuplicate('INFLNCR')).toBe(false);
  });

  it('null/boş platform false döner (dahil et)', () => {
    expect(shouldSkipForAmazonDuplicate(null)).toBe(false);
  });
});

describe('computeEffectiveStatus', () => {
  const today = new Date('2026-05-12T00:00:00Z');

  it('ready_to_ship + sipariş 90 günden eski → stale', () => {
    const r = computeEffectiveStatus('ready_to_ship', '2025-01-01', today);
    expect(r.effective_status).toBe('stale');
    expect(r.stale_age_days).toBe(496);
  });

  it('ready_to_ship + sipariş 89 gün → active (eşik dahil)', () => {
    // 90 gün eşiği — > olarak kontrol, eşik 90'da active kalır
    const date90 = new Date(today.getTime() - 90 * 86_400_000).toISOString().slice(0, 10);
    const r = computeEffectiveStatus('ready_to_ship', date90, today);
    expect(r.effective_status).toBe('active');
    expect(r.stale_age_days).toBe(90);
  });

  it('ready_to_ship + sipariş 91 gün → stale', () => {
    const date91 = new Date(today.getTime() - 91 * 86_400_000).toISOString().slice(0, 10);
    const r = computeEffectiveStatus('ready_to_ship', date91, today);
    expect(r.effective_status).toBe('stale');
    expect(r.stale_age_days).toBe(91);
  });

  it('open status hiçbir zaman stale işaretlenmez (eski olsa bile)', () => {
    const r = computeEffectiveStatus('open', '2024-01-01', today);
    expect(r.effective_status).toBe('active');
    expect(r.stale_age_days).toBeGreaterThan(365);
  });

  it('siparis_tarihi null → active + age null', () => {
    const r = computeEffectiveStatus('ready_to_ship', null, today);
    expect(r.effective_status).toBe('active');
    expect(r.stale_age_days).toBeNull();
  });

  it('geçersiz tarih string → active + age null', () => {
    const r = computeEffectiveStatus('ready_to_ship', 'not-a-date', today);
    expect(r.effective_status).toBe('active');
    expect(r.stale_age_days).toBeNull();
  });
});

import { readFileSync as _readFileSync } from 'fs';
import { resolve as _resolve } from 'path';

describe('wisersellPendingSync — source-level regression', () => {
  const filePath = _resolve(__dirname, '../services/sync/wisersellPendingSync.ts');
  const source: string = _readFileSync(filePath, 'utf-8');

  it('idempotent: DELETE-then-INSERT pattern (aynı gün re-run safe)', () => {
    expect(source).toContain('DELETE FROM wisersell_pending_orders WHERE snapshot_date = $1 AND status = $2');
  });

  it('post-cleanup: closed orders\'a düşmüş kayıtları siler', () => {
    expect(source).toMatch(/DELETE FROM wisersell_pending_orders p\s+USING wisersell_orders o/);
  });

  it('retention: eski snapshot\'ları siler', () => {
    expect(source).toMatch(/snapshot_date < CURRENT_DATE - .* days.*::interval/i);
  });

  it('Amazon platform filtresi çağrılıyor (shouldSkipForAmazonDuplicate)', () => {
    expect(source).toContain('shouldSkipForAmazonDuplicate(platform)');
  });

  it('iki status grubunu da çekiyor', () => {
    expect(source).toContain("syncPendingForStatus('open'");
    expect(source).toContain("syncPendingForStatus('ready_to_ship'");
  });
});
