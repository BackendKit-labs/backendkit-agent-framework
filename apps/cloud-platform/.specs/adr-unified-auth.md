# ADR — Unificación de autenticación y autorización (IdP+PDP central)

- **Estado:** Aceptado (IdP = abac-service)
- **Fecha:** 2026-06-29
- **Contexto previo:** `COMPARISON.md` (gap #2), `.specs/IMPROVEMENT-PLAN.md` (Phase 4)
- **Componentes:** `apps/abac-service`, `apps/cloud-platform`, `director-agent`, `vault-manager`

> **Actualización (2026-06-29) — el IdP es `abac-service`, no `auth-service`.**
> Tras evaluar un microservicio ABAC existente (grado producción: JWKS/EdDSA, motor de
> políticas ABAC, audit log, OpenTelemetry, Entra ID, rate-limit, service accounts M2M),
> se decidió **consolidar en él** en vez de extender auth-service. Se copió y adaptó a
> `apps/abac-service`. El cuerpo de este ADR sigue siendo válido sustituyendo
> "auth-service" por "abac-service", con dos mejoras directas:
> - La firma pasa a **EdDSA/Ed25519 con JWKS** (el "objetivo de hardening" ya viene hecho),
>   no secreto simétrico compartido.
> - La autorización usa **permisos ABAC `resource:action` + PDP `/abac/can-access`**, no
>   `tools[]`. El `@RequireTool` de la sub-fase 4b se renombrará a `@RequirePermission`.
>
> **Trabajo ya hecho que sigue válido:** 4a (validación stateless), 4b (guard de
> autorización + dept-scoping), 4c (borrado de identidad local en cloud-platform).
> **Pendiente:** (1) capa **Organization/Tenant** en abac-service para multi-compañía
> self-service; (2) catálogo de permisos propio (`deployable:deploy`, `secret:write`, …);
> (3) integrar cloud-platform como PEP (verificar EdDSA por JWKS + consultar PDP).

## Contexto

Hoy existen **dos sistemas de identidad paralelos** que no comparten ni la clave de firma:

| | auth-service | cloud-platform |
|---|---|---|
| Store de identidad | `users` (SQLite/Turso) | `users` (Postgres) — duplicado |
| Emite JWT | sí, firma con `AUTH_SECRET` | sí, firma con `JWT_SECRET` (clave distinta) |
| Payload | `role, dept, tools[], vault[], apps[]` | `{ sub, email }` |
| Valida contra | su tabla `users` | su tabla `users` local (`auth/strategies/jwt.strategy.ts:27`) |
| M2M | no tiene | ApiKey `bkc_xxx` (`X-Api-Key`) |
| RBAC | rol → tools del director + namespaces del vault | scopes binarios `["*"]` en ApiKey |

Consecuencias del estado actual:
- Un usuario de auth-service **no puede** autenticarse contra la REST de cloud-platform.
- cloud-platform reimplementa register/login/bcrypt que ya existen en auth-service.
- Dos claves de firma, dos superficies de identidad, dos lugares donde rotar/auditar.

**Habilitador clave:** ningún dominio de cloud-platform (Deployable, Secret, Workflow,
Department) tiene FK a su tabla `users` — solo la usan los módulos `auth`/`users`. Por lo
tanto se puede retirar la identidad local de cloud-platform **sin tocar el modelo de
negocio**.

## Decisión

**auth-service es el único Identity Provider y servidor de autorización del ecosistema.**
cloud-platform deja de emitir identidad y pasa a ser un **resource server** que solo
*valida* tokens emitidos por auth-service.

```
auth-service  (ÚNICO emisor de identidad + autorización)
   │  emite JWT firmado  (sub, role, dept, tools[], vault[], apps[])
   ├──────────────► director-agent      (ya valida)
   ├──────────────► vault-manager        (ya valida)
   └──────────────► cloud-platform REST  (NUEVO: solo valida, no emite)
```

### Sub-decisiones

**1. Clave de firma.**
- *Ahora:* clave simétrica compartida — cloud-platform usa `AUTH_SECRET` (HS256) en lugar
  de `JWT_SECRET`.
- *Objetivo (endurecimiento prod):* auth-service firma con par asimétrico (RS256/EdDSA) y
  expone **JWKS** (`/.well-known/jwks.json`); los resource servers validan con la clave
  pública. Ningún resource server puede forjar tokens.

**2. Autorización — reusar el vocabulario existente, no construir uno nuevo.**
Los guards de cloud-platform autorizan con los claims que auth-service ya emite:
- `tools[]` → exigir la tool cloud correspondiente por endpoint (`cloud_deploy`,
  `cloud_stop`, … ya existen en el vocabulario del director).
- `dept` → filtrar/scopear los recursos visibles y operables.
No se crea modelo `Role`/`Permission` propio en cloud-platform.

**3. M2M (director-agent).**
- *Ahora:* las ApiKeys (`bkc_xxx`) se mantienen como **excepción M2M local** del resource
  server. El director sigue funcionando sin cambios.
- *Objetivo:* modelar **service accounts** en auth-service que emiten JWT (o
  client-credentials); el ApiKey local desaparece y queda una sola fuente de credenciales.

**4. Validación stateless (no introspección por request).**
cloud-platform valida firma + `exp` localmente (clave compartida o JWKS cacheado). **No**
hace introspección remota contra auth-service por request, para no crear acoplamiento de
disponibilidad (si auth-service cae, cloud-platform debe seguir validando).

**5. Revocación.** TTL cortos en los tokens + (opcional) lista de revocación consultada de
forma asíncrona. Un usuario desactivado en auth-service mantiene su token válido hasta el
`exp`; se asume aceptable con TTL corto en Fase 1.

## Consecuencias

**Positivas**
- Una sola fuente de identidad, una sola clave a rotar/auditar, un solo punto para añadir
  OIDC/SSO (Entra ID, Auth0) en el futuro — todos lo heredan.
- cloud-platform borra `AuthService`, `/auth/register`, `/auth/login` y su tabla `users`.
- Un usuario de auth-service opera la REST de cloud-platform con su rol real.
- Reemplaza y simplifica la Phase 4 del improvement plan (sin RBAC duplicado).

**Negativas / riesgos**
- auth-service entra en la ruta crítica de cloud-platform. Mitigado con validación stateless
  (no hard dependency en runtime) y JWKS cacheado.
- Revocación inmediata no es posible con JWT stateless puro → TTL cortos.
- Migración requiere coordinar `AUTH_SECRET` entre servicios y reapuntar el login del
  frontend a auth-service `:4000`.

## Plan de migración (resumen)

Detalle por fases en `.specs/IMPROVEMENT-PLAN.md` (Phase 4, reescrita).

1. Unificar clave de firma: cloud-platform valida con `AUTH_SECRET`.
2. Reescribir `jwt.strategy.ts`: leer claims de auth-service, eliminar lookup a `users` local.
3. Guards de autorización: chequear `tools[]` por endpoint + scope por `dept`.
4. Borrar identidad local de cloud-platform (`/auth/*`, `AuthService`, tabla `users`);
   reapuntar login del frontend a auth-service.
5. M2M: mantener ApiKeys como excepción local (Fase 1) → service accounts en auth-service
   (Fase 2).
6. Endurecimiento: migrar de secret compartido a JWKS asimétrico.

## Alternativas descartadas

- **RBAC propio en cloud-platform** (Phase 4 original): duplicaría el motor de roles que ya
  vive en auth-service. Descartado.
- **Introspección remota por request:** acopla la disponibilidad de cloud-platform a
  auth-service. Descartado en favor de validación stateless.
- **Mantener dos IdP sincronizados:** complejidad de sincronización y doble superficie de
  ataque sin beneficio. Descartado.
