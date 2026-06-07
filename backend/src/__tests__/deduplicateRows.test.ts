import { describe, it, expect } from 'vitest';
import { deduplicateRows } from '../services/adsApi/adsDataWriterTier1';

// Amazon Ads raporlari ayni report icinde duplike satir donebilir → ON CONFLICT
// "cannot affect row a second time" hatasi. deduplicateRows composite key ile
// teklestir; SOZLESME = son occurrence kazanir (en guncel veri).

describe('deduplicateRows', () => {
  const key = (r: { campaignId: number; date: string }) => `${r.campaignId}|${r.date}`;

  it('ayni key → son occurrence kazanir', () => {
    const rows = [
      { campaignId: 1, date: '2026-06-01', clicks: 5 },
      { campaignId: 1, date: '2026-06-01', clicks: 9 }, // son → bu kalir
      { campaignId: 2, date: '2026-06-01', clicks: 3 },
    ];
    const out = deduplicateRows(rows, key);
    expect(out).toHaveLength(2);
    expect(out.find(r => r.campaignId === 1)?.clicks).toBe(9);
  });

  it('duplike yoksa hepsi korunur', () => {
    const rows = [
      { campaignId: 1, date: '2026-06-01' },
      { campaignId: 2, date: '2026-06-01' },
      { campaignId: 1, date: '2026-06-02' },
    ];
    expect(deduplicateRows(rows, key)).toHaveLength(3);
  });

  it('bos dizi → bos dizi', () => {
    expect(deduplicateRows([], key)).toEqual([]);
  });
});
