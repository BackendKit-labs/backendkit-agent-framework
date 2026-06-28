-- PR 2: Deployable entity
-- Replaces the conceptual role of Agent with a richer deployable unit.
-- Idempotent — safe to run multiple times.

CREATE TABLE IF NOT EXISTS deployables (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    kind VARCHAR(10) NOT NULL DEFAULT 'agent',
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    "departmentId" UUID REFERENCES departments(id) ON DELETE SET NULL,
    "catalogKey" VARCHAR(100),
    image VARCHAR(255),
    runtime VARCHAR(20) NOT NULL DEFAULT 'docker',
    "runtimeHandle" VARCHAR(255),
    -- agent-specific
    model VARCHAR(100),
    "mcpPort" INT,
    -- app-specific
    "publicPort" INT,
    "publicUrl" VARCHAR(500),
    framework VARCHAR(20),
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_deployables_department ON deployables("departmentId");
CREATE INDEX IF NOT EXISTS idx_deployables_status ON deployables(status);
CREATE INDEX IF NOT EXISTS idx_deployables_kind ON deployables(kind);
CREATE INDEX IF NOT EXISTS idx_deployables_catalog ON deployables("catalogKey");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'update_deployables_updated_at'
  ) THEN
    CREATE TRIGGER update_deployables_updated_at
      BEFORE UPDATE ON deployables
      FOR EACH ROW
      EXECUTE FUNCTION update_updated_at_column();
  END IF;
END
$$;
