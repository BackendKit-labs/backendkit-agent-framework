-- Migration 0001 — Fase 1 (RuntimeSPI): runtime fields on agents.
--
-- In development the schema is auto-synced (TypeORM synchronize=true), so this
-- file is for existing/production databases where synchronize is OFF.
-- Idempotent: safe to run more than once.
--
-- Column names use the camelCase that TypeORM generates from the entity
-- properties; "runtimeHandle" must stay quoted to preserve its casing.

ALTER TABLE agents ADD COLUMN IF NOT EXISTS runtime VARCHAR(20) DEFAULT 'docker';
ALTER TABLE agents ADD COLUMN IF NOT EXISTS image VARCHAR(255);
ALTER TABLE agents ADD COLUMN IF NOT EXISTS "runtimeHandle" VARCHAR(255);
