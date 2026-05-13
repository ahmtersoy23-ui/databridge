-- wayfair_credentials.id was created as 'integer DEFAULT 1' (no SERIAL),
-- so the 3rd INSERT (e.g. UK account) always tried id=1 and hit pkey conflict.
-- Add a proper sequence, backfill setval, and grant.

CREATE SEQUENCE IF NOT EXISTS wayfair_credentials_id_seq OWNED BY wayfair_credentials.id;
SELECT setval('wayfair_credentials_id_seq', GREATEST(COALESCE(MAX(id), 0), 1)) FROM wayfair_credentials;
ALTER TABLE wayfair_credentials ALTER COLUMN id SET DEFAULT nextval('wayfair_credentials_id_seq');
ALTER SEQUENCE wayfair_credentials_id_seq OWNER TO pricelab_user;
GRANT USAGE, SELECT ON SEQUENCE wayfair_credentials_id_seq TO pricelab_user;
GRANT USAGE, SELECT ON SEQUENCE wayfair_credentials_id_seq TO pricelab;
