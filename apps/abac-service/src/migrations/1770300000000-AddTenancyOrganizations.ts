import { MigrationInterface, QueryRunner } from 'typeorm';
import {
    SYSTEM_ORG_ID,
    SYSTEM_ORG_SLUG,
    DEFAULT_ORG_ID,
    DEFAULT_ORG_SLUG,
} from '../common/tenancy/tenancy.constants';

/**
 * Fase T1 de multi-tenancy (ver .specs/adr-multitenancy.md) — parte SEGURA:
 *  1. Crea la tabla `organizations` y siembra System org y Default org.
 *  2. Añade `organizationId` NULLABLE a users/roles/policies/applications/audit_logs.
 *  3. Backfillea los datos legacy (infra M2M → System; resto → Default).
 *  4. Añade las FKs hacia organizations.
 *
 * El hardening (NOT NULL + uniques compuestos) va en una migración aparte que se
 * aplica DESPUÉS de T2, cuando el código setea `organizationId` en cada insert.
 */
export class AddTenancyOrganizations1770300000000 implements MigrationInterface {
    name = 'AddTenancyOrganizations1770300000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        // 1. Tabla organizations (mirror de BaseEntity + columnas propias)
        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS "organizations" (
                "id"        uuid NOT NULL,
                "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                "isActive"  boolean NOT NULL DEFAULT true,
                "createdBy" uuid NULL,
                "updatedBy" uuid NULL,
                "name"      varchar(150) NOT NULL,
                "slug"      varchar(100) NOT NULL,
                "status"    varchar(20) NOT NULL DEFAULT 'active',
                "plan"      varchar(20) NOT NULL DEFAULT 'free',
                "isSystem"  boolean NOT NULL DEFAULT false,
                "settings"  json NULL,
                CONSTRAINT "PK_organizations" PRIMARY KEY ("id"),
                CONSTRAINT "UQ_organizations_slug" UNIQUE ("slug")
            )
        `);
        await queryRunner.query(
            `CREATE INDEX IF NOT EXISTS "IDX_organizations_status_active" ON "organizations" ("status", "isActive")`,
        );

        // 2. Seed System org + Default org (idempotente)
        await queryRunner.query(
            `INSERT INTO "organizations" (id, name, slug, status, plan, "isSystem")
             VALUES ($1, 'System', $2, 'active', 'enterprise', true)
             ON CONFLICT (id) DO NOTHING`,
            [SYSTEM_ORG_ID, SYSTEM_ORG_SLUG],
        );
        await queryRunner.query(
            `INSERT INTO "organizations" (id, name, slug, status, plan, "isSystem")
             VALUES ($1, 'Default', $2, 'active', 'free', false)
             ON CONFLICT (id) DO NOTHING`,
            [DEFAULT_ORG_ID, DEFAULT_ORG_SLUG],
        );

        // 3. Columnas organizationId (nullable) — IF NOT EXISTS para idempotencia en dev
        for (const table of ['users', 'roles', 'policies', 'applications', 'audit_logs']) {
            await queryRunner.query(
                `ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS "organizationId" uuid NULL`,
            );
        }

        // 4. Backfill de datos legacy — cast ::uuid explícito porque Postgres no infiere
        //    el tipo de $n dentro de CASE WHEN (lo trata como text → falla al asignar a uuid)
        await queryRunner.query(
            `UPDATE "applications" SET "organizationId" =
                CASE WHEN type = 'm2m_service' THEN $1::uuid ELSE $2::uuid END
             WHERE "organizationId" IS NULL`,
            [SYSTEM_ORG_ID, DEFAULT_ORG_ID],
        );
        await queryRunner.query(
            `UPDATE "users" SET "organizationId" =
                CASE WHEN "accountType" = 'service' THEN $1::uuid ELSE $2::uuid END
             WHERE "organizationId" IS NULL`,
            [SYSTEM_ORG_ID, DEFAULT_ORG_ID],
        );
        await queryRunner.query(
            `UPDATE "roles" SET "organizationId" = $1::uuid WHERE "organizationId" IS NULL`,
            [DEFAULT_ORG_ID],
        );
        await queryRunner.query(
            `UPDATE "policies" SET "organizationId" = $1::uuid WHERE "organizationId" IS NULL`,
            [DEFAULT_ORG_ID],
        );
        // audit_logs: histórico previo a tenancy queda con organizationId NULL intencionalmente.

        // 5. FKs hacia organizations (bloque condicional para idempotencia)
        for (const table of ['users', 'roles', 'policies', 'applications']) {
            await queryRunner.query(`
                DO $$ BEGIN
                    IF NOT EXISTS (
                        SELECT 1 FROM information_schema.table_constraints
                        WHERE constraint_name = 'fk_${table}_organization'
                          AND table_name = '${table}'
                    ) THEN
                        ALTER TABLE "${table}"
                        ADD CONSTRAINT "fk_${table}_organization"
                        FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
                        ON DELETE CASCADE;
                    END IF;
                END $$
            `);
        }
        await queryRunner.query(`
            DO $$ BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.table_constraints
                    WHERE constraint_name = 'fk_audit_logs_organization'
                      AND table_name = 'audit_logs'
                ) THEN
                    ALTER TABLE "audit_logs"
                    ADD CONSTRAINT "fk_audit_logs_organization"
                    FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
                    ON DELETE SET NULL;
                END IF;
            END $$
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        for (const table of ['users', 'roles', 'policies', 'applications']) {
            await queryRunner.query(
                `ALTER TABLE "${table}" DROP CONSTRAINT IF EXISTS "fk_${table}_organization"`,
            );
        }
        await queryRunner.query(
            `ALTER TABLE "audit_logs" DROP CONSTRAINT IF EXISTS "fk_audit_logs_organization"`,
        );
        for (const table of ['users', 'roles', 'policies', 'applications', 'audit_logs']) {
            await queryRunner.query(`ALTER TABLE "${table}" DROP COLUMN IF EXISTS "organizationId"`);
        }
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_organizations_status_active"`);
        await queryRunner.query(`DROP TABLE IF EXISTS "organizations"`);
    }
}
