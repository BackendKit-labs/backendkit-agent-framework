# Plan de Remediación — Auditoría de Seguridad y Calidad

Generado: 2026-05-31  
Basado en: auditoría completa del codebase agent-framework  
Seguimiento: marcar cada ítem con ✅ al completar + commit SHA

---

## Prioridades

| Nivel | Significado |
|-------|-------------|
| 🔴 Crítico | Explotable en producción — atacar primero |
| 🟠 Alto | Riesgo real, debe resolverse antes del próximo release |
| 🟡 Medio | Acoplamiento / deuda técnica significativa |
| ⚪ Bajo | Mejora de calidad / consistencia |

---

## 🔴 Críticos

### C1 — `run_command`: allowlist trivialmente evadible
**Archivos:** `packages/coding/src/tools/run-command.ts`  
**Problema:** `extractBin()` solo valida el primer token. Con `shell: true` todo lo que siga a `&&`, `|`, `;` se ejecuta sin restricción. `echo ok && rm -rf ~` pasa el allowlist.  
**Fix:**
- [ ] Tokenizar la cadena por `;`, `&&`, `||`, `|`, `` ` ``, `$()` y validar el binario de cada segmento, **o**
- [ ] Cambiar a `execFile` / `spawn` sin `shell: true` con args parseados, **o**
- [ ] Documentar explícitamente que `run_command` no es límite de seguridad y forzar siempre `onToolApproval` para este tool (sin importar modo)
- [ ] Añadir test unitario que intente bypass de allowlist con pipes/`&&`

**Commit target:** `fix(run-command): close allowlist bypass via shell chaining`

---

### C2 — `run_command`: el parámetro `cwd` no pasa por el sandbox
**Archivos:** `packages/coding/src/tools/run-command.ts:55-98`  
**Problema:** `parseCdAndCommand` y el param `cwd` se resuelven con `path.resolve()` sin `resolveAndCheck()`. `cwd: "../../secrets"` ejecuta el comando fuera del working dir.  
**Fix:**
- [ ] Llamar `resolveAndCheck(baseDir, effectiveCdDir)` antes de construir `workDir`
- [ ] Añadir test: `cwd: "../outside"` debe retornar `Error: Access denied`

**Commit target:** `fix(run-command): apply path sandbox to cwd parameter`

---

### C3 — Sandbox de rutas roto en Windows (rutas cross-drive y UNC)
**Archivos:** `packages/coding/src/tools/path-sandbox.ts`  
**Problema:** `relative('C:\\work', 'D:\\secrets')` retorna `'D:\\secrets'` (no empieza con `..`), así que la verificación lo aprueba. Cualquier ruta absoluta en otra unidad escapa el sandbox.  
**Fix:**
- [ ] Después de `resolve()`, comparar que `abs` comience con `cwd + path.sep` (o `cwd` si `abs === cwd`)
- [ ] Agregar check de `path.isAbsolute(rel)` como salvaguarda adicional
- [ ] Tests: rutas `D:\\outside`, `\\\\server\\share`, rutas absolutas de otra unidad

**Commit target:** `fix(path-sandbox): block cross-drive and UNC path traversal on Windows`

---

### C4 — Gate de aprobación humana no cubre sub-agentes
**Archivos:** `packages/core/src/engine/AgentEngine.ts` — `runLoop` vs `runAgentInternal`  
**Problema:** `onToolApproval` y el chequeo de `allowedTools` existen en `runLoop` pero **no** en `runAgentInternal`. Como `general` delega via `ask_agent`, toda escritura real ocurre en sub-agentes que omiten el gate.  
**Fix:**
- [ ] Extraer `executeTool(call, toolDef, profile)` como método privado compartido que incluya: autorización por `allowedTools` + gate `onToolApproval` + `writeAuditRecord`
- [ ] Usar ese método en ambos `runLoop` y `runAgentInternal`
- [ ] `buildContext()` en `runAgentInternal` debe usar el `agentId` del sub-agente, no `currentAgentId`
- [ ] Test: con `onToolApproval` configurado, llamada desde sub-agente debe disparar el callback

**Commit target:** `fix(engine): apply approval gate and authorization to sub-agent tool calls`

---

### C5 — `run_command` en `READ_ONLY_TOOLS`
**Archivos:** `packages/coding/src/agents/profiles.ts:15`  
**Problema:** `const READ_ONLY_TOOLS = [..., 'run_command', ...]` — etiqueta engañosa y el agente `data` recibe capacidad de ejecución no intencionada.  
**Fix:**
- [ ] Crear `EXEC_TOOLS = ['run_command']` separado
- [ ] Ajustar los perfiles que necesitan ejecutar comandos para incluirlo explícitamente
- [ ] Revisar si `data` realmente necesita `run_command`

**Commit target:** `fix(profiles): remove run_command from READ_ONLY_TOOLS set`

---

## 🟠 Altos

### A1 — Normalización de comandos Windows corrompe argumentos
**Archivos:** `packages/coding/src/tools/run-command.ts:84-94`  
**Problema:** Los `.replace(/\bcat\b/g, 'type')` actúan sobre toda la cadena. `grep cat file.ts` → `grep type file.ts`; `ls my-catalog/` → corrupto. `\b` trata `-` como frontera.  
**Fix:**
- [ ] Mapear solo el primer token (binario), no la cadena completa
- [ ] Tests en plataforma Windows o mocks: comando con la subcadena en args no debe transformarse

**Commit target:** `fix(run-command): scope Windows command normalization to binary only`

---

### A2 — Reintentos MCP con tope global rompen registro tardío de servidores
**Archivos:** `packages/core/src/engine/AgentEngine.ts:300-341`  
**Problema:** `mcpInitAttempts` se incrementa en cada `run()`. Tras 3 mensajes, un servidor que arranca tarde nunca se registra aunque ya esté online.  
**Fix:**
- [ ] Separar "registrar servidores recién conectados" del límite de reintentos (el registro debe ocurrir siempre si hay nuevos conectados)
- [ ] Contar fallos reales (servidores que siguen offline), no llamadas a `run()`
- [ ] Opcionalmente exponer `engine.retryMCP()` para reintentar manualmente

**Commit target:** `fix(mcp): decouple server registration from retry counter`

---

### A3 — WebhookServer sin límite de tamaño de body
**Archivos:** `packages/core/src/triggers/WebhookServer.ts:86-93`  
**Problema:** `readBody` acumula chunks sin tope — un POST gigante agota memoria (DoS). La verificación HMAC corre después de leer todo el body.  
**Fix:**
- [ ] Trackear bytes acumulados en `readBody`; si supera el límite (default 1 MB), llamar `req.destroy()` y retornar 413
- [ ] Hacer el límite configurable en el constructor

**Commit target:** `fix(webhook): add request body size limit to prevent memory DoS`

---

## 🟡 Medios

### M1 — IDs de agente hardcodeados en core
**Archivos:** `packages/core/src/engine/qa-orchestrator.ts`  
**Problema:** Usa `'general'`, `'qa-engineer'`, `'architecture'`, `'security'` como strings literales. El core genérico está acoplado a los IDs del paquete `coding`.  
**Fix:**
- [ ] Agregar a `QaContext` campos `defaultAgentId: string` y opcionalmente `gateAgentIds`
- [ ] Pasar `defaultAgentId` desde `AgentEngine` al construir el contexto QA
- [ ] Reemplazar strings hardcodeados por las referencias de contexto

**Commit target:** `refactor(qa-orchestrator): parameterize hardcoded agent IDs`

---

### M2 — `DelegationBus.parentMessages` es acoplamiento muerto
**Archivos:** `packages/core/src/delegation/DelegationBus.ts:28`  
**Problema:** `parentMessages` se recibe en opciones pero nunca se usa. Además `AgentEngine` lo pasa por referencia y luego `trimHistory()` reasigna `this.messages`, dejando la ref obsoleta.  
**Fix:**
- [ ] Eliminar `parentMessages` de `DelegationBusOptions` y del constructor de `AgentEngine`

**Commit target:** `refactor(delegation-bus): remove unused parentMessages`

---

### M3 — Descripción de `ask_agent` no refleja la implementación
**Archivos:** `packages/core/src/engine/AgentEngine.ts:82-95`  
**Problema:** El tool describe "waves de max 6 agentes" pero la implementación usa `Promise.all` con bulkhead; no hay olas discretas. El modelo recibirá instrucciones incorrectas.  
**Fix:**
- [ ] Actualizar descripción del tool para reflejar el comportamiento real (concurrencia continua con límite de slots)

**Commit target:** `fix(engine): correct ask_agent tool description to match bulkhead implementation`

---

### M4 — `buildContext()` reporta `agentId` incorrecto en sub-agentes
**Archivos:** `packages/core/src/engine/AgentEngine.ts:764-777`  
**Problema:** `buildContext()` siempre usa `this.currentAgentId` (el orquestador). En `runAgentInternal` el contexto del tool debería reportar el ID del sub-agente.  
**Nota:** parcialmente cubierto por C4 (si se extrae `executeTool`, se puede pasar el `profile.id` correcto).

**Commit target:** cubierto en `fix(engine): apply approval gate and authorization to sub-agent tool calls` (C4)

---

### M5 — Tokens de sub-agentes siempre retornan 0
**Archivos:** `packages/core/src/engine/AgentEngine.ts:725`  
**Problema:** `DelegationResult` retorna `inputTokens: 0, outputTokens: 0` hardcodeado; los tokens no se acumulan por agente.  
**Fix:**
- [ ] Acumular tokens en `runAgentInternal` (ya llegan por `onMetrics`)
- [ ] Retornar los valores reales en `DelegationResult`

**Commit target:** `fix(engine): propagate token counts from sub-agent delegations`

---

### M6 — Comentario stale del separador MCP + bug de nombre no saneado
**Archivos:** `packages/core/src/mcp/MCPClientManager.ts:30`, `packages/core/src/engine/AgentEngine.ts:172`  
**Problema:**  
1. Comentario dice `mcp:{server}:{tool}` pero el código usa `mcp__{safeName}__{tool}`  
2. `AgentEngine.ts:172` construye el nombre como `mcp__${mcpRoute.agentId}__${mcpRoute.tool}` usando `config.name` original (no `safeName`) → tool no encontrado si el nombre tiene caracteres especiales.  
**Fix:**
- [ ] Actualizar comentario en `MCPClientManager.ts`
- [ ] En `AgentEngine.registerMCPAgent()` guardar el `safeName` en el perfil del agente y usarlo en `findMCPRoute`/`runLoop`

**Commit target:** `fix(mcp): use safeName consistently for tool lookup`

---

### M7 — `ConfigLoader.save()` no aplica chmod 600
**Archivos:** `packages/coding/src/config/ConfigLoader.ts:188-190`  
**Problema:** El bootstrap aplica `chmod 600` al crear `config.json`, pero `save()` puede sobrescribirlo sin restringir permisos en POSIX.  
**Fix:**
- [ ] Llamar `chmodSync(this.configPath, 0o600)` al final de `save()` en plataformas no-Windows

**Commit target:** `fix(config): re-apply chmod 600 after save() on POSIX`

---

## ⚪ Bajos

### B1 — Audit trail fire-and-forget bajo concurrencia
**Archivos:** `packages/core/src/engine/AgentEngine.ts:750-762`  
**Problema:** `appendFile(..., () => {})` — errores silenciados, orden no garantizado bajo concurrencia paralela de sub-agentes.  
**Fix:**
- [ ] Usar `appendFileSync` (simple, correcto para audit) **o** cola serializada si performance importa

**Commit target:** `fix(engine): use appendFileSync for audit trail consistency`

---

### B2 — `globToRegex` usa espacio como placeholder de `**`
**Archivos:** `packages/coding/src/tools/search-files.ts:12-21`  
**Problema:** Un glob con espacio literal (`"my file.ts"`) se rompe porque el espacio ya está tomado como placeholder de `**`.  
**Fix:**
- [ ] Usar un sentinel improbable (`\x00`) o un enfoque distinto para `**`

**Commit target:** `fix(search-files): fix globToRegex sentinel collision with space`

---

### B3 — `fs.statSync` sin try/catch en `search-files.ts`
**Archivos:** `packages/coding/src/tools/search-files.ts:99`  
**Problema:** Si `targetPath` no existe lanza sin capturar, inconsistente con el resto del archivo.  
**Fix:**
- [ ] Envolver en try/catch y retornar `Error: path not found`

**Commit target:** `fix(search-files): handle non-existent search path gracefully`

---

### B4 — secret-scanner solo hace `console.warn` (invisible en TUI/Electron)
**Archivos:** `packages/coding/src/tools/secret-scanner.ts:35`  
**Problema:** El warning no pasa por el `transport`, es invisible en entornos sin consola.  
**Fix:**
- [ ] Recibir `transport` como parámetro opcional en `warnIfSecrets` y emitir `{ type: 'system', level: 'warn', text: ... }`

**Commit target:** `fix(secret-scanner): emit warning via transport instead of console.warn`

---

### B5 — Duplicación en QA orchestrator
**Archivos:** `packages/core/src/engine/qa-orchestrator.ts:108-197`  
**Problema:** `processQaEngineerResponse` y `processInlineQaReview` repiten bloque de transición FSM + `completeSprint`.  
**Fix:**
- [ ] Extraer helper privado `applyQaDecision(ctx, approved, findings)` que contenga la transición y `completeSprint`

**Commit target:** `refactor(qa-orchestrator): extract applyQaDecision to remove duplication`

---

## Estado de progreso

| ID | Descripción | Estado | Sesión |
|----|-------------|--------|--------|
| C1 | allowlist bypass via shell chaining | ✅ completado | 2026-05-31 |
| C2 | cwd sin sandbox en run_command | ✅ completado | 2026-05-31 |
| C3 | Sandbox Windows cross-drive/UNC | ✅ completado | 2026-05-31 |
| C4 | Gate aprobación no cubre sub-agentes | ✅ completado | 2026-05-31 |
| C5 | run_command en READ_ONLY_TOOLS | ✅ completado | 2026-05-31 |
| A1 | Normalización Windows corrompe args | ✅ completado | 2026-05-31 |
| A2 | Reintentos MCP tope global | ✅ completado | 2026-05-31 |
| A3 | WebhookServer sin límite body | ✅ completado | 2026-05-31 |
| M1 | IDs hardcodeados en core | ✅ completado | 2026-05-31 |
| M2 | parentMessages acoplamiento muerto | ✅ completado | 2026-05-31 |
| M3 | Descripción ask_agent incorrecta | ✅ completado | 2026-05-31 |
| M4 | buildContext agentId incorrecto | ✅ completado | 2026-05-31 |
| M5 | Tokens sub-agentes retornan 0 | ✅ completado | 2026-05-31 |
| M6 | Separador MCP stale + bug safeName | ✅ completado | 2026-05-31 |
| M7 | ConfigLoader.save() sin chmod | ✅ completado | 2026-05-31 |
| B1 | Audit trail fire-and-forget | ✅ completado | 2026-05-31 |
| B2 | globToRegex sentinel collision | ✅ completado | 2026-05-31 |
| B3 | statSync sin try/catch | ✅ completado | 2026-05-31 |
| B4 | secret-scanner invisible en TUI | ✅ completado | 2026-05-31 |
| B5 | Duplicación QA orchestrator | ✅ completado | 2026-05-31 |

---

## Orden de ataque recomendado

**Sprint 1 — Seguridad de ejecución** (C1, C2, C3, C4, C5, A1)  
Todo lo relacionado con `run_command`, sandbox de rutas y gate de aprobación. Son el mayor vector de riesgo para un agente autónomo.

**Sprint 2 — Robustez de infraestructura** (A2, A3, M6, M7, B1)  
MCP, WebhookServer, audit trail, config seguro. Afectan estabilidad y seguridad operacional.

**Sprint 3 — Desacoplamiento y correctness** (M1, M2, M3, M4, M5)  
Refactors de arquitectura que mejoran extensibilidad del framework.

**Sprint 4 — Calidad y consistencia** (B2, B3, B4, B5)  
Mejoras de baja prioridad sin impacto en seguridad.
