-- Multi-account support: credential_id per marketplace
-- Allows multiple SP-API credentials for the same region (e.g., EU/MDN + EU/IWA)

-- Ensure account_name column exists in sp_api_credentials (was added via app code but not in DDL)
ALTER TABLE sp_api_credentials ADD COLUMN IF NOT EXISTS account_name VARCHAR(50) DEFAULT '';

-- Add credential_id to marketplace_config to link each marketplace to a specific credential
ALTER TABLE marketplace_config ADD COLUMN IF NOT EXISTS credential_id INTEGER REFERENCES sp_api_credentials(id);
