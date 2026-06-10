# Proyecto: Agentes Web Empresariales

> Diseño de la extensión del agent-framework hacia agentes web de uso empresarial,
> con soporte de LLMs locales, RAG sobre documentación interna y conexión a sistemas
> del negocio vía MCP.

---

## 1. Visión

Extender el framework actual (CLI-first) para que cualquier empresa pueda desplegar
agentes conversacionales web alimentados con su propio conocimiento, conectados a sus
sistemas en vivo, y con control total sobre dónde corren sus datos (LLM local o cloud).

**Principio rector:** el engine de agentes no cambia — se agregan capas de transporte,
conocimiento y proveedores. Todo lo construido (skills, MCP plugins, orquestación
multi-agente, memoria) se reutiliza tal cual.

**Punto de partida — qué ya es reutilizable en web:**
- Engine de agentes (LLM calls, tool use, agent switching)
- Skills system, MCP plugins, orquestación multi-agente
- Perfiles de agente, memoria, contexto de proyecto

**Qué falta para web:**
- Un `WebTransport` (WebSocket o SSE) en lugar de `TerminalTransport`
- Un servidor HTTP que envuelva el engine y exponga streaming
- Manejo de sesiones concurrentes (hoy el engine asume una sola sesión)
- UI — el framework no incluye frontend

---

## 2. Arquitectura general

```
┌─────────────────────────────────────────────────────────────┐
│                        Browser (UI)                          │
│   ChatWindow · ToolCallBadge · AgentSwitcher · Thinking      │
└──────────────────────────┬──────────────────────────────────┘
                           │ WebSocket / SSE
┌──────────────────────────▼──────────────────────────────────┐
│                  @bk/agent-web (NUEVO)                       │
│   AgentServer (Fastify) · WebSocketTransport · Sessions      │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│                  @bk/agent-core (existente)                  │
│   AgentEngine · Skills · Memory · Orchestrator · MCP Client  │
│   + ProviderAbstraction (NUEVO) → anthropic | ollama | ...   │
└───────┬──────────────────┬──────────────────┬───────────────┘
        │                  │                  │
┌───────▼───────┐  ┌───────▼───────┐  ┌───────▼───────┐
│  docs-agent   │  │   crm-agent   │  │   erp-agent   │
│  (RAG plugin) │  │  (Salesforce) │  │     (SAP)     │
└───────┬───────┘  └───────────────┘  └───────────────┘
        │
┌───────▼───────────────────────────┐
│  Vector DB (pgvector / Chroma)    │
│  ← ingestion pipeline ← docs      │
└───────────────────────────────────┘
```

**Posición en la cadena de paquetes:**

```
@bk/agent-core    (engine, skills, MCP)
       ↓
@bk/agent-coding  (agentes especializados)
       ↓
@bk/agent-web     ← nuevo: transport HTTP/WS + servidor
       ↓
create-bk-agent   ← scaffold genera template "web" además de "cli"
```

---

## 3. Componentes nuevos

### 3.1 `@bk/agent-web` — transporte y servidor

Paquete nuevo en el monorepo. Envuelve el engine existente y lo expone vía HTTP.

```
packages/web/
  src/
    server/
      AgentServer.ts        ← Fastify app, lifecycle, auth hooks
      routes.ts             ← POST /chat, GET /agents, GET /health
    transport/
      WebSocketTransport.ts ← streaming de chunks al browser
      SseTransport.ts       ← alternativa para clientes simples
    session/
      SessionManager.ts     ← N sesiones concurrentes, una Engine instance c/u
      SessionStore.ts       ← persistencia (memoria | redis)
    auth/
      AuthHook.ts           ← interfaz pluggable (JWT, API key, SSO empresa)
```

**Decisiones de diseño:**

| Decisión | Elección | Razón |
|---|---|---|
| Framework HTTP | Fastify | performance, schema validation, plugins |
| Streaming | WebSocket principal, SSE fallback | WS para chat bidireccional, SSE para embeds |
| Sesiones | 1 engine instance por sesión | el engine actual asume sesión única — aislamiento total |
| Estado de sesión | pluggable (memory/redis) | dev local sin deps, producción con redis |
| Auth | hook pluggable, no implementación fija | cada empresa tiene su SSO |

**Contrato del transporte** (mismo patrón que `TerminalTransport`):

```typescript
interface WebTransport {
  onChunk(sessionId: string, chunk: StreamChunk): void;    // texto incremental
  onToolCall(sessionId: string, tool: ToolCallInfo): void; // badge en UI
  onAgentSwitch(sessionId: string, agent: AgentProfile): void;
  onDone(sessionId: string, usage: Usage): void;
  onError(sessionId: string, error: AgentError): void;
}
```

### 3.2 Provider Abstraction — LLMs locales y cloud

Hoy el engine usa Anthropic SDK directo. Se introduce una abstracción mínima (~100 líneas)
para soportar proveedores OpenAI-compatible (Ollama, vLLM, LM Studio):

```typescript
// packages/core/src/providers/
interface LLMProvider {
  stream(req: CompletionRequest): AsyncIterable<StreamChunk>;
  countTokens?(text: string): Promise<number>;
}

class AnthropicProvider implements LLMProvider { ... }    // actual, extraído
class OpenAICompatProvider implements LLMProvider { ... } // Ollama, vLLM, etc.
```

Configuración por agente — permite estrategia híbrida:

```json
{
  "providers": {
    "cloud":  { "type": "anthropic", "model": "claude-sonnet-4-6" },
    "local":  { "type": "openai-compat", "baseURL": "http://localhost:11434/v1",
                "model": "llama3.3:70b" }
  },
  "agents": {
    "hr-agent":      { "provider": "local"  },
    "sales-agent":   { "provider": "cloud"  },
    "general":       { "provider": "cloud"  }
  }
}
```

**Local vs cloud — la decisión clave:**

| | Local (Ollama + Llama/Mistral) | Cloud (Claude/GPT) |
|---|---|---|
| Datos sensibles | quedan en la empresa | salen al exterior |
| Costo operativo | servidor propio | por token |
| Capacidad de razonamiento | menor | mayor |
| Velocidad setup | días | minutos |

**Estrategia híbrida recomendada:**

```
Dato sensible (RRHH, finanzas, legal)  → LLM local (nunca sale de la empresa)
Razonamiento complejo / redacción      → Claude cloud
RAG / vector DB                        → siempre local
```

### 3.3 `docs-agent` — plugin MCP de RAG

Plugin MCP independiente (mismo patrón que `docker-agent`, `design-agent`).
El engine no sabe nada de RAG — solo ve tools.

```
docs-agent/
  src/
    server.ts            ← MCP server (stdio)
    ingestion/
      loader.ts          ← PDF, DOCX, MD, HTML, Confluence export
      chunker.ts         ← chunking semántico (~512 tokens, overlap 64)
      embedder.ts        ← embeddings locales (nomic-embed / bge) u OpenAI
    store/
      PgVectorStore.ts   ← pgvector (default — empresa ya suele tener Postgres)
      ChromaStore.ts     ← alternativa standalone
    tools/
      docs_search.ts     ← búsqueda semántica top-k con filtros de metadata
      docs_ingest.ts     ← indexar documento/carpeta
      docs_list.ts       ← inventario de fuentes indexadas
      docs_reindex.ts    ← re-indexar fuente actualizada
```

**MCP tools expuestas:**

| Tool | Parámetros | Devuelve |
|---|---|---|
| `docs_search` | `query`, `topK?`, `source?`, `department?` | chunks relevantes + score + cita de origen |
| `docs_ingest` | `path`, `source`, `metadata?` | resumen de indexación |
| `docs_list` | — | fuentes, conteo de chunks, fecha de indexación |
| `docs_reindex` | `source` | resultado de re-indexación |

**Flujo en runtime:**

```
Usuario: "¿Cuál es la política de vacaciones?"
  → HR Agent llama docs_search("política vacaciones", department="rrhh")
  → docs-agent: embedding de la query → top-3 chunks de pgvector
  → LLM responde citando el documento interno exacto
```

**Reglas de la capa de conocimiento** (en qué nivel vive cada cosa):

```
Skills    → reglas fijas del negocio (sin LLM, sin latencia)
RAG       → conocimiento documentado (semántico, actualizable sin redeploy)
MCP tools → sistemas en vivo (CRM, ERP — dato real time)
LLM       → razonamiento y redacción sobre todo lo anterior
```

Los tres niveles se complementan: skills para lo que siempre es igual, RAG para
lo que está documentado, MCP para lo que cambia en tiempo real.

### 3.4 `@bk/agent-web-ui` — componentes de frontend

Librería React de componentes para construir la UI del chat. Opcional —
el servidor expone WS/SSE estándar y cualquier frontend puede consumirlo.

```
packages/web-ui/
  src/components/
    ChatWindow.tsx          ← historial + streaming de mensajes
    MessageBubble.tsx       ← markdown render, código con highlight
    ToolCallBadge.tsx       ← "🔍 buscando en documentación..." en vivo
    AgentSwitcher.tsx       ← selector visual de agente activo
    ThinkingIndicator.tsx   ← estado de razonamiento
    SourceCitation.tsx      ← cita del documento RAG usado en la respuesta
  src/hooks/
    useAgentSession.ts      ← conexión WS, reconexión, estado del stream
```

---

## 4. Agentes empresariales — perfiles predefinidos

Cada agente es un `AgentProfile` (patrón existente) + skills + tools MCP asignadas.

| Agente | Área | Tools MCP | Provider sugerido |
|---|---|---|---|
| **Support Agent** `☎` | Soporte | docs_search, ticket_create, ticket_status | cloud |
| **HR Agent** `👥` | RRHH | docs_search (rrhh), leave_request, payroll_query | **local** (dato sensible) |
| **Sales Agent** `💼` | Ventas | crm_query, docs_search (productos), proposal_gen | cloud |
| **Finance Agent** `📊` | Finanzas | erp_query, report_gen, approval_flow | **local** (dato sensible) |
| **Ops Agent** `⚙` | Operaciones | metrics_query, incident_lookup, runbook_search | cloud |
| **General** `◆` | Orquestador | delega a especialistas según la consulta | cloud |

**Orquestación** (mismo mecanismo que el flujo `/spec.run` actual):
el General recibe la consulta, identifica el dominio y delega al especialista.
Consultas multi-dominio → delegación en paralelo y consolidación.

**Personalización por empresa** — el valor no está en el engine, está en cuánto
contexto del negocio se le inyecta:

```
{empresa}/
  AGENT.md              ← contexto del negocio: productos, procesos, glosario
  .bk-agent/skills/     ← reglas propias (aprobaciones, tono, flujos)
  config.json           ← providers, agentes activos, MCP plugins
  docs/                 ← fuentes para ingestar en RAG
```

El framework es el runtime. La empresa construye encima con sus datos y sus
integraciones (crm-agent → Salesforce/HubSpot, erp-agent → SAP/Oracle,
hr-agent → RRHH/nómina, docs-agent → RAG sobre documentación interna).

---

## 5. Scaffold — `create-bk-agent`

Nuevo template `web` con sub-perfiles, siguiendo la estructura composable
base/ + deploy/ existente:

```
npx create-bk-agent mi-agente --template web --profile enterprise
```

```
? Select template:
    base          (CLI)
    coding        (CLI + coding agents)
  ❯ web           (HTTP + WebSocket, browser-ready)
    deploy        (CI/CD)

? Select web profile:
  ❯ enterprise    (Support + HR + Sales + Finance + General, RAG, híbrido)
    support       (Support Agent + RAG)
    analyst       (Data Analyst + SQL tools)
    custom        (vacío — el dev define agentes)

? LLM provider:
  ❯ hybrid        (local para sensible, cloud para razonamiento)
    anthropic     (todo cloud)
    ollama        (todo local)
```

**Lo que genera el profile `enterprise`:**

```
mi-agente/
  src/server.ts           ← AgentServer configurado y listo
  agents/                 ← perfiles de los 6 agentes
  skills/                 ← skills de ejemplo por área
  config.json             ← providers híbrido preconfigurado
  docker-compose.yml      ← postgres+pgvector, ollama, redis
  web/index.html          ← cliente mínimo de prueba (chat funcional)
  docs/.gitkeep           ← carpeta para fuentes RAG
  README.md               ← guía: ingestar docs, conectar CRM, agregar agentes
```

**Ventaja real:** el desarrollador no piensa en transporte — elige `web` en el
scaffold y el engine de agentes ya habla por WebSocket.

---

## 6. Seguridad y datos

| Aspecto | Diseño |
|---|---|
| Datos sensibles | provider `local` por agente — RRHH/finanzas nunca salen |
| Vector DB | siempre on-premise (pgvector en el Postgres de la empresa) |
| Auth | hook pluggable — JWT, API key, o SSO corporativo (OIDC) |
| Autorización por agente | claims del token → qué agentes puede usar el usuario |
| Filtrado RAG | metadata `department` en chunks — HR Agent no ve docs de finanzas |
| Audit log | toda tool call registrada con sessionId + userId + timestamp |
| Rate limiting | por sesión y por usuario en AgentServer |

---

## 7. Roadmap de implementación

### Fase 1 — Provider Abstraction *(core, prerequisito)*
- Extraer `AnthropicProvider` de la implementación actual
- Implementar `OpenAICompatProvider` (Ollama/vLLM)
- Config `providers` + override por agente
- **Criterio:** un agente CLI corre con Ollama local sin tocar nada más

### Fase 2 — `@bk/agent-web` mínimo
- `AgentServer` + `WebSocketTransport` + `SessionManager` (memoria)
- Cliente HTML de prueba con streaming
- **Criterio:** chat funcional en browser contra el engine existente

### Fase 3 — `docs-agent` (RAG)
- Ingestion pipeline (PDF/MD/DOCX) + pgvector
- Tools `docs_search`, `docs_ingest`, `docs_list`
- Embeddings locales por default
- **Criterio:** agente responde preguntas citando documentos ingestados

### Fase 4 — Perfiles empresariales
- 6 agent profiles + skills de ejemplo por área
- Orquestación General → especialistas en contexto web
- Filtrado RAG por departamento
- **Criterio:** consulta multi-dominio delega y consolida correctamente

### Fase 5 — Scaffold + UI
- Template `web` en create-bk-agent con los 4 profiles
- `@bk/agent-web-ui` componentes React
- docker-compose con todo el stack
- **Criterio:** `npx create-bk-agent x --template web` → chat empresarial corriendo en < 10 min

### Fase 6 — Producción
- SessionStore redis, auth hooks (JWT/OIDC), audit log, rate limiting
- Métricas (tokens por sesión, latencia por provider)
- **Criterio:** deploy multi-usuario estable

---

## 8. Lo que NO cambia

- `AgentEngine`, skills system, memoria, MCP client — se reutilizan intactos
- Los plugins MCP existentes (docker-agent, design-agent) funcionan igual en web
- El flujo CLI sigue siendo first-class — web es una capa adicional, no un reemplazo
- El patrón de orquestación multi-agente es el mismo que en `/spec.run`

---

*Documento generado a partir del análisis de diseño — junio 2026.*
