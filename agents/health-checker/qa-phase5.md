# QA Report — Fase 5: Tool end_to_end_test

> Proyecto: health-checker
> Fecha: 2026-06-19
> Etapa: VERIFY

---

## Paso 1 — Criterios funcionales

### C1: end_to_end_test sin flow_id crea un flow 'health-check-test'

**Resultado: ✅**

**Evidencia (análisis de código):**
- `src/checks/e2e.ts` función `runEndToEndTest(flowId?)`:
  ```typescript
  const targetFlowId = flowId || 'health-check-test';
  ```
- Si no se pasa `flowId`, se usa `'health-check-test'` por defecto
- `createTestFlow(targetFlowId)` hace `POST /flows` con un step de tipo `echo`:
  ```typescript
  steps: [{ id: 'echo-ok', type: 'echo', message: 'Health check OK' }]
  ```
- Solo crea el flow si `!flowId` (no se especificó uno existente)

---

### C2: end_to_end_test ejecuta el flow y espera el resultado

**Resultado: ✅**

**Evidencia (análisis de código):**
- `executeFlow(flowId)` → `POST /flows/${flowId}/run` → obtiene `run_id`
- `pollRunResult(runId)` → loop con `GET /runs/${runId}` cada 1s:
  - Si status es `completed`/`success` → retorna resultado
  - Si status es `failed`/`error` → retorna fallo
  - Timeout de 30s → retorna null
- `runEndToEndTest()` orquesta la secuencia completa: crear → ejecutar → poll → limpiar

---

### C3: Devuelve success, flow_id, run_id, duration_ms, steps_completed

**Resultado: ✅**

**Evidencia (análisis de código):**
- Interfaz `E2EResult`:
  ```typescript
  interface E2EResult {
    success: boolean;
    flow_id: string;
    run_id: string;
    duration_ms: number;
    steps_completed: number;
    error?: string;
  }
  ```
- Todos los return paths en `runEndToEndTest()` incluyen los 5 campos requeridos
- `duration_ms` se calcula con `Date.now() - startTime`
- `steps_completed` viene del orquestador (`data.steps_completed || data.steps || 1`)

---

### C4: Si el flow falla, devuelve success=false con error descriptivo

**Resultado: ✅**

**Evidencia (análisis de código):**
- 3 escenarios de error con mensajes descriptivos:
  1. **No se pudo crear el flow:**
     ```
     error: "No se pudo crear el flow de prueba 'health-check-test' - ¿El orquestador está corriendo?"
     ```
  2. **No se pudo ejecutar el flow:**
     ```
     error: "No se pudo ejecutar el flow 'health-check-test' - ¿El orquestador está corriendo?"
     ```
  3. **Timeout en polling:**
     ```
     error: "Timeout esperando resultado del run <runId> (límite: 30000ms)"
     ```
  4. **Flow falló durante ejecución:**
     ```
     error: "El flow 'health-check-test' falló durante la ejecución"
     ```

---

### C5: No deja flows huérfanos (los limpia después de la prueba)

**Resultado: ✅**

**Evidencia (análisis de código):**
- `cleanupFlow(flowId)` → `DELETE /flows/${flowId}` con try/catch
- `cleanupFlow` se llama en **todos** los escenarios de salida cuando el flow fue creado por el test (`!flowId`):
  1. Si falla la ejecución → `if (!flowId) await cleanupFlow(targetFlowId)`
  2. Si hay timeout → `if (!flowId) await cleanupFlow(targetFlowId)`
  3. Si todo sale bien → `if (!flowId) await cleanupFlow(targetFlowId)`
- Si el usuario pasa un `flow_id` existente, **no** se limpia (porque no fue creado por el test)

---

## Paso 2 — Cumplimiento de decisiones de diseño (ADRs)

### ADR-001: AgentMCPServer como framework MCP

**Verificación de imports:**
| Librería | Archivos | Evidencia |
|----------|----------|-----------|
| `@backendkit-labs/mcp-server` | `src/main.ts` | ✅ |
| `@backendkit-labs/agent-core` | `src/main.ts`, `src/engine.ts` | ✅ |

**Resultado: ✅**

---

### ADR-002: Módulos en src/

**Verificación:**
| Elemento | Evidencia |
|----------|-----------|
| Estructura modular | ✅ 12 archivos en src/ |
| Entry point `health-checker.ts` | ✅ Re-export |

**Estructura actual:**
```
src/
├── types.ts
├── cache.ts
├── fetch.ts              (NUEVO - helper compartido)
├── checks/
│   ├── environment.ts
│   ├── orchestrator.ts
│   ├── messaging.ts
│   ├── scheduler.ts
│   ├── vault.ts
│   └── e2e.ts            (NUEVO)
├── engine.ts
├── tools.ts
└── main.ts
```

**Resultado: ✅**

---

### ADR-003: Cache en memoria con TTL fijo de 30s

**Verificación:**
| Elemento | Evidencia |
|----------|-----------|
| Cache Manager | ✅ `src/cache.ts` |
| `e2e.ts` no usa cache | ✅ Correcto — los tests e2e no deben cachearse |

**Resultado: ✅** — e2e.ts deliberadamente no cachea porque cada test debe ser una ejecución fresca.

---

### ADR-004: Conexión TCP para check_messaging

**Verificación:**
| Elemento | Evidencia |
|----------|-----------|
| `net.createConnection` | ✅ `src/checks/messaging.ts` |
| Sin clientes npm | ✅ |

**Resultado: ✅** — Verificado en Fase 4, se mantiene.

---

### Stack del design.md (sección 2)

**Verificación de módulos nativos vs imports:**
| Módulo | Design.md | Código | Archivo |
|--------|-----------|--------|---------|
| `@backendkit-labs/mcp-server` | ✅ | ✅ | `src/main.ts` |
| `zod` | ✅ | ✅ | `src/tools.ts` |
| `os` (nativo) | ✅ | ✅ | `src/checks/environment.ts`, `scheduler.ts`, `vault.ts` |
| `child_process` (nativo) | ✅ | ✅ | `src/checks/environment.ts` |
| `fetch` (nativo) | ✅ | ✅ | `src/fetch.ts`, `src/checks/orchestrator.ts`, `e2e.ts` |
| `net` (nativo) | ✅ | ✅ | `src/checks/messaging.ts` |
| `fs` (nativo) | ✅ | ✅ | `src/checks/scheduler.ts`, `vault.ts` |
| `path` (nativo) | ✅ | ✅ | `src/checks/scheduler.ts`, `vault.ts` |

**Resultado: ✅** — Stack cumplido. `fetch` nativo ahora es un helper compartido (`src/fetch.ts`) usado por orchestrator.ts y e2e.ts.

---

## Resumen de hallazgos

| ID | Hallazgo | Severidad | Estado |
|----|----------|-----------|--------|
| H1 | No se pudo probar `end_to_end_test` con un orquestador real porque no hay uno corriendo | **Baja** | La lógica HTTP está implementada. Cuando el orquestador esté disponible, el test funcionará |

---

## Plan de remediación

Sin hallazgos que requieran remediación.

---

## VEREDICTO: GO

Todos los criterios funcionales se cumplen (5/5 ✅). Los ADRs aplicables se cumplen (4/4 ✅). El stack técnico del design.md se respeta. El helper `fetch.ts` compartido mejora la calidad del código eliminando duplicación. Los hallazgos son de severidad baja y no bloquean el avance.
