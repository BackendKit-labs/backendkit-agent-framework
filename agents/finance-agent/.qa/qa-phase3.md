# QA Report — Phase 3: Integration & Architecture Validation

**Proyecto:** finance-agent
**Fecha:** 2024-07-15
**Agente:** QA Specialist
**Veredicto:** ❌ NO GO

## Resumen Ejecutivo

Se revisaron 8 archivos clave (implementaciones + tests) contra la specification.md y design.md. Se encontraron **6 fallos críticos** y **3 advertencias** que impiden aprobar la fase:

1. **Duplicidad de implementaciones** — Existen dos versiones de `SchedulerClient` y `NotifierClient` (en `src/core/` y `src/clients/`), lo que viola el principio de única fuente de verdad.
2. **Tests no ejecutables** — Los tests de integración importan módulos de NestJS (`@nestjs/testing`, `@nestjs/axios`) que no están en el `package.json` del proyecto.
3. **Inconsistencia arquitectónica** — `engine.ts` usa `SchedulerClient` de `src/core/` pero `orchestrator.yaml` referencia endpoints que no coinciden con los métodos implementados.
4. **Falta de cobertura** — No hay tests unitarios para `tool-registry.ts` con el nuevo `ToolContext`.
5. **Workflows incompletos** — `orchestrator.yaml` define workflows que dependen de servicios no implementados (report-engine).
6. **Violación de ADR-001** — La estructura de proyecto tiene archivos duplicados en ubicaciones diferentes.

## Archivos Revisados

| Archivo | Estado | Observaciones |
|---------|--------|---------------|
| `src/core/scheduler-client.ts` | ⚠️ | Implementación correcta pero duplicada con `src/clients/scheduler-client.ts` |
| `src/core/notifier-client.ts` | ⚠️ | Implementación correcta pero duplicada con `src/clients/notifier-client.ts` |
| `src/core/tool-registry.ts` | ✅ | ToolContext implementado correctamente con scheduler y notifier |
| `src/core/engine.ts` | ⚠️ | Inyecta clientes correctamente pero usa la versión de `src/core/` |
| `config/orchestrator.yaml` | ❌ | Workflows incompletos, referencias a servicios no implementados |
| `tests/integration/scheduler-integration.test.ts` | ❌ | Dependencias de NestJS no disponibles |
| `tests/integration/notifier-integration.test.ts` | ❌ | Dependencias de NestJS no disponibles |
| `tests/integration/report-workflow.test.ts` | ❌ | Dependencias de NestJS no disponibles |

## Criterios Funcionales

| ID | Criterio | Resultado | Evidencia |
|----|----------|-----------|-----------|
| C1 | `SchedulerClient` implementa `scheduleTask()`, `listTasks()`, `cancelTask()`, `reschedule()`, `getTaskStatus()` | ✅ | `src/core/scheduler-client.ts` implementa los 5 métodos con logging y validación Zod |
| C2 | `NotifierClient` implementa `notifyUser()`, `sendNotification()`, `getHistory()` | ✅ | `src/core/notifier-client.ts` implementa los 3 métodos con logging y validación Zod |
| C3 | `ToolContext` incluye `apiGateway`, `config`, `vault`, `scheduler`, `notifier` | ✅ | `src/core/tool-registry.ts` define `ToolContext` con las 5 propiedades |
| C4 | `NativeToolDefinition.handler` usa `(input, ctx: ToolContext) => Promise<TOutput>` | ✅ | La interfaz `NativeToolDefinition` tiene handler con firma actualizada |
| C5 | `engine.ts` crea instancias de `SchedulerClient` y `NotifierClient` desde config | ✅ | `engine.ts` crea ambas instancias con configuración desde `config.scheduler` y `config.notifier` |
| C6 | `engine.ts` inyecta clientes en `ToolContext` al ejecutar tools | ✅ | `executeTool` en `engine.ts` pasa `toolContext` con scheduler y notifier |
| C7 | `orchestrator.yaml` tiene 3 workflows: `finance-report`, `schedule-report`, `cancel-report` | ✅ | Los 3 workflows están definidos con steps y acciones |
| C8 | Tests de integración existen para SchedulerClient | ✅ | `tests/integration/scheduler-integration.test.ts` existe con 5 tests |
| C9 | Tests de integración existen para NotifierClient | ✅ | `tests/integration/notifier-integration.test.ts` existe con 4 tests |
| C10 | Tests de integración existen para workflows | ✅ | `tests/integration/report-workflow.test.ts` existe con 3 tests |
| C11 | Tests de integración usan mocks HTTP | ❌ | Los tests importan `@nestjs/testing` y `@nestjs/axios` que no están en `package.json` |
| C12 | No hay duplicidad de implementaciones | ❌ | `src/core/scheduler-client.ts` y `src/clients/scheduler-client.ts` son duplicados funcionales |
| C13 | `orchestrator.yaml` workflows son ejecutables | ❌ | `finance-report` workflow referencia `report-engine` que no está implementado |
| C14 | Tests unitarios para `tool-registry.ts` con nuevo `ToolContext` | ❌ | No existen tests que verifiquen el paso de `ToolContext` a los handlers |
| C15 | `SchedulerClient` usa `@backendkit-labs/agent-core` para logging | ✅ | Usa `createLogger` de `@backendkit-labs/agent-core` |
| C16 | `NotifierClient` usa `@backendkit-labs/agent-core` para logging | ✅ | Usa `createLogger` de `@backendkit-labs/agent-core` |

## Cumplimiento de ADRs

| ADR | Estado | Evidencia |
|-----|--------|-----------|
| ADR-001 (Estructura de proyecto) | ❌ | Violación: existen archivos duplicados en `src/core/` y `src/clients/` para SchedulerClient y NotifierClient |
| ADR-002 (Engine con agent-enterprise) | ✅ | `engine.ts` usa `@backendkit-labs/agent-enterprise` correctamente |
| ADR-003 (Validación con Zod) | ✅ | Todos los clientes y tool-registry usan Zod para validación |
| ADR-004 (Tools independientes) | ✅ | `tool-registry.ts` mantiene tools independientes con contexto inyectado |
| ADR-005 (MCP Bridge) | ⚠️ | No se verificó el archivo `mcp-bridge.ts` en esta fase |
| ADR-006 (Report Engine) | ❌ | `orchestrator.yaml` referencia `report-engine` que no está implementado |
| ADR-007 (Config por empresa) | ✅ | `engine.ts` carga config desde `config` y la pasa al ToolContext |

## Problemas Detallados

### P1: Duplicidad de implementaciones (Crítico)
- **Archivos:** `src/core/scheduler-client.ts` ↔ `src/clients/scheduler-client.ts`, `src/core/notifier-client.ts` ↔ `src/clients/notifier-client.ts`
- **Impacto:** Mantenimiento duplicado, riesgo de divergencia, confusión en imports
- **Solución:** Eliminar `src/clients/` y consolidar todo en `src/core/`. Actualizar imports en `engine.ts` si es necesario.

### P2: Tests de integración no ejecutables (Crítico)
- **Archivos:** `tests/integration/scheduler-integration.test.ts`, `tests/integration/notifier-integration.test.ts`, `tests/integration/report-workflow.test.ts`
- **Problema:** Importan `@nestjs/testing`, `@nestjs/axios`, `HttpService` que no están en `package.json`
- **Impacto:** Los tests no pueden ejecutarse, cobertura falsa
- **Solución:** Reescribir tests usando solo Jest con mocks manuales de `fetch`/`axios`, o agregar dependencias faltantes al `package.json`

### P3: Workflows incompletos (Crítico)
- **Archivo:** `config/orchestrator.yaml`
- **Problema:** El workflow `finance-report` tiene un step que llama a `report-engine` que no existe
- **Impacto:** El workflow no puede ejecutarse en producción
- **Solución:** Implementar `report-engine` o eliminar la referencia y usar solo los clientes existentes

### P4: Falta de tests unitarios para ToolContext (Advertencia)
- **Cobertura faltante:** No hay tests que verifiquen que `ToolContext` se pasa correctamente a los handlers de tools
- **Impacto:** Riesgo de que el contexto no se inyecte correctamente en producción
- **Solución:** Agregar tests unitarios en `tests/core/tool-registry.test.ts` que verifiquen el paso de contexto

### P5: Inconsistencia en endpoints (Advertencia)
- **Problema:** `orchestrator.yaml` usa URLs hardcodeadas (`http://scheduler-agent:3001`, `http://notifier-agent:3002`) mientras que `engine.ts` las obtiene de `config`
- **Impacto:** Posible desincronización entre config y orchestrator
- **Solución:** Centralizar URLs en `config` y referenciarlas desde `orchestrator.yaml` o viceversa

### P6: Validación de schemas incompleta (Advertencia)
- **Problema:** `SchedulerClient` y `NotifierClient` en `src/core/` validan inputs con Zod, pero no validan las respuestas de los agentes externos
- **Impacto:** Riesgo de procesar respuestas malformadas
- **Solución:** Agregar schemas Zod para validar respuestas de scheduler-agent y notifier-agent

## Recomendaciones

### Inmediatas (para pasar a GO)
1. **Consolidar implementaciones:** Eliminar `src/clients/` y mantener solo `src/core/` como fuente única
2. **Corregir tests de integración:** Reescribir usando Jest puro con mocks de `fetch` o agregar dependencias NestJS al proyecto
3. **Completar workflows:** Implementar `report-engine` o ajustar `orchestrator.yaml` para usar solo los clientes existentes

### Corto plazo
4. **Agregar tests unitarios para ToolContext** en `tests/core/tool-registry.test.ts`
5. **Centralizar configuración de URLs** en un solo lugar (config o orchestrator)
6. **Agregar validación de respuestas** en SchedulerClient y NotifierClient

### Mediano plazo
7. **Implementar tests de integración end-to-end** con un scheduler-agent y notifier-agent mockeados como servicios HTTP
8. **Agregar tests de carga** para verificar que los clientes manejan timeouts correctamente

## Conclusión

La fase 3 tiene una base sólida en las implementaciones de `SchedulerClient`, `NotifierClient`, `ToolContext` y `engine.ts`, pero **falla en 3 criterios críticos**: duplicidad de código, tests no ejecutables y workflows incompletos. Se requiere una iteración de corrección antes de aprobar.

**Veredicto:** ❌ NO GO — Se requieren correcciones en duplicidad, tests y workflows antes de proceder a la siguiente fase.