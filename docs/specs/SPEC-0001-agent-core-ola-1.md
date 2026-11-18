# SPEC-0001: Ola 1 de capacidades de agent-core

**Fecha:** 2026-10-21
**Estado:** Implementado y publicado (Ola 1, core 0.27.0, v0.27.0). *(Revisado el 2026-11-18; antes decía: En revisión (decisiones de la §10 aceptadas el 2026-10-21; pendiente de aprobación final))*
**Versión base:** `@backendkit-labs/agent-core` 0.24.1, `agent-coding` 0.20.1
**ADR:** [0001](../adr/0001-ejecucion-paralela-de-tool-calls.md) · [0002](../adr/0002-aborto-automatico-por-presupuesto.md) · [0003](../adr/0003-salida-estructurada.md) · [0004](../adr/0004-cache-de-prompt-y-razonamiento-anthropic.md) · [0005](../adr/0005-unificacion-de-providers.md)

## 1. Objetivos y no objetivos

### Objetivos
1. Ejecutar en paralelo las herramientas de solo lectura de un mismo turno.
2. Poder detener automáticamente una ejecución al superar un presupuesto de costo.
3. Obtener salida estructurada validada, sin depender de prompt + regex.
4. Usar caché de prompt y razonamiento extendido en Anthropic, con costo bien medido.
5. Eliminar la duplicación de providers para que las mejoras se hagan una sola vez.
6. Corregir el defecto previo del cableado de `createBaseEngine` (§2).

### No objetivos (quedan para olas posteriores)
Entrada multimodal, ejecución durable con reanudación, evals, guardrails genéricos, exportador OpenTelemetry, resumen de contexto, interoperabilidad A2A, cancelación de herramientas en ejecución (`ExecutionContext.signal`) y persistencia del gasto diario.

### Principios
- **Compatibles hacia atrás:** toda opción nueva es opcional y su valor por defecto conserva el comportamiento actual (excepto la corrección documentada en §4.4).
- **Cambio de versión menor** en los paquetes afectados.
- **Verificable:** cada capítulo define criterios de aceptación medibles y pruebas.

## 2. Prerrequisito P0: cableado de `createBaseEngine`

**Defecto:** `createBaseEngine` no declara ni reenvía `onToolApproval`, `onIterationLimit` ni `onStep`. `createCodingEngine` los pasa (`packages/coding/src/index.ts:532-534`), pero `BaseEngineOptions` no los contiene y el `new AgentEngine({...})` de `packages/core/src/engine/createBaseEngine.ts:261-302` no los incluye. Como se pasan con `spread` condicional, TypeScript no marca la propiedad sobrante, y se descartan en silencio. `ApprovalGate.check` devuelve `'run'` cuando no hay `onToolApproval` (`ApprovalGate.ts:38`), así que **la aprobación de herramientas de escritura no se activa** en los motores creados con `createCodingEngine`.

**Estado de la verificación:** confirmado leyendo el código. Falta una prueba que lo demuestre.

**Cambio:**
1. Prueba que falla primero: crear un motor con `createBaseEngine({ onToolApproval })`, hacer que el proveedor falso pida `write_file` y comprobar que el callback se invoca.
2. Añadir los tres campos a `BaseEngineOptions` y reenviarlos con `...(opts.x ? { x: opts.x } : {})`.
3. Revisar que `createCodingEngine` y `examples/coding-assistant` siguen compilando.

**Aceptación:** la prueba pasa; `ApprovalGate` se invoca desde `createCodingEngine` cuando se pasa `onToolApproval`.

**Riesgo:** al activarse la aprobación, quien dependía (sin saberlo) de que no hubiera prompts verá confirmaciones nuevas. Se anota en el CHANGELOG como corrección.

## 3. Ejecución paralela de tool calls (ADR-0001)

### 3.1 API
```ts
// core/src/types/index.ts
export interface ToolDefinition {
    name: string; description: string; parameters: JSONSchema;
    /** Seguro de ejecutar a la vez que otras herramientas seguras. Por defecto false. */
    concurrencySafe?: boolean;
    execute(args: unknown, ctx: ExecutionContext): Promise<string>;
}
// EngineOptions / BaseEngineOptions / CodingEngineOptions
maxParallelTools?: number; // 0.25: por defecto 1 (comportamiento actual); 0.26: 4 si se cumple §3.6

// MCPServerConfig (core/src/mcp/types.ts)
trustAnnotations?: boolean; // por defecto false: solo entonces se honra readOnlyHint
```
`defineTool({ ..., concurrencySafe: true })` lo propaga.

### 3.2 Comportamiento (en `AgentEngine.runLoop`, bloque actual de `AgentEngine.ts:742-748`)
1. Los `otherCalls` del turno se recorren en orden y se agrupan en olas: llamadas consecutivas con `concurrencySafe === true` forman una ola (tamaño ≤ `maxParallelTools`); cualquier otra llamada es una barrera que se ejecuta sola.
2. Antes de lanzar una ola se ejecuta `approvalGate.check` de cada llamada, **en serie y en orden**.
3. Las llamadas de una ola se ejecutan con `Promise.all` (o un semáforo con el patrón de `DelegationBus`). Cada llamada usa `executeToolCall(call, profile, 0, emit)` con un `emit` que acumula sus eventos.
4. Al terminar la ola, los eventos se vuelcan al transporte en el orden original y los resultados se añaden a `toolResults` en el orden original de las llamadas.
5. `iterManager.recordToolCall()` se invoca una vez por llamada, como hoy.
6. `this.aborted` se comprueba antes de cada ola; las llamadas en vuelo terminan y sus resultados se guardan (el historial no queda con `tool_calls` sin respuesta).
7. Con `maxParallelTools === 1` el recorrido es idéntico al actual.

### 3.3 Herramientas marcadas `concurrencySafe: true`
`read_file`, `list_directory`, `search_files`, `list_audits`, `get_latest_audit` (`packages/coding/src/tools`), `memory_recall`, `memory_search_knowledge` (`core/src/agent-memory/tools.ts`). Se deja en `false`: `write_file`, `edit_file`, `run_command`, `save_*`, `update_session`, `memory_remember`, `memory_save_knowledge`, `memory_learn_pattern`, `ask_agent` (tiene su propia ruta) y las herramientas MCP. Una herramienta MCP solo se marca `concurrencySafe` si su servidor tiene `trustAnnotations: true` y la herramienta declara `readOnlyHint: true`; para ello `MCPClientManager` (`core/src/mcp/MCPClientManager.ts`, `listTools`) debe leer `annotations`.

### 3.4 Casos borde
- Una herramienta lanza una excepción: `executeToolCall` ya devuelve el error como texto; no afecta al resto de la ola.
- Herramienta no encontrada o no autorizada para el agente: respuesta de error en su posición.
- Aborto durante una ola: se esperan las llamadas en vuelo; no se lanzan olas posteriores.
- Sub-agentes (`runAgentInternal`): fuera de alcance en esta ola; conservan su recorrido secuencial.

### 3.5 Pruebas (`packages/core/src/engine/__tests__/`)
Con `createScriptedProvider` y `buildRegistries` de `core/src/__tests__/helpers.ts`:
- Tres herramientas seguras de 200 ms con `maxParallelTools: 3` terminan en ≤ 450 ms; con `1`, en ≥ 600 ms.
- Orden de `tool_result` en el historial = orden de las llamadas, aunque terminen al revés.
- Una barrera (`write_file`) entre dos lecturas separa las olas.
- Una excepción en una herramienta no cancela a las demás.
- Aborto entre olas.
- `onToolApproval` se invoca en serie y en orden.

### 3.6 Aceptación
Pruebas anteriores en verde; con `maxParallelTools` sin configurar, el conjunto de pruebas existente de `AgentEngine` no cambia.

## 4. Aborto automático por presupuesto (ADR-0002)

### 4.1 API
```ts
// BaseEngineOptions y CodingEngineOptions
abortOnBudget?: boolean;          // por defecto false
observability?: ObservabilityConfig; // también en CodingEngineOptions

// AgentEvent (core/src/types/index.ts)
| { type: 'budget_exceeded'; usage: BudgetUsage }
```

### 4.2 Comportamiento
1. `CostTracker` dispara `onBudgetExceeded` como máximo **una vez por límite y por ejecución** (`perDay`, una vez por día). Los indicadores se reinician en `onRunStart()` y al cambiar de día. Si se superan ambos límites en el mismo evento, se reportan ambos.
2. Con `abortOnBudget`, `createBaseEngine` envuelve `onBudgetExceeded`: llama `engine.abort()`, emite `budget_exceeded` y luego invoca el callback del usuario. La referencia al engine se asigna después de crearlo.
3. Al inicio de cada iteración de `runLoop`, si el costo de la ejecución ya superó `budget.perRun`, no se llama al LLM.
4. `runAgentInternal` comprueba `this.aborted` en cada iteración y recibe `signal`, de modo que los sub-agentes también se detienen.
5. Si hay `budget` pero no hay precios (ni el modelo figura en `MODEL_PRICING`), el engine emite un evento `system` de nivel `warn` al crearse. También avisa si se configura `budget.perDay`, porque el gasto diario no se persiste y en procesos de vida corta empieza en cero.

### 4.3 Límites conocidos
El gasto puede exceder el límite en una llamada (las métricas llegan al final de la llamada). El gasto diario no sobrevive a un reinicio. Las herramientas en ejecución no se cancelan.

### 4.4 Cambio de comportamiento documentado
`onBudgetExceeded` pasa de dispararse en cada evento de métricas a una vez por límite y ejecución. Se anota en el CHANGELOG.

### 4.5 Pruebas
Extender `CostTracker.test.ts` y `ObservabilityManager.test.ts` y añadir pruebas de engine con un proveedor falso que invoque `onMetrics`:
- El callback se invoca una vez al superar `perRun`, aunque lleguen más métricas.
- `perRun` y `perDay` superados a la vez: se reportan ambos.
- Con `abortOnBudget: true` la ejecución se detiene antes de la siguiente iteración y se emite `budget_exceeded`.
- Un sub-agente en curso se detiene.
- Sin precios configurados: se emite la advertencia.
- El evento nuevo no rompe los `switch` de `packages/web` (revisar `WebSocketTransport`).

### 4.6 Aceptación
Una ejecución con `perRun: 0.01` y un proveedor falso que reporta tokens se detiene en la iteración siguiente al cruce y el callback se invocó exactamente una vez.

## 5. Salida estructurada (ADR-0003)

### 5.1 API
```ts
// core/src/types/index.ts
export interface ChatOptions {
    responseFormat?: { type: 'json_schema'; name: string; schema: JSONSchema; strict?: boolean };
    toolChoice?: 'auto' | 'none' | 'required' | { name: string };
}
export interface LLMProvider {
    chat(messages: LLMMessage[], tools: ToolDefinition[], callbacks: LLMStreamCallbacks, options?: ChatOptions): Promise<void>;
    capabilities?: { structuredOutput: 'native' | 'json_object' | 'none' };
}
// core: función independiente (la usan intent-detector, planner y curadores)
export function generateObject<T>(provider: LLMProvider, prompt: string, schema: ZodType<T>, opts?: { retries?: number; model?: string }): Promise<T>;
// AgentEngine: atajo que usa el provider del agente y contabiliza el costo
generateObject<T>(prompt: string, schema: ZodType<T>, opts?: { agentId?: string; retries?: number }): Promise<T>;
export class StructuredOutputError extends Error { raw: string; issues: unknown }
```

### 5.2 Comportamiento
1. `generateObject` (función y método) convierte el esquema zod con el helper de `defineTool` (se extrae a una función exportada), llama al provider con `responseFormat`, valida con zod y devuelve el objeto.
2. Si la validación falla, reintenta una vez añadiendo al diálogo el error de validación; si vuelve a fallar lanza `StructuredOutputError`.
3. Mapeo por provider: Anthropic con `output_config.format` y, como respaldo, herramienta única `respond` con `tool_choice` forzado; OpenAI-compatible con `response_format: json_schema`; DeepSeek con `json_object` y esquema en el prompt; Ollama según soporte del servidor.
4. Los providers que ignoran `options` siguen funcionando: la validación zod siempre se aplica.
5. Primer consumidor: `intent-detector` (`core/src/orchestration/intent-detector.ts:219-249`) sustituye la regex por `generateObject` con un enum de acciones. `LLMChatClient`/`adaptProviderToLLMClient` se amplían para propagar las opciones.

### 5.3 Pruebas
- Esquema válido con respuesta válida; respuesta inválida seguida de válida (un reintento); dos inválidas (`StructuredOutputError` con el texto crudo).
- Pruebas de provider con cliente SDK falso: la petición lleva `output_config` / `response_format` esperados, o el respaldo.
- `intent-detector` mantiene sus pruebas actuales y gana una con respuesta no JSON.

### 5.4 Aceptación
`generateObject` devuelve un objeto tipado válido en el 100 % de los casos de la batería con doble de provider, y lanza el error tipado en los de fallo; sin regex en `intent-detector`.

## 6. Caché de prompt y razonamiento extendido en Anthropic (ADR-0004)

### 6.1 API
```ts
// AnthropicProviderOptions
cache?: 'none' | 'system' | 'system+tools' | 'auto';  // por defecto 'none'
cacheTtl?: '5m' | '1h';                                // por defecto '5m'
thinking?: { budgetTokens: number };                   // mínimo 1024, < maxTokens
// LLMMessage
raw?: unknown;   // payload opaco del provider (bloques del asistente con thinking y firma)
// LLMStreamCallbacks
onMetrics?(input: number, output: number, usage?: { cacheReadTokens?: number; cacheWriteTokens?: number }): void;
onReasoning?(delta: string): void;
// CostTrackerConfig
cacheReadPricePerMToken?: number; cacheWritePricePerMToken?: number;
// AgentEvent 'metrics' + campos opcionales cache_read_tokens, cache_write_tokens
```

### 6.2 Comportamiento
1. `toAnthropicMessages` (`AnthropicProvider.ts:17-76`) deja de unir el system en una cadena cuando `cache !== 'none'`: lo envía como bloques de texto con `cache_control: { type: 'ephemeral', ttl }` en el último bloque; con `system+tools`, también en la última definición de herramienta; con `auto`, además un punto móvil en el último mensaje.
2. Con `thinking`, se envía `thinking: { type: 'enabled', budget_tokens }` y se **omite `temperature`**. Los deltas `thinking_delta` se entregan a `onReasoning` (no se emite evento al transporte en esta ola); los bloques `thinking`/`redacted_thinking` se acumulan, con su firma, en `LLMMessage.raw` del mensaje del asistente, y se reenvían intactos en el turno siguiente.
3. El uso se lee de `message_start`/`message_delta` (`cache_read_input_tokens`, `cache_creation_input_tokens`) y se pasa a `onMetrics`.
4. `CostTracker.onTokens(input, output, providedCostUsd?, usage?)` suma lectura y escritura con sus precios; `MODEL_PRICING` incorpora los precios de caché (lectura ≈ 0,1×, escritura ≈ 1,25× a 5 minutos y ≈ 2× a 1 hora) y se actualiza contra la tarifa vigente antes de publicar.
5. `HistoryManager` conserva `raw` al persistir y `sanitized()` no lo descarta.

### 6.3 Pruebas
Con cliente SDK falso:
- La petición contiene `cache_control` en los lugares esperados según el modo; sin opción, la petición es idéntica a la actual.
- Con thinking: `temperature` ausente, `budget_tokens` correcto, y el segundo turno reenvía el bloque `thinking` con su firma.
- Las métricas incluyen los tokens de caché y `CostTracker` calcula el costo con los precios de lectura y escritura (caso numérico).
- `budgetTokens` fuera de rango lanza un error de configuración claro.

### 6.4 Aceptación
En una conversación de prueba de varios turnos con herramientas, el segundo y siguientes turnos muestran `cacheReadTokens > 0` y el costo calculado es menor que el de la misma conversación sin caché; el bucle de herramientas con thinking completa sin error de firma.

## 7. Unificación de providers (ADR-0005)

### 7.1 Estructura
Paquete nuevo `packages/providers` (`@backendkit-labs/agent-providers`, versión inicial 0.1.0; nombre libre en npm el 2026-10-21) con `BaseStreamingProvider`, `OpenAICompatibleProvider`, `AnthropicProvider` y presets `OllamaProvider` y `DeepSeekProvider`. `agent-coding` los re-exporta bajo los mismos nombres; `orchestrator-agent` elimina `src/provider.ts` y los consume.

### 7.2 Semántica unificada
- Reintentos con `@backendkit-labs/retry`: `maxAttempts` explícito; reintenta 429, 5xx y errores de red; no reintenta si ya se emitió contenido.
- Siempre se solicita el uso (`stream_options.include_usage`), se propagan `max_tokens`, `model` y `signal`, y se expone `thinking`.
- La regla de temperatura de `orchestrator-agent` (modelos "reasoner") se convierte en una opción del preset.
- Cliente SDK inyectable por constructor.

### 7.3 Pruebas
Pruebas de caracterización primero (el comportamiento actual de las copias), luego la suite del paquete nuevo: reintentos, streaming, ensamblado de tool calls, métricas, abort, errores. Cobertura mínima propuesta: 80 % de líneas.

### 7.4 Aceptación
`coding` y `orchestrator-agent` compilan y pasan sus pruebas usando el paquete; ninguna copia de la rama OpenAI-compatible queda en `packages/` fuera de templates y test-projects.

## 8. Impacto por paquete y heredabilidad

| Cambio | Se implementa en | Lo heredan |
|---|---|---|
| P0, §3, §4 | `agent-core` (y reenvío en `agent-coding`) | Todo lo construido sobre `AgentEngine`/`createBaseEngine`: `coding`, `enterprise`, `web`, `orchestrator-agent`, `mcp-server`, templates de `create-bk-agent`, y en `bk-agents` config, finance, knowledge, notification, schedule, synthesizer |
| §5, §6 (contrato) | `agent-core` | Igual que arriba, al actualizar la versión |
| §5, §6 (mapeos), §7 | `agent-providers` | Quien use los providers: `coding`, `orchestrator-agent`, y los templates cuando se actualicen |
| Fuera | — | `codex-context-agent-v2` y `curator-codex-agent` (usan `CuratorLLMProvider`); aiops, checking, design, mock-erp sin motor visible; bk-coder-v2 por confirmar |

Regla para agentes nuevos: construirlos sobre `createBaseEngine`.

## 9. Plan de entrega

### 9.1 Orden
P0 → ADR-0001 → ADR-0002 → ADR-0005 → ADR-0003 → ADR-0004 (ADR-0004 puede avanzar en paralelo a ADR-0005, porque solo toca Anthropic).

### 9.2 Ramas y versiones
Una rama y un PR por elemento, desde `master`; el spec y los ADR se mergean primero (esta rama de documentación). Versiones: `agent-core` 0.25.0 (minor), `agent-coding` minor, `agent-providers` 0.1.0, `orchestrator-agent` minor. CHANGELOG con la corrección de P0 y el cambio de §4.4. La actualización de `packages/templates` y la regeneración de los `test-projects` van en un PR posterior, una vez publicado `agent-providers`.

### 9.3 Pruebas transversales
Antes de cada PR: typecheck, build y pruebas de los paquetes afectados, y el guardrail de cobertura por paquete de CI (umbrales ya fijados en `jest.config`).

## 10. Riesgos y preguntas abiertas

### Riesgos
- Marcar mal una herramienta como `concurrencySafe` produce carreras sobre estado compartido; mitigación: lista inicial corta y revisión por herramienta.
- Activar la aprobación (P0) cambia la experiencia de quien ya usa `createCodingEngine`.
- `LLMMessage.raw` acopla el historial a Anthropic y lo agranda.
- La unificación puede cambiar el número real de reintentos; mitigación: pruebas de caracterización.
- Los precios de `MODEL_PRICING` pueden estar desactualizados.

### Decisiones tomadas (revisión del 2026-10-21)
| # | Tema | Decisión |
|---|---|---|
| 1 | Default de `maxParallelTools` | `1` en la 0.25; pasa a `4` en la 0.26 como cambio explícito, solo si se cumple el criterio de §3.6 en nuestros agentes |
| 2 | Herramientas MCP con `readOnlyHint` | Se respeta solo con `trustAnnotations: true` en el servidor (por defecto apagado) |
| 3 | Paquete de providers | `packages/providers`, `@backendkit-labs/agent-providers` |
| 4 | Evento `reasoning` | Solo el callback `onReasoning` en esta ola; el evento al transporte se difiere hasta que `web-ui` tenga un componente colapsable |
| 5 | `generateObject` | Función independiente en `core` más atajo `engine.generateObject` que contabiliza el costo |
| 6 | Gasto diario persistente | Siguiente ola; mientras tanto, aviso al configurar `perDay` y limitación documentada |
| 7 | Templates y test-projects | PR posterior, tras publicar `agent-providers`; los test-projects se regeneran con el script |

### Preguntas abiertas
Ninguna por ahora.
