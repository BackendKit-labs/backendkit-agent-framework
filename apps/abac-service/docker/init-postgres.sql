-- Extensiones requeridas por abac-service en Postgres.
-- uuid-ossp: para uuid_generate_v4() (default de @PrimaryGeneratedColumn('uuid')).
-- pgcrypto: gen_random_uuid() y utilidades de hash.
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
