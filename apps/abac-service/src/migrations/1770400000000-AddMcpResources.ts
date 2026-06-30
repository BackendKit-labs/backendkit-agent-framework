import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * MCP Resources ABAC — primera etapa:
 *  1. Tabla department_resources (ceiling de URIs por área)
 *  2. Columna vault_resources en users (override opcional por usuario)
 *  3. Columna department en users (enrutamiento de agentes)
 *  4. Seed de resource patterns para departments predefinidos
 */
export class AddMcpResources1770400000000 implements MigrationInterface {
    name = 'AddMcpResources1770400000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        // 1. Tabla department_resources
        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS "department_resources" (
                "id"          uuid        NOT NULL DEFAULT gen_random_uuid(),
                "createdAt"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                "updatedAt"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                "isActive"    boolean     NOT NULL DEFAULT true,
                "createdBy"   uuid        NULL,
                "department"  varchar(100) NOT NULL,
                "uriPattern"  varchar(500) NOT NULL,
                "description" varchar(255) NULL,
                CONSTRAINT "PK_department_resources" PRIMARY KEY ("id")
            )
        `);
        await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_dept_res_department" ON "department_resources" ("department")`);

        // 2. vault_resources — override personal (jsonb array de URI patterns)
        await queryRunner.query(`
            ALTER TABLE "users"
            ADD COLUMN IF NOT EXISTS "vaultResources" jsonb NULL
        `);

        // 3. department — string del área del usuario
        await queryRunner.query(`
            ALTER TABLE "users"
            ADD COLUMN IF NOT EXISTS "department" varchar(100) NULL
        `);

        // 4. Seed: resource ceilings por department
        const rows: Array<{ department: string; uriPattern: string; description: string }> = [
            // development
            { department: 'development', uriPattern: 'jira://*',                   description: 'Todos los recursos de Jira' },
            { department: 'development', uriPattern: 'director://workflows',        description: 'Listado de workflows activos' },
            { department: 'development', uriPattern: 'director://agents/health',    description: 'Estado de agentes desplegados' },
            // devops
            { department: 'devops',      uriPattern: 'director://workflows',        description: 'Listado de workflows activos' },
            { department: 'devops',      uriPattern: 'director://agents/health',    description: 'Estado de agentes desplegados' },
            { department: 'devops',      uriPattern: 'director://deployables',      description: 'Catálogo de deployables' },
            // sales
            { department: 'sales',       uriPattern: 'hubspot://*',                 description: 'Todos los recursos de HubSpot' },
            { department: 'sales',       uriPattern: 'odoo://customers/*',          description: 'Fichas de clientes Odoo' },
            { department: 'sales',       uriPattern: 'odoo://products/catalog',     description: 'Catálogo de productos' },
            // finance
            { department: 'finance',     uriPattern: 'odoo://invoices/*',           description: 'Facturas Odoo' },
            { department: 'finance',     uriPattern: 'odoo://products/catalog',     description: 'Catálogo de productos' },
            // hr — sin recursos de negocio por defecto
        ];

        for (const row of rows) {
            await queryRunner.query(`
                INSERT INTO "department_resources" ("department", "uriPattern", "description")
                VALUES ($1, $2, $3)
                ON CONFLICT DO NOTHING
            `, [row.department, row.uriPattern, row.description]);
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "department"`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "vaultResources"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_dept_res_department"`);
        await queryRunner.query(`DROP TABLE IF EXISTS "department_resources"`);
    }
}
