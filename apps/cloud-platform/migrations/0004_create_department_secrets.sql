-- PR 3: Secret entity — env vars scoped to a department.
-- Idempotent — safe to run multiple times.

CREATE TABLE IF NOT EXISTS department_secrets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    "departmentId" UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
    key VARCHAR(100) NOT NULL,
    value TEXT NOT NULL,
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_dept_secret_key UNIQUE ("departmentId", key)
);

CREATE INDEX IF NOT EXISTS idx_dept_secrets_dept ON department_secrets("departmentId");
