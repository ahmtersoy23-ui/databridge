-- DataBridge SSO Sessions
-- No local users table — session stores user info directly from Apps-SSO

CREATE TABLE IF NOT EXISTS databridge_sessions (
  id SERIAL PRIMARY KEY,
  sso_user_id VARCHAR(100) NOT NULL,
  email VARCHAR(255) NOT NULL,
  name VARCHAR(255),
  role VARCHAR(50) NOT NULL DEFAULT 'viewer',
  token VARCHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_db_sessions_token ON databridge_sessions(token);
CREATE INDEX IF NOT EXISTS idx_db_sessions_expires ON databridge_sessions(expires_at);

-- Grant permissions
GRANT ALL PRIVILEGES ON TABLE databridge_sessions TO pricelab_user;
GRANT ALL PRIVILEGES ON TABLE databridge_sessions TO pricelab;
GRANT USAGE, SELECT ON SEQUENCE databridge_sessions_id_seq TO pricelab_user;
GRANT USAGE, SELECT ON SEQUENCE databridge_sessions_id_seq TO pricelab;
