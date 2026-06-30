# IMPROVEMENT PLAN — cierre de gaps enterprise

> Origen: `COMPARISON.md` (raíz) — análisis vs. rúbrica enterprise de MCP deployment
> platforms (Prefect 2026). Modelo de dominio: ver `ARCHITECTURE.md`.
>
> Orden por **riesgo × esfuerzo**: primero lo que bloquea cualquier claim "enterprise"
> (secrets en claro, audit, superficie de ataque del runtime), luego control de acceso,
> luego observabilidad y multi-tenancy.

## Phase 1: Cifrado de secrets (cerrar `src/vault/`)
**Goal:** Eliminar el almacenamiento de secrets en texto plano. Cifrar en reposo con una
clave gestionada (envelope encryption), descifrar solo en el momento de inyección al
runtime. Cierra el gap #1 de `COMPARISON.md`.

**Cambios:**
- `src/vault/` — completar el módulo: `EncryptionService` (AES-256-GCM con DEK envuelta
  por KEK desde `KMS_KEY` / `VAULT_*` env, fallback a `MASTER_KEY` para self-hosted).
- `src/departments/secret.entity.ts` — `value` pasa a `valueEncrypted` + `iv` + `authTag`.
- `migrations/0008_encrypt_secrets.sql` — añade columnas cifradas, migra valores existentes.
- `src/departments/secret.service.ts` — cifra en write, descifra solo en deploy inject.
- `src/director/director.service.ts` — usa el secret descifrado en memoria, nunca lo loguea.

**Completion criteria:**
- [ ] Ningún secret se persiste en texto plano (verificado con query directa a DB)
- [ ] `GET /departments/:id/secrets` sigue devolviendo solo keys, nunca valores
- [ ] Deploy inyecta el valor correcto descifrado como env var
- [ ] Rotación de KEK documentada en `README.md`
- [ ] Migración 0008 idempotente y reversible

**Dependencies:** None

## Phase 2: Audit log inmutable
**Goal:** Registro append-only de toda acción sensible (deploy, stop, secret CRUD, apikey
CRUD, login). Responder "quién hizo qué, cuándo, sobre qué recurso". Cierra gap #3.

**Cambios:**
- `src/audit/audit.entity.ts` — `AuditEvent { id, actorType, actorId, action, resourceType, resourceId, metadata, ip, createdAt }`. Sin update ni delete.
- `src/audit/audit.service.ts` + `audit.interceptor.ts` — interceptor global que emite eventos.
- `migrations/0009_audit_events.sql` — tabla con índice por `(resourceType, resourceId, createdAt)`; revoke UPDATE/DELETE a nivel de rol DB.
- `GET /audit` (solo scope `audit:read`, read-only) con filtros por actor/recurso/fecha.

**Completion criteria:**
- [ ] Deploy/stop/secret/apikey/login generan un AuditEvent
- [ ] No existe endpoint ni método que actualice o borre eventos
- [ ] `GET /audit?resourceId=` devuelve la traza completa de un deployable
- [ ] El log nunca contiene valores de secrets (solo keys/metadata)
- [ ] Export en formato consumible (JSON/CSV) para auditoría

**Dependencies:** None

## Phase 3: Endurecer la superficie del runtime
**Goal:** Reducir el riesgo del mount `docker.sock` root-equivalent y actualizar el review
de seguridad. Cierra gap #4.

**Cambios:**
- `docker-compose.yml` / `k8s/` — introducir **docker-socket-proxy** (tecnativa) con
  allowlist de endpoints (containers, images) en vez del socket crudo.
- `src/runtime/docker.adapter.ts` — apuntar a `DOCKER_HOST` del proxy; documentar.
- `.security/security-review.md` — re-scan con scope ampliado: RuntimeSPI, adapters,
  inyección de env, manejo de `docker.sock`. Re-fechar.
- k8s: `NetworkPolicy` + `PodSecurityContext` (non-root, readOnlyRootFilesystem) para los
  contenedores desplegados.

**Completion criteria:**
- [ ] cloud-platform no monta `/var/run/docker.sock` directo en prod (usa proxy)
- [ ] El proxy rechaza endpoints fuera de la allowlist (verificado)
- [ ] Security review re-emitido cubriendo runtime, con veredicto y CWE
- [ ] Contenedores desplegados corren como non-root por defecto

**Dependencies:** None

## Phase 4: Unificar auth/authz en auth-service (cloud-platform = resource server)
**Goal:** Eliminar la identidad local de cloud-platform y centralizar autenticación y
autorización en `apps/auth-service` como único IdP. cloud-platform pasa de **emisor** a
**resource server**: solo valida tokens, nunca crea identidad. Cierra gap #2.
Diseño y trade-offs en `.specs/adr-unified-auth.md`.

> Reemplaza el plan original ("RBAC propio en cloud-platform"), que duplicaba el motor de
> roles que ya vive en auth-service. El vocabulario de autorización (`tools[]`, `dept`) ya
> es emitido por auth-service y se reutiliza tal cual.

**Sub-fase 4a — validación stateless de tokens de auth-service:**
- `src/auth/strategies/jwt.strategy.ts` — firmar/validar con `AUTH_SECRET` (no `JWT_SECRET`);
  leer claims `sub, role, dept, tools[], vault[], apps[]`; **eliminar** el `usersService.findById`
  (validación stateless, sin lookup a DB local).
- `.env.example` / `README.md` — documentar `AUTH_SECRET` compartido con auth-service.

**Sub-fase 4b — autorización por claims existentes:**
- ✅ `src/auth/guards/authz.guard.ts` + `src/common/decorators/require-tool.decorator.ts` —
  `@RequireTool('cloud_deploy')`: exige que el token incluya la tool cloud correspondiente.
  Cubre JWT (`req.user.tools`) y M2M ApiKey (`scopes`, comodín `*`/null = todas). Aplicado
  a los endpoints de `director` y `deployables`. 9 tests de guard + suite completa en verde.
- ✅ Scope por `dept` (opción (a) — match contra `Department.slug`): decorator
  `@DeptScope()` resuelve el slug del claim `dept` (M2M y roles sin `dept` → `null` =
  sin restricción). `DeployablesService.findAll` filtra por `dept.slug`; `findOne`
  (y por herencia `update`/`remove`) devuelve 404 si el deployable está fuera de scope
  (no filtra existencia entre depts). 6 tests de service. **Pendiente menor:** scoping de
  `create` (requiere resolver slug→id) y replicar el patrón en `secrets`/`workflows`.

**Sub-fase 4c — borrar identidad local:**
- ✅ Eliminados `auth.service.ts`, `auth.controller.ts`, `/auth/register`, `/auth/login`,
  DTOs de login/register, el módulo `users/` completo (service + entity) y sus specs.
- ✅ `auth.module.ts` reescrito (sin `AuthController`/`AuthService`/`JwtModule`/`UsersModule`);
  `app.module.ts` sin `UsersModule`. `jwt.strategy.ts` sin fallback a `JWT_SECRET`.
- ✅ `migrations/0010_drop_local_users.sql` — `DROP TABLE users CASCADE` (idempotente).
- ✅ `.env`/`.env.example` solo con `AUTH_SECRET`; `README.md` reapunta auth a auth-service.
- ✅ Suite completa en verde (12 suites / 70 tests) + `tsc` limpio tras el borrado.
- ⬜ Frontend (`frontend/`) — reapuntar login a auth-service `:4000`. **No mecánico:**
  auth-service usa `username` (no `email`), devuelve `token` (no `accessToken`), no tiene
  `/auth/profile` (tiene `/api/auth/verify`) ni registro self-service (admin-provisioned).
  Requiere proxy a `:4000` + decisión sobre la página de registro (ver abajo).

**Sub-fase 4d — M2M (decisión del ADR):**
- *Fase 1:* mantener ApiKeys (`bkc_xxx`) como excepción M2M local — el director sigue sin cambios.
- *Fase 2 (futuro):* service accounts en auth-service que emiten JWT; el ApiKey local desaparece.

**Completion criteria:**
- [x] cloud-platform NO emite JWTs ni tiene tabla `users` (endpoints `/auth/*` eliminados) — sub-fase 4c
- [x] `jwt.strategy.ts` valida con `AUTH_SECRET` sin lookup a DB (stateless) — sub-fase 4a
- [x] Endpoint protegido sin la tool requerida en el token → 403 (test) — sub-fase 4b
- [x] El claim `dept` filtra qué deployables ve y opera cada usuario (test) — sub-fase 4b, match por slug
- [x] El director-agent sigue operando (ApiKey intacta) tras la migración — path M2M intacto, AuthzGuard wildcard testeado
- [x] Si auth-service está caído, cloud-platform sigue validando tokens vigentes (no introspección por request) — validación stateless
- [ ] Un usuario creado en auth-service opera la REST de cloud-platform con su rol real — habilitado estructuralmente; falta verificación e2e + repoint del frontend

**Dependencies:** ninguna técnica; coordinar `AUTH_SECRET` entre servicios antes del corte.
OIDC/SSO (Entra ID, Auth0), cuando se requiera, se integra **una sola vez en auth-service**
y cloud-platform lo hereda — no es trabajo de este repo.

## Phase 5: Observabilidad — OpenTelemetry + rate limiting
**Goal:** Tracing distribuido y control de consumo por ApiKey/department. Cierra gaps #5 y #7.

**Cambios:**
- `src/observability/otel.ts` — instrumentación OpenTelemetry (traces + metrics), exporter
  OTLP configurable. Spans en deploy, runtime calls, workflow runs.
- `src/director/metrics` — exponer métricas Prometheus además del JSON actual.
- `src/common/guards/rate-limit.guard.ts` — rate limit por ApiKey y budget por department
  (Redis ya está en el stack).

**Completion criteria:**
- [ ] Un deploy genera un trace correlacionado (REST → director → runtime adapter)
- [ ] Métricas exportables a OTLP/Prometheus
- [ ] ApiKey excede su rate limit → 429 con `Retry-After`
- [ ] Budget por department configurable y visible en métricas

**Dependencies:** Phase 4 (para atribuir consumo por identidad/role)

## Phase 6: Multi-tenancy real
**Goal:** Hacer explícita la entidad Organization y aislar datos por tenant. Cierra gap #6;
habilita modelo SaaS.

**Cambios:**
- `src/organizations/` — Organization como entidad de primer nivel; toda query scoped por
  `orgId` (row-level o schema-per-tenant).
- `migrations/0011_org_scoping.sql` — `orgId` NOT NULL en Department/ApiKey/Catalog;
  backfill al tenant default.
- `src/common/interceptors/tenant.interceptor.ts` — resuelve `orgId` desde el token y lo
  fuerza en todas las queries.

**Completion criteria:**
- [ ] Ningún endpoint devuelve datos de otra organización (test cross-tenant)
- [ ] ApiKey y JWT portan `orgId`; las queries lo respetan sin excepción
- [ ] Catálogo: distinguir entries globales de entries por-org
- [ ] Migración backfillea el tenant default sin pérdida de datos

**Dependencies:** Phase 4

## Phase 7: DX de testing MCP + MCP Inspector
**Goal:** Cerrar la dimensión "Setup & testing" del artículo. Cierra gap #8.

**Cambios:**
- `Makefile` — target `mcp-inspect` que lanza MCP Inspector contra `cloud-mcp`.
- `README.md` — sección de testing local de tools del director.
- `test/` — smoke test que valida el handshake MCP y lista las 17 tools.

**Completion criteria:**
- [ ] `make mcp-inspect` abre el Inspector contra el connector cloud
- [ ] Smoke test verifica que las 17 tools del director responden
- [ ] README documenta el flujo de testing local de extremo a extremo

**Dependencies:** None

---

## Resumen de prioridades

| Fase | Gap que cierra | Riesgo si no se hace | Esfuerzo |
|---|---|---|---|
| 1 — Cifrado secrets | #1 | Crítico (secrets en claro) | M |
| 2 — Audit inmutable | #3 | Alto (sin trazabilidad) | M |
| 3 — Endurecer runtime | #4 | Alto (RCE vía docker.sock) | M |
| 4 — Unificar auth en auth-service | #2 | Alto (identidad duplicada, sin authz REST) | M |
| 5 — OTel + rate limit | #5, #7 | Medio | M |
| 6 — Multi-tenancy | #6 | Bloqueante para SaaS | L |
| 7 — DX testing MCP | #8 | Bajo | S |
