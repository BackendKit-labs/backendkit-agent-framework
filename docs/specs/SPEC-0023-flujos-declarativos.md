# SPEC-0023: motor de flujos (definición, ejecución, estado, control y observación)

**Fecha:** 2026-11-16
**Estado:** Borrador. D1-D3 aceptadas con las propuestas (el usuario pidió el spec "como indicas", 2026-11-16); D4-D8 son propuestas nuevas, pendientes. Sin implementar.
**Sustituye a:** [SPEC-0020](SPEC-0020-ejecucion-reanudable.md) (que queda absorbido aquí) y a la primera versión de este SPEC. Es el diseño detallado de F1 de [SPEC-0017](SPEC-0017-un-contrato-por-concepto.md).
**Depende de:** [SPEC-0014](SPEC-0014-puntos-de-extension-del-engine.md) (`ToolPolicy`, `ApprovalStore`), `agent-protocol` 1.1 (`FlowHandler`, `FlowRunState`).
**Tipo de cambio:** por fases. Aditivo hasta F6; la retirada de los runners viejos va en el minor siguiente y es con ruptura.
**Objetivo:** que core tenga **un** motor de flujos con la definición como datos, estado durable, control en vuelo y una vista estándar hacia fuera, de modo que Hermes, `orchestrator-agent`, `enterprise` y orquestadores futuros sean adaptadores de él y no implementaciones paralelas.

## 1. De dónde se parte (verificado en el código el 2026-11-16)

Lo mismo está implementado tres veces, con otros nombres:

| Concepto | `orchestrator-agent` (0.7.7) | Hermes (`bk-platform`) | core |
|---|---|---|---|
| Definición | `TaskPlan`/`StaticFlow`: `id, agent, task, depends_on, gate: boolean, gate_criteria[]` | no define flujos: los **aloja el agente** | `WorkflowDef`: `id, agentId, input, dependsOn, requireApproval`; `enterprise` añade `FlowDefinition` (`after`, `gate: { criteria, evaluator, evidence, approval }`, compensación) |
| Estado de una ejecución | `RunState` (`run-store.ts`): plan, `completedSteps` con su salida, `currentStep`, `waitingGate`, informe; en disco o Redis | `RunRecord` (`store/RunStore.ts`): estado (con `lost`), entrada **enmascarada**, salida tras guardrails, coste, `connectorRunId`; JSON con escritura atómica | resultados en memoria (`WorkflowRunner`) |
| Reanudar | `execute(plan, priorResults)` salta los pasos hechos (se usa tras un gate) | `reconcile()` tras reiniciar: pregunta al agente por cada ejecución abierta → recuperada o `lost` | no hay |
| Exclusión entre procesos | `claim(runId, ttl)`: archivo `wx` con caducidad, o Redis | no la necesita (un plano de control) | no hay |
| Aprobación | `waitingGate` en el estado, `applyGateDecision` | `approver` y `ApprovalStore` | callback `onApprovalRequired` en proceso |
| Control en vuelo | no | pausar, reanudar, cancelar, cooperativo (`FlowControl.step()`/`checkpoint()` en `InProcessFlows`) | no |
| Concurrencia | `Promise.all` sobre los pasos listos, **sin tope**; cola BullMQ por agente (`subtasks.<id>`, worker con `concurrency: 4`, plazo 900 s) | `limits.maxConcurrent` por agente: rechaza con `AGENT_BUSY`, **no encola**; los flujos no cuentan | `WorkflowRunner`: oleadas con `maxConcurrency` (8 por defecto) |

**Corrección respecto a SPEC-0017 y a la primera versión de este SPEC:** no hay "dos runners". `enterprise.FlowRunner` construye un `WorkflowBuilder` y ejecuta un `WorkflowRunner` de core; el esquema, la interpolación, los gates, la compensación y las transiciones viven en `enterprise`. El orquestador tiene su propio `PlanExecutor`, que no reutiliza core.

**La pieza que ya existe y es el contrato hacia fuera:** `agent-protocol` 1.1 define `FlowHandler` (`flows`, `start`, `status`, `pause`, `resume`, `cancel`) y `FlowRunState` (estados `running | paused | done | failed | cancelled`; pasos `pending | running | done | failed | skipped`). El `FlowPort` de Hermes tiene exactamente esa forma, y `serveFlows` (Hermes) la sirve sobre `InProcessFlows`.

Lo que no se verificó: el almacén Redis (`run-store-redis.ts`), `worker-process.ts` ni `server.ts` más allá de sus firmas.

## 2. Principios

1. **Core define contratos y el motor; las apps son adaptadores.** El planner con LLM, la cola entre procesos, el servidor MCP/HTTP, la flota, la salud y los roles no son de core.
2. **Hacia fuera se habla el vocabulario de `agent-protocol`.** No se inventa un segundo `FlowRunState`.
3. **Un flujo es datos.** Un flujo escrito en YAML y un plan que genera un LLM son el mismo objeto.
4. **Dos registros, uno por nivel.** El supervisor (Hermes) guarda "esta capacidad corre" (`RunRecord`). El anfitrión del flujo guarda "este flujo va por el paso 3" (`RunJournal`). Los une `connectorRunId` = `flowRunId`. Hermes no necesita el journal del anfitrión, solo su vista.

## 3. Capas

```
OBSERVAR   FlowRunState (agent-protocol)  ← lo que ven Hermes, una UI u otro orquestador
              ▲  flowRunView(record)          createFlowHandler(flows, journal) → AgentServer
EJECUTAR   runFlow(def, ports)            ← core
              ├─ StepExecutor   cómo corre un paso (un agente, una tool, código propio, un worker remoto)
              ├─ RunJournal     estado durable, claim y reanudación
              ├─ FlowControl    pausar, reanudar, cancelar (cooperativo)
              ├─ ConcurrencyLimiter   tope por flujo, por agente y por tenant
              └─ Approvals / ToolPolicy   SPEC-0014 (ya existe)
DEFINIR    FlowDefinition (datos)         ← YAML, o un plan efímero que genera un planner
```

## 4. Contratos (propuesta)

```ts
interface FlowDefinition {
  flow: string; version: number;
  trigger?: FlowTrigger;                       // lo dispara la app; core solo lo declara
  steps: FlowStep[];
  compensation?: FlowCompensation[];
}
interface FlowStep {
  id: string; after?: string[];
  kind?: 'agent' | 'tool' | 'gate';            // por defecto 'agent' (D2)
  agent?: string; prompt?: string;             // {{payload.x}} en el prompt
  tool?: { name: string; args?: Record<string, unknown> };
  gate?: { criteria?: string[]; evaluator?: string; evidence?: 'required' | 'optional'; approval?: 'human' | 'none' };
  timeoutMs?: number;
}

interface StepExecutor {                       // el integrador lo da; core trae el de un proceso
  run(step: FlowStep, input: { prompt: string; context?: string; idempotencyKey: string; signal: AbortSignal }): Promise<StepOutput>;
}

type StepStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped' | 'awaiting_approval' | 'interrupted';
interface RunRecord {
  runId: string; flow: string; tenantId?: string; startedAt: string; updatedAt: string; finishedAt?: string;
  status: 'running' | 'paused' | 'awaiting_approval' | 'done' | 'failed' | 'cancelled' | 'lost';
  inputPreview: string;                        // enmascarado y cortado, nunca crudo (de Hermes)
  steps: Record<string, { status: StepStatus; output?: string; error?: string; attempt: number; at: string; costUsd?: number }>;
  waiting?: { stepId: string; approvalId: string; criteria?: string[] };   // de `waitingGate` del orquestador
  transitions: FlowTransition[];               // el registro append-only de enterprise
  costUsd?: number;
}
interface RunJournal {
  begin(rec): Promise<void>;
  /** Escribe el cambio ANTES de ejecutar el paso (running) y DESPUÉS (done/failed). Falla cerrado. */
  step(runId, stepId, patch): Promise<void>;
  /** Cierre con caducidad: una persona o un proceso por ejecución. false si otro lo tiene vigente. De `claim` del orquestador. */
  claim(runId, owner, ttlMs): Promise<(() => Promise<void>) | null>;
  get(runId): Promise<RunRecord | undefined>;
  list(filter?: { status?: RunRecord['status'][]; flow?: string; tenantId?: string }): Promise<RunRecord[]>;
}
interface FlowControl {                        // de `InProcessFlows` (Hermes)
  readonly signal: AbortSignal;
  step(name: string, detail?: string): Promise<void>;   // espera aquí si está en pausa; lanza si se canceló
  checkpoint(): Promise<void>;
}
```

### 4.1 Vista hacia fuera

`flowRunView(record): FlowRunState` proyecta el registro al vocabulario del protocolo:

| Estado de core | `FlowStatus` del protocolo 1.1 | Con protocolo 1.2 (D1) |
|---|---|---|
| `running` | `running` | igual |
| `paused` | `paused` | igual |
| `awaiting_approval` | `paused` (motivo en `detail`) | `awaiting_approval` |
| `done` / `failed` / `cancelled` | igual | igual |
| `lost` | `failed` (`error`: "lost") | `lost` |

Paso: `awaiting_approval` e `interrupted` se proyectan como `running`/`failed` con `detail`, hasta 1.2.

`createFlowHandler(flows, journal)` devuelve un `FlowHandler` listo para `AgentServer`: reemplaza a `serveFlows`/`InProcessFlows` de Hermes. Un agente con flujos de core queda controlable por Hermes sin código extra.

## 5. Multitarea

Hoy hay seis niveles de concurrencia, cada uno con su propio tope (o ninguno):

| Nivel | Hoy | Propuesta |
|---|---|---|
| **Dentro de un paso**: tool calls en paralelo | ADR-0001, con `concurrencySafe` | sin cambios |
| **Dentro de un flujo**: pasos listos a la vez | core: oleadas con `maxConcurrency` (8). Orquestador: `Promise.all` **sin tope** | `maxConcurrency` por flujo en el motor (8 por defecto); el orquestador lo hereda y deja de ser ilimitado |
| **Por agente**, entre ejecuciones | Hermes: `limits.maxConcurrent`, rechaza con `AGENT_BUSY`, no encola, y no cuenta flujos | `ConcurrencyLimiter` de core, clave `agentId`, compartido por los pasos de todos los flujos del proceso (D4) |
| **Por tenant** | sin tope | misma interfaz, clave `tenantId` (D4) |
| **Entre procesos** | orquestador: cola BullMQ por agente, worker `concurrency: 4`, plazo 900 s | el motor no trae cola: un `StepExecutor` remoto es el adaptador (D5) |
| **Gates simultáneos** | orquestador: **una a la vez por ejecución** (`waitingGate` único; las demás se difieren) | primera versión igual, por compatibilidad (D6) |

Más:

- **Varias ejecuciones del mismo flujo a la vez:** cada una tiene su `runId`; `claim(runId)` evita que dos procesos reanuden la misma (D7).
- **`ask_agent` (delegación) y los trabajos en segundo plano (`JobRegistry`) no son pasos de flujo:** siguen aparte. Un paso de agente puede usarlos dentro, pero el motor no los cuenta como pasos (D8).
- **Dentro de un flujo un paso que se topa con `maxConcurrent` espera** (acotado por su `timeoutMs`); al **admitir** una ejecución nueva desde fuera se **rechaza** con `AGENT_BUSY`, como hace Hermes. Rechazar un paso a mitad de flujo rompería el flujo por una carga pasajera.

## 6. Decisiones

| # | Pregunta | Propuesta | Estado |
|---|---|---|---|
| D1 | Vocabulario de estados hacia fuera | Ampliar el protocolo a 1.2 de forma aditiva (`awaiting_approval`, `lost`). Hasta entonces, la proyección de §4.1 | Aceptada |
| D2 | Tipos de paso | `agent`, `tool` y `gate`. Sin subflujos, bucles ni condicionales hasta que un caso real los pida | Aceptada |
| D3 | Forma de `RunJournal` | El `RunState` del orquestador (pasos con salida, `waiting`) más los campos de privacidad y coste de Hermes (`inputPreview`, `costUsd`); `redact` opcional y sin valor por defecto (el journal es tan sensible como el historial) | Aceptada |
| D4 | Topes de concurrencia | `ConcurrencyLimiter` con clave `agentId` o `tenantId`, en proceso; `maxConcurrency` por flujo. Un límite distribuido (Redis) lo aporta el integrador implementando la misma interfaz | Propuesta |
| D5 | Ejecución repartida entre procesos | Core define `StepExecutor` y la clave de idempotencia `runId:stepId:attempt`; la cola (BullMQ) es un adaptador de la app. Semántica **al menos una vez**: un paso con efecto externo usa la clave o se marca `interrupted` tras caer | Propuesta |
| D6 | Gates simultáneos | Una a la vez por ejecución en la primera versión (paridad con el orquestador); levantarlo cuando un caso lo pida | Propuesta |
| D7 | Ejecuciones concurrentes de un flujo | Permitidas; `maxActiveRuns` opcional por flujo, con rechazo al admitir | Propuesta |
| D8 | Delegación y trabajos en segundo plano | Fuera del motor | Propuesta |

## 7. Fases

- **F1. `FlowDefinition` en core.** El esquema de `enterprise` se mueve; se añaden los conversores de `StaticFlow` del orquestador (`gate: boolean` + `gate_criteria` → `gate`) y de `TaskPlan`. Test: los YAML de ejemplo de `enterprise` y los `flows/*.yaml` del orquestador validan y dan la misma definición.
- **F2. `runFlow` y `StepExecutor`.** Oleadas, `maxConcurrency`, `ConcurrencyLimiter`, interpolación, gates enchufables, compensación (como hoy: en el orden declarado, tras el flujo). Test de aceptación: los tests de `core/workflow` y de `enterprise/flow` pasan sin cambios contra el motor.
- **F3. `RunJournal` y reanudar.** Implementación en archivo con la técnica de `FileApprovalStore` (publicar con hard link que falla si existe) también para `claim`. Test: matar el proceso entre dos pasos no repite el primero; dos procesos no reanudan la misma ejecución.
- **F4. `FlowControl`, `flowRunView` y `createFlowHandler`.** Se mueven `InProcessFlows` y `serveFlows` de Hermes a core. Test: un agente servido con `AgentServer` se pausa, reanuda y cancela desde un `FlowPort` de Hermes sin cambios en Hermes.
- **F5. Aprobación por paso.** `awaiting_approval` enlaza con el `ApprovalStore` (`{ kind: 'workflow_step', workflow, step, input }`). Test: aprobar reanuda el paso; una regla aprendida `ask` para `flow.step:<id>` lo detiene.
- **F6. Adaptadores.** `orchestrator-agent` (ya en `bk-platform`) cambia su `PlanExecutor` por `runFlow` y su `RunStore` por `RunJournal`; Hermes sustituye `InProcessFlows` por el de core; `enterprise.FlowRunner` queda como una capa fina. Protocolo 1.2.
- **F7. Retirada** de `WorkflowRunner` y `FlowRunner` como obsoletos un minor y luego fuera. Con ruptura.

## 8. Cómo encaja cada uno

| | Pone | Recibe de core |
|---|---|---|
| **Hermes** | flota, salud, roles, aprobación, auditoría, `RunRecord` y `reconcile` | motor de flujos y `createFlowHandler` para los agentes que alojan flujos; el `FlowPort` no cambia |
| **orchestrator-agent** | planner con LLM, matching de flujos por `trigger`, cola BullMQ como `StepExecutor`, MCP/HTTP, auth, RAG | `FlowDefinition`, `runFlow`, `RunJournal`, topes |
| **enterprise** | `ComplianceGate`, `FlowLoader`, triggers | el motor; sus gates implementan `Gate` |
| **Un orquestador futuro** (Temporal, una cola propia, otro planner) | un `StepExecutor` o un `RunJournal` propio | el resto; hacia fuera habla `FlowRunState` |

## 9. Criterios de aceptación

- Un flujo escrito en YAML corre igual en un agente de negocio, en `enterprise` y en el orquestador.
- Matar el proceso en cualquier punto no repite un paso `done` ni reintenta un efecto en curso; dos procesos no reanudan la misma ejecución.
- Hermes controla (inicia, mira, pausa, reanuda, cancela) un flujo de core sin saber que es de core.
- Ningún nivel de concurrencia queda sin tope por defecto (hoy el orquestador lo está).
- La aprobación de un paso usa `ApprovalStore`; un ciclo en `after` se rechaza al cargar.
- Sin `RunJournal` configurado, el flujo corre en memoria como hoy.

## 10. Fuera de alcance

- El planner con LLM, la cola entre procesos, el servidor, la flota, la salud y los roles.
- Un motor durable completo (temporizadores, señales, versionado de definiciones en vuelo): es terreno de Temporal; el integrador implementa `RunJournal` sobre él.
- Bucles, condicionales y subflujos (D2).
- Un editor visual de flujos.
- Reanudar un turno del engine a mitad (el journal es por paso). Depende de SPEC-0004.
