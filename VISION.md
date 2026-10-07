# Warden — Visión de Producto
## Framework de agentes con gobernanza nativa

> **Identidad:** marca **Warden** · org/repo `warden-agents` · scope npm `@warden-agents/*`
> (el control plane — ex `abac-service` — se llama `warden`).

> Estado: **borrador inicial** (consolidación de la reorientación de producto).
> Este documento define la dirección; el detalle técnico del contrato vive en los RFCs que se deriven de aquí.

---

## 1. La tesis, en una frase

> **Warden es el framework para construir agentes que la empresa se atreve a desplegar.**
> Construcción de agentes + gobernanza (identidad, autorización, auditoría, límites) **dentro del mismo SDK** — no como accesorios.

## 2. Por qué (el slot de mercado vacío)

| Jugador | Construcción de agentes | Autorización/auditoría enterprise |
|---|---|---|
| LangChain / CrewAI / AutoGen / OpenAI Agents SDK | ✅ Fuerte (mindshare ganado) | ❌ Casi nula |
| Keycloak / Auth0 / SpiceDB / OPA | ❌ No construyen agentes | ✅ Fuerte |
| **BackendKit** | ✅ Engine, tools, MCP, workflows, memoria, skills | ✅ ABAC, PDP, vault visibility, auditoría (en germen) |

- El framework **solo** no es defendible: LangChain ya ganó el "construir agentes" genérico.
- La gobernanza **sola** tampoco: Keycloak/SpiceDB ganan el IAM genérico.
- **Lo defendible es la suma integrada:** el enforcement vive *dentro* del runtime de construcción de agentes. Esa integración no existe hoy en el mercado.

## 3. El producto

### 3.1 Artefacto único: el "agente gobernado"

```ts
const engine = createGovernedAgent({
    tools, agents,
    identity: m2mToken,            // quién es el agente (emitido por abac-service)
    permissions: pdpClient,        // qué tools/recursos puede tocar, por tenant/scope
    audit: auditSink,              // cada tool call queda registrada (qué, quién, cuándo, cuánto costó)
    limits: { failClosed: true },  // si el PDP cae → denegar, no permitir
});
```

### 3.2 Dos capas, un solo ecosistema

| Capa | Qué es | Dónde vive |
|---|---|---|
| **Control plane** | `abac-service` — identidad (IdP), decisión (PDP), auditoría central, clave privada | Servicio standalone complementario (como Postgres o Redis) |
| **Data plane** | `packages/governance` — verificación de tokens (clave pública), evaluación de permisos, auditoría local, fail-closed | SDK embebido en el framework (cada agente lo incluye como librería) |

- La **decisión es central** (fuente de verdad única, revocación inmediata, clave privada en un solo lugar).
- El **enforcement es local** (verificación EdDSA sin red, decisiones cacheadas con TTL, fail-closed).
- Modo dev/offline: `EmbeddedPolicyProvider` (política exportada, con warning explícito) — la DX no depende de levantar el servicio.

## 4. El contrato de dominio agente (esbozo)

El modelo de autorización pasa de "qué usuario llama a qué endpoint" a **"qué agente invoca qué tool con qué argumentos, sobre qué recurso, en nombre de quién, y cuánto le cuesta"**:

| Dimensión | IAM genérico | Ámbito de agentes |
|---|---|---|
| **Principal** | Usuario / cliente OAuth | Agente M2M + humano + **cadena on-behalf-of** (agente por usuario, agente por agente) |
| **Recurso** | Endpoint / ruta | **Tool call + argumentos** + `scopeId` + tenant |
| **Acción** | Método HTTP | Nombre de tool (`run_command`, `docker_exec`, `vault_write`) |
| **Decisión** | allow / deny | allow/deny + **modo de ejecución** (approval, sandbox, dry-run) + razón auditable |
| **Auditoría** | Logins y eventos | Cada **tool call** con cadena de actores, hash-chain, coste USD |
| **Límites** | Rate limit por IP | **Cuotas por agente/tenant**: tokens, coste, nº de calls, timeout |
| **Token** | Service token plano | Credencial de agente con scopes por tool, **revocable y rotable** |

### 4.1 Tipos raíz (para el RFC de `packages/governance`)

```ts
type AgentPrincipal = {
    agentId: string;
    tenantId: string;
    scopeId: string;              // genérico: repo | deployable | department | flow | entidad
    chain: string[];              // cadena on-behalf-of: [orchestrator → specialist → user]
    roles: string[];
    scopes: string[];             // scopes por tool: 'vault:write', 'docker:exec', ...
};

type ToolCallContext = {
    tool: string;                 // 'run_command' | 'docker_exec' | 'vault_write' | ...
    args: Record<string, unknown>; // el PDP puede evaluar argumentos
    tenantId: string;
    scopeId: string;
    resourcePath?: string;        // vault path / repo path / deployable id
};

type Decision =
    | { effect: 'allow'; mode: 'run' | 'approval_required' | 'sandboxed' | 'dry_run'; reason: string }
    | { effect: 'deny'; reason: string };

type AuditEvent = {
    ts: string;
    chain: string[];              // quién originó la acción
    tenantId: string;
    scopeId: string;
    tool: string;
    argsHash: string;             // args redactados/hasheados, nunca en claro
    resourcePath?: string;
    decision: Decision;
    durationMs: number;
    costUsd?: number;
};
```

### 4.2 `scopeId`: la generalización de "proyecto" (no es un modelo de coding)

El "workspace multi-proyecto" del SDK es una instancia de coding. El concepto que gobierna es el **scope de operación** — el contexto delimitado al que se atan los permisos. Cada vertical instancia su propio scope:

| Vertical | scopeId |
|---|---|
| Coding | repo / workspace |
| Infra (docker/k8s) | environment / deployable |
| Finanzas | entidad / cartera |
| Conocimiento (vault) | vault path / department |
| Orquestador | flow / run |

`abac-service` no necesita saber qué es un "proyecto": solo modela **recurso anidado bajo un scope** y **política por scope**.

## 5. Mapa del repositorio: CORE / REFERENCIA / CONGELADO

### 🔵 CORE — el producto (lo único que se expande)
| Componente | Acción |
|---|---|
| **`packages/governance` (nuevo)** | SDK del data plane: PDP client, verificación JWT, tenant/scope helper, auditoría, fail-closed. Con tests de aislamiento. |
| `apps/abac-service` | Control plane: arreglar IDOR multi-tenant, unificar algoritmo JWT, fail-closed en scopes, auditoría tamper-evident, revocación/rotación de credenciales de agente. |
| `packages/agent-protocol` | Contrato "agente → autorización → auditoría" con tenant binding real. |
| `packages/web` + `packages/mcp-server` | Puntos de *enforcement*: auth fail-closed, sin `?token=` en URLs, IDOR de sesiones cerrado. |
| `packages/core` | El runtime de construcción — consume `governance` (auditoría automática de tool calls, approvals del PDP, allowlists fail-closed). |
| `packages/enterprise` | El vault gobernado (visibilidad por rol) + ComplianceGate fail-closed. |

### 🟢 REFERENCIA — demuestran el producto (se mantienen, no se expanden)
| Componente | Rol |
|---|---|
| `agents/director-agent` | Orquestador delgado de referencia (cliente de la capa de gobernanza). |
| `agents/docker-agent`, `k8s-agent`, `finance-agent` | Herramientas gobernadas de referencia — el caso de venta: "docker sin `sh -c`, con token M2M, con audit trail". |
| `apps/director-api`, `cloud-platform`, `director-chat`, `agent-studio`, `abac-admin` | Consumidores de referencia del PDP (replicar `AuthzGuard` en director-api; cerrar su IDOR). |

### ⚪ HEREDADO pero NO-FOCO (viaja al proyecto nuevo completo; no se expande en este ciclo)

Todas las capacidades de **diseño y construcción de agentes se heredan íntegras** al proyecto nuevo.
"Congelado" significa **no expandir como foco de producto en este ciclo**, nunca eliminar:

- Triggers/autonomía (cron/webhook/event, `createAutonomousAgent`) — se heredan; en modo enterprise exigen gobernanza.
- `reflection`, `agent-memory`, `observability`, `workspace`, `qa` — se heredan; no se expanden en este ciclo.
- Todos los agentes (`agents/*`) — se heredan como ejemplos de diseño y construcción.

### ⚫ NO se hereda (poda mínima, a confirmar)

- `apps/*` del ciclo anterior (director-chat, agent-studio, vault-manager, cloud-platform, director-api, abac-admin, bk-agent) — salvo `abac-service` (control plane). Se confirma con el propietario si alguno viaja como ejemplo de consumo.
- Secretos, `.env`, bases de datos locales, y la deuda de seguridad de la auditoría (se corrige, no se copia).

## 6. Gap de `abac-service` hacia el ámbito de agentes

### Qué sobra / se re-pesa (orientado a humano/API genérica)
- OAuth2 client-credentials completo (mantener como compat, no es core).
- Roles por "peso" (base para ABAC, no el enforcement final).
- Federación Entra + login interactivo (solo para el director/chat).
- Rate limit por IP en memoria (reemplazar por cuotas por identidad de agente).
- Consola admin (útil, no es el producto).

### Qué falta (propiedades de agente)
1. **Cadena on-behalf-of** en el token (`sub` + `on_behalf_of` + `chain`) y autorización de cadenas (el delegado nunca excede al delegador).
2. **Autorización por tool call con argumentos**: `(agente, tool, args, tenant, scope, sesión)`.
3. **Recursos de agente**: vault paths, deployables, flows — vía `scopeId` genérico.
4. **Decisiones con modo de ejecución**: allow + approval/sandbox/dry-run.
5. **Cuotas y límites**: coste USD, tokens, nº de calls, timeout — por agente/tenant.
6. **Revocación y rotación** reales de credenciales M2M + rotación de claves con múltiples `kid` en solapamiento.
7. **Auditoría de agente**: evento por tool call, hash-chain tamper-evident, coste.
8. **Tenancy por agente** con aislamiento real (hoy: IDOR multi-tenant en mutaciones).
9. **Registro dinámico**: el MCP server se presenta al arrancar, recibe identidad + scopes.

### Semillas que ya existen (no se tiran)
- `department_resources` con `uriPattern` (recursos MCP) — semilla del modelo de recursos.
- Scopes en api-keys de cloud-platform — semilla de scopes por tool.
- `AbacConditionSchema` en director — semilla de condiciones ABAC.
- Audit service con eventos — semilla de la auditoría.
- M2M EdDSA + JWKS — semilla de la identidad de servicio.

## 7. Roadmap por fases

### Fase 0 — Seguridad (semanas 1–2) *[no es deuda previa: es la Fase 1 del producto]*
1. Rotar secretos reales detectados (API key DeepSeek en `apps/vault-manager/.env`, token M2M en `apps/cloud-platform/.env`, credenciales DB) y purgar `.env`/`data/vault-manager.db`.
2. Fail-closed: gates de QA/seguridad/CI, allowlist de tools vacía, auth fail-open (agent-protocol, resource-auth), scopes de API keys.
3. IDOR multi-tenant de abac-service (filtrar `organizationId` en toda mutación).
4. RCE: `sh -c` en docker.adapter, `execSync` en codex-context, `shell:true` en `/plugin add` y `run_command`.
5. Fallback de clave EdDSA cero → `throw` si falta `ABAC_PUBLIC_KEY`.
6. Unificar algoritmo JWT (EdDSA vs HS256) y naming de claves.
7. Rate-limit en login.

### Fase 1 — Re-encuadre (mes 1)
- Escribir el **guard-rail contract** (cómo un agente pide permiso, cómo se audita, qué pasa si ABAC cae → fail-closed).
- Congelar subsistemas no-core (mover a `archive/` con `git mv`).
- Reescribir `README.md`/`design.md`/`specification.md` al nuevo norte.
- Unificar `ED25519_PUBLIC_KEY`/`ABAC_PUBLIC_KEY`.

### Fase 2 — Extraer `packages/governance` (mes 2–3)
- SDK único con tests de aislamiento multi-tenant.
- Migrar abac-service, agent-protocol, web y mcp-server a consumirlo.
- Todo enforcement usa el mismo camino.

### Fase 3 — Referencias que venden (mes 3–4)
- Un "agente gobernado" de punta a punta (identidad M2M → PDP → tool call → audit trail) como caso de demo.
- Director y vault como las otras dos referencias.

### Fase 4 — Publicación
- Producto publicable = `@backendkit-labs/governance` (SDK) + `abac-service` (servicio) + contratos.
- El monorepo se reduce a lo que alimenta la tesis; lo congelado queda en `archive/`.

## 8. Qué NO hacer (tan importante como lo que sí)
- No construir un solo agente MCP nuevo hasta que el enforcement sea el estándar (sí se heredan todos los existentes).
- No expandir como foco, en este ciclo: triggers/autonomía/memoria/reflexión (se heredan completos, no se amplían).
- No agregar conectores SaaS nuevos (los existentes se heredan como referencia, no son el foco).
- No meter multi-agente por defecto: el orquestador de referencia es delgado.

## 9. Decisiones de repositorio
- **No fork, no reescritura.** Mismo monorepo, corte limpio:
  1. Este documento (`VISION.md`) es el punto de partida.
  2. Rama de reencuadre → `archive/` (git mv preserva historial) → README reescrito → esqueleto de `packages/governance`.
  3. Fase 0 de seguridad como PRs.
- **Cuándo re-evaluar un repo separado:** si el repo actual queda como plataforma interna consumida por otros equipos, o si `governance` se publica como SDK con ciclo de vida independiente. Aun así, se resuelve con workspaces, no con fork.
