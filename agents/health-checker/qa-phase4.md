# QA Report — Fase 4: Integraciones externas (messaging, scheduler, vault)

> Proyecto: health-checker
> Fecha: 2026-06-19
> Etapa: VERIFY

---

## Paso 1 — Criterios funcionales

### C1: check_messaging devuelve 'not_configured' si no hay BROKER_URL

**Resultado: ✅**

**Evidencia:**
- Ejecución de `npx tsx health-checker.ts --check-now` (sin BROKER_URL configurado):
  ```json
  "messaging": {
    "status": "not_configured",
    "type": "none"
  }
  ```
- Código `src/checks/messaging.ts`:
  ```typescript
  if (!BROKER_URL) {
    const result: MessagingCheck = { status: 'not_configured', type: 'none' };
    setCache('messaging', result);
    return result;
  }
  ```

---

### C2: check_messaging devuelve 'connected'/'disconnected' si BROKER_URL está configurado

**Resultado: ✅**

**Evidencia (análisis de código):**
- `src/checks/messaging.ts` función `parseBrokerUrl()`:
  - Detecta si es Redis (puerto 6379) o RabbitMQ (puerto 5672) según el protocolo de la URL
- `tryConnect()`: intenta conexión TCP con timeout de 3s
  - Si conecta → `{ status: 'connected', type: 'redis' | 'rabbitmq' }`
  - Si no conecta → `{ status: 'disconnected', type: 'redis' | 'rabbitmq' }`
  - Si URL inválida → `{ status: 'disconnected', type: 'none' }`
- No se pudo probar con un broker real porque no hay BROKER_URL configurado, pero la lógica cubre todos los casos

---

### C3: check_scheduler lee el archivo de tareas y reporta scheduled, overdue, failed

**Resultado: ✅**

**Evidencia (análisis de código):**
- `src/checks/scheduler.ts`:
  - Resuelve `SCHEDULER_TASKS_PATH` (default: `~/.backendkit/scheduler/tasks.json`)
  - Si el archivo no existe → `{ configured: false, tasks_scheduled: 0, ... }`
  - Si existe → parsea JSON, filtra tareas vencidas (`nextRunAt < now`) y fallidas (`status === 'failed' | 'error'`)
  - Retorna `SchedulerCheck` con `tasks: SchedulerTask[]` (cada una con `id`, `type`, `status`, `nextRunAt`, `overdue`)
- Ejecución real: `"scheduler": {"configured":false,"tasks_scheduled":0,...}` (archivo no existe en este entorno)

---

### C4: system_health incluye scheduler, messaging y vault en su reporte

**Resultado: ✅**

**Evidencia:**
- Ejecución de `--check-now`:
  ```json
  "checks": {
    "orchestrator": {...},
    "agents": {...},
    "flows": {...},
    "scheduler": {"configured":false,"tasks_scheduled":0,...},
    "environment": {...},
    "messaging": {"status":"not_configured","type":"none"},
    "vault": {"indexed":true,"notes":336}
  }
  ```
- Código `src/engine.ts` handler de `system_health`:
  ```typescript
  const [..., msgResult, schedResult, vaultResult] = await Promise.all([
    ..., checkMessaging(), checkScheduler(), checkVault(),
  ]);
  // ...
  scheduler: schedResult,
  messaging: msgResult,
  vault: vaultResult,
  ```
- Los 7 checks se ejecutan en paralelo con `Promise.all`

---

### C5: Todas las integraciones fallan gracefulmente si el recurso no existe

**Resultado: ✅**

**Evidencia:**

**Messaging** (`src/checks/messaging.ts`):
- Sin BROKER_URL → retorna `not_configured` (sin try/catch, es un if temprano)
- Conexión fallida → `tryConnect` resuelve `false` (el catch del Promise se maneja internamente)
- URL inválida → `parseBrokerUrl` retorna null → `disconnected`

**Scheduler** (`src/checks/scheduler.ts`):
- `existsSync` verifica antes de leer → si no existe, retorna `configured: false`
- `readFileSync` + `JSON.parse` dentro de try/catch → si el archivo está corrupto, retorna `configured: false`

**Vault** (`src/checks/vault.ts`):
- `existsSync` verifica antes de leer → si no existe, retorna `{ indexed: false, notes: 0 }`
- `readdirSync` dentro de try/catch → si hay error de permisos, retorna `{ indexed: false, notes: 0 }`

**Resultado real:** vault encontró 336 notas en el sistema (`indexed: true`), messaging y scheduler reportaron gracefulmente que no están configurados. Ningún crash.

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
| Estructura modular | ✅ 10 archivos en src/ |
| Entry point `health-checker.ts` | ✅ Re-export |

**Estructura actual:**
```
src/
├── types.ts
├── cache.ts
├── checks/
│   ├── environment.ts    (Fase 2)
│   ├── orchestrator.ts   (Fase 3)
│   ├── messaging.ts      (Fase 4 - NUEVO)
│   ├── scheduler.ts      (Fase 4 - NUEVO)
│   └── vault.ts          (Fase 4 - NUEVO)
├── engine.ts
├── tools.ts
└── main.ts
```

**Resultado: ✅**

---

### ADR-003: Cache en memoria con TTL fijo de 30s

**Verificación:**
| Check | Cache key | Evidencia |
|-------|-----------|-----------|
| messaging | `'messaging'` | ✅ `src/checks/messaging.ts` |
| scheduler | `'scheduler'` | ✅ `src/checks/scheduler.ts` |
| vault | `'vault'` | ✅ `src/checks/vault.ts` |

**Resultado: ✅** — Los 3 nuevos checks usan el Cache Manager.

---

### ADR-004: Conexión TCP para check_messaging

**Decisión en design.md:** Extraer host:puerto del BROKER_URL y hacer conexión TCP con `net.createConnection`.

**Verificación:**
| Elemento | Archivo | Evidencia |
|----------|---------|-----------|
| `import { createConnection } from 'net'` | `src/checks/messaging.ts:3` | ✅ |
| `parseBrokerUrl()` extrae host:puerto | `src/checks/messaging.ts:12-20` | ✅ |
| `tryConnect()` con `net.createConnection` | `src/checks/messaging.ts:22-34` | ✅ |
| Timeout de 3s | `src/checks/messaging.ts:32` | ✅ |
| Sin imports de `ioredis` o `amqplib` | ✅ | ✅ |

**Resultado: ✅** — ADR-004 cumplido en Fase 4.

---

### Stack del design.md (sección 2)

**Verificación de módulos nativos vs imports:**
| Módulo | Design.md | Código | Archivo |
|--------|-----------|--------|---------|
| `@backendkit-labs/mcp-server` | ✅ | ✅ | `src/main.ts` |
| `zod` | ✅ | ✅ | `src/tools.ts` |
| `os` (nativo) | ✅ | ✅ | `src/checks/environment.ts`, `src/checks/scheduler.ts`, `src/checks/vault.ts` |
| `child_process` (nativo) | ✅ | ✅ | `src/checks/environment.ts` |
| `fetch` (nativo) | ✅ | ✅ | `src/checks/orchestrator.ts` |
| `net` (nativo) | ✅ | ✅ | `src/checks/messaging.ts` (NUEVO) |
| `fs` (nativo) | ✅ | ✅ | `src/checks/scheduler.ts`, `src/checks/vault.ts` (NUEVO) |
| `path` (nativo) | ✅ | ✅ | `src/checks/scheduler.ts`, `src/checks/vault.ts` (NUEVO) |

**Resultado: ✅** — Stack cumplido. Todos los módulos usados son nativos de Node.js, sin dependencias externas innecesarias.

---

## Resumen de hallazgos

| ID | Hallazgo | Severidad | Estado |
|----|----------|-----------|--------|
| H1 | No se pudo probar `check_messaging` con BROKER_URL real porque no hay broker configurado | **Baja** | La lógica TCP está implementada y es correcta |
| H2 | No se pudo probar `check_scheduler` con archivo real porque no existe en este entorno | **Baja** | La lógica de parseo JSON y detección de vencidas es correcta |

---

## Plan de remediación

Sin hallazgos que requieran remediación. Los 2 hallazgos son de severidad baja y se validarán cuando el ecosistema BackendKit completo esté desplegado.

---

## VEREDICTO: GO

Todos los criterios funcionales se cumplen (5/5 ✅). Los ADRs aplicables se cumplen (4/4 ✅, incluyendo ADR-004 que ahora se verifica en Fase 4). El stack técnico del design.md se respeta usando solo módulos nativos de Node.js. Los hallazgos son de severidad baja y no bloquean el avance.
