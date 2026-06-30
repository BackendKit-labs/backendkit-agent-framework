/**
 * Constantes de multi-tenancy. Ver `.specs/adr-multitenancy.md`.
 *
 * Toda fila tenant-scoped lleva `organizationId`. Lo de plataforma (apps de
 * infraestructura M2M, super-admins) vive en la **System org**. Los datos legacy
 * single-tenant se backfillean a la **Default org**.
 *
 * UUIDs fijos y reservados — no reasignar.
 */
export const SYSTEM_ORG_ID = '00000000-0000-0000-0000-000000000001';
export const SYSTEM_ORG_SLUG = 'system';

export const DEFAULT_ORG_ID = '00000000-0000-0000-0000-000000000002';
export const DEFAULT_ORG_SLUG = 'default';

/** Claim que transporta el tenant en los JWT de usuario (se inyecta en T2). */
export const ORG_CLAIM = 'org';
export const ORG_SLUG_CLAIM = 'orgSlug';
