-- Migration 025: Fix purchased product report duplicate issue
-- Problem: UNIQUE index includes campaign_id, ad_group_id, targeting which can be NULL
-- SQL NULL != NULL so ON CONFLICT never triggers for Excel backfill rows (NULL campaign_id)
-- Result: duplicate rows (634 dupes found, 618 groups x2, 5 groups x4)

BEGIN;

-- 1. Remove duplicate rows (keep lowest id per group)
DELETE FROM ads_purchased_product_report a
USING ads_purchased_product_report b
WHERE a.id > b.id
  AND a.profile_id = b.profile_id
  AND a.report_date = b.report_date
  AND COALESCE(a.campaign_id::text, '') = COALESCE(b.campaign_id::text, '')
  AND COALESCE(a.ad_group_id::text, '') = COALESCE(b.ad_group_id::text, '')
  AND a.advertised_asin = b.advertised_asin
  AND COALESCE(a.targeting, '') = COALESCE(b.targeting, '')
  AND a.purchased_asin = b.purchased_asin;

-- 2. Drop old UNIQUE index (NULL-unsafe)
DROP INDEX IF EXISTS ads_purch_prod_uq;

-- 3. Create new UNIQUE index with COALESCE (NULL-safe)
CREATE UNIQUE INDEX ads_purch_prod_uq ON ads_purchased_product_report (
  profile_id, report_date,
  COALESCE(campaign_id, 0), COALESCE(ad_group_id, 0),
  advertised_asin,
  COALESCE(targeting, ''),
  purchased_asin
);

COMMIT;
