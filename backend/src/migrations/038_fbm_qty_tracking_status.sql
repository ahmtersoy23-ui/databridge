-- FBM izleme: listing status + issue (ERROR) bilgisi ekle — "biri aktif 0'lıyor" mu (status BUYABLE,
-- issue yok ama qty 0) yoksa "listing suppressed → Amazon 0 gösteriyor" mu (issue_errors>0) ayrımı için.
ALTER TABLE fbm_qty_tracking ADD COLUMN IF NOT EXISTS listing_status TEXT;
ALTER TABLE fbm_qty_tracking ADD COLUMN IF NOT EXISTS issue_errors INTEGER;
ALTER TABLE fbm_qty_tracking ADD COLUMN IF NOT EXISTS issue_note TEXT;
