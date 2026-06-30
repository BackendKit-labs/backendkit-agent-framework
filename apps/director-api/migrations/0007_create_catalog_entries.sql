-- PR 7: CatalogEntry enterprise — templates con category y requiredSecrets.
-- Idempotent — safe to run multiple times.

CREATE TABLE IF NOT EXISTS catalog_entries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    key VARCHAR(100) UNIQUE NOT NULL,
    "displayName" VARCHAR(255) NOT NULL,
    description TEXT,
    category VARCHAR(50) NOT NULL DEFAULT 'custom',
    kind VARCHAR(20) NOT NULL DEFAULT 'agent',
    image VARCHAR(255) NOT NULL,
    command TEXT,                        -- simple-array: CSV
    env JSONB,
    "defaultModel" VARCHAR(100),
    runtime VARCHAR(20) NOT NULL DEFAULT 'docker',
    "requiredSecrets" TEXT,             -- simple-array: CSV of UPPER_SNAKE_CASE keys
    "isPublic" BOOLEAN NOT NULL DEFAULT TRUE,
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_catalog_entries_category ON catalog_entries(category);
CREATE INDEX IF NOT EXISTS idx_catalog_entries_kind ON catalog_entries(kind);

-- updatedAt trigger
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_catalog_entries'
  ) THEN
    CREATE TRIGGER set_updated_at_catalog_entries
      BEFORE UPDATE ON catalog_entries
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

-- Seed: built-in entries from agent catalog (idempotent via ON CONFLICT DO NOTHING)
INSERT INTO catalog_entries (key, "displayName", description, category, kind, image, "isPublic")
VALUES
  ('backend',  'Backend',         'Implementación de backend/API.',                              'dev',       'agent', 'agent-runtime:latest', TRUE),
  ('qa',       'QA',              'Pruebas y aseguramiento de calidad.',                        'dev',       'agent', 'agent-runtime:latest', TRUE),
  ('design',   'Design',          'Diseño de arquitectura/UX.',                                 'dev',       'agent', 'agent-runtime:latest', TRUE),
  ('security', 'Security',        'Revisión y hardening de seguridad.',                         'infra',     'agent', 'agent-runtime:latest', TRUE),
  ('infra',    'Infra',           'Infraestructura y despliegue.',                              'infra',     'agent', 'agent-runtime:latest', TRUE),
  ('custom',   'Custom',          'Agente genérico configurable.',                              'custom',    'agent', 'agent-runtime:latest', TRUE)
ON CONFLICT (key) DO NOTHING;

-- codex has a specific image and env
INSERT INTO catalog_entries (key, "displayName", description, category, kind, image, env, "defaultModel", "isPublic")
VALUES (
  'codex',
  'Knowledge Vault',
  'Vault de conocimiento por proyecto con RAG (curar/buscar/leer notas).',
  'knowledge',
  'agent',
  'knowledge-vault:latest',
  '{"CODEX_HTTP_PORT":"8080","CODEX_PROVIDER":"anthropic"}',
  'claude-opus-4-8',
  TRUE
)
ON CONFLICT (key) DO NOTHING;
