import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Fase T1 — hardening, **aplicar SOLO después de T2** (cuando el código setea
 * `organizationId` en cada insert de user/role/policy/application).
 *
 * Hace `organizationId` NOT NULL y reemplaza los uniques de un solo campo por
 * compuestos con la org (para que dos compañías puedan compartir email/nombres).
 *
 * Guard: aborta si quedan filas con `organizationId IS NULL` en las tablas que se
 * van a marcar NOT NULL — evita romper datos a medio backfillear.
 */
export class HardenTenancyConstraints1770300100000 implements MigrationInterface {
    name = 'HardenTenancyConstraints1770300100000';

    private static readonly NOT_NULL_TABLES = ['users', 'roles', 'policies', 'applications'];

    /** Dropea el UNIQUE constraint que cubre exactamente estas columnas (en ese orden). */
    private async dropUniqueOn(qr: QueryRunner, table: string, columns: string[]): Promise<void> {
        const rows: Array<{ constraint_name: string; cols: string }> = await qr.query(
            `SELECT c.conname AS constraint_name,
                    string_agg(a.attname, ',' ORDER BY array_position(c.conkey, a.attnum)) AS cols
               FROM pg_constraint c
               JOIN pg_class t ON t.oid = c.conrelid
               JOIN pg_namespace n ON n.oid = t.relnamespace
               JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(c.conkey)
              WHERE t.relname = $1
                AND c.contype = 'u'
                AND n.nspname = current_schema()
              GROUP BY c.conname`,
            [table],
        );
        const target = rows.find((r) => r.cols === columns.join(','));
        if (target) {
            await qr.query(`ALTER TABLE "${table}" DROP CONSTRAINT "${target.constraint_name}"`);
        }
    }

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Guard: ninguna fila sin org en las tablas que se marcarán NOT NULL
        for (const table of HardenTenancyConstraints1770300100000.NOT_NULL_TABLES) {
            const [{ n }] = await queryRunner.query(
                `SELECT COUNT(*) AS n FROM "${table}" WHERE "organizationId" IS NULL`,
            );
            if (Number(n) > 0) {
                throw new Error(
                    `[HardenTenancy] "${table}" tiene ${n} fila(s) con organizationId NULL. ` +
                    `Completá el backfill (T2 debe setear org en cada insert) antes de aplicar esta migración.`,
                );
            }
        }

        // NOT NULL (audit_logs queda nullable a propósito)
        for (const table of HardenTenancyConstraints1770300100000.NOT_NULL_TABLES) {
            await queryRunner.query(
                `ALTER TABLE "${table}" ALTER COLUMN "organizationId" SET NOT NULL`,
            );
        }

        // Swap de uniques a compuestos con la org
        await this.dropUniqueOn(queryRunner, 'users', ['email']);
        await queryRunner.query(
            `ALTER TABLE "users" ADD CONSTRAINT "UQ_users_org_email" UNIQUE ("organizationId", "email")`,
        );

        await this.dropUniqueOn(queryRunner, 'roles', ['name', 'applicationId']);
        await queryRunner.query(
            `ALTER TABLE "roles" ADD CONSTRAINT "UQ_roles_org_name_app" UNIQUE ("organizationId", "name", "applicationId")`,
        );

        await this.dropUniqueOn(queryRunner, 'policies', ['name', 'applicationId']);
        await queryRunner.query(
            `ALTER TABLE "policies" ADD CONSTRAINT "UQ_policies_org_name_app" UNIQUE ("organizationId", "name", "applicationId")`,
        );

        await this.dropUniqueOn(queryRunner, 'applications', ['name']);
        await queryRunner.query(
            `ALTER TABLE "applications" ADD CONSTRAINT "UQ_applications_org_name" UNIQUE ("organizationId", "name")`,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "UQ_users_org_email"`);
        await queryRunner.query(`ALTER TABLE "users" ADD CONSTRAINT "UQ_users_email" UNIQUE ("email")`);

        await queryRunner.query(`ALTER TABLE "roles" DROP CONSTRAINT IF EXISTS "UQ_roles_org_name_app"`);
        await queryRunner.query(`ALTER TABLE "roles" ADD CONSTRAINT "UQ_roles_name_app" UNIQUE ("name", "applicationId")`);

        await queryRunner.query(`ALTER TABLE "policies" DROP CONSTRAINT IF EXISTS "UQ_policies_org_name_app"`);
        await queryRunner.query(`ALTER TABLE "policies" ADD CONSTRAINT "UQ_policies_name_app" UNIQUE ("name", "applicationId")`);

        await queryRunner.query(`ALTER TABLE "applications" DROP CONSTRAINT IF EXISTS "UQ_applications_org_name"`);
        await queryRunner.query(`ALTER TABLE "applications" ADD CONSTRAINT "UQ_applications_name" UNIQUE ("name")`);

        for (const table of HardenTenancyConstraints1770300100000.NOT_NULL_TABLES) {
            await queryRunner.query(
                `ALTER TABLE "${table}" ALTER COLUMN "organizationId" DROP NOT NULL`,
            );
        }
    }
}
