-- sync_log'a serbest 'detail' alanı: veeqo book/cancel gibi işlemlerde hangi sipariş/
-- tracking/shipment olduğunu kaydetmek için (audit). Nullable; diğer job'lar set etmez.
ALTER TABLE sync_log ADD COLUMN IF NOT EXISTS detail TEXT;
