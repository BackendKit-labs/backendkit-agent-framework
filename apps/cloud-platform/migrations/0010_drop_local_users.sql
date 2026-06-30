-- Sub-fase 4c: cloud-platform deja de gestionar identidad local.
-- auth-service es el único IdP del ecosistema (ver .specs/adr-unified-auth.md).
-- Se elimina la tabla de usuarios local y todo lo que dependa de ella.
-- Idempotent — safe to run multiple times.

-- CASCADE elimina las FKs legacy que apuntan a users(id) (p. ej. agents.user_id,
-- projects.user_id, si existen): esas columnas quedan como UUID sin constraint.
-- El trigger update_users_updated_at y el índice idx_users_email se eliminan
-- automáticamente junto con la tabla.
DROP TABLE IF EXISTS users CASCADE;
