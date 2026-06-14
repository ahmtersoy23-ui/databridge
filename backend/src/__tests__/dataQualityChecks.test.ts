import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../utils/notify', () => ({
  notify: vi.fn(),
}));

const mockQuery = vi.fn();
const mockSharedQuery = vi.fn();
vi.mock('../config/database', () => ({
  pool: { query: (...args: any[]) => mockQuery(...args) },
  sharedPool: { query: (...args: any[]) => mockSharedQuery(...args) },
}));

import { runPostSyncChecks, runGapDetection, validateColumnHeaders, runDailyHealthCheck, runCoreTableFreshness } from '../utils/dataQualityChecks';
import { notify } from '../utils/notify';

describe('dataQualityChecks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('runPostSyncChecks', () => {
    function mockCleanData() {
      // Route queries by SQL content
      mockQuery.mockImplementation((sql: string) => {
        if (sql.includes('HAVING COUNT')) return { rows: [] }; // dupe: no dupes
        if (sql.includes('today_count')) return { rows: [{ today_count: 100, yesterday_count: 95 }] };
        if (sql.includes('IS NULL')) return { rows: [{ cnt: 0 }] };
        if (sql.includes('SUM') && sql.includes('adv_spend')) return { rows: [{ adv_spend: '100', tgt_spend: '105' }] };
        if (sql.includes('SUM')) return { rows: [{ total_spend: '50', total_sales: '200' }] };
        return { rows: [] };
      });
    }

    it('returns passed for clean data', async () => {
      mockCleanData();
      const results = await runPostSyncChecks('2026-04-06');
      expect(results.length).toBeGreaterThan(0);
      const criticals = results.filter(r => r.severity === 'CRITICAL' && !r.passed);
      expect(criticals).toHaveLength(0);
    });

    it('detects duplicates as CRITICAL', async () => {
      let dupeCallCount = 0;
      mockQuery.mockImplementation((sql: string) => {
        if (sql.includes('HAVING COUNT')) {
          dupeCallCount++;
          // First dupe check returns a hit
          if (dupeCallCount === 1) return { rows: [{ cnt: 3 }] };
          return { rows: [] };
        }
        if (sql.includes('today_count')) return { rows: [{ today_count: 100, yesterday_count: 95 }] };
        if (sql.includes('IS NULL')) return { rows: [{ cnt: 0 }] };
        if (sql.includes('SUM') && sql.includes('adv_spend')) return { rows: [{ adv_spend: '100', tgt_spend: '105' }] };
        if (sql.includes('SUM')) return { rows: [{ total_spend: '50', total_sales: '200' }] };
        return { rows: [] };
      });

      const results = await runPostSyncChecks('2026-04-06');
      const dupeCheck = results.find(r => r.check.startsWith('dupe:') && !r.passed);
      expect(dupeCheck).toBeDefined();
      expect(dupeCheck!.severity).toBe('CRITICAL');
    });

    it('detects zero row count as CRITICAL', async () => {
      let countCallCount = 0;
      mockQuery.mockImplementation((sql: string) => {
        if (sql.includes('HAVING COUNT')) return { rows: [] };
        if (sql.includes('today_count')) {
          countCallCount++;
          if (countCallCount === 1) return { rows: [{ today_count: 0, yesterday_count: 50 }] };
          return { rows: [{ today_count: 100, yesterday_count: 95 }] };
        }
        if (sql.includes('IS NULL')) return { rows: [{ cnt: 0 }] };
        if (sql.includes('SUM') && sql.includes('adv_spend')) return { rows: [{ adv_spend: '100', tgt_spend: '105' }] };
        if (sql.includes('SUM')) return { rows: [{ total_spend: '50', total_sales: '200' }] };
        return { rows: [] };
      });

      const results = await runPostSyncChecks('2026-04-06');
      const countCheck = results.find(r => r.check.startsWith('count:') && r.severity === 'CRITICAL');
      expect(countCheck).toBeDefined();
      expect(countCheck!.message).toContain('0 rows');
    });

    it('seyrek tablo 0 satir + saglikli feed job → count INFO (alarm degil)', async () => {
      mockQuery.mockImplementation((sql: string) => {
        if (sql.includes('FROM sync_log')) return { rows: [{ x: 1 }] }; // sd-ads healthy
        if (sql.includes('HAVING COUNT')) return { rows: [] };
        if (sql.includes('today_count')) return { rows: [{ today_count: 0, yesterday_count: 2 }] };
        if (sql.includes('IS NULL')) return { rows: [{ cnt: 0 }] };
        if (sql.includes('adv_spend')) return { rows: [{ adv_spend: '0', tgt_spend: '0' }] };
        if (sql.includes('SUM')) return { rows: [{ total_spend: '0', total_sales: '0' }] };
        return { rows: [] };
      });
      const results = await runPostSyncChecks('2026-06-11', 'sd');
      const c = results.find(r => r.check === 'count:ads_sd_purchased_product_report')!;
      expect(c.severity).toBe('INFO');
      expect(c.passed).toBe(true);
    });

    it('seyrek tablo 0 satir + olu feed job → count yine CRITICAL', async () => {
      mockQuery.mockImplementation((sql: string) => {
        if (sql.includes('FROM sync_log')) return { rows: [] }; // sd-ads NOT healthy
        if (sql.includes('HAVING COUNT')) return { rows: [] };
        if (sql.includes('today_count')) return { rows: [{ today_count: 0, yesterday_count: 2 }] };
        if (sql.includes('IS NULL')) return { rows: [{ cnt: 0 }] };
        if (sql.includes('adv_spend')) return { rows: [{ adv_spend: '0', tgt_spend: '0' }] };
        if (sql.includes('SUM')) return { rows: [{ total_spend: '0', total_sales: '0' }] };
        return { rows: [] };
      });
      const results = await runPostSyncChecks('2026-06-11', 'sd');
      const c = results.find(r => r.check === 'count:ads_sd_purchased_product_report')!;
      expect(c.severity).toBe('CRITICAL');
      expect(c.passed).toBe(false);
    });
  });

  describe('runGapDetection', () => {
    it('returns passed when no gaps', async () => {
      mockQuery.mockImplementation((sql: string) => {
        if (sql.includes('missing_date')) return { rows: [] }; // no gaps
        if (sql.includes('COUNT(*)')) return { rows: [{ cnt: 100 }] }; // table not empty
        if (sql.includes('child_asin')) return { rows: [] }; // business report asin
        return { rows: [] };
      });

      const results = await runGapDetection(30);
      expect(results.length).toBeGreaterThan(0);
      const allPassed = results.every(r => r.passed);
      expect(allPassed).toBe(true);
    });

    it('detects gaps as WARNING or CRITICAL', async () => {
      // First table: 2 missing days
      mockQuery.mockResolvedValueOnce({
        rows: [
          { missing_date: new Date('2026-04-01') },
          { missing_date: new Date('2026-04-02') },
        ],
      });
      // Rest return clean
      mockQuery.mockResolvedValue({ rows: [] });

      const results = await runGapDetection(30);
      const gapCheck = results.find(r => r.check.startsWith('gap:') && !r.passed);
      expect(gapCheck).toBeDefined();
      expect(gapCheck!.message).toContain('2 missing day');
    });

    it('seyrek tablo bos gunler + saglikli feed job → gap INFO (alarm degil)', async () => {
      mockQuery.mockImplementation((sql: string) => {
        if (sql.includes('FROM sync_log')) return { rows: [{ x: 1 }] }; // sd-ads healthy
        if (sql.includes('missing_date') && sql.includes('ads_sd_purchased_product_report')) {
          return { rows: [{ missing_date: new Date('2026-05-17') }, { missing_date: new Date('2026-05-18') }] };
        }
        if (sql.includes('missing_date')) return { rows: [] };
        if (sql.includes('COUNT(*)')) return { rows: [{ cnt: 100 }] };
        if (sql.includes('child_asin')) return { rows: [] };
        return { rows: [] };
      });
      const results = await runGapDetection(30);
      const sdGap = results.find(r => r.check === 'gap:ads_sd_purchased_product_report')!;
      expect(sdGap.severity).toBe('INFO');
      expect(sdGap.passed).toBe(true);
    });

    it('seyrek tablo bos gunler + olu feed job → gap yine CRITICAL', async () => {
      mockQuery.mockImplementation((sql: string) => {
        if (sql.includes('FROM sync_log')) return { rows: [] }; // sd-ads NOT healthy
        if (sql.includes('missing_date') && sql.includes('ads_sd_purchased_product_report')) {
          return { rows: [
            { missing_date: new Date('2026-05-17') }, { missing_date: new Date('2026-05-18') },
            { missing_date: new Date('2026-05-19') }, { missing_date: new Date('2026-05-20') },
          ] };
        }
        if (sql.includes('missing_date')) return { rows: [] };
        if (sql.includes('COUNT(*)')) return { rows: [{ cnt: 100 }] };
        if (sql.includes('child_asin')) return { rows: [] };
        return { rows: [] };
      });
      const results = await runGapDetection(30);
      const sdGap = results.find(r => r.check === 'gap:ads_sd_purchased_product_report')!;
      expect(sdGap.severity).toBe('CRITICAL');
      expect(sdGap.passed).toBe(false);
    });
  });

  describe('validateColumnHeaders', () => {
    it('detects trailing spaces', () => {
      const results = validateColumnHeaders(
        ['report_date', 'spend ', 'sales_7d'],
        ['report_date', 'spend', 'sales_7d'],
      );
      const trailing = results.find(r => r.check.includes('trailing_space'));
      expect(trailing).toBeDefined();
      expect(trailing!.passed).toBe(false);
    });

    it('detects missing columns', () => {
      const results = validateColumnHeaders(
        ['report_date', 'spend'],
        ['report_date', 'spend', 'sales_7d'],
      );
      const missing = results.find(r => r.check.includes('missing_columns'));
      expect(missing).toBeDefined();
      expect(missing!.severity).toBe('CRITICAL');
    });

    it('returns passed for valid headers', () => {
      const results = validateColumnHeaders(
        ['report_date', 'spend', 'sales_7d'],
        ['report_date', 'spend', 'sales_7d'],
      );
      expect(results.every(r => r.passed)).toBe(true);
    });
  });

  describe('runDailyHealthCheck', () => {
    it('sends summary to Slack', async () => {
      mockQuery.mockImplementation((sql: string) => {
        if (sql.includes('HAVING COUNT')) return { rows: [] };
        if (sql.includes('today_count')) return { rows: [{ today_count: 100, yesterday_count: 95 }] };
        if (sql.includes('IS NULL')) return { rows: [{ cnt: 0 }] };
        if (sql.includes('generate_series')) return { rows: [] };
        if (sql.includes('child_asin')) return { rows: [] };
        if (sql.includes('adv_spend')) return { rows: [{ adv_spend: '100', tgt_spend: '105' }] };
        if (sql.includes('SUM')) return { rows: [{ total_spend: '50', total_sales: '200' }] };
        return { rows: [] };
      });

      // Core tables fresh
      mockSharedQuery.mockResolvedValue({ rows: [{ cnt: '1000', age_hours: '3600' }] });

      await runDailyHealthCheck();
      expect(notify).toHaveBeenCalled();
      const msg = (notify as any).mock.calls[0][0] as string;
      expect(msg).toContain('Daily summary');
    });
  });

  describe('runCoreTableFreshness', () => {
    it('taze + dolu tablo → INFO passed', async () => {
      // age 3600s = 1h → her iki esigin de altinda
      mockSharedQuery.mockResolvedValue({ rows: [{ cnt: '5000', age_hours: '3600' }] });
      const results = await runCoreTableFreshness();
      expect(results).toHaveLength(2);
      expect(results.every(r => r.passed)).toBe(true);
    });

    it('bos tablo → CRITICAL', async () => {
      mockSharedQuery.mockResolvedValue({ rows: [{ cnt: '0', age_hours: null }] });
      const results = await runCoreTableFreshness();
      expect(results.every(r => r.severity === 'CRITICAL' && !r.passed)).toBe(true);
    });

    it('bayat sales_data → CRITICAL, bayat fba_inventory → WARNING', async () => {
      // 40h = 144000s → sales (30h limit) ve inventory (14h limit) ikisi de bayat
      mockSharedQuery.mockResolvedValue({ rows: [{ cnt: '5000', age_hours: '144000' }] });
      const results = await runCoreTableFreshness();
      const sales = results.find(r => r.check === 'fresh:sales_data')!;
      const inv = results.find(r => r.check === 'fresh:fba_inventory')!;
      expect(sales.severity).toBe('CRITICAL');
      expect(inv.severity).toBe('WARNING');
      expect(sales.passed).toBe(false);
      expect(inv.passed).toBe(false);
    });

    it('query hatasi → WARNING, crash etmez', async () => {
      mockSharedQuery.mockRejectedValue(new Error('connection refused'));
      const results = await runCoreTableFreshness();
      expect(results.every(r => r.severity === 'WARNING' && !r.passed)).toBe(true);
    });
  });
});
