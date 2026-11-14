# SPEC-0014: puntos de extensión del engine

**Fecha:** 2026-11-14
**Estado:** Borrador
**Depende de:** [ADR-0008](../adr/0008-core-define-contratos-verticales-y-apps-fuera.md), [SPEC-0013](SPEC-0013-framework-como-libreria-hoja-de-ruta.md), [SPEC-0011](SPEC-0011-mcp-server-tools-directas.md) (hechos declarados en las tools)
**Tipo de cambio:** aditivo. Nada existente se rompe; `onToolApproval` queda como adaptador obsoleto.
**Objetivo:** que el engine ofrezca una forma genérica de enganchar lógica alrededor de un turno y de cada llamada a tool, con un solo contrato de política, uno de auditoría y uno de aprobación. El engine y `createToolServer` usan los mismos contratos.

## 1. Problema (verificado el 2026-11-14)

- **Sin puntos de enganche, cada caso se mete en el engine como opción propia.** El pipeline de coding entra como `orchestrator` y `qaService` (`AgentEngine.ts:65-76`, `:526-541`, `:1106-1133`). La gobernanza de Steward no tiene dónde entrar y envuelve el `execute` de cada tool (`steward/packages/governed-agent/src/governed-engine.ts:240-260`). Por eso decide **después** de la aprobación y de los guardrails del engine, sin saber qué hicieron.
- **La aprobación no sabe quién llama ni qué hace la tool.** `onToolApproval` recibe un extracto de texto de 200 caracteres (`ApprovalGate.ts:37`). Qué tools piden aprobación lo decide una lista de nombres (`ApprovalGate.ts:14`).
- **Hay tres formas de un mismo concepto.**
  - Auditoría: `AuditRecord` del engine (argumentos en claro), `ToolCallRecord` del servidor de tools (hash) y `AuditEvent` de Steward (hash y decisión).
  - Política: `ToolServerOptions.authorize`, `onToolApproval` y `PolicyProvider.decide` de Steward.

## 2. Ruta de una llamada a tool (actual y propuesta)

Actual (`AgentEngine.ts:1382-1441`):

```
tool desconocida → allowedTools → sandbox (rechazo) → guardrails(args, puede redactar)
  → ApprovalGate (en serie) → execute → guardrails(resultado) → AuditLogger → evento tool_result
```

Propuesta:

```
tool desconocida → allowedTools → sandbox (rechazo) → guardrails(args, puede redactar)
  → policy.decide(principal, call)              ← NUEVO, ve los argumentos ya redactados y los hechos de la tool
      deny             → resultado de rechazo
      ask              → approvals (en serie, en orden de llamada)
      allow            → sigue
  → hooks.beforeTool → execute → hooks.afterTool → guardrails(resultado)
  → audit.write(evento con decisión)            ← AuditSink, siempre (también rechazos)
  → evento tool_result
```

**Decisiones fijadas:**
- La política va **después** de los guardrails de argumentos: decide sobre lo que de verdad se ejecutaría, y no se pide aprobación para una llamada ya bloqueada (mismo criterio que hoy, `AgentEngine.ts:1399`).
- `allowedTools` y el sandbox siguen siendo comprobaciones previas e independientes. La política se añade a ellas, no las reemplaza.
- `policy.decide` corre en paralelo dentro de una oleada de tools. La parte `ask` (aprobación humana) sigue en serie y en orden de llamada (`AgentEngine.ts:1453-1459`).

## 3. Contratos

```ts
// ── Quién actúa ───────────────────────────────────────────────────────────────
interface Principal {
  agentId: string;             // el agente que ejecuta
  sessionId: string;
  /** Cadena de delegación, de quien originó a quien ejecuta: [usuario?, orquestador, especialista]. */
  chain: string[];
  tenantId?: string;
  userId?: string;             // en nombre de quién
  roles?: string[];
  scopes?: string[];
  attributes?: Record<string, unknown>;   // libre: departamento, ámbito...
}
// ExecutionContext.principal: Principal   (nuevo; lo rellena el engine con identity + chain de delegación)
// AgentEngineOptions.identity?: Omit<Principal, 'agentId' | 'sessionId' | 'chain'>

// ── Política ──────────────────────────────────────────────────────────────────
interface ToolCall {
  tool: ToolDefinition;        // con sus hechos: readOnly, destructive, idempotent, openWorld, meta
  args: Record<string, unknown>;
  /** Una persona ya aprobó exactamente esta llamada (reenvío, §6 opción A). */
  approved?: { by: string; approvalId: string };
}
type PolicyDecision =
  | { effect: 'allow'; reason?: string }
  | { effect: 'deny'; reason: string }
  | { effect: 'ask'; reason: string; approver?: string };   // approver: rol o nivel, libre
interface ToolPolicy {
  decide(principal: Principal, call: ToolCall): PolicyDecision | Promise<PolicyDecision>;
}
// AgentEngineOptions.policy?: ToolPolicy | ToolPolicy[]   (varias: deny gana, después ask, después allow)

// ── Aprobación ────────────────────────────────────────────────────────────────
interface ApprovalRequest { id: string; principal: Principal; call: ToolCall; reason: string; approver?: string; createdAt: string }
type ApprovalOutcome = { decision: 'approve' | 'reject'; by: string; note?: string };
interface Approver {
  /** Resuelve en el momento (CLI, UI conectada). Sin approver y con 'ask', la llamada se rechaza (fail-closed). */
  request(req: ApprovalRequest): Promise<ApprovalOutcome>;
}
// AgentEngineOptions.approver?: Approver
// Durable: ver §6.

// ── Auditoría ─────────────────────────────────────────────────────────────────
interface AuditEvent {
  at: string;
  principal: Pick<Principal, 'agentId' | 'sessionId' | 'chain' | 'tenantId' | 'userId'>;
  tool: string;
  argsHash: string;                    // SHA-256 del JSON canónico (hashArgs de core)
  decision: PolicyDecision['effect'] | 'not_found' | 'not_allowed' | 'sandbox_denied' | 'guardrail_blocked';
  reason?: string;
  outcome?: 'ok' | 'error' | 'timeout' | 'aborted' | 'too_large';
  durationMs: number;
  approval?: { id: string; by: string };
  meta?: Record<string, unknown>;      // lo que declare la tool en `meta`
}
interface AuditSink { write(event: AuditEvent): void | Promise<void> }
// AgentEngineOptions.audit?: AuditSink | AuditSink[]
// Implementaciones en core: NdjsonAuditSink(path) (sustituye a AuditLogger), HashChainAuditSink(path, secret?) (sube de Steward), MemoryAuditSink (tests)

// ── Hooks de ciclo de vida ────────────────────────────────────────────────────
interface EngineHooks {
  /** Antes de un turno de usuario. Puede adjuntar estado que verán los demás hooks del mismo turno. */
  beforeRun?(ctx: RunContext): void | Promise<void>;
  /** Secciones que se añaden al system prompt del agente activo, en el orden de registro. */
  systemPrompt?(ctx: RunContext, profile: AgentProfile): string | undefined | Promise<string | undefined>;
  /** El modelo terminó un turno sin pedir tools. 'continue' con otro agente fuerza otra pasada (sustituye a la QA). */
  afterTurn?(ctx: RunContext, turn: { text: string; profile: AgentProfile }):
    void | { action: 'continue'; agentId?: string; message?: string } | Promise<...>;
  beforeTool?(ctx: RunContext, call: ToolCall): void | Promise<void>;
  afterTool?(ctx: RunContext, call: ToolCall, result: { text: string; success: boolean }): void | Promise<void>;
  afterRun?(ctx: RunContext, result: { text: string }): void | Promise<void>;
}
interface RunContext { principal: Principal; input: string; state: Map<string, unknown>; signal: AbortSignal; emit(e: AgentEvent): void }
// AgentEngineOptions.hooks?: EngineHooks[]   (orden de registro; un error en un hook falla el turno: fail-closed)
```

**Límites del hook `afterTurn`:** cuenta contra `maxIterations` y respeta el mismo tope de vueltas que hoy tiene la QA (`maxRework`, SPEC-0010).

## 4. Regla de aprobación por defecto, por hechos

Sin `policy` configurada se aplica `defaultToolPolicy`, que reproduce el comportamiento actual sin nombres de tools:
- `readOnly: true` → `allow`.
- `destructive: true` → `ask`.
- Sin hechos declarados → `ask`, solo si hay `approver` y el modo de iteración lo exige (hoy `WRITE_TOOLS`).

**Pregunta abierta (decidir en F2 con un test):** ¿`write_file` es `destructive`? `destructive` implica que no se puede deshacer y prohíbe `concurrencySafe`. Escribir un archivo del workspace no encaja del todo. La alternativa es una regla "no `readOnly` ⇒ `ask`" y que las tools de coding declaren `readOnly` cuando corresponda. Lo que se decida queda documentado aquí.

La detección de instalación de paquetes (`package-install.ts`) no es una regla por hechos: pasa a ser una `ToolPolicy` del vertical de coding (SPEC-0015 F3).

## 5. Unificación con el servidor de tools (SPEC-0011)

- `ToolServerOptions.authorize` pasa a aceptar también una `ToolPolicy`. `authorize(info)` se mantiene como atajo y se adapta a `{ decide: … ⇒ allow | deny }`. Un `ask` sin `approver` en el servidor equivale a `deny`.
- `ToolServerOptions.audit` recibe el `AuditEvent` de §3. `ToolCallRecord` queda como alias obsoleto.
- `hashArgs` sigue siendo el de core.
- **Hay que decidir si #166 se publica tal cual o se alinea antes con este contrato.** Ver §8.

## 6. Aprobación durable (decisión abierta)

| | Opción A: reenvío | Opción B: suspender y reanudar el loop |
|---|---|---|
| Cómo funciona | Con `ask`, el engine guarda la `ApprovalRequest` en un `ApprovalStore` y devuelve al modelo "pendiente de aprobación (id)". Cuando alguien aprueba, la llamada se reenvía con `approved` y la política responde `allow`. | El turno se suspende, se persiste y se reanuda al llegar la aprobación |
| Depende de | `ApprovalStore` (interfaz + implementación en archivo con escritura atómica) | SPEC-0004 (`agent-session`, borrador): sin un log de sesión reanudable no es viable |
| Quién la usa hoy | Steward (`ToolCallContext.approved`) | nadie |
| Coste | bajo | alto |

```ts
interface ApprovalStore {
  put(req: ApprovalRequest): Promise<void>;
  get(id: string): Promise<(ApprovalRequest & { outcome?: ApprovalOutcome }) | undefined>;
  resolve(id: string, outcome: ApprovalOutcome): Promise<void>;
  list(filter?: { status?: 'pending' | 'resolved'; agentId?: string }): Promise<ApprovalRequest[]>;
}
```

La recomendación es la opción A ahora, dejando abierta la B para cuando SPEC-0004 exista. **La decisión es del usuario.**

## 7. Migración de los consumidores reales

| Consumidor | Hoy | Con este SPEC |
|---|---|---|
| Pipeline de coding de core (`orchestrator` + QA) | opciones del engine | hooks `beforeRun` + `systemPrompt` + `afterTurn` (se implementa en SPEC-0015 F1; aquí solo se comprueba que se puede expresar) |
| `onToolApproval` (CLI, web) | callback con extracto de texto | adaptador `approverFromCallback(onToolApproval)`; `@deprecated`, se retira en 0.40 |
| `auditLog: string` | `AuditLogger` | adaptador a `NdjsonAuditSink`; `@deprecated` |
| Steward `createGovernedAgent` | envuelve `execute` | `policy: PolicyProvider adaptado` + `audit: HashChainAuditSink` + `identity`. Se comprueba en papel: cada campo de `AgentPrincipal`/`ToolCallContext`/`Decision`/`AuditEvent` tiene su sitio (tabla en F4). La migración real queda aplazada |
| `createToolServer` | `authorize` / `audit` propios | §5 |

## 8. Fases

- **F0. Base común.** `hashArgs` y `isLoopbackRequest` en un solo sitio de core; `mcp-server` y `mcp-connectors` los importan (D6).
- **F1. Contratos y `AuditSink`.** Tipos de §3; `NdjsonAuditSink`, `MemoryAuditSink` y `HashChainAuditSink` con `verifyAuditChain`; el engine escribe `AuditEvent` en todos los resultados, incluidos los rechazos. Adaptador de `auditLog`.
- **F2. Política y aprobación.** `policy.decide` en la ruta de §2, `defaultToolPolicy` (§4, se cierra la pregunta abierta), `Approver`, adaptador de `onToolApproval`, `ExecutionContext.principal` y propagación de `chain` en `ask_agent`.
- **F3. Hooks.** `EngineHooks` con los seis puntos y su orden; test que reproduce el pipeline de coding solo con hooks (sin tocar todavía sus opciones).
- **F4. Unificación con el servidor de tools** (§5) y tabla de correspondencia con Steward.
- **F5. Aprobación durable** según la opción elegida en §6.

**Decisión pendiente antes de F4:** si #166 se publica como está (con `authorize` y `ToolCallRecord`) y F4 los adapta, o si se alinea antes de publicar. Lo primero publica ya algo que se va a marcar obsoleto; lo segundo retrasa la publicación.

## 9. Criterios de aceptación

- Ningún tipo nuevo nombra una tool, un agente o un dominio.
- El pipeline de coding se puede expresar solo con hooks y política (test de F3).
- Cada campo de Steward tiene su lugar (tabla de F4).
- Toda llamada, aceptada o rechazada, produce exactamente un `AuditEvent`.
- Ningún argumento aparece en claro en la auditoría.

## 10. Fuera de alcance

- Quitar las opciones `orchestrator` y `qaService` (lo hace SPEC-0015).
- Implementar un PDP concreto, un registro de agentes o la emisión de tokens: son producto (Steward).
