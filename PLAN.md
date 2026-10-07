# Plan de Creación — Proyecto Nuevo (independiente, con reciclaje selectivo)

> Este documento define **cómo** se crea el proyecto nuevo a partir del monorepo actual
> (`agent-framework` / BackendKit Platform), sin tocar el repo actual ni romper a los
> consumidores de los paquetes NPM publicados.
> La **visión** del producto vive en `VISION.md`; este documento es el plan de ejecución.

---

## 1. Objetivo

Crear un **proyecto nuevo, independiente** (repo, identidad npm y ciclo de vida propios)
que implemente la visión de `VISION.md` — *framework de agentes con gobernanza nativa* —
reciclando el código y el conocimiento del repo actual que ya son sólidos.

## 2. Restricciones inamovibles

1. **El repo actual queda intacto** — se conserva para otros usos futuros del propietario.
2. **Los paquetes NPM publicados** (`@backendkit-labs/agent-core`, `agent-coding`, `mcp-server`, `web`, `web-ui`, `enterprise`, `mcp-connectors`, `create-bk-agent`) **siguen publicados y funcionales** desde el repo actual para los proyectos que ya los consumen. El proyecto nuevo **no** reutiliza esos nombres de paquete (evita dos editores del mismo paquete).
3. **Los secretos reales encontrados en el workspace actual** (API key DeepSeek en `apps/vault-manager/.env`, token M2M en `apps/cloud-platform/.env`, credenciales DB) se **rotan** y **no** se copian al proyecto nuevo.
4. El proyecto nuevo arranca **sin deuda de seguridad** del actual: los hallazgos críticos de la auditoría se corrigen en el código reciclado antes del primer commit productivo.

## 3. Qué se recicla (selección deliberada — CORE del producto)

### Código fuente — SE HEREDA TODO lo de diseño y construcción de agentes

> Regla: **todas las capacidades de diseño y construcción de agentes viajan al proyecto nuevo, completas.**
> La gobernanza se integra como **capa** (`createGovernedAgent`), nunca como recorte de capacidades.
> "Congelado" = no expandir como foco en este ciclo; **no** = eliminar.
> La poda real solo aplica a productos/UI del ciclo anterior y artefactos de entorno (sección 4).

| Path actual | Rol en el proyecto nuevo |
|---|---|
| `packages/core/src` | Runtime de construcción de agentes — **completo**: engine, delegation, tools, workflow, skills, commands, context, checkpoint, workspace, agent-discovery, qa, reflection, agent-memory, observability, triggers. La gobernanza se integra como capa sin eliminar ninguna posibilidad |
| `packages/coding/src` | Vertical de agentes de coding (agentes, tools, providers) — se hereda |
| `packages/enterprise/src` | Vault + compliance + flows — se hereda (ComplianceGate pasa a fail-closed) |
| `packages/web`, `web-ui`, `mcp-server`, `mcp-connectors`, `agent-protocol`, `infra`, `aval-tools`, `curator-codex-agent`, `orchestrator-agent` | SDK y servidores — se heredan |
| `packages/templates`, `packages/create-bk-agent` | Plantillas y scaffolding — se heredan (re-diseño de DX si hace falta) |
| `apps/abac-service` | **Control plane** — identidad (IdP) + decisión (PDP) + auditoría central. Se implementa el gap de agentes (ver `VISION.md` §6) |
| `agents/*` (todos) | **Ejemplos de diseño y construcción de agentes** — se heredan completos; la gobernanza se les aplica como capa (director = orquestador de referencia; docker/k8s/finance = herramientas gobernadas de referencia) |
| `examples/*` | Ejemplos — se heredan |
| `packages/governance` (nuevo) | **El SDK del data plane** — se crea desde cero en el proyecto nuevo |

### Conocimiento y procesos

- `VISION.md` (visión consolidada).
- La **auditoría** (hallazgos críticos → lista de correcciones pre-commit).
- Los **tests que ya existen** (core engine, enterprise, coding tools) — se reciclan tal cual.
- Las decisiones de arquitectura documentadas en esta conversación.

## 4. Qué NO se recicla (poda mínima)

| Path actual | Razón |
|---|---|
| `apps/director-chat`, `agent-studio`, `vault-manager`, `cloud-platform`, `director-api`, `abac-admin`, `bk-agent` | Productos/UI del ciclo anterior — **solo se excluyen si el propietario lo confirma**; de lo contrario viajan como ejemplos de consumo |
| Cualquier `.env`, `data/*.db`, secretos | Nunca se copian |
| Deuda de seguridad de la auditoría | Se corrige, no se copia: IDOR multi-tenant, fail-open, RCE (`sh -c`, `execSync`, `shell:true`), fallback de clave EdDSA, secretos |

> **Nota:** todo lo que es capacidad de diseño/construcción de agentes se hereda **completo**
> (core, coding, enterprise, web, mcp, templates, agentes, examples). No se poda por "foco de producto":
> la gobernanza se integra como capa sin eliminar posibilidades.

## 5. Estrategia de identidad npm

- **Nombre del proyecto: Warden** — org/repo `warden-agents`, scope npm `@warden-agents/*`.
- Paquetes propuestos: `@warden-agents/core`, `@warden-agents/governance`, `@warden-agents/agent-runtime`, `@warden-agents/mcp-server`, `@warden-agents/vault`.
- Control plane (ex `abac-service`) se llama **`warden`** (servicio/containers, no paquete npm).
- El código reciclado se **re-bautiza** (renombrar `package.json` + imports internos) — es un fork interno con identidad nueva.
- Los paquetes `@backendkit-labs/*` existentes **no se tocan**: siguen publicándose desde el repo actual para sus consumidores.
- El producto nuevo publica: **SDK `governance`** + runtime + servicio (`warden` como contenedor).

## 6. Historial de git (decisión del propietario)

- **Opción A (recomendada si el historial importa):** `git clone` del actual + `git filter-repo` con los paths de la sección 3. Conserva el historial de `abac-service` y `core` (decisiones, fixes).
- **Opción B (código interno, historial irrelevante):** copia limpia de los paths de la sección 3 + `git init`. Más simple.
- En ambos casos el repo nuevo arranca con `main` y sin la deuda del actual.

## 7. Secuencia de creación

1. **Fase 0 (pre-requisito, no bloqueante):** rotar secretos del workspace actual; eliminar `.env` locales y `data/vault-manager.db`.
2. **Definir identidad:** nombre del proyecto, scope npm, ubicación del repo (org nueva, GitLab, local). *(decisión del propietario)*
3. **Extraer código:** clonar + `filter-repo` (paths §3) o copia limpia, según §6.
4. **Re-bautizar paquetes** (nuevos nombres + imports) y **podar** lo no reciclado.
5. **Corregir la deuda crítica de la auditoría** antes del primer commit productivo:
   - IDOR multi-tenant en `abac-service` (filtrar `organizationId` en toda mutación).
   - Fail-closed: gates de QA, allowlist de tools vacía, auth fail-open, scopes de API keys.
   - RCE: `sh -c` en docker.adapter, `execSync` en codex (o excluir codex), `shell:true` en `/plugin add` y `run_command`.
   - Fallback de clave EdDSA cero → `throw`; unificar algoritmo JWT y naming de claves.
   - Rate-limit en login.
6. **Fundar el producto:** `packages/governance` (tipos del contrato, `PolicyProvider` Remote/Embedded, auditoría, fail-closed) con tests.
7. **Referencias:** orquestador delgado + una herramienta gobernada de punta a punta (identidad M2M → PDP → tool call → audit trail).
8. **Publicar** el SDK y desplegar `abac-service` (docker-compose propio del proyecto nuevo).

## 8. Pendientes que requieren decisión del propietario

- [x] Nombre del proyecto: **Warden** (org/repo `warden-agents`, scope npm `@warden-agents/*`) — *verificado disponible en GitHub (user+org) y npm (paquete suelto); confirmar el scope al crear la org npm*.
- [ ] Crear la org npm `warden-agents` (confirmar disponibilidad del scope `@warden-agents/*`).
- [ ] Crear la org GitHub `warden-agents` y el repo del proyecto.
- [ ] Ubicación del repo (GitHub) y visibilidad (público/privado).
- [ ] Historial: Opción A (`filter-repo`) u Opción B (copia limpia).
- [ ] ¿El producto nuevo será open-source o privado?
- [ ] ¿`apps/*` del ciclo anterior viajan como ejemplos de consumo o se quedan en el repo actual?

---

## Anexo A — Análisis de valor por componente (basado en la auditoría)

> Criterio: qué aporta cada componente al proyecto nuevo (framework de agentes con gobernanza nativa).

### 🔵 Núcleo de valor (heredar — son el producto)

| Componente | Qué aporta | Estado verificado | Decisión |
|---|---|---|---|
| `packages/core` | Runtime completo de construcción de agentes (engine, delegación, workflow, skills, contexto, memoria, resilient client, MCP client) | Capacidades maduras con tests; fail-open corregibles | **Heredar completo** |
| `apps/abac-service` | Control plane: identidad (EdDSA/M2M), PDP, auditoría, multi-tenant | Arquitectura correcta; corregir IDOR/algoritmo/scopes | **Heredar** |
| `packages/enterprise` | Vault/RAG + ComplianceGate + flows | Mejor cobertura de tests; file locks | **Heredar completo** |
| `packages/agent-protocol` | Contrato agente → autorización → auditoría | Sin tests; fail-open | **Heredar** |
| `packages/coding` | Vertical de coding + tools con sandbox corregido y tests | El más sano (6.5/10) | **Heredar completo** |
| `agents/director-agent` | Orquestador de referencia | Mejor estructura de auth existente | **Heredar completo** |

### 🟢 Referencia (heredar — demuestran el producto)

| Componente | Rol | Trabajo pendiente |
|---|---|---|
| `packages/web` | Superficie HTTP/WS de agentes — punto de enforcement | IDOR en /sessions, HMAC webhooks, auth fail-open |
| `packages/mcp-server` | Indexer tree-sitter + SQLite FTS5 (integración MCP) | Tests; fail-open de recursos; skills_install traversal |
| `agents/docker-agent`, `k8s-agent` | Caso de venta: infra gobernada | Auth en HTTP MCP (hoy sin auth) |
| `agents/finance-agent` | Vertical financiera (627 tests verdes) | — |
| `agents/schedule-agent` | Demo de gobernanza (agente con triggers) | Rol auto-declarado → PDP |
| `agents/codex-context-agent-v2` | RAG de código → vault | RCE (execSync), read_note traversal |
| `packages/mcp-connectors` | Herramientas SaaS (HubSpot/Jira/GCal) | — |
| `packages/curator-codex-agent` | Curador de código para RAG | — |
| `apps/director-api`, `cloud-platform` | Consumidores de referencia del PDP | IDOR; AuthzGuard en director-api |
| `packages/create-bk-agent` + `templates` | DX del framework (scaffold con gobernanza) | Bug `.env` DeepSeek → openai |
| `packages/web-ui`, `apps/abac-admin` | Base opcional para dashboard de gobernanza | Sin tests; drift |

### ⚪ Dudoso / no aporta al proyecto nuevo

| Componente | Razón |
|---|---|
| `agents/vscode-terminal` | Fork completo de VS Code (peso muerto gigante); solo vale la idea del MCP de terminal |
| `apps/bk-agent` | CLI del ciclo anterior; `seed-config.ts` con UTF-8 inválido |
| `apps/director-chat`, `agent-studio`, `vault-manager` | UIs del ciclo anterior; no son el producto |
| `.github/workflows` | CI sin gates de seguridad — se rehace |
| Secretos, `.env`, `data/*.db`, deuda de seguridad | Se rotan/corrige, nunca se copian |
