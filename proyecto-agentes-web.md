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

**Punto de partida — qué ya es reutilizable en web** *(actualizado 2026-06)*:
- Engine de agentes (LLM calls, tool use, agent switching)
- Skills system, MCP plugins, orquestación multi-agente
- Perfiles de agente, memoria, contexto de proyecto
- **Provider abstraction** — `LLMProvider` + `ProviderRegistry` con override por agente,
  incluyendo `OllamaProvider` para LLMs locales (ya en master)
- **RAG local** — `@backendkit-labs/agent-enterprise`: `ObsidianRAGProvider` con
  embeddings Ollama, VectorStore JSON e indexado incremental (ya en master, con suite de tests)
- **Robustez de concurrencia** — `run()` serializado por mutex, output de agentes
  paralelos buffereado por agente, delegación anidada sin starvation (fixes de junio 2026)

**Qué falta para web:**
- Un `WebTransport` (WebSocket o SSE) en lugar de `TerminalTransport`
- Un servidor HTTP que envuelva el engine y exponga streaming
- Manejo de sesiones concurrentes multiusuario — el engine serializa `run()` internamente,
  pero el diseño sigue siendo 1 instancia de engine por sesión
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
│           @backendkit-labs/agent-web (NUEVO)                 │
│   AgentServer (Fastify) · WebSocketTransport · Sessions      │
└──────────────────────────┬──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│         @backendkit-labs/agent-core (existente)              │
│   AgentEngine · Skills · Memory · Orchestrator · MCP Client  │
│   ProviderRegistry (existente) → anthropic | openai | ollama │
└───────┬──────────────────┬──────────────────┬───────────────┘
        │                  │                  │
┌───────▼───────┐  ┌───────▼───────┐  ┌───────▼───────┐
│ agent-        │  │   crm-agent   │  │   erp-agent   │
│ enterprise    │  │  (Salesforce) │  │     (SAP)     │
│ (RAG — exist.)│  │    (nuevo)    │  │    (nuevo)    │
└───────┬───────┘  └───────────────┘  └───────────────┘
        │
┌───────▼───────────────────────────────────────┐
│  VectorStore JSON local (existente)            │
│  → pgvector como upgrade a escala web (nuevo)  │
└────────────────────────────────────────────────┘
```

**Posición en la cadena de paquetes:**

```
@backendkit-labs/agent-core        (engine, skills, MCP, ProviderRegistry)
       ↓
@backendkit-labs/agent-coding      (agentes especializados + OllamaProvider)
       ↓
@backendkit-labs/agent-enterprise  ← existente: RAG local (Obsidian + VectorStore JSON)
       ↓
@backendkit-labs/agent-web         ← nuevo: transport HTTP/WS + servidor
       ↓
create-bk-agent                    ← template "enterprise" existente; "web" nuevo
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

### 3.2 Provider Abstraction — LLMs locales y cloud ✅ YA IMPLEMENTADO

> **Estado real (junio 2026):** esta capa ya existe en master. No hay trabajo pendiente
> aquí para la fase web — solo consumirla.

La abstracción real del framework:

```typescript
// packages/core — existente
interface LLMProvider {
    chat(
        messages: LLMMessage[],
        tools: ToolDefinition[],
        callbacks: LLMStreamCallbacks,   // onChunk, onToolCall, onDone, onError, onMetrics
    ): Promise<void>;
}
```

Implementaciones existentes: `AnthropicProvider`, `OpenAICompatibleProvider`
(OpenAI, DeepSeek, vLLM, LM Studio) y **`OllamaProvider`** (`packages/coding`) — este
último con `checkConnection()`, retry en ECONNREFUSED y mensajes de error con
instrucciones (`ollama serve`, `ollama pull`).

La estrategia híbrida por agente ya funciona: `AgentProfile.provider` se resuelve vía
`ProviderRegistry.resolve(profile.provider, defaultProvider)` — cada agente puede usar
un provider distinto:

```typescript
// existente — así se configura hoy
const engine = createCodingEngine({
    providers: {
        anthropic: { apiKey: process.env.ANTHROPIC_API_KEY },
        ollama:    { host: 'http://localhost:11434', model: 'llama3.3:70b' },
    },
    defaultProvider: 'anthropic',
});

// AgentProfile por agente:
{ id: 'hr-agent',    provider: 'ollama'    }   // dato sensible → local
{ id: 'sales-agent', provider: 'anthropic' }   // razonamiento → cloud
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

### 3.3 RAG — base existente y evolución a escala web

> **Estado real (junio 2026):** el caso base ya está cubierto por
> `@backendkit-labs/agent-enterprise` en master:
> - `ObsidianRAGProvider` — expone la tool `search_knowledge` al engine
> - `OllamaEmbedder` — embeddings locales (`nomic-embed-text`, 768 dims)
> - `VectorStore` — JSON en disco, cosine similarity, indexado incremental por mtime
> - `VaultIndexer` — chunking semántico por headings `##`, frontmatter YAML, filtros por tag
> - Suite de 30 tests (unit + integración con skip automático sin Ollama)
>
> Para vaults Markdown/Obsidian de hasta unos pocos miles de notas, **no hay nada que
> construir** — esto cubre el piloto y los primeros despliegues.

**`docs-agent` (plugin MCP) es la evolución a escala web**, no el punto de partida.
Se justifica cuando aparece alguna de estas condiciones:
- Fuentes no-Markdown (PDF, DOCX, Confluence, HTML)
- Volumen que supera la búsqueda lineal del store JSON (>~5k documentos)
- Multi-tenant / filtrado por departamento con permisos
- Múltiples procesos consumiendo el mismo índice (el JSON local es single-process)

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

> **Estado real (junio 2026):** la arquitectura **`enterprise` (CLI) ya existe** en el
> scaffold: pregunta el vault path, genera engine con `OllamaProvider` +
> `ObsidianRAGProvider`, orchestrator + domain-specialist, y `.env` preconfigurado.
> También existe `add knowledge <path>` / `add knowledge --vault <path>` para ampliar
> la base de conocimiento de un proyecto generado.
> Lo nuevo de esta fase es únicamente el template **`web`**.

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

### Fase 1 — Provider Abstraction ✅ COMPLETADA *(junio 2026)*
- ~~Extraer `AnthropicProvider` de la implementación actual~~ → `ProviderRegistry` existente
- ~~Implementar `OpenAICompatProvider` (Ollama/vLLM)~~ → `OpenAICompatibleProvider` + `OllamaProvider` en master
- ~~Config `providers` + override por agente~~ → `AgentProfile.provider` + `createCodingEngine({ providers })`
- **Criterio cumplido:** la arquitectura `enterprise` del CLI genera agentes que corren
  100 % con Ollama local

### Fase 1b — RAG local ✅ COMPLETADA *(junio 2026 — no estaba en el plan original)*
- `@backendkit-labs/agent-enterprise`: ObsidianRAGProvider + OllamaEmbedder +
  VectorStore JSON + VaultIndexer, con 30 tests
- Template CLI `enterprise` + comando `add knowledge`
- **Criterio cumplido:** agente CLI responde citando el vault, indexado incremental

### Fase 2 — `@backendkit-labs/agent-web` mínimo ← **SIGUIENTE PASO REAL**
- `AgentServer` + `WebSocketTransport` + `SessionManager` (memoria)
- Cliente HTML de prueba con streaming
- **Criterio:** chat funcional en browser contra el engine existente
- *Nota: los fixes de junio 2026 (mutex en `run()`, output paralelo buffereado) eliminan
  los principales riesgos de concurrencia para esta fase*

### Fase 3 — `docs-agent` (RAG a escala web) — *solo si el piloto lo demanda*
- Ingestion pipeline para fuentes no-Markdown (PDF/DOCX/Confluence) + pgvector
- Tools `docs_search`, `docs_ingest`, `docs_list`
- Embeddings locales por default (reutiliza `OllamaEmbedder`)
- **Criterio:** agente responde citando documentos no-Markdown a escala multi-tenant
- *Para vaults Markdown, `agent-enterprise` ya lo cubre — ver §3.3*

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
- `@backendkit-labs/agent-enterprise` (RAG) se consume tal cual desde web — la tool
  `search_knowledge` no distingue transporte

---

## 9. Relación con `mejorar-de-diseno.md`

Este roadmap **compite por las mismas horas** con el plan de consolidación
(`mejorar-de-diseno.md`: tests del core, descomponer el god object, idioma, scope).
Orden recomendado:

1. Fases 1–2 del plan de mejora (tests + descomposición) **antes** de la Fase 2 web —
   el `SessionManager` multiplica instancias del engine, y conviene que el engine esté
   testeado y modular antes de multiplicarlo.
2. El piloto CLI con vault real valida la historia enterprise sin esperar a la capa web.
3. La Fase 2 web arranca cuando el piloto confirme qué features se usan de verdad.

---

*Documento generado a partir del análisis de diseño — junio 2026.*
*Actualizado 2026-06-10 para reflejar el estado real de master: Provider Abstraction y
RAG local ya completados (commits hasta `b6b2c18`); el siguiente paso real es la capa web.*
