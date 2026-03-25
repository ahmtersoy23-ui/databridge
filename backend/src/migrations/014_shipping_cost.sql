-- Add shipping_cost to wayfair_sku_mapping (part_number based, entered in DataBridge)
ALTER TABLE wayfair_sku_mapping ADD COLUMN IF NOT EXISTS shipping_cost NUMERIC(10,2);
