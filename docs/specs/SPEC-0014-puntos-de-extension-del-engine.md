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
  /** Alguien ya aprobó exactamente esta llamada (reenvío, §6). Solo lo pone quien guarda la aprobación al ejecutarla. */
  approved?: { by: ApproverRef; approvalId: string };
}
type PolicyDecision =
  | { effect: 'allow'; reason?: string;
      /** Cómo se ejecuta lo permitido. 'sandboxed' fuerza el SandboxRunner aunque la tool no lo pida;
       *  'dry_run' ejecuta con ctx.dryRun = true (la tool simula y no escribe). Por defecto 'run'. */
      mode?: 'run' | 'sandboxed' | 'dry_run' }
  | { effect: 'deny'; reason: string }
  | { effect: 'ask'; reason: string;
      /** A quién se dirige: rol, nivel o departamento. Libre; lo interpreta quien enruta (p. ej. Hermes). */
      approver?: string;
      /** Qué tipos de aprobador valen. Por defecto, cualquiera. Lo `destructive` exige ['human'] (§6.2). */
      accepts?: ApproverKind[] };
// ExecutionContext.dryRun?: boolean   (nuevo; una tool que escribe y no lo soporta debe rechazar dry_run)
interface ToolPolicy {
  decide(principal: Principal, call: ToolCall): PolicyDecision | Promise<PolicyDecision>;
}
// AgentEngineOptions.policy?: ToolPolicy | ToolPolicy[]   (varias: deny gana, después ask, después allow)

// ── Aprobación ────────────────────────────────────────────────────────────────
// Genérica en dos sentidos: qué se aprueba (cualquier acción, no solo una tool) y quién aprueba
// (una persona, otro agente o un servicio como Hermes).
type ApproverKind = 'human' | 'agent' | 'service';
interface ApproverRef {
  kind: ApproverKind;
  id: string;                 // usuario, agentId o nombre del servicio
  chain?: string[];           // si es un agente: su cadena de delegación
}
type ApprovalSubject =
  | { kind: 'tool_call'; call: ToolCall }                                    // cualquier tool de cualquier dominio
  | { kind: 'workflow_step'; workflow: string; step: string; input: unknown }  // SPEC-0017 F1
  | { kind: 'rule_proposal'; rule: unknown; evidence: string }               // autoaprendizaje, SPEC-0017 F6
  | { kind: string; payload: unknown; summary: string };                     // abierto: un vertical define los suyos
interface ApprovalRequest {
  id: string; principal: Principal; subject: ApprovalSubject; reason: string;
  approver?: string; accepts?: ApproverKind[]; createdAt: string;
}
type ApprovalOutcome = { decision: 'approve' | 'reject'; by: ApproverRef; reason?: string; at: string };
interface Approver {
  /** Quién es este aprobador. Se usa para comprobar las reglas de §6.2 antes de aceptar su respuesta. */
  readonly ref?: ApproverRef;
  /** Resuelve en el momento (CLI, UI conectada, agente supervisor). Sin approver y con 'ask', la acción queda pendiente en el ApprovalStore (§6). */
  request(req: ApprovalRequest): Promise<ApprovalOutcome>;
}
// AgentEngineOptions.approver?: Approver
// AgentEngineOptions.approvals?: ApprovalStore   (§6)
// Implementaciones en core: consoleApprover (persona por CLI), agentApprover(engine, agentId) (otro agente vía delegación),
// approverFromCallback(onToolApproval) (compatibilidad). Hermes implementa ApprovalStore y/o Approver como servicio.

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
  approval?: { id: string; by: ApproverRef };   // siempre con el tipo: persona, agente o servicio
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

## 4. Regla de aprobación por defecto, por hechos (decidida el 2026-11-14)

**Precedencia (implementada en F2).** La ruta nueva se activa al configurar `policy`, `approver` o `approvals`. Sin ninguna de las tres, la ruta legada sigue exactamente como estaba, para no cambiar qué pregunta la CLI de coding mientras sus tools no declaran `readOnly` (eso se hace en SPEC-0015 F3).

| Configurado | Ruta | Quién decide qué se pregunta |
|---|---|---|
| Ninguno de `policy`, `approver`, `approvals` (con o sin `onToolApproval`) | Legada, `ApprovalGate` sin cambios | `WRITE_TOOLS` e instalación de paquetes |
| `policy`, `approver` o `approvals` | Nueva | La `policy` dada; sin ella, `defaultToolPolicy` si hay a quién preguntar |

En la ruta nueva:
- **Aprobador:** se usa `opts.approver`. Si no se configura, se adapta `onToolApproval`.
- **Instalación de paquetes:** `packageInstallPolicy` siempre se combina, y siempre pregunta a una persona. Se moverá a coding en SPEC-0015 F3.
- **Sandbox:** un `approvalFor() === 'ask'` del sandbox suma un `ask`. Si no hay aprobador, la llamada queda en `SANDBOX_DENIED`.
- **"Aprobar todo"** del callback: lo guarda el adaptador, y nunca cubre lo `destructive` ni lo que solo acepta personas.

`defaultToolPolicy` ya no depende de nombres de tools:
- `readOnly: true` → `allow`.
- Todo lo demás → `ask`, si hay `approver` y el modo de iteración pide aprobación. Esto incluye las tools `destructive` y las que no declaran nada. Sin `approver`, se mantiene el comportamiento actual: se ejecuta, salvo que la política del sandbox exija aprobación.
- `destructive: true` → `ask` con `accepts: ['human']`, **siempre**, también en el modo "aprobar todo" (como hoy la instalación de paquetes). Lo irreversible nunca se aprueba en bloque ni lo aprueba un agente o un servicio.

**Decisión del usuario: regla "no `readOnly` ⇒ pedir aprobación".** `write_file` no se marca `destructive`: escribir un archivo se puede deshacer. Las tools de coding declaran `readOnly` cuando corresponde (`read_file`, `search_files`, `list_directory`...). Si alguien olvida declarar los hechos de una tool, se pregunta de más, nunca de menos.

La detección de instalación de paquetes (`package-install.ts`) no es una regla por hechos: pasa a ser una `ToolPolicy` del vertical de coding (SPEC-0015 F3).

## 5. Unificación con el servidor de tools (SPEC-0011)

- `ToolServerOptions.authorize` pasa a aceptar también una `ToolPolicy`. `authorize(info)` se mantiene como atajo y se adapta a `{ decide: … ⇒ allow | deny }`. Un `ask` sin `approver` en el servidor equivale a `deny`.
- `ToolServerOptions.audit` recibe el `AuditEvent` de §3. `ToolCallRecord` queda como alias obsoleto.
- `hashArgs` sigue siendo el de core.
- **Hay que decidir si #166 se publica tal cual o se alinea antes con este contrato.** Ver §8.

## 6. Aprobación durable (decidida el 2026-11-14: opción A, reenvío)

Vale para **cualquier** `ApprovalSubject` (§3): una llamada a tool de cualquier dominio, un paso de workflow, una regla propuesta por el autoaprendizaje o lo que defina un vertical. El problema es el mismo en todos los casos: la persona que debe aprobar no está en el momento en que el agente lo pide.

| | Opción A: reenvío | Opción B: suspender y reanudar el loop |
|---|---|---|
| Cómo funciona | Con `ask`, el engine guarda la `ApprovalRequest` en un `ApprovalStore` y devuelve al modelo "pendiente de aprobación (id)". Cuando alguien aprueba, la llamada se reenvía con `approved` y la política responde `allow`. | El turno se suspende, se persiste y se reanuda al llegar la aprobación |
| Depende de | `ApprovalStore` (interfaz + implementación en archivo con escritura atómica) | SPEC-0004 (`agent-session`, borrador): sin un log de sesión reanudable no es viable |
| Quién la usa hoy | Steward (`ToolCallContext.approved`) | nadie |
| Coste | bajo | alto |

```ts
type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'executed';
interface StoredApproval extends ApprovalRequest { status: ApprovalStatus; outcome?: ApprovalOutcome; executedAt?: string }
interface ApprovalStore {
  put(req: ApprovalRequest): Promise<void>;
  get(id: string): Promise<StoredApproval | undefined>;
  /** Una sola decisión por id; la segunda falla. */
  resolve(id: string, outcome: ApprovalOutcome): Promise<StoredApproval>;
  /** Marca ejecutada una aprobación, de forma atómica y como mucho una vez; false si ya lo estaba. */
  markExecuted(id: string): Promise<boolean>;
  list(filter?: { status?: ApprovalStatus; agentId?: string }): Promise<StoredApproval[]>;
}
```

### 6.1 Decisión: opción A

**Decisión del usuario: opción A, reenvío.** Cuando una acción necesita aprobación y nadie responde en el momento, se guarda la `ApprovalRequest` en el `ApprovalStore` y el turno sigue o termina. El modelo recibe "pendiente de aprobación (id)". Cuando llega la decisión, quien guarda la aprobación ejecuta la acción con `approved` (para `tool_call`) o reanuda lo que corresponda (paso de workflow, alta de regla). La política vuelve a decidir con `approved` puesto. Solo se salta el `ask`; el resto de comprobaciones se repiten (alcances, cuotas, sandbox), igual que en Steward.

Razones:
- Funciona con aprobadores asíncronos: una persona que tarda horas, otro agente u Hermes.
- Hermes ya trabaja así (`hermes-server/src/actions.ts`, `pg-approvals.ts`: pendientes persistidos, decisión única por id, reasignación y prueba firmada).
- No depende de SPEC-0004.

La opción B (suspender y reanudar) queda descartada por ahora. Se reconsidera solo si SPEC-0004 llega a existir y aparece un caso que el reenvío no cubra.

**Quién ejecuta lo aprobado:** el SDK expone `resumeApproved(store, id, engineOrRunner)` para ejecutar una acción ya aprobada. En Steward lo hace Hermes. Ejecutar dos veces la misma aprobación es imposible: el store marca la petición como ejecutada de forma atómica (en archivo con `atomicWrite` y, en Hermes, en Postgres).

### 6.2 Quién puede aprobar y reglas de seguridad

Aprobador puede ser una persona (`human`), otro agente (`agent`) o un servicio como Hermes (`service`). El engine valida cada `ApprovalOutcome` antes de aceptarla, y si una regla falla la trata como `reject` y lo audita:

1. **Tipo aceptado:** `by.kind` debe estar en `accepts` de la decisión `ask`. `defaultToolPolicy` pone `accepts: ['human']` para lo `destructive`: lo irreversible solo lo aprueba una persona.
2. **Nadie se aprueba a sí mismo:** `by.id` no puede ser el agente que pidió la acción ni nadie de su `principal.chain`.
3. **Un agente no aprueba más de lo que puede hacer:** si `by.kind === 'agent'`, la política se evalúa también con ese agente como principal sobre el mismo `subject`. Si a él no le daría `allow` (o un `ask` que él mismo satisface), su aprobación no vale. Es la regla de Steward: el delegado nunca supera al que delega.
4. **Trazabilidad:** toda aprobación queda en la auditoría con `by` completo (tipo, id y cadena si es un agente) y su motivo. Las aprobaciones de un agente se auditan igual que las de una persona.

Un servicio (`service`, como Hermes) puede aprobar por regla (por ejemplo, montos menores a un umbral) o derivar la petición a una persona o a un agente. Las reglas 1 a 4 se aplican igual: un servicio no aprueba lo que `accepts` reserva a personas.

## 7. Migración de los consumidores reales

| Consumidor | Hoy | Con este SPEC |
|---|---|---|
| Pipeline de coding de core (`orchestrator` + QA) | opciones del engine | hooks `beforeRun` + `systemPrompt` + `afterTurn` (se implementa en SPEC-0015 F1; aquí solo se comprueba que se puede expresar) |
| `onToolApproval` (CLI, web) | callback con extracto de texto | adaptador `approverFromCallback(onToolApproval)`; `@deprecated`, se retira en 0.40 |
| `auditLog: string` | `AuditLogger` | **Se mantiene sin cambios**, con el mismo formato de archivo, marcado `@deprecated` y retirado en 0.40. No se convierte en `NdjsonAuditSink`: eso cambiaría el formato de un archivo que alguien puede estar leyendo. La auditoría nueva es la opción `audit`, que recibe `AuditEvent` y nunca los argumentos en claro (implementado en F1) |
| Steward `createGovernedAgent` | envuelve `execute` | `policy: PolicyProvider adaptado` + `audit: HashChainAuditSink` + `identity`. Se comprueba en papel: cada campo de `AgentPrincipal`/`ToolCallContext`/`Decision`/`AuditEvent` tiene su sitio (tabla en F4). La migración real queda aplazada |
| `createToolServer` | `authorize` / `audit` propios | §5 |

## 8. Fases

- **F0. Base común. Hecho.** `hashArgs` y `canonicalJson` en `shared/utils/canonical-json.ts`, e `isLoopbackRequest` en `shared/utils/loopback.ts`. `mcp-server` lo reexporta de core. `mcp-connectors` conserva su copia porque no depende de core (D6).
- **F1. Contratos y `AuditSink`. Hecho.**
  - **Tipos:** los de §3, en `governance/types.ts`.
  - **Sinks** en `governance/audit.ts`: `MemoryAuditSink`, `NdjsonAuditSink` y `HashChainAuditSink`, este último con `verifyAuditChain`, `verifyAuditSegment` y HMAC opcional (mismo esquema que Steward).
  - **Engine:** `audit` e `identity` en `AgentEngineOptions` y en `createBaseEngine`. Escribe exactamente un `AuditEvent` por llamada: permitida, fallida, con timeout, inexistente, no autorizada, rechazada, bloqueada por guardrail o por el sandbox. Las decisiones del sandbox durante la llamada van dentro del mismo evento (`sandbox[]`). `ask_agent` también se audita, y la autodelegación queda como `not_allowed`.
  - **`auditLog`:** sin cambios (§7).
  - **Fallos de un sink:** se avisan en el transport y no alteran el resultado.
  - En F1 la cadena del principal es `[agentId]`; F2 la propaga en las delegaciones.
- **F2. Política y aprobación. Hecho.**
  - **Ruta de §2:** la política decide sobre los argumentos ya pasados por los guardrails. Las decisiones `ask` van en serie y en orden de llamada.
  - **Piezas:** `defaultToolPolicy`, `combineDecisions` y `evaluatePolicies` (una política que lanza error deniega), además de `approverFromCallback` y `approvalProblem`.
  - **Contexto de cada tool:** `ExecutionContext.principal` y `ExecutionContext.dryRun`.
  - **Cadena de delegación:** se propaga por `DelegationBus` (`chain`), `runAgentInternal` y `ctx.askAgent`. La cadena lista solo agentes; `userId` va en su propio campo.
  - **Delegaciones:** `ask_agent` también pasa por la política. Se declara `readOnly`, así que la política por defecto la deja pasar.
  - **Modo `sandboxed`:** sin sandbox configurado se deniega.
  - **Sin nadie a quién preguntar:** si hay `approvals`, la llamada queda pendiente y no se ejecuta; si no, se rechaza.
  - **`approved`:** nunca se toma de los argumentos del modelo.
  - **Tests:** las cuatro reglas de §6.2, cada una con el suyo. Los tests anteriores de aprobación, sandbox y `allowedTools` pasan sin cambios.
- **F3. Hooks. Hecho.**
  - **Dónde:** `EngineHooks` en `governance/hooks.ts`, con las opciones `hooks` y `maxHookContinues` en el engine y en `createBaseEngine`.
  - **Orden:** los seis puntos se ejecutan en orden de registro. El `RunContext` (principal, input, `state` y `signal`) se comparte durante todo el turno, y `engine.abort()` aborta su `signal`.
  - **`systemPrompt`:** añade secciones al prompt del agente activo y al de los delegados.
  - **`afterTurn`:** solo en el loop principal. Gana el primero que pide `continue`, y puede cambiar de agente y añadir un mensaje. Tiene un tope de 5 pasadas por turno, además de `maxIterations`.
  - **`beforeTool` y `afterTool`:** solo envuelven las llamadas que la política permitió. `afterTool` recibe el resultado ya pasado por los guardrails.
  - **Errores:** si un hook lanza, falla el turno y el error nombra el hook y el punto. Si es `beforeTool`, la tool no se ejecuta.
  - **Criterio de aceptación cumplido:** un test reproduce el pipeline de coding solo con hooks. Clasifica en `beforeRun`, pone el brief en `systemPrompt` solo para el orquestador, y en `afterTurn` hace una revisión de QA con un veredicto guardado en `state`.
  - **Fuera de F3:** el mapeo real del `Orchestrator` y el `QAService` a hooks es SPEC-0015 F1.
- **F4. Unificación con el servidor de tools** (§5) y tabla de correspondencia con Steward.
- **F5. Aprobación durable (opción A).** `ApprovalStore` con implementación en archivo (`atomicWrite`, una sola decisión y una sola ejecución por id), `resumeApproved`, `agentApprover` y `consoleApprover`. Tests:
  - una acción pendiente sobrevive a un reinicio y se ejecuta una sola vez al aprobarse;
  - un agente supervisor aprueba un paso no destructivo y no puede aprobar uno `destructive`.
  - Comparación en papel con el `ApprovalStore` de Hermes (`hermes-server/src/pg-approvals.ts`).

**#166 se publica como está (decidido el 2026-11-14).**
- **Compatibilidad verificada:** los 12 paquetes de Steward que dependen de `agent-core` compilan contra el core de #166. Se comprobó con un `tsconfig` temporal que resuelve el core local. Los paquetes son `governed-agent`, `knowledge`, `hermes`, `hermes-server`, `agent-accounting` y los 7 agentes contables.
- **Coste de migración:** ningún consumidor usa todavía `authorize` ni `ToolCallRecord`. Cuando F4 los adapte, nadie tendrá que migrar.
- **Correspondencia con Steward:** el vocabulario de hechos coincide con sus manifiestos (`readOnly`, `idempotent`). Sus modos `sandboxed` y `dry_run` (`governance/types.ts:10`) se cubren con `PolicyDecision.allow.mode` (§3).

## 9. Criterios de aceptación

- Ningún tipo nuevo nombra una tool, un agente o un dominio.
- El pipeline de coding se puede expresar solo con hooks y política (test de F3).
- Cada campo de Steward tiene su lugar (tabla de F4).
- Toda llamada, aceptada o rechazada, produce exactamente un `AuditEvent`.
- Ningún argumento aparece en claro en la auditoría.

## 10. Fuera de alcance

- Quitar las opciones `orchestrator` y `qaService` (lo hace SPEC-0015).
- Implementar un PDP concreto, un registro de agentes o la emisión de tokens: son producto (Steward).
