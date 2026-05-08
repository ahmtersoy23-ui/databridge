-- Wisersell web app credentials (REST API'den ayrı)
-- REST API: pim@iwa.com / api.wisersell.com/restapi (catalog sync için)
-- Web app: kullanıcı login'i / www.wisersell.com (shipment Excel için)
-- Auth flow: POST /api/auth/login { data: base64({userInfo:{email,password}}) } → JWT (4h)

ALTER TABLE wisersell_credentials
  ADD COLUMN IF NOT EXISTS web_email    TEXT,
  ADD COLUMN IF NOT EXISTS web_password TEXT,
  ADD COLUMN IF NOT EXISTS web_url      TEXT NOT NULL DEFAULT 'https://www.wisersell.com';

-- web_password AES-256-GCM şifreli saklanır (mevcut decryptCredential util'i ile çözülür)
COMMENT ON COLUMN wisersell_credentials.web_password IS
  'AES-256-GCM encrypted (CREDENTIAL_ENCRYPTION_KEY) — Wisersell web app password';
