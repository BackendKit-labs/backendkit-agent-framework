-- PR 4: ApiKey entity — machine-to-machine authentication.
-- Idempotent — safe to run multiple times.

CREATE TABLE IF NOT EXISTS api_keys (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL,
    "keyHash" VARCHAR(64) UNIQUE NOT NULL,
    scopes TEXT,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    "lastUsedAt" TIMESTAMP WITH TIME ZONE,
    "expiresAt" TIMESTAMP WITH TIME ZONE,
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys("keyHash");
CREATE INDEX IF NOT EXISTS idx_api_keys_active ON api_keys(active);
