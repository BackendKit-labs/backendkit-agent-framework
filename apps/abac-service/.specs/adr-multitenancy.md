# ADR — Capa de multi-tenancy en abac-service

- **Estado:** Propuesto
- **Fecha:** 2026-06-29
- **Contexto previo:** `apps/cloud-platform/.specs/adr-unified-auth.md` (abac-service = IdP+PDP central)
- **Objetivo:** Habilitar el modelo SaaS B2B — **múltiples compañías, cada una self-service**:
  se le entrega un usuario administrador y configura su propio entorno (usuarios, roles,
  políticas), con aislamiento estricto entre compañías.

## Contexto

abac-service hoy es **single-tenant**:
- No hay entidad `Organization`/tenant de primer nivel.
- `User` tiene `@Unique(['email'])` **global** → dos compañías no pueden compartir un email.
- `User.tenantId` es un `varchar(100)` suelto (atributo ligado a Azure), no una frontera.
- `Role` es `@Unique(['name','applicationId'])` — por aplicación, no por compañía.
- El seed crea **un** super-admin global.

**El eje del diseño** — hay dos clases de `Application` que hoy se confunden:
1. **Apps de infraestructura (M2M)**: `cloud-platform`, `director-agent`, `vault-manager`.
   Son **compartidas por todos los tenants** (plataforma), no pertenecen a una compañía.
2. **Apps de un tenant** (OAuth clients / internas que una compañía registra para sí):
   pertenecen a esa compañía.

Y los **permisos** (`resource:action`, ej. `deployable:deploy`) son **vocabulario global de
plataforma** — las compañías componen roles a partir de él, no inventan permisos.

## Decisión

**Aislamiento row-level con `organizationId`** sobre DB/esquema compartido. Se descarta
schema-per-tenant y DB-per-tenant (sobrecarga operativa y de migraciones × N tenants; el
target son muchos tenants pequeños).

Se introduce una **System Organization** (UUID fijo, `isSystem=true`) que es dueña de la
infraestructura de plataforma (apps M2M, super-admins). Así **todo** tiene `organizationId`
no-nulo — lo de plataforma vive en la System org. Evita la ambigüedad de columnas nullable
y simplifica unicidad y filtrado.

### Nueva entidad: Organization (tenant)

```
organizations
  id          uuid pk
  name        varchar(150)
  slug        varchar(100)  UNIQUE      ← identificador estable, va en el claim
  status      enum(active|suspended|pending)  default active
  plan        varchar(20)   default 'free'
  isSystem    boolean       default false     ← true solo para la System org
  settings    json
  createdAt / updatedAt / isActive (BaseEntity)
```

### Qué se vuelve tenant-scoped (añadir `organizationId` FK → organizations)

| Entidad | organizationId | Nota |
|---|---|---|
| `User` | **sí** | toda persona/servicio pertenece a una org. Platform admins → System org |
| `Role` | **sí** | roles de la compañía. Templates de sistema → System org (materializados al signup) |
| `Policy` + `PolicyRule` | **sí** (rule hereda vía policy) | políticas ABAC propias del tenant |
| `Application` | **sí** | infra M2M → System org; apps propias del tenant → su org |
| `AuditLog` | **sí** | cada evento etiquetado con su org (trazabilidad por compañía) |
| `UserRole` / `UserApplication` / `UserPolicyAssignment` | **sí (denormalizado)** | hereda de User, pero se persiste para filtrar e integridad |

### Qué queda global (NO lleva `organizationId`)

| Entidad | Razón |
|---|---|
| `Permission` | vocabulario `resource:action` definido por la plataforma; compartido |
| `RolePermission` | join de (Role del tenant) × (Permission global); hereda org vía el role |

### Cambios de unicidad

| Entidad | Antes | Ahora |
|---|---|---|
| `User` | `UNIQUE(email)` | `UNIQUE(organizationId, email)` |
| `Role` | `UNIQUE(name, applicationId)` | `UNIQUE(organizationId, name, applicationId)` |
| `Application` | `UNIQUE(name)` | `UNIQUE(organizationId, name)` (infra usa System org) |
| `Organization` | — | `UNIQUE(slug)` |

## Principales y acceso cross-tenant

| Principal | org | Capacidad |
|---|---|---|
| **Platform super-admin** | System org | CRUD de organizations, soporte cross-tenant. Bypassa el filtro de tenant (puede actuar sobre una org vía `?organizationId=`) |
| **Org admin (owner)** | su org | gestiona usuarios/roles/políticas **de su org** |
| **Org user** | su org | acceso según roles/políticas de su org |
| **M2M service** (cloud-platform…) | System org | se autentica a abac para llamar `can-access`; **no** representa a un tenant |

**Punto crítico — "on-behalf-of" / dos tokens.** El PEP (cloud-platform) es un servicio de
la System org que atiende a **muchos** tenants. El tenant de cada request **no** sale del
token del servicio, sino del **token del usuario final** (claim `org`). Cuando una persona de
la Compañía A llama a cloud-platform:
- cloud-platform valida el token del **usuario** (lleva `org`) → aísla sus datos por ese `org`.
- cloud-platform se autentica como **servicio** (M2M EdDSA) para llamar `/abac/can-access`,
  pasando el `userId`; abac resuelve la org del usuario y **enforce** el aislamiento en la decisión.

## Claims del JWT

Añadir `org` y `orgSlug` a **todos** los tokens de usuario:

```jsonc
{ "sub": "...", "email": "...", "org": "<orgId>", "orgSlug": "acme",
  "accountType": "user", "applicationId": "...", "iss": "abac-service",
  "aud": "abac-clients", "exp": ... }
```

Tokens M2M de servicio: `org = SYSTEM_ORG_ID`, `accountType: "service"`, `platform: true`.

> Esto cierra el bug latente del dept-scoping de cloud-platform (sub-fase 4b): el match
> pasa de `Department.slug` solo a **(`org` + `slug`)** — `backend` de la Compañía A ≠
> `backend` de la Compañía B.

## Tenant signup (self-service)

Nuevo endpoint público (rate-limited): `POST /organizations/signup`

```jsonc
// body
{ "orgName": "Acme Inc", "orgSlug": "acme",
  "admin": { "email": "admin@acme.com", "firstName": "...", "lastName": "...", "password": "..." } }
```

Flujo transaccional:
1. Crear `Organization` (status `active` o `pending` si hay verificación de email).
2. Crear el **primer User** en esa org (`accountType: user`).
3. **Materializar** los roles base de la org desde templates de sistema (`org-admin`,
   `member`, `viewer`) → la compañía los posee y edita.
4. Asignar `org-admin` al primer usuario.
5. Devolver org + credenciales/primer login.

Validaciones: `slug` único global; `(org,email)` único. Bootstrap de plataforma (System org +
super-admin) lo hace `npm run seed` (reemplaza el super-admin global de hoy).

## Enforcement del aislamiento

TypeORM no tiene RLS nativa. Estrategia en capas:

1. **`TenantContextInterceptor`**: tras validar el principal, puebla
   `req.tenant = { organizationId, isPlatform }`. Decorador `@CurrentOrg()`.
2. **Scoping explícito en servicios** vía helper compartido `TenantScope.apply(qb, org)` —
   regla dura: *ninguna query tenant-scoped sin filtro de org*. Lint/review lo vigila.
3. **Checks a nivel recurso**: al cargar por id, si `resource.organizationId !== principal.org`
   → **404** (no 403), para no filtrar existencia entre compañías (mismo patrón que el
   dept-scoping de cloud-platform).
4. **Platform principals** (System org) bypassean el filtro; para soporte usan
   `?organizationId=<tenant>` explícito y auditado.
5. **Cache Redis namespaced por org**: `abac:perms:{org}:{user}:{app}`, `abac:apikey:{org}:…`
   — evita fugas de permisos entre tenants.

## Motor ABAC

- Añadir `organization` a los *facts* de `json-rules-engine`
  (`{ user, application, membership, organization, context, timestamp }`).
- `can-access(userId, appId, resource, action, context)`:
  - resuelve la org del `userId`;
  - si el `context` trae org del recurso, verifica que coincida (salvo platform principal);
  - evalúa políticas con el fact `organization`.

## Plan de migración (fases)

**T1 — Modelo + datos** ✅ (implementado)
- ✅ Entidad `Organization` + `tenancy.constants.ts` (UUIDs fijos System/Default) + `OrganizationsModule`.
- ✅ `organizationId` **nullable** + relación en User/Role/Policy/Application/AuditLog
  (AuditLog `ON DELETE SET NULL`; el resto `CASCADE`).
- ✅ Migración `AddTenancyOrganizations` — crea tabla, siembra System+Default, columnas
  nullable, backfill (infra M2M → System; resto → Default) y FKs.
- ⏸️ **Hardening separado y gated post-T2** (`HardenTenancyConstraints`): `NOT NULL` +
  swap de uniques a compuestos. **No** se hace en T1 porque (a) marcar NOT NULL antes de
  que el código setee la org (T2) rompería los inserts existentes, y (b) un unique
  compuesto con `organizationId` nullable **no aísla** (los NULL son distintos en índices
  únicos de MySQL → permitiría emails duplicados). La migración aborta si quedan filas con
  org NULL. **Las join tables (UserRole/UserApplication/UserPolicyAssignment) heredan la org
  vía FK; su denormalización se difiere** (no necesaria para el aislamiento de T1).

**T2 — Token + enforcement**

T2-core ✅ (implementado):
- ✅ Claim `org` en admin login y tokens M2M (M2M → org dueña de la app, infra = System).
- ✅ `JwtStrategy.validate` expone `org`/`orgSlug` en `req.user`.
- ✅ Infra de contexto: `TenantContext` + `resolveTenantContext`, `TenantContextInterceptor`
  (global), `@CurrentOrg()`, `TenantScope` (apply/where/owns/cacheKey). Tests de los helpers.
- ✅ Write-path representativo: `UserController.create` pasa `@CurrentOrg()` y
  `UserService.createUser` setea `organizationId` + unicidad de email por org.

T2b — punto 1 ✅ (write-paths + seeds):
- ✅ `organizationId` seteado al crear Role (role.controller), Policy (policy.service vía
  `@CurrentOrg`), Application internal (contexto), OAuth client (hereda de la app dueña) y
  M2M service (→ System org). Unicidad escopada por org en cada uno.
- ✅ Seeds: `seed-initial-data` asegura System+Default y backfillea lo sembrado → System;
  `seed-m2m-services` inserta los servicios M2M en System. Tras seed+migración no quedan
  filas con org NULL → el hardening `HardenTenancyConstraints` ya puede aplicarse.
- ⬜ **Gap restante:** la sync lazy de Entra ID (`auth.service.syncEntraUser`) crea usuarios
  sin org — falta mapear el tenant de Azure (`entraTenantId`) → Organization.

T2b — resto ⬜ (incremental, pendiente):
- Aplicar `TenantScope` en los **reads** de los services (list/get) con 404 en mismatch.
- Adoptar `TenantScope.cacheKey` en los callers que cachean permisos/api-keys (namespacing).
- `orgSlug` en el claim de admin login (hoy solo va `org`/id).
- Override de soporte para platform admins (`?organizationId=`).

**T3 — Self-service**
- `POST /organizations/signup` + materialización de roles base por org.
- CRUD de `/organizations` (platform super-admin).

**T4 — PDP org-aware**
- `can-access` enforce org + fact `organization` en políticas.

**T5 — (opcional) consola cross-tenant** para platform super-admins.

## Consecuencias

**Positivas**
- Onboarding de una compañía = "crear org + admin" en un punto; el resto se autoconfigura.
- Aislamiento estricto verificable; auditoría por compañía.
- Reusa todo lo que abac ya trae (JWKS/EdDSA, ABAC, audit, OTel, rate-limit).

**Negativas / riesgos**
- Sin RLS nativa → el aislamiento depende de disciplina de scoping (mitigado con helper +
  checks a nivel recurso + tests cross-tenant obligatorios).
- Migración con backfill y cambio de constraints únicos — requiere ventana cuidada.
- `Permission` global asume catálogo compartido; permisos custom por tenant quedan fuera de
  alcance inicial (se puede añadir luego con `organizationId` nullable en Permission).

## Alternativas descartadas

- **Schema/DB-per-tenant**: aislamiento más fuerte pero migraciones × N y operación compleja;
  innecesario para muchos tenants pequeños.
- **`Application` como tenant**: las apps son infra/clientes, no compañías; los usuarios son
  globales. Romper esa semántica genera más deuda que la entidad `Organization` dedicada.
- **tenantId suelto (lo de hoy)**: atributo sin integridad referencial ni unicidad compuesta;
  no aísla.
