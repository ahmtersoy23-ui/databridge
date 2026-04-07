import { pool } from '../config/database';
import logger from '../config/logger';
import { notify } from './notify';

// ─── Types ───────────────────────────────────────────────────────────────────

type Severity = 'INFO' | 'WARNING' | 'CRITICAL';

interface CheckResult {
  check: string;
  severity: Severity;
  message: string;
  passed: boolean;
}

interface ImportSnapshot {
  tableName: string;
  rowCount: number;
  minDate: string | null;
  maxDate: string | null;
}

// ─── Ads tables config ──────────────────────────────────────────────────────

const ADS_TABLES = [
  {
    table: 'ads_advertised_product_report',
    dupeKeys: ['report_date', 'profile_id', 'advertised_asin', 'campaign_id', 'ad_group_id', 'country'],
    nullChecks: ['advertised_asin', 'report_date'],
    spendCol: 'spend',
    salesCol: 'sales_7d',
  },
  {
    table: 'ads_search_term_report',
    dupeKeys: ['report_date', 'profile_id', 'customer_search_term', 'campaign_id', 'ad_group_id', 'country'],
    nullChecks: ['customer_search_term', 'report_date'],
    spendCol: 'spend',
    salesCol: 'sales_7d',
  },
  {
    table: 'ads_targeting_report',
    dupeKeys: ['report_date', 'profile_id', 'targeting', 'campaign_id', 'ad_group_id', 'country'],
    nullChecks: ['report_date'],
    spendCol: 'spend',
    salesCol: 'sales_7d',
  },
  {
    table: 'ads_purchased_product_report',
    dupeKeys: ['report_date', 'profile_id', 'advertised_asin', 'purchased_asin', 'campaign_id', 'ad_group_id', 'country'],
    nullChecks: ['advertised_asin', 'report_date'],
    spendCol: null,
    salesCol: null,
  },
  {
    table: 'ads_campaign_report',
    dupeKeys: ['report_date', 'profile_id', 'campaign_id'],
    nullChecks: ['report_date', 'campaign_id'],
    spendCol: 'spend',
    salesCol: 'sales_7d',
  },
  {
    table: 'ads_sb_campaign_report',
    dupeKeys: ['report_date', 'profile_id', 'campaign_id'],
    nullChecks: ['report_date', 'campaign_id'],
    spendCol: 'spend',
    salesCol: 'sales_14d',
  },
  {
    table: 'ads_sb_search_term_report',
    dupeKeys: ['report_date', 'profile_id', 'campaign_id', 'ad_group_id', 'search_term'],
    nullChecks: ['report_date', 'search_term'],
    spendCol: 'spend',
    salesCol: 'sales_14d',
  },
] as const;

const BUSINESS_REPORT_TABLE = 'business_report';

// ─── Katman 1: Post-Sync Assertions ────────────────────────────────────────

/** Run after each ads sync completes. Returns array of check results. */
export async function runPostSyncChecks(reportDate?: string): Promise<CheckResult[]> {
  // Ads raporlari T-1 gecikmeli gelir — default yesterday
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const targetDate = reportDate || yesterday;
  const results: CheckResult[] = [];

  for (const cfg of ADS_TABLES) {
    // 1. Duplikasyon kontrolu
    try {
      const dupeSQL = `
        SELECT ${cfg.dupeKeys.join(', ')}, COUNT(*) as cnt
        FROM ${cfg.table}
        WHERE report_date = $1
        GROUP BY ${cfg.dupeKeys.join(', ')}
        HAVING COUNT(*) > 1
        LIMIT 5
      `;
      const { rows } = await pool.query(dupeSQL, [targetDate]);
      results.push({
        check: `dupe:${cfg.table}`,
        severity: rows.length > 0 ? 'CRITICAL' : 'INFO',
        message: rows.length > 0
          ? `${rows.length} duplicate group(s) found for ${targetDate}`
          : `No duplicates for ${targetDate}`,
        passed: rows.length === 0,
      });
    } catch (err: any) {
      results.push({ check: `dupe:${cfg.table}`, severity: 'WARNING', message: `Check error: ${err.message}`, passed: false });
    }

    // 2. Satir sayisi anomali (bugun vs dun)
    try {
      const countSQL = `
        SELECT
          (SELECT COUNT(*)::int FROM ${cfg.table} WHERE report_date = $1) as today_count,
          (SELECT COUNT(*)::int FROM ${cfg.table} WHERE report_date = $1::date - 1) as yesterday_count
      `;
      const { rows } = await pool.query(countSQL, [targetDate]);
      const { today_count, yesterday_count } = rows[0];

      if (today_count === 0) {
        results.push({ check: `count:${cfg.table}`, severity: 'CRITICAL', message: `0 rows for ${targetDate}`, passed: false });
      } else if (yesterday_count > 0) {
        const ratio = today_count / yesterday_count;
        const deviated = ratio < 0.5 || ratio > 2;
        results.push({
          check: `count:${cfg.table}`,
          severity: deviated ? 'WARNING' : 'INFO',
          message: `${today_count} rows (yesterday: ${yesterday_count}, ratio: ${ratio.toFixed(2)})`,
          passed: !deviated,
        });
      } else {
        results.push({ check: `count:${cfg.table}`, severity: 'INFO', message: `${today_count} rows (no yesterday data)`, passed: true });
      }
    } catch (err: any) {
      results.push({ check: `count:${cfg.table}`, severity: 'WARNING', message: `Check error: ${err.message}`, passed: false });
    }

    // 3. NULL critical field
    for (const col of cfg.nullChecks) {
      try {
        const { rows } = await pool.query(
          `SELECT COUNT(*)::int as cnt FROM ${cfg.table} WHERE report_date = $1 AND ${col} IS NULL`,
          [targetDate],
        );
        const cnt = rows[0].cnt;
        results.push({
          check: `null:${cfg.table}.${col}`,
          severity: cnt > 0 ? 'CRITICAL' : 'INFO',
          message: cnt > 0 ? `${cnt} NULL ${col} rows` : 'OK',
          passed: cnt === 0,
        });
      } catch (err: any) {
        results.push({ check: `null:${cfg.table}.${col}`, severity: 'WARNING', message: `Check error: ${err.message}`, passed: false });
      }
    }

    // 4. Sales/Spend tutarlilik
    if (cfg.spendCol && cfg.salesCol) {
      try {
        const { rows } = await pool.query(`
          SELECT
            COALESCE(SUM(${cfg.spendCol}), 0)::numeric as total_spend,
            COALESCE(SUM(${cfg.salesCol}), 0)::numeric as total_sales
          FROM ${cfg.table}
          WHERE report_date = $1
        `, [targetDate]);
        const { total_spend, total_sales } = rows[0];
        const spend = parseFloat(total_spend);
        const sales = parseFloat(total_sales);

        if (spend > 0 && sales > 0) {
          const acos = (spend / sales) * 100;
          const abnormal = acos > 200;
          results.push({
            check: `acos:${cfg.table}`,
            severity: abnormal ? 'WARNING' : 'INFO',
            message: `ACOS ${acos.toFixed(1)}% (spend: ${spend.toFixed(0)}, sales: ${sales.toFixed(0)})`,
            passed: !abnormal,
          });
        } else if (spend > 0 && sales === 0) {
          results.push({
            check: `acos:${cfg.table}`,
            severity: 'WARNING',
            message: `Spend $${spend.toFixed(0)} but $0 sales — possible data issue`,
            passed: false,
          });
        }
      } catch (err: any) {
        results.push({ check: `acos:${cfg.table}`, severity: 'WARNING', message: `Check error: ${err.message}`, passed: false });
      }
    }
  }

  // 5. Cross-table tutarlilik: advertised_product vs targeting spend
  try {
    const { rows } = await pool.query(`
      SELECT
        (SELECT COALESCE(SUM(spend), 0)::numeric FROM ads_advertised_product_report WHERE report_date = $1) as adv_spend,
        (SELECT COALESCE(SUM(spend), 0)::numeric FROM ads_targeting_report WHERE report_date = $1) as tgt_spend
    `, [targetDate]);
    const adv = parseFloat(rows[0].adv_spend);
    const tgt = parseFloat(rows[0].tgt_spend);

    if (adv > 0 && tgt > 0) {
      const diff = Math.abs(adv - tgt) / Math.max(adv, tgt);
      results.push({
        check: 'cross:adv_vs_targeting_spend',
        severity: diff > 0.1 ? 'WARNING' : 'INFO',
        message: `Advertised spend: ${adv.toFixed(0)}, Targeting spend: ${tgt.toFixed(0)} (diff: ${(diff * 100).toFixed(1)}%)`,
        passed: diff <= 0.1,
      });
    }
  } catch (err: any) {
    results.push({ check: 'cross:adv_vs_targeting_spend', severity: 'WARNING', message: `Check error: ${err.message}`, passed: false });
  }

  return results;
}

// ─── Katman 2: Gap Tespiti ──────────────────────────────────────────────────

/** Detect missing dates in the last N days for all tracked tables. */
export async function runGapDetection(lookbackDays = 30): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  const allTables = [...ADS_TABLES.map(t => t.table), BUSINESS_REPORT_TABLE];

  for (const table of allTables) {
    try {
      // Only check gaps from the table's first data date (avoid false positives for new tables)
      const { rows } = await pool.query(`
        WITH table_start AS (
          SELECT GREATEST(MIN(report_date), CURRENT_DATE - $1::int) AS start_date
          FROM ${table}
        ),
        date_range AS (
          SELECT generate_series(
            (SELECT start_date FROM table_start),
            CURRENT_DATE - 1,
            '1 day'::interval
          )::date AS d
        ),
        actual AS (
          SELECT DISTINCT report_date FROM ${table}
          WHERE report_date >= (SELECT start_date FROM table_start)
            AND report_date < CURRENT_DATE
        )
        SELECT d AS missing_date
        FROM date_range
        LEFT JOIN actual ON actual.report_date = date_range.d
        WHERE actual.report_date IS NULL
        ORDER BY d
      `, [lookbackDays]);

      // Empty table — skip (no data yet, not a gap)
      if (rows.length === 0) {
        // Check if table is truly empty
        const total = await pool.query(`SELECT COUNT(*)::int as cnt FROM ${table}`);
        if (total.rows[0].cnt === 0) {
          results.push({ check: `gap:${table}`, severity: 'INFO', message: 'Table empty — skipped', passed: true });
        } else {
          results.push({ check: `gap:${table}`, severity: 'INFO', message: `No gaps in last ${lookbackDays} days`, passed: true });
        }
      } else {
        const dates = rows.map(r => r.missing_date.toISOString().slice(0, 10));
        const severity: Severity = rows.length >= 4 ? 'CRITICAL' : 'WARNING';
        results.push({
          check: `gap:${table}`,
          severity,
          message: `${rows.length} missing day(s): ${dates.slice(0, 5).join(', ')}${dates.length > 5 ? '...' : ''}`,
          passed: false,
        });
      }
    } catch (err: any) {
      results.push({ check: `gap:${table}`, severity: 'WARNING', message: `Check error: ${err.message}`, passed: false });
    }
  }

  // Business report ASIN count consistency
  try {
    const { rows } = await pool.query(`
      SELECT report_date, COUNT(DISTINCT child_asin)::int as asin_count
      FROM business_report
      WHERE report_date >= CURRENT_DATE - 14
      GROUP BY report_date
      ORDER BY report_date
    `);
    if (rows.length >= 2) {
      const counts = rows.map(r => r.asin_count);
      const avg = counts.reduce((a: number, b: number) => a + b, 0) / counts.length;
      const outliers = rows.filter(r => r.asin_count < avg * 0.8);
      if (outliers.length > 0) {
        results.push({
          check: 'gap:business_report_asin_consistency',
          severity: 'WARNING',
          message: `${outliers.length} day(s) with low ASIN count vs avg ${Math.round(avg)}: ${outliers.map(o => `${o.report_date.toISOString().slice(0, 10)}(${o.asin_count})`).join(', ')}`,
          passed: false,
        });
      }
    }
  } catch (err: any) {
    results.push({ check: 'gap:business_report_asin_consistency', severity: 'WARNING', message: `Check error: ${err.message}`, passed: false });
  }

  return results;
}

// ─── Katman 3: Import/Backfill Validation ───────────────────────────────────

/** Take a snapshot before import for later comparison. */
export async function takeImportSnapshot(tableName: string): Promise<ImportSnapshot> {
  const { rows } = await pool.query(`
    SELECT
      COUNT(*)::int as row_count,
      MIN(report_date)::text as min_date,
      MAX(report_date)::text as max_date
    FROM ${tableName}
  `);
  return {
    tableName,
    rowCount: rows[0].row_count,
    minDate: rows[0].min_date,
    maxDate: rows[0].max_date,
  };
}

/** Validate after import by comparing with pre-import snapshot. */
export async function validateImport(
  snapshot: ImportSnapshot,
  expectedDateRange?: { start: string; end: string },
): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  const { tableName, rowCount: beforeCount } = snapshot;

  // Current state
  const { rows } = await pool.query(`
    SELECT
      COUNT(*)::int as row_count,
      MIN(report_date)::text as min_date,
      MAX(report_date)::text as max_date
    FROM ${tableName}
  `);
  const afterCount = rows[0].row_count;
  const added = afterCount - beforeCount;

  // Row count check
  if (added <= 0) {
    results.push({
      check: `import:${tableName}:count`,
      severity: 'WARNING',
      message: `No new rows added (before: ${beforeCount}, after: ${afterCount})`,
      passed: false,
    });
  } else {
    results.push({
      check: `import:${tableName}:count`,
      severity: 'INFO',
      message: `${added} rows added (before: ${beforeCount}, after: ${afterCount})`,
      passed: true,
    });
  }

  // Date range check
  if (expectedDateRange) {
    const { min_date, max_date } = rows[0];
    const inRange = min_date <= expectedDateRange.start || max_date >= expectedDateRange.end;
    if (!inRange) {
      results.push({
        check: `import:${tableName}:daterange`,
        severity: 'WARNING',
        message: `Expected ${expectedDateRange.start}~${expectedDateRange.end}, got ${min_date}~${max_date}`,
        passed: false,
      });
    }
  }

  // Run dupe check on the table config (if it's an ads table)
  const cfg = ADS_TABLES.find(t => t.table === tableName);
  if (cfg) {
    try {
      const { rows: dupes } = await pool.query(`
        SELECT ${cfg.dupeKeys.join(', ')}, COUNT(*) as cnt
        FROM ${tableName}
        GROUP BY ${cfg.dupeKeys.join(', ')}
        HAVING COUNT(*) > 1
        LIMIT 5
      `);
      results.push({
        check: `import:${tableName}:dupes`,
        severity: dupes.length > 0 ? 'CRITICAL' : 'INFO',
        message: dupes.length > 0
          ? `${dupes.length} duplicate group(s) found after import`
          : 'No duplicates after import',
        passed: dupes.length === 0,
      });
    } catch (err: any) {
      results.push({ check: `import:${tableName}:dupes`, severity: 'WARNING', message: err.message, passed: false });
    }
  }

  // Spend/sales zero check (possible column mapping error)
  if (cfg?.spendCol && cfg?.salesCol) {
    try {
      const { rows: zeroRows } = await pool.query(`
        SELECT
          COALESCE(SUM(${cfg.spendCol}), 0)::numeric as total_spend,
          COALESCE(SUM(${cfg.salesCol}), 0)::numeric as total_sales
        FROM ${tableName}
        WHERE synced_at >= NOW() - INTERVAL '1 hour'
      `);
      const spend = parseFloat(zeroRows[0].total_spend);
      const sales = parseFloat(zeroRows[0].total_sales);
      if (spend === 0 && sales === 0 && added > 100) {
        results.push({
          check: `import:${tableName}:zero_values`,
          severity: 'CRITICAL',
          message: `${added} rows imported but spend=0 and sales=0 — possible column mapping error`,
          passed: false,
        });
      }
    } catch { /* ignore */ }
  }

  return results;
}

/** Validate CSV/Excel column headers against expected columns. */
export function validateColumnHeaders(
  headers: string[],
  expectedColumns: string[],
): CheckResult[] {
  const results: CheckResult[] = [];
  const trimmed = headers.map(h => h.trim());
  const hasTrailingSpace = headers.some((h, i) => h !== trimmed[i]);

  if (hasTrailingSpace) {
    const offending = headers.filter((h, i) => h !== trimmed[i]).map(h => `'${h}'`);
    results.push({
      check: 'import:header:trailing_space',
      severity: 'WARNING',
      message: `Trailing spaces in headers: ${offending.join(', ')}`,
      passed: false,
    });
  }

  const missing = expectedColumns.filter(c => !trimmed.includes(c));
  if (missing.length > 0) {
    results.push({
      check: 'import:header:missing_columns',
      severity: 'CRITICAL',
      message: `Missing columns: ${missing.join(', ')}`,
      passed: false,
    });
  }

  if (results.length === 0) {
    results.push({ check: 'import:header', severity: 'INFO', message: 'All headers valid', passed: true });
  }

  return results;
}

// ─── Katman 4: Slack Alert + Gunluk Ozet ────────────────────────────────────

function severityEmoji(s: Severity): string {
  return s === 'CRITICAL' ? '\u{1F534}' : s === 'WARNING' ? '\u{26A0}\u{FE0F}' : '\u{2705}';
}

/** Send check results to Slack, filtering by minimum severity. */
async function alertResults(results: CheckResult[], context: string, minSeverity: Severity = 'WARNING'): Promise<void> {
  const severityOrder: Severity[] = ['INFO', 'WARNING', 'CRITICAL'];
  const minIdx = severityOrder.indexOf(minSeverity);
  const alerts = results.filter(r => !r.passed && severityOrder.indexOf(r.severity) >= minIdx);

  if (alerts.length === 0) return;

  const lines = alerts.map(a => `${severityEmoji(a.severity)} [${a.check}] ${a.message}`);
  const text = `*[DataQuality] ${context}*\n${lines.join('\n')}`;
  await notify(text);
}

/** Daily health check: post-sync assertions + gap detection + summary. */
export async function runDailyHealthCheck(): Promise<void> {
  logger.info('[DataQuality] Daily health check started');
  const start = Date.now();

  const [postSync, gaps] = await Promise.all([
    runPostSyncChecks(),
    runGapDetection(),
  ]);

  const all = [...postSync, ...gaps];
  const critical = all.filter(r => r.severity === 'CRITICAL' && !r.passed);
  const warnings = all.filter(r => r.severity === 'WARNING' && !r.passed);
  const durationSec = ((Date.now() - start) / 1000).toFixed(1);

  // Always send daily summary
  if (critical.length === 0 && warnings.length === 0) {
    await notify(`${severityEmoji('INFO')} *[DataQuality] Daily summary* — All ${all.length} checks passed (${durationSec}s)`);
  } else {
    const summaryLines = [
      `*[DataQuality] Daily summary* — ${critical.length} critical, ${warnings.length} warning (${durationSec}s)`,
    ];
    for (const r of [...critical, ...warnings]) {
      summaryLines.push(`${severityEmoji(r.severity)} [${r.check}] ${r.message}`);
    }
    await notify(summaryLines.join('\n'));
  }

  logger.info(`[DataQuality] Daily check done: ${critical.length} critical, ${warnings.length} warning, ${all.length} total (${durationSec}s)`);
}

/** Run post-sync checks and alert on failures. Called after each ads sync. */
export async function runPostSyncChecksAndAlert(reportDate?: string): Promise<void> {
  try {
    const results = await runPostSyncChecks(reportDate);
    await alertResults(results, `Post-sync ${reportDate || 'today'}`);
    const failed = results.filter(r => !r.passed);
    if (failed.length > 0) {
      logger.warn(`[DataQuality] Post-sync: ${failed.length} issue(s) detected`);
    }
  } catch (err: any) {
    logger.error('[DataQuality] Post-sync check error:', err.message);
  }
}
