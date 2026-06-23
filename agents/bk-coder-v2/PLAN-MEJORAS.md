# Plan de Ejecución — Mejoras bk-coder-v2

> **Creado:** 2026-06-23
> **Objetivo:** Cerrar las fallas que impiden que el SDD *garantice* en vez de *sugerir*.
> **Estado global:** 🔴 No iniciado · 🟡 En progreso · 🟢 Completado

---

## Contexto

El orquestador SDD funciona end-to-end (verificado: KV store Go, 30 archivos, 4 fases +
security + infra en 2m18s). El loop de fases con gates y rework converge. Pero hay fallas
estructurales que limitan la confiabilidad:

1. **El sistema escribe código pero nunca lo ejecuta** — el QA es estático, no compila ni
   testea. Un "GO" puede aprobar código que no compila. ← **falla central**
2. El file-writer parsea texto del LLM con heurísticas (frágil, ya falló 2 veces).
3. El veredicto QA se parsea con regex sobre markdown libre (frágil).
4. Inyectar archivos enteros al prompt no escala (context window).
5. Los "agentes" son LLM calls con system prompt, no procesos MCP aislados (ADR-005).

---

## Fase 1 — Gate de ejecución (máximo impacto) 🔴

**Meta:** después de implementar, compilar y testear de verdad en el `root`. La salida real
alimenta el veredicto del QA. El "GO" pasa de opinión a hecho.

| # | Tarea | Archivo(s) | Estado |
|---|-------|-----------|--------|
| 1.1 | Crear `command-runner.ts`: ejecuta comandos en `projectRoot` con timeout, captura stdout/stderr/exitCode | `src/command-runner.ts` (nuevo) | 🟢 |
| 1.2 | Detectar stack del proyecto (package.json → node, go.mod → go, etc.) y mapear a comandos build/test | `src/command-runner.ts` | 🟢 |
| 1.3 | En el phase-runner, tras IMPLEMENT correr build+test antes del QA; pasar el resultado real al QA | `src/phase-runner.ts` | 🟢 |
| 1.4 | El QA recibe la salida de compilación/tests como evidencia objetiva (no solo el código) | `src/phase-runner.ts`, `souls/qa.md` | 🟢 |
| 1.5 | Si el build falla, el veredicto es NO_GO automático (sin pasar por el LLM) y los errores se inyectan al rework | `src/phase-runner.ts` | 🟢 |
| 1.6 | Mostrar resultado build/test en el gate (CLI/TUI/status) | `cli.ts`, `tui.tsx`, `server.ts` | 🟢 |

**Criterio de aceptación:** un proyecto con un error de compilación introducido a propósito
da NO_GO determinista, y el rework lo corrige con los errores reales del compilador inyectados.

**Decisión de seguridad pendiente:** ejecutar comandos arbitrarios del LLM es un riesgo.
Definir allowlist de comandos (build/test/lint) y/o sandbox antes de 1.1.

---

## Fase 2 — Robustez del file-writer y el veredicto 🔴

**Meta:** que el contrato LLM↔sistema deje de depender de heurísticas frágiles.

| # | Tarea | Archivo(s) | Estado |
|---|-------|-----------|--------|
| 2.1 | Veredicto QA estructurado: pedir al QA una última línea `VERDICT: GO\|NO_GO\|CONDITIONAL` y parsear esa, con el regex actual como fallback | `souls/qa.md`, `src/phase-runner.ts` | 🟢 |
| 2.2 | Validar archivos extraídos antes de escribir: rechazar paths sospechosos, vacíos, o fuera de `root` (ya hay chequeo parcial) | `src/file-writer.ts` | 🟢 |
| 2.3 | Si el backend devuelve 0 archivos en una fase de implementación, reintentar 1 vez con instrucción reforzada antes de fallar | `src/phase-runner.ts` | 🟢 |
| 2.4 | Tests unitarios del `file-writer` (4 formatos) y `parseVerdict` (casos borde) | `tests/` (nuevo) | 🟢 |
| 2.5 | Tests del `roadmap-parser` (variaciones de formato de fase) | `tests/` (nuevo) | 🟢 |

**Criterio de aceptación:** suite de tests verde cubriendo parsing de archivos, veredicto y roadmap.

---

## Fase 3 — Escalabilidad del contexto 🔴

**Meta:** que el SDD funcione en proyectos grandes sin chocar el context window.

| # | Tarea | Archivo(s) | Estado |
|---|-------|-----------|--------|
| 3.1 | En vez de inyectar archivos enteros, usar el vault RAG (codex) para traer solo los fragmentos relevantes a la fase | `src/context-reader.ts`, `src/rag.ts` | 🟢 |
| 3.2 | Límite configurable de tokens de contexto por agente; priorizar spec + archivos tocados en la fase actual | `src/context-reader.ts` | 🟢 |
| 3.3 | Resumen incremental: tras cada fase, curar un resumen del estado del proyecto en vez de releer todo | `src/context-reader.ts` | 🟢 |

**Criterio de aceptación:** un proyecto de 40+ archivos completa una fase sin exceder el límite de contexto.

---

## Fase 4 — Aislamiento real de agentes (opcional / largo plazo) 🔴

**Meta:** evaluar si conviene mover de "LLM call con system prompt" a procesos MCP aislados.

| # | Tarea | Archivo(s) | Estado |
|---|-------|-----------|--------|
| 4.1 | Evaluar costo/beneficio: los subdirectorios `backend-mcp/`, `qa-mcp/`, `security-mcp/` ya existen pero no se usan | (análisis) | 🔴 |
| 4.2 | Decidir: integrarlos como procesos stdio reales, o eliminarlos y documentar que el orquestador los reemplaza inline | design.md (ADR-005) | 🔴 |

**Criterio de aceptación:** decisión documentada y código coherente con ella (sin agentes muertos).

---

## Fase 5 — Cierre del ciclo (integración) 🔴

**Meta:** que el resultado verificado se integre al ecosistema.

| # | Tarea | Archivo(s) | Estado |
|---|-------|-----------|--------|
| 5.1 | Al completar el SDD, opción de commit git del proyecto generado | `src/phase-runner.ts` o nuevo | 🔴 |
| 5.2 | Curar el conocimiento del proyecto al vault (codex) al finalizar | `src/phase-runner.ts` | 🔴 |
| 5.3 | Conectar con fleet-agent para deploy del proyecto terminado (vía director) | SOUL.md director | 🔴 |

---

## Orden recomendado

1. **Fase 1** primero — es la falla central y convierte todo lo demás en algo que garantiza.
2. **Fase 2** en paralelo o inmediatamente después — barata y elimina fragilidad.
3. **Fase 3** cuando se quiera usar en proyectos reales (no demos).
4. **Fases 4 y 5** son evolución, no bloqueantes.

## Registro de avance

| Fecha | Fase/Tarea | Nota |
|-------|-----------|------|
| 2026-06-23 | — | Plan creado. Base SDD funcional commiteada (hasta `0fa6203`). |
| 2026-06-23 | 3.1 + 3.2 + 3.3 | Scoring de archivos por keywords de fase (sin indexing). Presupuesto 28k chars por agente (spec 6k + fase actual del roadmap 2k + progreso 2.5k + archivos 15k). progress.md incremental tras cada GO. phaseCtx fluye por executeSubtask. Verificado: fase 2 "PUT Handler" trae put.go primero, contexto 3.7k < 28k. |
| 2026-06-23 | 2.2 + 2.4 + 2.5 | isPathSafe(): rechaza path traversal, extensiones peligrosas (.sh/.exe/.ps1/etc), vacíos. 62 tests (0 fallos): 28 file-writer, 17 parseVerdict, 17 roadmap-parser. npm test verde.  |
| 2026-06-23 | 1.1–1.6 + 2.1 + 2.3 | Gate de ejecución completo. Stack detection (TS/Go/Python/Rust/Deno). Build falla → NO_GO automático + errores al rework. QA recibe evidencia real. VERDICT: línea estructurada. Retry si 0 archivos. Verificado: error TS → NO_GO determinista, proyecto limpio → PASS. |
