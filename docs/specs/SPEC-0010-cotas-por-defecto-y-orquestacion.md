# SPEC-0010: Cotas por defecto, orquestación y tipos de agente

**Fecha:** 2026-10-26
**Estado:** En curso (O1 en PR #112–#114; O2 casi completo en #116–#122; O3–O5 sin empezar)
**Depende de:** SPEC-0009 (confianza y límites aplicados), SPEC-0006 (sandbox), [ADR-0007](../adr/0007-un-limite-declarado-debe-aplicarse.md)
**Origen:** informe del auditor del 2026-10-26 (6 subagentes sobre el SDK ya extraído a bk-platform). Las citas `ruta:línea` son del auditor; **ninguna se ha reverificado salvo las marcadas "verificado"**. Cada fase empieza por reproducir el hallazgo con un test que falle; si no se reproduce, se descarta y se anota aquí.
**Objetivo:** que ningún bucle, historial, cola o delegación crezca sin techo por defecto, que la orquestación no pueda saltarse una aprobación ni dejar un run colgado, y que haya una sola forma de cargar y describir un agente.

## 1. Hallazgos ya resueltos o ya cubiertos

| Hallazgo | Estado |
|---|---|
| Bypass del allowlist de `run_command` (`env sh -c`, `xargs sh`, `timeout`, `find -exec`) | Verificado y corregido en #112. El allowlist sigue siendo un guard rail: `node -e`, `python -c`, `npm exec` ejecutan código; la contención es el sandbox (SPEC-0006). |
| Bypass de gates paralelas en orchestrator-agent | Verificado y corregido en #113 (una gate por paso; las demás se difieren). |
| Carrera de `onProgress` que deja el run en `running` | Corregido en #113 (escrituras encadenadas y drenadas). Sin test automatizado: vive en `server.ts`. |
| Sin límite de profundidad de delegación | Verificado y corregido en #114 (`maxDelegationDepth`, 5). Las delegaciones anidadas siguen sin pasar por el bulkhead. |
| `WorkflowRunner`: skipped no se propaga, ciclos devuelven `completed` | Verificado y corregido en #116. |
| `TaskPlanner.validate` sin ciclos, ids duplicados ni agente conocido; `agent_id` desconocido = éxito; `Promise.all` descarta hermanos | Corregido en #117 (más `subtaskTimeoutMs` opcional). |
| `QAService.evaluateReview` por subcadenas; transición muerta `commit_skipped` | Corregido en #118. |
| Sub-agentes sin `signal` en `abort()` | Corregido en #119. |
| FSM `approved→implementation` y rework sin tope | Corregido en #120: se quita la transición (nadie la usaba) y `maxRework` por defecto 5; agotado, `qa-orchestrator` rechaza. |
| `orchestrate().catch(() => undefined)` fail-open | Corregido en #121: `orchestratorFailureMode`, **fail-closed por defecto**. |
| `approveGate` duplicado MCP/HTTP, la HTTP sin audit trail | Corregido en #122 (`applyGateDecision`); sin test, `server.ts` no es importable. |
| `model:` del frontmatter pisa `provider` | **Ya recogido en SPEC-0009 (C4):** es un alias deliberado, no un error de copia. |
| `delegatesTo: ['*']` en `general` | **Ya recogido en SPEC-0009 (C2).** |
| Corregidos antes y confirmados por el auditor | Path traversal en `skill.name`, webhook con secret obligatorio, `AgentServer` en 127.0.0.1, retry de POST no idempotente, `blockedCommands` efectivo. |

## 2. Fases

### O2 — Orquestación restante (core, orchestrator-agent)
**Pendiente de esta fase tras #116–#122:** compactación y recuperación de desbordamiento en sub-agentes; bulkhead para delegaciones anidadas; límite de concurrencia en `WorkflowRunner.executeWave`; atomicidad de la aprobación entre procesos; extraer `applyGateDecision` de `server.ts` para poder testearla. El resto de viñetas de abajo ya está resuelto (ver §1).

- `WorkflowRunner`: los dependientes de un paso fallido o saltado pasan a `skipped` en el resultado (hoy A→B→C con A fallando deja a C fuera de `results`); un `WorkflowDef` con ciclo se rechaza al validar en lugar de devolver `completed` con pasos faltantes.
- `TaskPlanner.validate`: rechaza ids duplicados, ciclos en `depends_on` y `agent_id` fuera de `agents`; el ejecutor trata un `agent_id` desconocido como fallo, no como éxito (`executor.ts:220-222`).
- Sub-agentes: propagar `signal` a la llamada LLM de un sub-agente y aplicar compactación y recuperación de desbordamiento (`AgentEngine.ts:1179-1217`).
- `executor.ts:165-167`: `Promise.allSettled` para que una subtarea colgada o caída no descarte los resultados hermanos; plazo por subtarea.
- `orchestrate().catch(() => undefined)` (`AgentEngine.ts:514`): pasa de fail-open a fail-closed, o emite un evento `warn` explícito; decidir cuál.
- Aprobación de gates: la HTTP recupera el rastro de auditoría que tiene la MCP; extraer una sola función `approveGate`. Atomicidad entre procesos (Redis) como decisión aparte.
- FSM: eliminar la transición muerta `commit_skipped→commit_allowed`, decidir si `approved→implementation` es intencional y poner tope al ciclo de rework (hoy hasta 1000).
- `QAService.evaluateReview`: coincidencia por palabra completa y negación ("broken" contiene "ok"); mejor, resultado estructurado en lugar de buscar subcadenas.
- Bulkhead en las delegaciones anidadas y límite de concurrencia en `WorkflowRunner.executeWave`.

**Tests:** uno por hallazgo, escrito antes del arreglo.

### O3 — Cotas por defecto (core, enterprise, otel, web, mcp-server)
Principio (ADR-0007): un recurso que crece con el uso necesita un tope por defecto, y quien lo quita lo hace a propósito.
- **Historial:** `maxContextMessages`/`maxTokens` con valor por defecto en `createBaseEngine` (hoy "unlimited": cada iteración reenvía todo, O(n²) en tokens). Decisión: valor y qué pasa al alcanzarlo (compactar o recortar).
- **`JsonFileStore`:** dejar de reescribir el archivo entero por mutación (NDJSON con compactación periódica, o escritura diferida con vaciado en cierre). Sin pretty-print por defecto.
- **Memorias:** `EpisodicMemory.recall()` no escribe por episodio y no pierde `recallCount` por carrera lectura-modificación-escritura; la summarization borra lo resumido; tope de entradas por defecto en Semantic/Procedural.
- **`MetricsCollector`:** histograma o reservorio en lugar de `durations[]` sin tope; sin ordenar completo en cada snapshot.
- **`indexDirectory`** (mcp-server): concurrencia acotada en lugar de `Promise.all` sobre todos los archivos.
- **WebSocket y OTLP:** comprobar `bufferedAmount` y cortar o descartar con cliente lento; tope de batches pendientes en `otlpHttpExporter`.
- **`ObsidianRAGProvider.index`:** checkpoint por tiempo o por tamaño, no por lote de ~10 archivos.
- **orchestrator-agent:** `buildEpisodicFn` lee los runs una vez, no por subtarea; caché de `buildRAG` por run.
- **`TaskStore`:** `cancel()` fija `finishedAt`; evicción de pending/running antiguos.
- **Reasoning:** `contentEmitted` cubre también tokens de razonamiento, para no reintentar tras haber emitido y duplicar coste.
- **OTel:** exportar por lista de atributos permitidos, no por "todo lo no consumido".
- **web-ui:** agrupar tokens por frame y no re-parsear el markdown completo en cada token.
- `MCPClientManager`: cerrar el proceso stdio si `connect` falla.
- Menores (backlog): single-flight en refresh de gcal y RAG; `SessionManager.get()` sin escritura por mensaje; TTL de sesiones HTTP MCP; `KEYS` → `SCAN` en Redis; `VaultIndexer.collectMdFiles`.

**Tests:** cada cota con un test de carga pequeño (N grande, comprobar tope de memoria o número de escrituras), no solo de corrección.
**Salida:** un agente que corre 1000 iteraciones no crece sin techo ni reescribe disco en O(n²).

### O4 — Modelo de capacidades por defecto (core, coding)
- `allowedTools: []` sin delegación hoy permite cualquier herramienta (`AgentEngine.ts:1320-1322`): pasa a denegar por defecto (cambio incompatible; se anuncia y se ofrece una opción transitoria).
- Decidir si `AgentProfile` incorpora `budget`/`rate`/`roots`/`temperature` o si se queda como está y las capacidades se componen desde sandbox, presupuesto y perfil (SPEC-0009 ya cubre parte).
- Perfil `EXEC_TOOLS` (sin `write_file`) con prompt que dice "implement directly": alinear datos y prompt.

### O5 — Una sola forma de definir un agente (core, coding, create-bk-agent)
- `AgentLoader` (JSON+MD, proyecto sobre global) y `discoverAgents` (YAML, global sobre proyecto) tienen precedencia opuesta y distinto control de confianza. Unificar en uno; la confianza de SPEC-0009 aplica a ambos.
- `add mcp-client` / `add plugin` (`create-bk-agent/add/patcher.ts:104-181`) inyectan `mcpServers` en `new AgentEngine({...})`, que no lo acepta: generar código que compile y verificarlo con un test que compile el resultado.
- Templates: reutilizar `@backendkit-labs/agent-providers` en lugar de tres copias de `openai-compatible.ts`; borrar los ~25 archivos top-level no referenciados (`domain-agent`, `mcp-server` y otros) o conectarlos al scaffolder; una sola tabla de metadatos de proveedor (hoy `PROVIDER_ENV`, `ORCHESTRATOR_PROVIDERS`, `KNOWN_BASE_URLS` con claves env inconsistentes).
- No se introduce un tipo formal de agente: SPEC-0009 ya decidió dejarlo así.

## 3. Orden y publicación
O1 (hecho, en revisión) → O2 → O3 → O5 → O4. O4 va último porque rompe compatibilidad. Cada fase es un PR por tema; los cambios de API de `core` son aditivos salvo O4 y siguen el procedimiento de bump y publicación habitual.

## 4. Decisiones abiertas
1. Valor por defecto del historial y qué hacer al alcanzarlo (compactar o recortar).
2. ~~`orchestrate()` ante error~~ — **resuelta:** fail-closed por defecto, `open` opcional (#121).
3. Formato de `JsonFileStore`: NDJSON con compactación o escritura diferida.
4. Si O4 se publica con opción transitoria o directamente como cambio incompatible.
5. Atomicidad de la aprobación de gates entre procesos: Redis con `SET NX` o aceptar un solo proceso.
