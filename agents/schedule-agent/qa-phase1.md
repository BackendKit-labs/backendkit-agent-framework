# QA — Auditoría Fase 1: Core del agente MCP

> **Proyecto:** schedule-agent  
> **Etapa actual:** spec  
> **Fecha:** 2026-06-18  
> **Auditor:** QA Architect

---

## Resumen Ejecutivo

El proyecto se encuentra en **etapa de especificación (spec)**. No existe código fuente implementado — solo archivos de documentación (`specification.md`, `design.md`, `prompt.md`, `ROADMAP.md`). No hay `package.json`, ni archivos `.ts`, ni directorio `src/`.

La especificación y el diseño están completos y bien estructurados. Sin embargo, **no se puede verificar ningún criterio funcional** porque no hay implementación que evaluar.

**VEREDICTO: NO-GO — No hay código implementado para la Fase 1.**

---

## Paso 1 — Criterios Funcionales

| # | Criterio | Resultado | Evidencia |
|---|----------|-----------|-----------|
| 1 | Agente MCP responde correctamente a las 5 herramientas | ❌ | No existe `src/server.ts` ni ningún archivo que implemente un servidor MCP. No hay `package.json` con dependencias. |
| 2 | `schedule_task` crea tareas one_time y cron con validación | ❌ | No existe `src/tools/schedule-task.ts`. No hay implementación de la herramienta. |
| 3 | `list_scheduled` filtra por status, type, createdBy | ❌ | No existe `src/tools/list-scheduled.ts`. No hay implementación. |
| 4 | `cancel_task` cambia estado a cancelled con razón | ❌ | No existe `src/tools/cancel-task.ts`. No hay implementación. |
| 5 | `reschedule` modifica when/cron de una tarea existente | ❌ | No existe `src/tools/reschedule.ts`. No hay implementación. |
| 6 | `task_status` devuelve estado + executionHistory | ❌ | No existe `src/tools/task-status.ts`. No hay implementación. |
| 7 | Persistencia funciona: datos sobreviven reinicio del agente | ❌ | No existe `src/repository/task-repository.ts`. No hay implementación de SQLite ni JSON. |

**Total: 0/7 criterios cumplidos.**

---

## Paso 2 — Cumplimiento de Decisiones de Diseño (ADRs)

### ADR-001: SQLite como motor de persistencia (`better-sqlite3`)

| Aspecto | Resultado | Evidencia |
|---------|-----------|-----------|
| `better-sqlite3` en imports de `src/` | ❌ | No existe `src/`. No hay imports. |
| `better-sqlite3` en `package.json` | ❌ | No existe `package.json`. |
| Alternativa JSON implementada | ❌ | No hay implementación de persistencia alguna. |

**Veredicto: ❌ No implementado.**

---

### ADR-002: Polling cada 30s con `setInterval`

| Aspecto | Resultado | Evidencia |
|---------|-----------|-----------|
| `setInterval` en `src/engine/engine.ts` | ❌ | No existe `src/engine/engine.ts`. |
| Engine background implementado | ❌ | No hay código de engine. |

**Veredicto: ❌ No implementado.**

---

### ADR-003: Delegar notificaciones al Notification-Agent

| Aspecto | Resultado | Evidencia |
|---------|-----------|-----------|
| `src/clients/notification-client.ts` | ❌ | No existe el archivo. |
| Llamada a Notification-Agent en engine | ❌ | No hay engine implementado. |

**Veredicto: ❌ No implementado.**

---

### Decisiones de Stack Técnico (design.md §2)

| Librería/Herramienta | Estado en spec | Implementado en código |
|----------------------|----------------|----------------------|
| TypeScript 5.x | ✅ Documentado en design.md | ❌ No hay `tsconfig.json` |
| Node.js 20+ | ✅ Documentado | ❌ No hay `package.json` |
| `@modelcontextprotocol/sdk` | ✅ Documentado | ❌ No hay import |
| `better-sqlite3` | ✅ Documentado | ❌ No hay import |
| `cron-parser` | ✅ Documentado | ❌ No hay import |
| `uuid` (v4) | ✅ Documentado | ❌ No hay import |
| `luxon` / `Intl` | ✅ Documentado | ❌ No hay import |
| Jest | ✅ Documentado | ❌ No hay `jest.config.js` ni tests |

**Total ADRs verificados: 3/3 — todos NO implementados.**

---

## Paso 3 — Análisis de la Documentación (spec)

Aunque no hay código, la documentación existente es sólida. Evaluación de la especificación:

### Fortalezas
- ✅ Contratos de API completos con inputs, outputs y validaciones para las 7 herramientas
- ✅ Modelo de datos `ScheduledTask` con todos los campos necesarios
- ✅ Máquina de estados (`TaskStatus`) con transiciones definidas
- ✅ 11 requisitos funcionales claros y testables
- ✅ 9 reglas de negocio documentadas
- ✅ 6 casos de uso con flujos detallados
- ✅ Matriz de seguridad por rol (admin/manager/user)

### Debilidades / Omisiones
| ID | Hallazgo | Severidad |
|----|----------|-----------|
| S-01 | No se especifica el formato de errores de las herramientas MCP (códigos, mensajes) | Media |
| S-02 | No hay esquema de validación para `workflowInput` (es `Record<string, any>` sin restricciones) | Media |
| S-03 | No se define cómo se maneja la concurrencia en `schedule_task` con `id` duplicado (RN-08 dice error, pero no el código HTTP/MCP) | Baja |
| S-04 | No hay especificación de logging estructurado | Baja |

---

## Paso 4 — Plan de Remediación

### Inmediato (antes de implementar)

| # | Acción | Responsable |
|---|--------|-------------|
| R-01 | Definir formato de errores estándar para todas las herramientas MCP (código, mensaje, detalles) | Backend |
| R-02 | Definir esquema de validación para `workflowInput` o al menos documentar que se valida en el orquestador | Backend |

### Corto plazo (implementación de Fase 1)

| # | Acción | Responsable |
|---|--------|-------------|
| R-03 | Crear `package.json` con dependencias: `@modelcontextprotocol/sdk`, `better-sqlite3`, `cron-parser`, `uuid`, `luxon` | Backend |
| R-04 | Crear `tsconfig.json` con configuración TypeScript 5.x | Backend |
| R-05 | Implementar `src/types/task.ts` con interfaces `ScheduledTask`, `TaskStatus`, `ExecutionLog` | Backend |
| R-06 | Implementar `src/types/tools.ts` con tipos de input/output de cada herramienta | Backend |
| R-07 | Implementar `src/config.ts` con configuración (DB path, intervalo engine, timezone default) | Backend |
| R-08 | Implementar `src/repository/task-repository.ts` con SQLite (CRUD, consultas indexadas) | Backend |
| R-09 | Implementar `src/services/task-service.ts` con lógica de negocio (validaciones, transiciones de estado, cálculo nextRunAt) | Backend |
| R-10 | Implementar `src/server.ts` con MCP Server y registro de las 7 herramientas | Backend |
| R-11 | Implementar cada tool handler en `src/tools/` (7 archivos) | Backend |
| R-12 | Implementar `src/engine/engine.ts` con loop de polling cada 30s | Backend |
| R-13 | Implementar `src/clients/orchestrator-client.ts` para comunicación con orquestador | Backend |
| R-14 | Implementar `src/index.ts` como entry point que inicia server + engine | Backend |
| R-15 | Escribir tests unitarios para `task-service`, `task-repository`, `engine` | Backend |
| R-16 | Escribir test de integración para flujo completo schedule → execute → complete | Backend |

### Mediano plazo

| # | Acción | Responsable |
|---|--------|-------------|
| R-17 | Implementar `src/clients/notification-client.ts` para delegar notificaciones | Backend |
| R-18 | Agregar logging estructurado con niveles (info, warn, error) | Backend |

---

## Conclusión

| Dimensión | Resultado |
|-----------|-----------|
| Criterios funcionales cumplidos | 0/7 ❌ |
| ADRs implementados | 0/3 ❌ |
| Stack técnico implementado | 0/8 ❌ |
| Documentación (spec + design) | ✅ Completa y bien estructurada |
| Estado del proyecto | Spec — sin código |

**VEREDICTO: NO-GO — No existe implementación de la Fase 1. El proyecto está en etapa de especificación (spec) y no hay código fuente, dependencias, ni configuración de proyecto. Se requiere implementar los 16 ítems del plan de remediación antes de avanzar a la etapa de implementación.**
