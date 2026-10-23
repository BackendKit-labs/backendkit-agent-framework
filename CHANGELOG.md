# Changelog

## v0.33.0 (2026-10-23)

Migración a **zod 4** y a **openai 6**, y cierre de SPEC-0008 P4–P6 (control desde Hermes, aprovisionamiento, flows de otros agentes, plugins y presets). La migración cierra GHSA-mrhx-c7xc-m3w5 (`zod <4.6.6`), cuyo único parche es zod 4.6.6 (#90).

**Breaking:** los esquemas que se pasan a `defineTool` / `generateObject` deben ser de zod 4. `agent-core` ya no depende de `zod-to-json-schema` (devolvía `{}` con esquemas zod 4) y genera el JSON Schema con `z.toJSONSchema`. `agent-providers` pasa a `openai ^6`. Los proyectos que usen zod 3 junto a `agent-core` deben migrar: `z.record(x)` pasa a `z.record(z.string(), x)`, `invalid_type_error` pasa a `error` y los mensajes de error cambian (p. ej. "Invalid input: expected number").

| Paquete | Versión |
|---|---|
| `agent-core` | 0.33.0 |
| `agent-protocol` | 0.3.0 |
| `agent-providers` | 0.3.0 |
| `hermes` | 0.2.0 |
| `agent-enterprise` | 0.8.0 |
| `orchestrator-agent` | 0.5.0 |
| `curator-codex-agent` | 1.1.0 |
| `mcp-connectors` | 0.2.0 |
| `mcp-server` | 0.17.0 |
| `create-bk-agent` | 0.23.0 |
| `agent-coding` | 0.27.2 |
| `agent-sandbox` | 0.1.3 |
| `agent-otel` | 0.1.5 |
| `agent-testkit` | 0.1.4 |
| `agent-web` | 0.4.15 |
| `aval-tools` | 0.1.10 |

**Orden de publicación (obligatorio):** core → **sandbox** → **agent-protocol** → **hermes** → providers → coding → enterprise → otel → orchestrator-agent → (curator-codex-agent, mcp-connectors, testkit, web, mcp-server, aval-tools) → create-bk-agent.
`hermes` tiene como peers `agent-core >=0.33.0 <0.35.0` y `agent-protocol ^0.3.0`: publicarlo antes de sus peers rompe las instalaciones.

### Detalle
- **Hermes (SPEC-0008 P4–P6):** control desde Hermes (política, jobs y auditoría unificada), aprovisionamiento y carencias, flows de otros agentes (`agent-protocol`), plugins con `requires` y `grant` del operador, y presets (más el preset neutral `pipeline`).
- **zod 4:** `z.record` con clave explícita; `mcp-server` declara `zod` (antes lo usaba sin declararlo); las plantillas y `create-bk-agent` generan proyectos con `zod ^4.6.6`.
- **Seguridad:** `body-parser` 1.20.9 / 2.4.0 en el lockfile (GHSA-27r3-jxmh-p828, #91).
- **Sin verificar en vivo:** el generador de JSON Schema (`openapi-3.0`) y `openai` 6 contra un LLM real.

## v0.32.0 (2026-10-23)

Control de agentes desde fuera y primer Hermes (SPEC-0008 P1–P3; PRs #79, #81, #82, #83). Todo es aditivo y opt-in: sin `controlApiKey` el servidor se comporta como 1.0. Rangos 0.x barridos (`agent-core ^0.32.0`; peers `<0.33.0`) y templates de `create-bk-agent` actualizados.

| Paquete | Versión |
|---|---|
| `agent-core` | 0.32.0 |
| `agent-sandbox` | 0.1.2 |
| `agent-protocol` | 0.2.2 |
| `hermes` (nuevo) | 0.1.0 |
| `agent-coding` | 0.27.1 |
| `agent-enterprise` | 0.7.2 |
| `agent-providers` | 0.2.6 |
| `agent-otel` | 0.1.4 |
| `agent-testkit` | 0.1.3 |
| `agent-web` | 0.4.14 |
| `mcp-server` | 0.16.9 |
| `orchestrator-agent` | 0.4.6 |
| `aval-tools` | 0.1.9 |
| `create-bk-agent` | 0.22.11 |

`mcp-connectors` y `curator-codex-agent` no cambian.

**Orden de publicación (obligatorio):** core → **sandbox** → **agent-protocol** → **hermes** → providers → coding → enterprise → otel → orchestrator-agent → (opcionales: testkit, web, mcp-server, aval-tools) → create-bk-agent.
`agent-sandbox` 0.1.2 tiene como peer `agent-core >=0.32.0 <0.33.0` (usa tipos nuevos: `PolicyControl`); `hermes` tiene como peers `agent-core >=0.31.0 <0.33.0` y `agent-protocol ^0.2.1`. Publicarlos antes de sus peers rompe las instalaciones.

### Detalle
- **core:** `createEngineControl(engine, { policy, jobs, approveWidening, onAudit })`: un handler de control con la forma de `ControlHandler` (`get/set_sandbox_policy`, `list_jobs`, `cancel_job`, `audit`). Estrechar una política es libre; ampliarla exige aprobación y falla cerrado sin aprobador (`APPROVAL_REQUIRED`); el techo del operador es un límite duro (`POLICY_WIDER_THAN_PARENT`); `expectedVersion` evita pisar cambios. `JobRegistry.listAll()` (nuevo método de la interfaz).
- **sandbox:** `isNarrowerOrEqual` / `checkNarrower` (un hijo nunca es más amplio que su padre) y `sandboxPolicyControl(policy, { ceiling })`.
- **agent-protocol:** protocolo 1.1 (compatible con 1.0): `POST /v1/agent/control`, `GET /v1/agent/runs`, `GET /v1/agent/audit`, `drain`/`resume` del servidor, `info` con `protocolMinor`, límites y flows. Cerrado por defecto: exige `controlApiKey`, distinta de `apiKey`. El cliente (`control`, `listRuns`, `audit`) no reintenta ni usa circuit breaker a propósito.
- **hermes (nuevo):** `fleet.yaml` validado (`bk-hermes validate`), registro de flota con salud periódica, conectores `in-process` y `protocol`, store de runs con reconciliación tras reinicio, herramientas `fleet_*`/`agent_*`, roles, aprobación que falla cerrado, guardrails sobre resultados y auditoría NDJSON.
- **Conocido:** cancelar un run en un `AgentServer` marca la tarea pero no aborta el handler del servidor.

## v0.31.0 (2026-10-23)

Herramientas de archivo detrás del sandbox (SPEC-0006 S3a; PR #76). Una ruta se juzga por **dónde apunta de verdad**: un symlink o junction dentro del workspace que apuntaba fuera permitía leer y escribir fuera, porque `resolveAndCheck` compara solo texto.
Es opt-in y compatible: sin `sandbox`, las herramientas se comportan como antes. Rangos 0.x barridos (`agent-core ^0.31.0`, `agent-coding ^0.27.0`; peers `<0.32.0`) y templates de `create-bk-agent` actualizados.

| Paquete | Versión |
|---|---|
| `agent-core` | 0.31.0 |
| `agent-sandbox` | 0.1.1 |
| `agent-coding` | 0.27.0 |
| `agent-enterprise` | 0.7.1 |
| `agent-providers` | 0.2.5 |
| `agent-otel` | 0.1.3 |
| `agent-testkit` | 0.1.2 |
| `agent-web` | 0.4.13 |
| `mcp-server` | 0.16.8 |
| `orchestrator-agent` | 0.4.5 |
| `aval-tools` | 0.1.8 |
| `create-bk-agent` | 0.22.10 |

`mcp-connectors` y `curator-codex-agent` no cambian: su rango `agent-enterprise ^0.7.0` cubre 0.7.1.

**Orden de publicación (obligatorio):** core → **sandbox** → providers → coding → enterprise → otel → orchestrator-agent → (opcionales: testkit, web, mcp-server, aval-tools) → create-bk-agent.
`agent-sandbox` 0.1.1 tiene como peer `agent-core >=0.31.0 <0.32.0` (usa tipos nuevos del contrato): publicarlo antes que core rompe las instalaciones.

### Detalle
- **core:** `SandboxRunner.authorizePath?` y tipos `SandboxPathRequest` / `SandboxPathVerdict`. El engine lo envuelve por llamada: denegaciones y escrituras permitidas salen por el transport y la auditoría de ese engine aunque el runner se comparta; las lecturas permitidas no se reportan.
- **sandbox:** `authorizePath` resuelve la ruta real (symlinks, junctions, enlaces colgantes y rutas aún inexistentes) y la compara con workspace + `roots` + directorios extra (memoria del agente). `read-only` rechaza escrituras; `danger-full-access` permite; una ruta que no se puede resolver se deniega. Exporta `realPathOf` e `isInsideDir`.
- **coding:** `write_file`, `edit_file`, `read_file`, `list_directory` y `search_files` consultan `ctx.sandbox.authorizePath` tras `resolveAndCheck`, que sigue siendo el suelo incluso en full access.

## v0.30.0 (2026-10-22)

Sandbox de ejecución (SPEC-0006 S1; PRs #73 y #74): confinamiento y permisos de lo que ejecutan los agentes, con política como datos que un plano de control puede fijar y consultar.
Es opt-in: sin `sandbox` configurado, `run_command` y el engine se comportan como antes (salvo la nota de la ruta heredada con docker). Rangos 0.x barridos (`agent-core ^0.30.0`, `agent-coding ^0.26.0`, `agent-enterprise ^0.7.0`; peers `<0.31.0`) y templates de `create-bk-agent` actualizados.

| Paquete | Versión |
|---|---|
| `agent-core` | 0.30.0 |
| `agent-sandbox` | 0.1.0 (nuevo) |
| `agent-coding` | 0.26.0 |
| `agent-enterprise` | 0.7.0 |
| `agent-providers` | 0.2.4 |
| `agent-otel` | 0.1.2 |
| `agent-testkit` | 0.1.1 |
| `agent-web` | 0.4.12 |
| `mcp-server` | 0.16.7 |
| `mcp-connectors` | 0.1.6 |
| `orchestrator-agent` | 0.4.4 |
| `aval-tools` | 0.1.7 |
| `curator-codex-agent` | 1.0.4 |
| `create-bk-agent` | 0.22.9 |

**Orden de publicación (obligatorio):** core → **sandbox** → providers → coding → enterprise → otel → orchestrator-agent → (opcionales: testkit, web, mcp-server, mcp-connectors, aval-tools, curator-codex-agent) → create-bk-agent.
`agent-coding` depende **de forma dura** de `agent-sandbox` y este tiene como peer `agent-core >=0.30.0`: publicar coding antes que sandbox, o sandbox antes que core, rompe las instalaciones.
`agent-providers`, `agent-otel`, `agent-testkit`, `agent-web`, `mcp-server`, `mcp-connectors`, `orchestrator-agent`, `aval-tools`, `curator-codex-agent` y `create-bk-agent` solo cambian rangos de dependencia/peer (templates en el caso de `create-bk-agent`).

### Detalle

### `@backendkit-labs/agent-sandbox` (nuevo)
- **Modos** `read-only`, `workspace-write`, `danger-full-access` y red `none|allow`; presets `read-only`, `ask`, `auto-edit`, `full`.
- **Falla cerrado:** si el modo exigido no se puede imponer en este host, la llamada devuelve `SANDBOX_UNAVAILABLE` y no se ejecuta nada. El backend `none` (host) solo reclama `danger-full-access` con red abierta; `docker` reclama `read-only` y `workspace-write`.
- **Política como datos:** `SandboxPolicyConfig` JSON (preset, mode, approval, network, roots, reglas por agente/herramienta, env, writeTools, commandTools); `set()` validado que aplica a la siguiente llamada, `snapshot()`, `version`, `parsePolicyConfig()`.
- **Entorno depurado** (KEY/SECRET/TOKEN/PASSWORD/CREDENTIAL) con `env.allow`; decisiones observables (`onDecision`) y auditoría NDJSON ordenada.
- Backend docker: workspace `:ro` y raíz de solo lectura en `read-only`, red `none` por defecto, sin capacidades, límites de memoria y procesos, **ejecución con el uid:gid del host en POSIX**.

### `@backendkit-labs/agent-core`
- Contrato `SandboxRunner` / `SandboxMode` / `SandboxOutcome` / `SandboxDecision`, `ExecutionContext.sandbox`, evento `sandbox` y `createBaseEngine({ sandbox })`; `engine.sandbox` para leer o cambiar la política en caliente.
- `authorizeTool` rechaza por nombre las herramientas de escritura en `read-only` antes del gate de aprobación; `approvalFor` sustituye la lista fija de herramientas que preguntan.
- **Fail-closed sin humano:** una herramienta que exige aprobación y no tiene `onToolApproval` se rechaza, incluso tras `disableToolApproval()`.
- Cada engine reporta solo las decisiones de sus propias llamadas aunque comparta el servicio con otros.

### `@backendkit-labs/agent-coding`
- `run_command` delega lanzamiento, terminación, timeout y captura al backend; las comprobaciones de comandos y los mensajes no cambian. `createCodingEngine({ sandbox: { preset, policy, backends, docker, auditLog } })` y `CODING_WRITE_TOOLS`.
- **Ruta heredada** (sin `sandbox`): `BK_RUN_COMMAND_SANDBOX` se traduce a la política equivalente (deprecado). Con `docker`, el contenedor corre ahora con el uid:gid del host en POSIX (antes root) y `BK_SANDBOX_NETWORK` distinto de `none` significa `bridge`.

### `@backendkit-labs/agent-enterprise`
- Reenvía `sandbox`.

### Límites
Solo se confina lo que pasa por `ctx.sandbox.run`; una herramienta propia o MCP que lance procesos por su cuenta queda fuera. `read-only` rechaza por nombre solo las herramientas listadas como de escritura. Las herramientas de archivos siguen usando su propia comprobación de ruta hasta la siguiente entrega.

## v0.29.1 (2026-10-22)

Parche sobre la Ola 3a. Sin cambios de rangos: `^0.29.0` ya cubre 0.29.1.

| Paquete | Versión |
|---|---|
| `agent-core` | 0.29.1 |
| `create-bk-agent` | 0.22.8 |

Orden de publicación: core → create-bk-agent.

- **`agent-core`:** un job cancelado (`job_kill`, `engine.abort()`) queda `cancelled` sin conservar como summary el error de su proceso muerto (antes `exit 1`) (#68).
- **`create-bk-agent`:** nuevo comando `npx create-bk-agent add testing`: instala `@backendkit-labs/agent-testkit`, jest y ts-jest como devDependencies, añade `jest.config.js`, el script `test` y un test de ejemplo sin clave de API; no sobrescribe archivos existentes (#71).
- **`agent-testkit` 0.1.0** (publicado aparte, paquete nuevo): dobles de prueba (`scriptedProvider`, `mockTransport`), servidor LLM mock compatible con OpenAI con fallos inyectables, grabación y reproducción de ejecuciones y aserciones sobre el sistema real (#69, #70).

## v0.29.0 (2026-10-22)

Ola 3a del SDK (SPEC-0002; PRs #63 a #66): herramientas con plazo y cancelación, recuperación ante desbordamiento de contexto, credenciales por referencia y jobs en segundo plano.
Todo es opt-in y aditivo salvo lo indicado. Rangos 0.x barridos (`agent-core ^0.29.0`, `agent-coding ^0.25.0`, `agent-enterprise ^0.6.0`; peers `<0.30.0`) y templates de `create-bk-agent` actualizados.

| Paquete | Versión |
|---|---|
| `agent-core` | 0.29.0 |
| `agent-providers` | 0.2.3 |
| `agent-coding` | 0.25.0 |
| `agent-enterprise` | 0.6.0 |
| `agent-otel` | 0.1.1 |
| `agent-web` | 0.4.11 |
| `mcp-server` | 0.16.6 |
| `mcp-connectors` | 0.1.5 |
| `orchestrator-agent` | 0.4.3 |
| `aval-tools` | 0.1.6 |
| `curator-codex-agent` | 1.0.3 |
| `create-bk-agent` | 0.22.7 |

Orden de publicación: core → providers → coding → enterprise → otel → orchestrator-agent → (opcionales: web, mcp-server, mcp-connectors, aval-tools, curator-codex-agent) → create-bk-agent.
`agent-providers`, `agent-otel`, `agent-web`, `mcp-server`, `mcp-connectors`, `orchestrator-agent`, `aval-tools`, `curator-codex-agent` y `create-bk-agent` solo cambian rangos de dependencia/peer (templates en el caso de `create-bk-agent`).

### Detalle

### `@backendkit-labs/agent-core`
- **Señal y plazo por herramienta:** `ExecutionContext.signal`; `timeoutMs` por herramienta y `toolTimeoutMs`/`toolTimeoutGraceMs` del engine. Al vencer o abortar, el modelo recibe `TOOL_TIMEOUT`/aborted y un resultado tardío se descarta. `tool_result` lleva `outcome` (`timeout` | `aborted`).
- **Reintento tras desbordamiento de contexto:** `isContextOverflowError`, `ContextManager.compact({ force, targetRatio })`, `noteOverflow()` y `ContextOptions.overflowRetry` (por defecto activo con `context`). Hasta 2 reintentos por ejecución; si el historial no se puede reducir se emite el error original.
- **Credenciales por referencia:** `AgentProfile.secrets` admite `{ env: "NOMBRE" }` (se resuelve en cada llamada) y `secretResolver` como respaldo; `secretLeakGuardrail` usa los valores resueltos. Los perfiles con valores literales siguen igual.
- **Jobs en segundo plano:** `createBaseEngine({ jobs })`, `JobRegistry`, herramientas `job_output`/`job_list`/`job_kill`, `ExecutionContext.jobs`, aviso de finalización al inicio de cada iteración y cancelación en `abort()`.

### `@backendkit-labs/agent-coding`
- `run_command`: respeta `ctx.signal` y mata el árbol de procesos (Windows: `taskkill /T /F`; POSIX: grupo de procesos propio); nuevo parámetro `background` cuando hay `jobs`.
- Opciones nuevas en `createCodingEngine`: `toolTimeoutMs`, `toolTimeoutGraceMs`, `jobs` (añade las herramientas `job_*` a los agentes con `run_command`) y `secretResolver`.

### `@backendkit-labs/agent-enterprise`
- Reenvía `toolTimeoutMs`, `jobs` y `secretResolver`.

### `@backendkit-labs/agent-otel`
- Los spans `execute_tool` exponen el `outcome` de la herramienta como `bk.outcome`.

## v0.28.0 (2026-10-22)

Ola 2 del SDK: contexto por tokens con resumen, guardrails genéricos y trazas OpenTelemetry (PRs #59 y #60).
Todo es opt-in y aditivo: sin configurar `context`, `guardrails` ni un exportador de trazas el comportamiento no cambia.
Los rangos 0.x se barren (`agent-core ^0.28.0`, `agent-coding ^0.24.0`, `agent-enterprise ^0.5.0`) y los templates de `create-bk-agent` se actualizan.

| Paquete | Versión |
|---|---|
| `agent-core` | 0.28.0 |
| `agent-providers` | 0.2.2 |
| `agent-coding` | 0.24.0 |
| `agent-enterprise` | 0.5.0 |
| `agent-otel` | 0.1.0 (nuevo) |
| `agent-web` | 0.4.10 |
| `mcp-server` | 0.16.5 |
| `mcp-connectors` | 0.1.4 |
| `orchestrator-agent` | 0.4.2 |
| `aval-tools` | 0.1.5 |
| `curator-codex-agent` | 1.0.2 |
| `create-bk-agent` | 0.22.6 |

Orden de publicación: core → providers → coding → enterprise → otel → orchestrator-agent → (opcionales: web, mcp-server, mcp-connectors, aval-tools, curator-codex-agent) → create-bk-agent.
`agent-web`, `mcp-server`, `mcp-connectors`, `aval-tools` y `curator-codex-agent` solo cambian rangos de dependencia/peer.

### Detalle

### `@backendkit-labs/agent-core` — contexto por tokens (`context`)
- Mantiene el historial bajo `context.maxTokens`: trunca resultados de tools viejos, resume los turnos más antiguos
  (el resumen nuevo extiende al anterior) y descarta como último recurso. Cortes en frontera de turno.
- Un resumidor que falla degrada a descartar con aviso; la compactación nunca detiene el run.
- El uso del resumidor se reporta como eventos `metrics` (lo ve el `CostTracker`). Estimador chars/4 calibrado con el
  `input_tokens` real del provider. Disponible también en `createCodingEngine` y `createEnterpriseSetup`.

### `@backendkit-labs/agent-core` — guardrails (`guardrails`, `guardrailOutputMode`)
- Fases `input`, `tool_call` (antes de la aprobación), `tool_result` y `output`, sobre el agente principal y todos los sub-agentes.
- Decisiones allow / redact / block, `failMode` cerrado por defecto, `dryRun`.
- Ready-made: `piiGuardrail`, `secretLeakGuardrail`, `promptInjectionGuardrail` (heurístico), `maxLengthGuardrail`,
  `denyListGuardrail`, `llmJudgeGuardrail`. Un bloqueo en `tool_call` borra los argumentos del historial.
- Salida `after` (corrige el historial; el evento trae `replacement`) o `buffer` (nada sin revisar se muestra).
- Evento `guardrail`, entradas `guardrail:<fase>:<nombre>` en `auditLog` y `MetricsSnapshot.guardrails`.
- Coding y enterprise **no** activan guardrails por defecto.

### `@backendkit-labs/agent-core` / `agent-providers` — spans de llamadas
- `llm_call` (modelo, proveedor, tokens, caché, coste, `purpose`) y `tool_call` bajo el `agent_block`, con inicio y fin reales.
- Los eventos `metrics` y `tool_result` ganan `agent_id`, `started_at` y `duration_ms` (opcionales); `metrics` también
  `provider`, `model` y `purpose`. Quien compare esos eventos con igualdad exacta debe pasar a una comparación parcial.
- `LLMProvider.modelId?` (lo implementan `OpenAICompatibleProvider` y `AnthropicProvider`).

### `@backendkit-labs/agent-otel` 0.1.0 (nuevo)
- `otlpHttpSpanExporter`: OTLP/JSON por HTTP sin SDK. `otelApiSpanExporter`: vía `@opentelemetry/api` (retiene el trace hasta
  que termina `agent.run`). Convenciones semánticas GenAI; nunca exporta prompts, respuestas ni argumentos de tools.
- Sin probar contra Jaeger/Langfuse reales. No está en `publish.yml`: publicación manual.

## v0.27.1 (2026-10-22)

Correcciones halladas probando con DeepSeek. Los rangos `^0.27.0`, `^0.2.0` y `^0.23.0` ya cubren estas versiones: sin barrido ni cambio en `create-bk-agent`.

| Paquete | Versión |
|---|---|
| `agent-core` | 0.27.1 |
| `agent-providers` | 0.2.1 |
| `agent-coding` | 0.23.1 |

### Detalle

### `@backendkit-labs/agent-core` / `agent-providers` / `agent-coding` — correcciones halladas probando con DeepSeek

- **`metrics` lleva `cost_usd`.** El `ObservabilityManager` calculaba el costo pero el evento que llegaba
  al transporte seguía sin él, así que ninguna interfaz podía mostrarlo. Ahora, con un `costTracker` con
  precios, el evento `metrics` reenviado incluye el `cost_usd` de esa llamada (tokens de caché incluidos).
  Un `cost_usd` que ya traiga el provider se respeta, y sin precios el evento no cambia.
- **DeepSeek V4 y `toolChoice` forzado.** V4 piensa por defecto y responde 400 a un `toolChoice`
  `'required'` o por nombre en ese modo. `DeepSeekProvider` envía ahora `thinking: disabled` en esas
  llamadas (si no fijaste `thinking` tú). Opción nueva `disableThinkingForForcedTools` en
  `OpenAICompatibleProvider` (apagada por defecto: no todos los endpoints aceptan el campo `thinking`;
  encendida en el preset de DeepSeek y para el provider `deepseek` de `createCodingEngine`).

### `examples/` — refactor con las novedades de 0.27

Los ejemplos dependen ahora de los paquetes **publicados** (`agent-core ^0.27.0`, `agent-coding ^0.23.0`,
`agent-providers ^0.2.0`…) en vez de rutas `file:` que ya no resolvían dentro del monorepo.
- `git-agent`: `createBaseEngine` + `agent-providers` (se borra su copia del provider y la dependencia
  `openai`); presupuesto por ejecución con `abortOnBudget`; modo solo lectura (`GIT_AGENT_READONLY=1`);
  `/report` con salida estructurada (`engine.generateObject`); la terminal muestra uso, avisos del
  framework y tope de presupuesto; `npm run smoke` (prueba real contra un repo temporal).
  Sus herramientas git ya no pasan por un shell: usan `execFile` con argumentos (nada de lo que elija el
  modelo se interpreta como sintaxis de shell), rechazan refs que empiezan por `-`, no se cuelgan pidiendo
  credenciales y devuelven también lo que git imprime por stderr (checkout, merge, push). `npm run check`
  las prueba sin LLM.
- `vault-pilot`: su `DeepSeekProvider` pasa a ser un adaptador fino sobre `agent-providers`.
- `code-explainer` y `git-analyst`: tope de gasto opcional por llamada (`AGENT_BUDGET_USD` + precios).
- `coding-assistant`: tope de gasto opcional, `maxParallelTools: 4`, muestra uso de caché y tope de
  presupuesto; corrige tipos desfasados (`IterationMode`, `mcpAdd`) que ya no compilaban contra core.
- Sin cambios (no usan un motor de agentes): `pg-dev-server`, `marketing-co`, `workflow.mcp-agents`.
  `finance-managment` (NestJS con motor propio) queda fuera de este cambio.

## v0.27.0 (2026-10-21)

Cierra la Ola 1 del SPEC-0001: salida estructurada (ADR-0003) y caché de prompt y razonamiento de
Anthropic (ADR-0004).

| Paquete | Versión |
|---|---|
| `agent-core` | 0.27.0 |
| `agent-providers` | 0.2.0 |
| `agent-coding` | 0.23.0 |
| `orchestrator-agent` | 0.4.1 |
| `agent-enterprise` | 0.4.3 |
| `agent-web` | 0.4.9 |
| `mcp-server` | 0.16.4 |
| `aval-tools` | 0.1.4 |
| `create-bk-agent` | 0.22.5 |

`agent-providers` 0.2.0 requiere `agent-core` `>=0.27.0 <0.29.0`. `orchestrator-agent`,
`enterprise`, `web`, `mcp-server`, `aval-tools` y `create-bk-agent` solo ajustan sus rangos de
`agent-core` / `agent-coding` / `agent-providers`; los templates pasan a `agent-core ^0.27.0` y
`agent-coding ^0.23.0`. `maxParallelTools` sigue en 1 por defecto.

### `@backendkit-labs/agent-core` / `@backendkit-labs/agent-providers` / `@backendkit-labs/agent-coding` — salida estructurada (ADR-0003)

`generateObject(provider, prompt, zodSchema, opts?)` (nuevo, en `agent-core`) pide al modelo un
objeto que cumpla el esquema, lo valida con zod y lo devuelve tipado. Una respuesta inválida se
reintenta **una vez** diciéndole al modelo qué estaba mal; si vuelve a fallar lanza
`StructuredOutputError` (con `raw` e `issues`). Los fallos del provider se relanzan tal cual.
`engine.generateObject(prompt, schema, { agentId?, retries? })` usa el provider del agente y emite
el uso de tokens como eventos `metrics` (sin tocar el historial). También `generateObjectWith`
para clientes que no son un `LLMProvider`, y `zodToParameters` (el helper de esquemas que usaba
`defineTool`, ahora exportado).

Contrato (compatible hacia atrás, todo opcional): `LLMProvider.chat(..., options?: ChatOptions)`
con `responseFormat` y `toolChoice`, y `LLMProvider.capabilities.structuredOutput`
(`'native' | 'json_object' | 'none'`). Un provider que no conoce `options` sigue funcionando: la
validación zod siempre se aplica, y si el provider no impone el esquema éste se añade al prompt.

Mapeo por provider:
- `OpenAICompatibleProvider`: `response_format: json_schema` (`structuredOutput: 'native'`, por
  defecto). El modo estricto se relaja solo si el esquema tiene campos opcionales u objetos que
  admiten propiedades extra (OpenAI respondería 400). `toolChoice` se traduce a `tool_choice`.
- `DeepSeekProvider` y `OllamaProvider`: `json_object` (el esquema viaja en el prompt). Ollama
  admite `structuredOutput: 'native'` si tu servidor soporta `json_schema`.
- `AnthropicProvider`: `output_config.format` con el esquema (`structuredOutput: 'native'`) o, como
  respaldo explícito, una herramienta `respond` forzada (`structuredOutput: 'tool'`; no se puede
  combinar con `thinking`). `toolChoice` se traduce a `tool_choice`.
- `createCodingEngine`: el provider `deepseek` usa `json_object` por defecto (no admite
  `json_schema`); `structuredOutput` es configurable en cada provider.

`intent-detector` deja de extraer la acción con una regex: usa `generateObjectWith` con un enum de
acciones. Una respuesta no válida sigue acabando en `unknown`. `LLMChatClient.chat` y
`adaptProviderToLLMClient` propagan las opciones. El planner de `orchestrator-agent` y los curadores
migran a `generateObject` en cambios posteriores.

### `@backendkit-labs/agent-core` / `@backendkit-labs/agent-providers` / `@backendkit-labs/agent-coding` — caché de prompt y razonamiento extendido de Anthropic (ADR-0004)

`AnthropicProvider` (y `AnthropicConfig` de `createCodingEngine`) gana, todo opt-in:
- `cache: 'none' | 'system' | 'system+tools' | 'auto'` (default `'none'`: la petición es idéntica a
  la anterior) y `cacheTtl: '5m' | '1h'`. Con caché, el system prompt se envía como bloques con
  `cache_control` en el último; `system+tools` marca también la última herramienta y `auto` añade
  un punto móvil en el último mensaje (útil en bucles de herramientas).
- `thinking: { budgetTokens }` (entero >= 1024 y < `maxTokens`; si no, error claro al crear el
  provider). Con thinking se omite `temperature`. Los bloques `thinking`/`redacted_thinking` con su
  firma se guardan en `LLMMessage.raw` y se reenvían intactos en el turno siguiente.

Contrato de `agent-core`:
- `LLMMessage.raw?: unknown` (payload opaco del provider; `HistoryManager` lo persiste).
  `OpenAICompatibleProvider` lo descarta al enviar.
- `LLMStreamCallbacks.onMetrics(input, output, usage?)` con `usage = { cacheReadTokens, cacheWriteTokens }`,
  y `onReasoning?(delta)`. El evento `metrics` gana `cache_read_tokens` y `cache_write_tokens`
  opcionales (visibles en la terminal de `coding`).
- `CostTracker` suma lectura y escritura de caché con `cacheReadPricePerMToken` /
  `cacheWritePricePerMToken` (por defecto 0,1x y 1,25x del precio de entrada; con TTL de 1 hora
  la escritura cuesta ~2x: configúralo). `MODEL_PRICING` incluye esos precios para los modelos
  Anthropic que ya listaba, **calculados con los multiplicadores y no contrastados con la tarifa
  vigente**: revísalos antes de confiar en el costo.

No se emite evento de razonamiento al transporte en esta ola (queda `onReasoning`).

## v0.26.0 (2026-10-21)

| Paquete | Versión |
|---|---|
| `agent-core` | 0.26.0 |
| `agent-providers` | 0.1.0 (nuevo) |
| `agent-coding` | 0.22.0 |
| `orchestrator-agent` | 0.4.0 |
| `agent-enterprise` | 0.4.2 |
| `agent-web` | 0.4.8 |
| `mcp-server` | 0.16.3 |
| `aval-tools` | 0.1.3 |
| `create-bk-agent` | 0.22.4 |

`enterprise`, `web`, `mcp-server`, `aval-tools` y `create-bk-agent` solo ajustan sus rangos de
`agent-core` (y los templates de `create-bk-agent` pasan a `agent-core ^0.26.0`, `agent-coding
^0.22.0`, `orchestrator-agent ^0.4.0`).

### `@backendkit-labs/agent-providers` 0.1.0 (nuevo) — una sola implementación de providers (ADR-0005)

Paquete nuevo con `BaseStreamingProvider`, `OpenAICompatibleProvider`, `AnthropicProvider` y los
presets `OllamaProvider` y `DeepSeekProvider`. `agent-coding` los re-exporta con los mismos
nombres y `orchestrator-agent` los consume (su `provider.ts` queda como adaptador de la config
snake_case). Reintentos con `@backendkit-labs/retry`: 429, 5xx y errores de red; nunca tras
emitir contenido ni tras un aborto. Cliente SDK inyectable (`client`) y primera suite de pruebas
de providers.

Cambios de comportamiento a tener en cuenta:
- `maxAttempts` explícito; `maxRetries` queda como alias obsoleto con el mismo significado de
  antes (intentos totales; en Ollama cuenta reintentos, 2 = 3 intentos).
- **Ollama:** ahora pide `include_usage` (antes no reportaba tokens, así que el presupuesto no
  veía sus llamadas) y también reintenta 429.
- **DeepSeek:** `maxRetries` ya no se descarta.
- **orchestrator-agent:** ahora respeta `model` y `signal` (se puede abortar); sigue sin enviar
  `max_tokens` y conserva temperatura 1 para modelos "reasoner".
- `createCodingEngine`: `OpenAICompatibleConfig` expone `thinking`.
- `agent-coding` ya no depende de `openai` ni de `@anthropic-ai/sdk` (los trae `agent-providers`).
- `agent-providers` declara `agent-core` como peer (`>=0.25.0 <0.27.0`); `orchestrator-agent`
  sube su rango de `agent-core` a `^0.25.0`.

Pendiente de este ADR: bump y publicación (providers → coding → orchestrator-agent) y actualizar
los templates cuando `agent-providers` esté en npm.

### `@backendkit-labs/agent-core` 0.26.0 / `@backendkit-labs/agent-coding` 0.22.0 — aborto automático por presupuesto (ADR-0002)

`abortOnBudget` (default `false`) en `createBaseEngine` y `createCodingEngine`; este último expone
además `observability`. Con él, al superar `costTracker.budget` el motor llama a `engine.abort()`,
emite el evento nuevo `budget_exceeded` (con `BudgetUsage`) y luego invoca tu `onBudgetExceeded`.
La llamada que cruza el límite termina (y se paga), pero su respuesta se descarta. Los
sub-agentes (`ask_agent`) también se detienen. Si hay `budget` sin precios, o con `perDay`, el
motor emite un aviso `system` de nivel `warn` al crearse (el gasto diario no se persiste).

**Cambio de comportamiento:** `onBudgetExceeded` se disparaba en cada evento de métricas
una vez superado el límite, y el límite diario quedaba oculto si el de ejecución también se
superaba. Ahora se dispara **una vez por límite y por ejecución** (`perDay`: una vez por día) y se
reportan ambos si se superan a la vez. El costo que entrega el provider (`cost_usd`) ahora se
acumula entre llamadas en `getRunCost()` / `getDayCost()`. `AgentEvent` gana `budget_exceeded`:
revisa los `switch` exhaustivos propios.

## v0.25.0 (2026-10-21)

### `@backendkit-labs/agent-core` 0.25.0 / `@backendkit-labs/agent-coding` 0.21.0 — ejecución paralela de tool calls (ADR-0001)

`ToolDefinition.concurrencySafe` (opt-in, default `false`) y `maxParallelTools` en `AgentEngine`,
`createBaseEngine` y `createCodingEngine` (default `1`: comportamiento idéntico al anterior).
Con `maxParallelTools > 1`, las tools seguras consecutivas de un turno corren en paralelo; una
tool no segura es una barrera. Resultados y eventos conservan el orden de las llamadas y
`onToolApproval` se invoca en serie. Marcadas seguras: `read_file`, `list_directory`,
`search_files`, `list_audits`, `get_latest_audit`, `memory_recall`, `memory_search_knowledge`.
Tools MCP: solo con `MCPServerConfig.trustAnnotations: true` y `readOnlyHint`.

### `@backendkit-labs/agent-core` — `createBaseEngine` reenvía los callbacks de aprobación e iteración (corrección)

`createBaseEngine` no declaraba ni reenviaba `onToolApproval`, `onIterationLimit`, `onStep` ni
`iterationMode` a `AgentEngine`. `createCodingEngine` los pasa con `spread` condicional, que
TypeScript no revisa por propiedades sobrantes, así que se descartaban en silencio: **la
aprobación de herramientas de escritura nunca se activaba** (un callback que devolvía `'reject'`
no impedía que `write_file` se ejecutara) y los callbacks de iteración no se llamaban.

Ahora `BaseEngineOptions` declara los cuatro y se pasan al motor. Quien use `createCodingEngine`
con `onToolApproval` empezará a ver las confirmaciones que antes no aparecían. Detalle en
`docs/specs/SPEC-0001-agent-core-ola-1.md` §2.

## v0.24.0 (2026-08-07)

### `@backendkit-labs/agent-core` — credenciales por agente

`AgentProfile.secrets` (nuevo, opcional): credenciales propias del agente, inyectadas en
`ExecutionContext.secrets` en cada llamada a herramienta. Antes de esto, una herramienta que
necesitara una clave externa sólo podía leerla de una variable de entorno compartida por todo
el proceso — cualquier agente con esa herramienta tenía la misma clave que todos los demás. Con
`secrets`, la clave vive en el perfil de cada agente y una herramienta la lee de `ctx.secrets`,
no del entorno.

Cambio aditivo: campo opcional en `AgentProfile` y en `ExecutionContext`, propagado en
`buildContext()` con el mismo patrón condicional que ya usa `blockedCommands`. No afecta a
ningún agente existente que no lo declare.

```typescript
const profile: AgentProfile = {
    // ...
    allowedTools: ['pay', 'check_payment'],
    secrets: { AVAL_KEY: process.env.EXPEDIENTES_BOT_AVAL_KEY! },
};
```

### `@backendkit-labs/aval-tools` (paquete nuevo)

Herramientas `pay` y `check_payment` para que un agente gaste dinero a través de una instancia
de [AVAL](https://github.com/BackendKit-labs/aval) — presupuesto previo, decisión antes del
gasto, registro encadenado. `pay` pide un techo de gasto y devuelve el resultado como texto
(pagado, retenido o denegado); `check_payment` consulta el estado de un gasto retenido en una
invocación posterior, sin que la sesión del agente tenga que quedarse esperando a que una
persona lo apruebe.

Usa `secrets` de arriba para la credencial: cada agente lleva su propia clave de AVAL, nunca
una compartida.

## v0.23.0 (2026-06-11)

### `@backendkit-labs/agent-web` — `MonitorBus`

Nuevo subsistema de observabilidad en tiempo real sobre todas las sesiones activas del servidor.

#### `MonitorBus`

Fan-out de eventos a observadores WebSocket read-only. Un servidor puede tener N monitores conectados simultáneamente sin impacto en las sesiones de chat.

```typescript
import { MonitorBus } from '@backendkit-labs/agent-web';
```

**Protocolo (server → monitor):**

```typescript
// Al conectar: lista de sesiones ya abiertas
{ type: 'monitor_hello', sessionIds: string[] }

// Ciclo de vida de sesiones
{ type: 'monitor_session_open',  sessionId: string }
{ type: 'monitor_session_close', sessionId: string }

// Input del usuario (antes de que el engine procese)
{ sessionId: string, type: 'run_input', content: string }

// Todos los AgentEvents de esa sesión
{ sessionId: string, type: 'token' | 'tool_call' | 'done' | ... }
```

El `MonitorBus` se crea automáticamente en `AgentServer` y se conecta al `SessionManager`. No requiere configuración adicional.

**Endpoint:** `WS /monitor` — read-only, no acepta input del cliente.

**`/health`** ahora incluye `monitors: number` — cantidad de observadores conectados.

---

### `@backendkit-labs/agent-web-ui` — template `kanban`

Template de monitoreo enterprise: visualiza la actividad de todos los agentes en tiempo real como un tablero kanban.

#### Layout

Secciones apiladas verticalmente. Cada sección es una columna del flujo:

```
┌─────────────────────────────────────────────┐
│ ● PENDIENTE  (n)                             │
│  [Card: mensaje del usuario]                 │
├─────────────────────────────────────────────┤
│ ● EN PROCESO  (n)                            │
│  [Card: agente trabajando + tool badges]     │
├─────────────────────────────────────────────┤
│ ● ESPERANDO APROBACIÓN  (n)                  │
├─────────────────────────────────────────────┤
│ ● COMPLETADO  (n)                            │
│  [Card: finalizado + tiempo + tokens]        │
└─────────────────────────────────────────────┘
```

#### Mapeo de eventos → columnas

| Evento | Transición |
|---|---|
| `run_input` | Nueva card en **Pendiente** |
| `block_start` | → **En Proceso** (actualiza agente activo) |
| `tool_call` | Badge animado (spinner) sobre la card activa |
| `tool_result` | Badge → verde (ok) / rojo (error) |
| `done` / `ready` | → **Completado** |
| `error` | → **Completado** (sección roja) |
| `monitor_session_close` con run activo | → **Completado** (error: desconexión) |

#### `useKanbanMonitor` hook

```typescript
const { runs, status, activeSessions, connect, disconnect, clearDone } =
  useKanbanMonitor({ url: 'ws://localhost:3000/monitor' });
```

`runs: KanbanRun[]` — historial completo de runs. Cada run tiene `sessionId`, `title` (primeros 80 chars del input), `column`, `agentId/Name/Icon`, `toolCalls[]`, `tokens`, `startedAt`, `completedAt`.

#### Navegación integrada

`NavTabs` — tabs **Chat / Monitor** en el header de ambos templates. Hash router sin dependencias externas:

- `http://localhost:5173/` → Chat
- `http://localhost:5173/#kanban` → Monitor

---

## v0.22.0 (2026-06-10)

### `@backendkit-labs/agent-web` 0.1.0 — nuevo paquete

Capa HTTP/WebSocket que envuelve `AgentEngine` y lo expone al browser.

#### `WebSocketTransport`

Implementa la interfaz `Transport` de `agent-core` sobre un WebSocket de `@fastify/websocket`. Traduce `AgentEvent` a frames JSON. Maneja reconexiones y cierre limpio.

```typescript
// El engine recibe un WebSocketTransport en lugar de CallbackTransport
const transport = new WebSocketTransport(socket);
const engine = new AgentEngine({ transport, ... });
```

#### `SessionManager`

Gestiona N sesiones concurrentes. Una `AgentEngine` instance por sesión. Sweep automático de sesiones idle (default: 30 min). Límite configurable de sesiones simultáneas (default: 100).

#### `AgentServer`

```typescript
import { AgentServer } from '@backendkit-labs/agent-web';

const server = new AgentServer({
    port: 3000,
    engineFactory: (sessionId, transport) => new AgentEngine({ transport, ... }),
    auth: async (req, reply) => { /* JWT / API key / OIDC — hook pluggable */ },
    cors: '*',
    maxSessions: 100,
    maxIdleMs: 30 * 60 * 1000,
});

await server.start();
```

**Rutas:**

| Ruta | Descripción |
|---|---|
| `WS /chat` | Conectar sesión. Enviar `{ type: 'input', content }` / `{ type: 'abort' }` |
| `GET /health` | Estado del servidor y número de sesiones activas |
| `GET /sessions` | Lista de sesiones con timestamps |
| `DELETE /sessions/:id` | Cerrar sesión específica |

**Protocolo WebSocket (client → server):**

```json
{ "type": "input",  "content": "¿Cuál es la política de vacaciones?" }
{ "type": "abort" }
```

El servidor devuelve `AgentEvent` JSON frames: `token`, `tool_call`, `tool_result`, `agent_switch`, `done`, `error`, etc. — mismos eventos que `CallbackTransport`.

**Cliente HTML de prueba:** `client/index.html` — chat funcional vanilla JS, sin dependencias, sirve como referencia de implementación del protocolo.

---

### `@backendkit-labs/agent-web-ui` 0.1.0 — nuevo paquete

Template React para el template `chat` del scaffold enterprise.

**Stack:** React 18 + Vite + Tailwind CSS v4 + shadcn/ui + TypeScript

#### `useAgentSession` hook

```typescript
const {
    messages,      // ChatMessage[] — historial completo
    status,        // 'disconnected' | 'connecting' | 'connected'
    isRunning,     // true mientras el engine procesa
    activeAgent,   // { id, name, icon } del agente activo
    connect,
    disconnect,
    sendMessage,
    abort,
    clearMessages,
} = useAgentSession({ url: 'ws://localhost:3000/chat' });
```

Maneja el estado completo del stream: acumula tokens en el mensaje activo, actualiza badges de tool calls en tiempo real, detecta cambios de agente.

#### Componentes

| Componente | Descripción |
|---|---|
| `ChatWindow` | Área de scroll con auto-scroll al último mensaje |
| `MessageBubble` | Burbujas user/assistant con Markdown renderizado, cursor de streaming |
| `ToolCallBadge` | Badge animado: spinner → verde (ok) / rojo (error) |
| `InputBar` | Textarea auto-resize, Enter para enviar, botón Stop durante streaming |

#### `App.tsx` — template chat completo

- Header con badge del agente activo y estado de conexión
- Barra de URL colapsable para cambiar el servidor sin recompilar
- Dark theme por defecto (variables CSS de shadcn)
- `VITE_AGENT_SERVER_URL` env var para configurar el servidor en build

---

### Pilot enterprise — web server

`pilot/src/web-server.ts` — servidor de prueba que conecta el pilot vault con el browser:

```bash
PORT=4001 npm run web   # desde /pilot
# → abre http://localhost:5173 (Vite dev server)
```

Validado end-to-end: browser conecta por WebSocket, agente busca en vault con RAG, responde en streaming token a token, badges de tool call se animan en vivo.

---

## v0.21.0 (2026-06-10)

### `@backendkit-labs/agent-core` 0.20.2 → 0.21.0

#### Engine decomposition — god object eliminado

`AgentEngine` pasó de ~1350 a ~895 líneas. Cuatro módulos extraídos con responsabilidad única:

| Módulo | Responsabilidad |
|---|---|
| `HistoryManager` | Historial de mensajes: push, save, load, sanitize, trim |
| `AuditLogger` | Escritura de registros de auditoría en disco |
| `MCPRegistrar` | Estado MCP, init, registro de agentes/tools/triggers, routing |
| `ApprovalGate` | Decisión de aprobación de tool calls (3 branches → `check()`) |

#### Tests — red de integración del core

10 escenarios de integración nuevos sobre `AgentEngine` + `DelegationBus`:

| Test | Qué valida |
|---|---|
| `abort()` a mitad de ejecución | `sanitizeMessages` elimina chain incompleto; no hay 400 en el siguiente `run()` |
| 3 `ask_agent` en paralelo | `runParallel` ejecuta concurrente; resultados mapeados al `tool_call_id` correcto |
| Delegación anidada | `depth > 0` bypasea el bulkhead; no hay starvation con 6 slots |
| Dos `run()` concurrentes | Mutex serializa; historial no se corrompe |
| Historial con chain partido cargado de disco | Save + load round-trip produce historial válido |
| `toolTriggers` MCP sin permiso | Auth + approval aplican igual que para tools directas |
| Tool rechazada por `onToolApproval` | Mensajes de error correctos; audit con `success: false` |
| `maxIterations` en sub-agentes | Config respetada (no hardcoded 30) |
| Eventos paralelos por agente | Cada bloque `block_start…block_end` es contiguo por `agent_id` |
| `loadAgents` concurrente | Promise cache: una sola carga; ambos callers esperan |

Suite total: **294 tests** (293 en rama `refactor/engine-quality` + 1 fix post-merge).

#### QA flow — cobertura

`QAService` y `qa-orchestrator` ahora cubiertos:
- `countCodeLines`: 5 tests
- `evaluateReview`: 10 tests (todos los paths + patrones específicos + tiebreaker)
- `extractFindings`: 7 tests (bullet, numerado, severidades, fallback)
- `activateQaEngineerIfNeeded`: 7 tests
- `processQaEngineerResponse`: 6 tests

Fix: `'issues found'` eliminado de `REJECTION_PATTERNS` — era substring de `'no issues found'` y causaba falso positivo.

#### Fase 3 — strings al LLM unificados en inglés

Cero español en strings que entran al contexto del LLM:
- `AgentEngine`: headers de orquestación traducidos
- `qa-orchestrator`: prompt de activación del QA engineer traducido
- `QAService`: `APPROVAL_PATTERNS` / `REJECTION_PATTERNS` reorganizados (inglés primero, español como fallback para respuestas mixtas); system prompts, mensajes de usuario y headers de secciones traducidos
- `LessonsMemoGenerator`: headers de documento, secciones, tabla, checklist y todas las recomendaciones por `failureType` traducidos

#### Fase 4 — clasificación de subsistemas

Matriz de estado publicada en el README raíz. Tres niveles:

| Estado | Significado |
|---|---|
| **core** | Requerido para la historia enterprise — revisión completa ante cambios |
| **stable** | Funciona y se mantiene; no se expande durante el piloto |
| **experimental** | Congelado — `qa`, `reflection`, `agent-memory`, `observability`, `triggers` |

Regla durante el piloto: sin features nuevas en subsistemas `experimental`.

---

### `@backendkit-labs/agent-enterprise` 0.2.0 → 0.3.0

#### Nuevo export: `SimpleEmbedder`

```ts
import { SimpleEmbedder } from '@backendkit-labs/agent-enterprise';
```

TF-IDF con feature hashing (256 dims, djb2), sin dependencias externas, sin Ollama.
Ideal para desarrollo, CI y pilotos donde no hay GPU disponible.
Para producción usar `OllamaEmbedder` con `nomic-embed-text`.

---

### Pilot enterprise (`pilot/`) — no publicado

REPL interactivo que valida la historia enterprise de punta a punta:
- Vault compartido como fuente única de verdad (`pilot/vault/`)
- 6 notas seed: decisiones de arquitectura, patrones, lecciones, guía de arranque
- `npm run repl` — conversación libre con agente consultant + analyst
- `npm run smoke` — verifica indexado RAG + búsqueda + llamada LLM end-to-end
- `dotenv` — carga `.env` automáticamente al arrancar
- `SimpleEmbedder` — sin Ollama requerido para el piloto

Ciclo validado: humano documenta → LLM busca via RAG → agente responde con contexto real del negocio → agente escribe de vuelta → conocimiento disponible en el próximo turno.

---

### Docs

- `proyecto-agentes-web.md`: Principio rector 2 — vault como fuente única de verdad; §2.1 con diagrama del ciclo de aprendizaje colectivo y tabla agente genérico vs enterprise
- READMEs de paquetes: status header en `core`, `enterprise`, `coding`, `mcp-server`, `create-bk-agent`

---

## v0.15.0 (2026-06-04)

### Breaking changes — package rename

All packages now use the `@backendkit-labs` npm scope:

| Old | New |
|-----|-----|
| `@bk/agent-core` | `@backendkit-labs/agent-core` |
| `@bk/agent-coding` | `@backendkit-labs/agent-coding` |
| `@bk/mcp-server` | `@backendkit-labs/mcp-server` |

Migration:

```bash
npm uninstall @bk/agent-core @bk/agent-coding @bk/mcp-server
npm install @backendkit-labs/agent-core @backendkit-labs/agent-coding
```

Replace all imports:

```ts
// Before
import { ... } from '@bk/agent-core';
// After
import { ... } from '@backendkit-labs/agent-core';
```

### New

- `create-bk-agent` — interactive CLI scaffolder (`npx create-bk-agent my-project`)
- 5 starter templates: `coding`, `domain-agent`, `autonomous`, `mcp-server`, `minimal`
- `AgentEngine.updateWorkingDir(newCwd)` — live workspace switch without engine restart
- `/skills create` — scaffold a new skill file locally
- `/skills generate` — LLM-generate a skill from a description
- `/skills reload` — hot-reload skills without restarting
- `/skills uninstall` and `/skills update` — full skill lifecycle management
- `AgentEngine.callLLM(prompt)` — direct single-turn LLM call for slash commands

### Fixed

- `advanceRequiredGates`: only advances gates the task actually requires
- QA gate no longer records a false GO when no qa-engineer agent exists
- Policy engine used `architecture-agent`/`security-agent` IDs that did not match registered profiles — corrected to `architecture`/`security`
- `hasPassedGate`: replaced linear index comparison with FSM-semantics checks
- `computeKeywordScores`: capped at 15 to match confidence normalization denominator
- Workspace `add-app` now syncs `settings.cwd` when the new project becomes active

---

## v0.14.0 (2026-05-30)

- Skills hot-reload: `AgentEngine.reloadSkills()` resets YAML layer on next `run()`
- Orchestration: respect `requiresX` flags in gate advancement
- `matchesKeyword` deduplicated into `orchestration/keyword-match.ts`
- `AgentEngine.callLLM()` for raw single-turn LLM access from slash commands
- QA gate never auto-GO without a real reviewer