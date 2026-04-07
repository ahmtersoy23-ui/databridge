import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../utils/notify', () => ({
  notify: vi.fn(),
}));

const mockQuery = vi.fn();
vi.mock('../config/database', () => ({
  pool: { query: (...args: any[]) => mockQuery(...args) },
}));

import { runPostSyncChecks, runGapDetection, validateColumnHeaders, runDailyHealthCheck } from '../utils/dataQualityChecks';
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
  });

  describe('runGapDetection', () => {
    it('returns passed when no gaps', async () => {
      // Gap queries return empty (no missing dates)
      mockQuery.mockResolvedValue({ rows: [] });

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

      await runDailyHealthCheck();
      expect(notify).toHaveBeenCalled();
      const msg = (notify as any).mock.calls[0][0] as string;
      expect(msg).toContain('Daily summary');
    });
  });
});
