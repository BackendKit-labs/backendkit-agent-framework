# SPEC-0002: Ola 3a — mejoras rápidas en agent-core

**Fecha:** 2026-10-22
**Estado:** Implementado y publicado (Ola 3a: plazo y cancelación por tool, desbordamiento de contexto, credenciales por referencia y jobs; PR #63 a #66, v0.29.0). *(Revisado el 2026-11-18; antes decía: Borrador)*
**Versión base:** `@backendkit-labs/agent-core` 0.28.0, `agent-coding` 0.24.0
**Contexto:** análisis de deepseek-harness (`docs/notes/analisis-dsh-vs-framework-actual.md`). Cuatro huecos que se cierran dentro de `agent-core` sin crear librerías nuevas y que son prerrequisito de Hermes (SPEC-0003).

## 1. Objetivos y no objetivos

### Objetivos
1. Que una herramienta en curso pueda cancelarse y tenga un plazo máximo (`ctx.signal`, `timeoutMs`).
2. Que un error de desbordamiento de contexto del proveedor no mate la ejecución: compactar y reintentar.
3. Que las credenciales de un agente se resuelvan por referencia (variable de entorno o resolvedor externo), no como valores en claro en el perfil.
4. Trabajos en segundo plano con id, dueño, lectura de salida, cancelación y aviso de finalización.

### No objetivos
Log de sesión orientado a eventos (SPEC-0004), sandbox (SPEC-0006), proveedores de subagentes (SPEC-0005), recordatorios durables y goals (SPEC-0007).

### Principios
Todo opcional y compatible hacia atrás; sin configurar nada el comportamiento actual no cambia (salvo lo anotado en §2.5). Cambio de versión menor (agent-core 0.29.0, agent-coding 0.25.0).

## 2. Cancelación y plazo por herramienta

### 2.1 Problema verificado
`ExecutionContext` no tiene `signal`. `engine.abort()` marca `aborted` y aborta el stream del modelo, pero una herramienta en curso sigue ejecutándose hasta terminar (ADR-0001 §consecuencias y SPEC-0001 §1 lo dejaron como no objetivo). `run_command` es la única con `timeout_ms`.

### 2.2 API
```ts
// core/src/types/index.ts
export interface ExecutionContext {
    /** Se aborta si el engine se aborta, si vence el plazo de la llamada o si se supera el presupuesto. */
    signal?: AbortSignal;
    // ...resto igual
}
export interface ToolDefinition {
    /** Plazo de esta herramienta en ms. Tiene prioridad sobre `toolTimeoutMs` del engine. */
    timeoutMs?: number;
    // ...
}
// EngineOptions / BaseEngineOptions / CodingEngineOptions
toolTimeoutMs?: number;       // por defecto sin plazo (comportamiento actual)
toolTimeoutGraceMs?: number;  // espera tras abortar antes de devolver TOOL_TIMEOUT; por defecto 2000

// defineTool({ ..., timeoutMs }) lo propaga.
// AgentEvent: tool_result gana  outcome?: 'timeout' | 'aborted'
```

### 2.3 Comportamiento (en `AgentEngine.executeToolCall` / `runToolDef`)
1. Cada llamada crea su `AbortController`, registrado en un conjunto del engine; `ctx.signal` apunta a él.
2. `engine.abort()` aborta además todos los controladores activos (y los de sub-agentes, que pasan por el mismo `executeToolCall`).
3. Si hay plazo (herramienta o engine), un temporizador aborta el controlador con razón `timeout`. El engine espera a que la herramienta termine hasta `toolTimeoutGraceMs`; si no termina, devuelve al modelo `Error: TOOL_TIMEOUT: tool "x" exceeded Nms` con `success: false` y `outcome: 'timeout'`, y **ignora** cualquier resultado tardío (no se añade al historial ni se emite).
4. Si la llamada se aborta por `engine.abort()`, el resultado es `Error: aborted` con `outcome: 'aborted'` para que no quede un `tool_call` sin respuesta.
5. Cada llamada limpia su temporizador y su controlador al terminar (sin fugas).
6. El `ApprovalGate` no cuenta contra el plazo: el temporizador arranca cuando empieza la ejecución, no durante la espera de aprobación.
7. Sin plazo configurado, el único cambio es que `ctx.signal` existe.

### 2.4 Herramientas existentes que deben respetar la señal
- `run_command` (coding): al abortar, mata el proceso (y el contenedor docker con `docker kill <name>`). Su `timeout_ms` se mantiene y se combina con el plazo del engine (gana el menor).
- Herramientas MCP (`MCPClientManager`): pasar `signal` en las opciones de `callTool`.
- `ask_agent` / sub-agentes: reciben la señal del padre.
- `memory_*`, `read_file`, `list_directory`, `search_files`, `write_file`, `edit_file`: operaciones cortas; solo comprueban `signal.aborted` antes de empezar.

### 2.5 Cambio de comportamiento documentado
Tras `engine.abort()` las herramientas en curso reciben la señal; las que ya la respeten terminarán antes. Se anota en el CHANGELOG.

### 2.6 Pruebas
- Herramienta que espera su `signal`: con `engine.abort()` termina en < 100 ms y el historial queda con su respuesta `aborted`.
- Plazo: herramienta de 500 ms con `timeoutMs: 50` devuelve `TOOL_TIMEOUT` y el resultado tardío se ignora (esperar y comprobar que no entra al historial).
- Prioridad `ToolDefinition.timeoutMs` sobre `toolTimeoutMs`; sin ninguno no hay temporizador (`jest.getTimerCount() === 0`).
- Ola paralela: una herramienta vence y las demás completan.
- `run_command` mata el proceso al abortar (comando `sleep` y comprobación de que ya no existe).
- Sin fugas: tras 200 llamadas el conjunto de controladores está vacío.

## 3. Reintento tras desbordamiento de contexto

### 3.1 Problema verificado
`ContextManager` actúa solo **antes** de la llamada, con una estimación. Si el proveedor responde con un error de contexto (estimación baja, `maxTokens` mal elegido, system prompt grande), `runLoop` emite `error` y termina.

### 3.2 API
```ts
// ContextOptions
overflowRetry?: boolean;      // por defecto true cuando `context` está configurado
// agent-core exporta
export function isContextOverflowError(err: unknown): boolean;
// ContextManager
compact(opts?: { force?: boolean; targetRatio?: number }): Promise<CompactionReport | null>;
noteOverflow(): void;         // reduce el presupuesto efectivo
```

### 3.3 Detección (`isContextOverflowError`)
Verdadero si el error trae `status` 400 o 413 (o `code` `context_length_exceeded`) **y** el mensaje coincide con alguno de: `maximum context length`, `context length`, `context_length_exceeded`, `prompt is too long`, `too many tokens`, `exceeds the (model|context) (limit|window)`, `reduce the length`, `input is too long`. Cubre OpenAI-compatibles (DeepSeek: "This model's maximum context length is N tokens"), Anthropic ("prompt is too long: N tokens > M maximum") y Ollama.

### 3.4 Comportamiento (en `runLoop`)
1. `onError` clasificado como desbordamiento **no** emite `error` de inmediato: se guarda.
2. Al volver de `chat()` sin mensaje final y con desbordamiento guardado, y con `overflowRetry` activo y menos de 2 reintentos en esta ejecución: `contextManager.noteOverflow()` y `compact({ force: true, targetRatio: 0.5 })`.
3. Si la compactación redujo los tokens estimados, se emite `system` info y se repite la iteración. Si no pudo reducir (los turnos recientes ya exceden el límite) o se agotaron los reintentos, se emite el `error` original.
4. `noteOverflow()` multiplica el presupuesto efectivo por 0.7 (mínimo 0.3 del `maxTokens`) para el resto de la vida del engine, de modo que las siguientes iteraciones compactan antes. Se informa en el evento `system`.
5. Sin `context` configurado nada cambia.

### 3.5 Pruebas
Proveedor falso que falla con el error de DeepSeek en la primera llamada y responde en la segunda: la ejecución termina bien y el historial enviado la segunda vez es menor. Dos desbordamientos seguidos con historial irreducible emiten el error. `isContextOverflowError` con los mensajes reales de cada proveedor y falsos negativos (400 de otro tipo, 429, 500). El presupuesto efectivo baja y no por debajo de 0.3.

## 4. Credenciales por referencia

### 4.1 API
```ts
export type SecretRef = { env: string };                 // valor de process.env[env]
export interface AgentProfile {
    /** Valores en claro (como hasta ahora) o referencias resueltas en cada llamada. */
    secrets?: Record<string, string | SecretRef>;
}
// EngineOptions / BaseEngineOptions
secretResolver?: (name: string, agentId: string) => string | undefined | Promise<string | undefined>;
```
### 4.2 Comportamiento
1. Antes de construir el `ExecutionContext` de una llamada, el engine resuelve `profile.secrets`: cadena → tal cual; `{ env }` → `process.env[env]`; si falta, se consulta `secretResolver(name, agentId)`; si sigue sin valor, la clave se omite (la herramienta decide el error).
2. La resolución ocurre **en cada llamada**: rotar la variable de entorno o el valor del vault aplica sin reiniciar.
3. `ctx.secrets` contiene solo cadenas resueltas. Los guardrails (`secretLeakGuardrail`) usan los valores resueltos de todos los agentes (hoy usan los literales del perfil).
4. Los perfiles en disco (JSON/YAML) admiten `{ "env": "NOMBRE" }`; `AgentDiscovery` los carga sin cambios.
5. Nunca se registran valores resueltos en eventos, auditoría ni trazas.

### 4.3 Pruebas
Resolución por `env`, por `secretResolver` asíncrono y mixta; rotación entre dos llamadas; clave ausente omitida; `secretLeakGuardrail` bloquea el valor resuelto; `aval-tools` sigue funcionando con `secrets: { AVAL_KEY: { env: 'X' } }`.

## 5. Trabajos en segundo plano (jobs)

### 5.1 API
```ts
export interface JobInfo { id: string; kind: string; owner: string; status: 'running' | 'done' | 'failed' | 'cancelled'; startedAt: number; endedAt?: number; summary?: string }
export interface JobRegistry {
    start(spec: { kind: string; owner: string; run(signal: AbortSignal, append: (chunk: string) => void): Promise<string | void> }): JobInfo;
    get(id: string, owner: string): JobInfo | undefined;
    output(id: string, owner: string, opts?: { sinceOffset?: number; waitMs?: number }): Promise<{ text: string; nextOffset: number; done: boolean }>;
    cancel(id: string, owner: string): Promise<boolean>;
    list(owner: string): JobInfo[];
    drainFinished(owner: string): JobInfo[];       // trabajos terminados aún no avisados
}
// EngineOptions / BaseEngineOptions / CodingEngineOptions
jobs?: boolean | { maxPerOwner?: number; retainOutputBytes?: number; retainFinishedMs?: number };
// ExecutionContext
jobs?: JobRegistry;
```
Con `jobs` activo se registran las herramientas `job_output`, `job_list` y `job_kill` (hay que añadirlas a `allowedTools` de los agentes que las usen, igual que las de memoria).

### 5.2 Comportamiento
1. Id estable `<kind>-<N>` (p. ej. `bash-1`). **El dueño es el agente**: otro agente no puede leer ni cancelar (devuelve "not found").
2. Salida acotada: anillo de `retainOutputBytes` (por defecto 64 KB) con offset absoluto; `output` puede esperar hasta `waitMs`.
3. Límite `maxPerOwner` (por defecto 8 vivos); al excederlo `start` lanza `JOB_LIMIT_REACHED`.
4. Terminados se conservan `retainFinishedMs` (por defecto 10 min) y luego se purgan.
5. **Aviso de finalización:** al inicio de cada iteración de `runLoop`, `drainFinished(agentId)` y, si hay, se añade un mensaje de usuario `[Background job bash-1 finished (done). Use job_output to read it.]`; no se avisa dos veces.
6. `engine.abort()` y el cierre del engine cancelan los trabajos vivos (señal + espera acotada).
7. `run_command` (coding) gana `background?: boolean`: con `ctx.jobs` presente arranca un job `bash`, devuelve el id y no bloquea; sin `ctx.jobs`, ignora el parámetro y se comporta como hoy.
8. Los eventos `tool_result` de `job_*` siguen el flujo normal; los trabajos se cuentan en `MetricsSnapshot.tools`.

### 5.3 Pruebas
Ciclo start → output → done; aislamiento por dueño; límite por dueño; anillo (offset tras desbordar); aviso único; cancelación; purga por TTL (reloj falso); aborto del engine; `run_command` en segundo plano con un comando `node -e` que imprime y termina; sin `jobs` activo no se registran herramientas.

## 6. Impacto por paquete

| Paquete | Cambio |
|---|---|
| `agent-core` | §2–§5 completos; 0.29.0 |
| `agent-coding` | `run_command` (señal, kill, `background`), opciones `toolTimeoutMs`, `jobs`, `secretResolver`; 0.25.0 |
| `agent-enterprise` | pass-through de las opciones nuevas; 0.6.0 |
| `agent-providers` | sin cambios (los errores ya llegan a `onError` con `status` y mensaje) |
| `aval-tools` | documentar `{ env }`; sin cambio de código |
| `agent-otel` | el span `tool_call` toma `outcome` como atributo `bk.outcome`; peer sube a `<0.30.0` |
| `mcp-server`, `agent-web`, `create-bk-agent` | solo rangos en el bump |

## 7. Plan de entrega
1. PR 1 — §2 (señal y plazo) con `run_command` y MCP.
2. PR 2 — §3 (reintento tras desbordamiento).
3. PR 3 — §4 (credenciales por referencia).
4. PR 4 — §5 (jobs) con `run_command` en segundo plano.
5. PR 5 — bump 0.29.0 y barrido de rangos.
Cada PR con su nota en el vault (`docs/notes/sdk/`) y verificación en vivo con DeepSeek donde aplique (§3 y §5).

## 8. Riesgos y preguntas abiertas
- **Resultados tardíos ignorados:** una herramienta con efecto (escritura) que vence puede haber completado igualmente; el modelo recibe `TOOL_TIMEOUT` y podría reintentar. Mitigación: documentar que las herramientas con efecto deben ser idempotentes y que el plazo por defecto es "ninguno".
- **Estimación en el reintento:** si el desbordamiento viene del system prompt o de los esquemas de tools (no del historial), la compactación no ayuda; se emite el error original.
- **Decisión propuesta (D1):** plazo global por defecto = ninguno (compatibilidad). Alternativa: 120 s en `createCodingEngine`. Se propone dejarlo para el bump.
- **Decisión propuesta (D2):** el aviso de finalización de jobs solo ocurre al empezar una iteración; un agente inactivo no es despertado (eso es del SPEC-0007).
