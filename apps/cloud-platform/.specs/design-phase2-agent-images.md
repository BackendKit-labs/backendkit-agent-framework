# Design — Fase 2: Imágenes de agente y catálogo

> Objetivo: que desplegar un agente sea *turnkey*. Hoy `deploy` exige una `image`
> arbitraria (probamos con `nginx`). Fase 2 define **qué es una imagen de agente**,
> entrega una **imagen de referencia real** (`agent-runtime`) y un **catálogo de
> plantillas** que resuelve `tipo de agente → imagen + comando + env`.

## Problema que resuelve

- `DEFAULT_AGENT_IMAGE=agent-runtime:latest` no existe → un deploy sin `config.image`
  falla en el pull.
- `CreateAgentDto` no expone `image` ni `runtime` (quedan ocultos en `config`).
- No hay forma de saber qué agentes/plantillas existen ni qué imagen usan.

## Contrato de una "imagen de agente"

Una imagen de agente es un contenedor de larga vida que:
1. Lee su identidad del entorno que inyecta el director:
   `AGENT_ID`, `AGENT_TYPE`, y opcional `MODEL`.
2. Se mantiene corriendo (heartbeat) — no sale al instante (a diferencia de `alpine`).
3. Expone un health HTTP en `AGENT_PORT` (default 8080) → `{ status, agentId, type, uptime }`.
4. Responde a `SIGTERM` para un stop limpio.

Esto deja la puerta abierta a que las imágenes reales (director, codex-context,
bk-coder…) implementen el mismo contrato y se desplieguen igual.

## Componentes

### 1. Imagen de referencia `agent-runtime` (PR 1)

`docker/agent-runtime/`:
- `Dockerfile` (FROM node:20-alpine, sin deps externas).
- `entrypoint.mjs`: banner + heartbeat + health HTTP usando solo `node:http`.

Es el `DEFAULT_AGENT_IMAGE` y sirve de plantilla para imágenes reales.
`Makefile`: target `agent-image` → `docker build -t agent-runtime:latest docker/agent-runtime`.

### 2. Catálogo de plantillas (PR 2)

`src/catalog/`:
- `AgentTemplate`: `{ key, displayName, description, image, runtime, command?, env?, defaultModel? }`.
- `AgentCatalog` (registro en código, sembrado): mapea cada `type`
  (`backend|qa|design|security|infra|codex|custom`) a una plantilla.
  Por defecto todas apuntan a `agent-runtime:latest` con `AGENT_TYPE` distinto,
  hasta que existan imágenes dedicadas.
- `GET /director/catalog` → lista de plantillas (alimenta UI / descubrimiento).

### 3. Resolución de imagen en el deploy (PR 2)

`DirectorService.deployAgent` resuelve el `AgentSpec` con esta precedencia:
1. `agent.image` (explícita) →
2. `catalog.resolve(agent.type).image` →
3. `DEFAULT_AGENT_IMAGE`.

Y **mergea** `command`/`env` de la plantilla (sin pisar lo que ya inyecta el
director: `AGENT_ID`, `AGENT_TYPE`, `MODEL`).

### 4. `CreateAgentDto`: `image` y `runtime` de primera clase (PR 2)

Campos opcionales nuevos:
- `image?: string` (override explícito).
- `runtime?: 'docker' | 'k8s' | 'process'` (default `docker`; k8s/process dan 503).

## Plan de PRs

1. **Imagen de referencia** `agent-runtime` + Makefile + build verificado.
2. **Catálogo** (`AgentTemplate` + `AgentCatalog` + `GET /director/catalog`),
   resolución de imagen en `deployAgent`, `image`/`runtime` en `CreateAgentDto`,
   tests.
3. (Opcional) **e2e**: build de la imagen, crear agente `type=codex`, deploy,
   `docker ps` muestra `agent-runtime`, health del contenedor responde.

## Criterios de aceptación

- [ ] `make agent-image` construye `agent-runtime:latest`; el contenedor queda
      `Up` y su `/health` responde con `agentId`/`type`.
- [ ] Deploy de un agente **sin** `config.image` funciona (usa la plantilla).
- [ ] `GET /director/catalog` lista las plantillas con su imagen.
- [ ] `CreateAgentDto` acepta `image` y `runtime`; la precedencia de resolución
      se respeta. Build limpio + tests verdes.
