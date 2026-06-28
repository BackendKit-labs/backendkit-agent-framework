
---

### 🧩 Arquitectura completa con scheduler

```
                        ┌──────────────┐
                        │   Usuario    │
                        └──────┬───────┘
                               │
                        ┌──────▼───────┐
                        │   DIRECTOR   │  ← programa/cancela/revisa
                        └──────┬───────┘
                               │
                        ┌──────▼───────┐
                        │ ORQUESTADOR  │  ← ejecuta el workflow cuando se dispara
                        └──────┬───────┘
                               │
                    ┌──────────┴──────────┐
                    │                     │
             ┌──────▼──────┐    ┌────────▼───────┐
             │ scheduler    │    │  email-agent   │
             │ (⏰ cron)    │    │ (📧 envía mail)│
             └─────────────┘    └────────────────┘
```

---

### 📋 Herramientas del scheduler-agent

```typescript
// 1. Programar tarea
schedule_task({
  id?: string,                    // auto si no se pasa
  type: "one_time" | "cron",
  when: "2026-06-18T11:00:00",    // para one_time
  cron: "0 9 29 * *",            // para recurrente
  workflow: "health-report-email", // flow a ejecutar
  params: { to: ["gerencia@x.com"] },
  notifyOnComplete: true
})

// 2. Listar tareas programadas
list_scheduled({ status?: "pending" | "executed" | "failed" })
// → [{ id, type, nextRun, workflow, status, createdAt }]

// 3. Cancelar tarea
cancel_scheduled({ id: "task-123" })

// 4. Reprogramar
reschedule({ id: "task-123", when: "2026-06-20T15:00:00" })
```

---

### 🤔 ¿Y cómo sabe el Director que es "mañana a las 11"?

Hoy no tengo acceso al reloj/calendario del usuario. Necesitaría:

```typescript
// tool: get_current_time
// → { iso: "2026-06-17T18:30:00Z", timezone: "America/Argentina/Buenos_Aires" }

// tool: get_user_timezone
// → { timezone: "America/Argentina/Buenos_Aires", offset: "-03:00" }
```

Para poder interpretar "mañana a las 11" correctamente.

---

### 📊 Dónde entra en la lista de prioridades

| Prioridad | Mejora | Esfuerzo |
|---|---|---|
| 🔥 1 | **Conectar agentes especialistas** | Medio |
| 🔥 2 | **shell-agent** (ejecutar comandos) | Medio |
| 🔥 3 | **coder-agent** (escribir archivos) | Medio |
| ⚡ 4 | **scheduler-agent** ⏰ | Medio-Alto |
| ⚡ 5 | **email-agent** 📧 | Bajo |
| ⚡ 6 | **notification-agent** 🔔 | Medio |
| 🟢 7 | **memory-agent** 🧠 | Medio |

**El scheduler solo tiene sentido si primero existen los agentes que ejecutan las acciones** (shell, coder, email). De nada sirve programar un informe si no hay quien lo genere ni quien lo envíe.

---

¿Te interesaría que modele el **scheduler-agent** completo como especificación técnica para implementar después? O preferís enfocarnos primero en los agentes base (shell, coder) que habilitan todo lo demás. 😎

  [◆ Director] > Si modelalo

Perfecto. Vamos a modelarlo completo y además lo guardo en el vault para consultas futuras.

Primero, veamos qué información extra tenemos sobre el sistema actual:
  ⟶ [codex] search_vault {"query": "arquitectura orquestador flows agentes especialistas", "topK": 5, "au

  ⟶ [codex] read_note {"path_or_title": "Arquitectura del ecosistema Director-Orquestador-Agentes"}
  ✓ {"query":"arquitectura orquestador flows agentes especialistas","results":[{"title":"Arquitectura del ecosistema Directo
  ✓ --- title: "Arquitectura del ecosistema Director-Orquestador-Agentes" area: operaciones tipo: politica resumen: "El Dire
Ahora modelamos el scheduler-agent completo y lo guardamos en el vault para referencia futura.
  ⟶ [codex] curate_path {"path": "C:/Users/mairon.cuello/development/workspace-ia/agent-framework/agents
  ✓ {"status":"processing","message":"Started curation of 15 changed files in background (0 unchanged, skipped)","totalFiles

  ⟶ [] memory_save_knowledge {"content": "Especificación completa del Scheduler-Agent para el ecosistema Back
  ✓ Stored in semantic memory (id: b9dc224c-3146-41d9-bc8e-1ef0898182d8). Total entries: 1.
Ahora guardemos el modelo completo en memoria semántica:[codex-context] ✗ proposals\vscode-terminal.md: LLM call failed: [
  {
    "received": "general",
    "code": "invalid_enum_value",
    "options": [
      "politica",
      "decision",
      "procedimiento",
      "leccion",
      "norma_externa"
    ],
    "path": [
      "notes",
      0,
      "type"
    ],
    "message": "Invalid enum value. Expected 'politica' | 'decision' | 'procedimiento' | 'leccion' | 'norma_externa', received 'general'"
  }
]

  ⟶ [] memory_save_knowledge {"content": "## Scheduler-Agent — Especificación Técnica Completa\n\n### 1. Iden
  ✓ Stored in semantic memory (id: 1ec4467d-3d2f-445e-8ed9-dee51cbea877). Total entries: 2.
Ahora veamos que el curado terminó y guardamos el modelo final en el vault:
  ⟶ [codex] vault_status {"reload": true}
  ✓ {"project":"agent-framework","projectRoot":"C:/Users/mairon.cuello/development/workspace-ia/agent-framework","vaultPath"
[codex-context] ✓ Curated 15 changed files from C:/Users/mairon.cuello/development/workspace-ia/agent-framework/agents/director-agent (0 unchanged)
Listo. Se curaron y guardaron **15 notas nuevas** sobre la arquitectura del Director. Ahora sí, acá tenés el **modelo completo** del scheduler-agent:

---

# ⏰ Scheduler-Agent — Especificación Completa

## 1. ¿Qué es?

Un agente especialista que **gestiona tareas en el tiempo**: recordatorios, informes periódicos, workflows automáticos. Se sienta al lado del shell-agent, coder-agent, email-agent, etc.

```
🧠 Director          ← decide QUÉ y CUÁNDO
   ↓
🎯 Orquestador       ← coordina la ejecución
   ↓
⏰ Scheduler-Agent   ← programa, dispara, gestiona
   ↓
   ├── email-agent   ← envía mails
   ├── shell-agent   ← ejecuta comandos
   ├── notification  ← notifica al usuario
   └── ... otros
```

---

## 2. Herramientas MCP

| Tool | Qué hace | Input clave |
|---|---|---|
| `schedule_task` | Programa una tarea | `type` (one_time/cron), `when` o `cron`, `workflow`, `workflowInput` |
| `list_scheduled` | Lista tareas con filtros | `status`, `type`, `createdBy` |
| `cancel_task` | Cancela una tarea | `id`, `reason` |
| `reschedule` | Reprograma o modifica | `id`, nuevo `when`/`cron` |
| `task_status` | Estado detallado + historial | `id` |

---

## 3. Modelo de datos

```typescript
interface ScheduledTask {
  id: string                    // uuid
  type: "one_time" | "cron"
  when?: string                 // ISO timestamp (one_time)
  cron?: string                 // expresión cron (recurrente)
  timezone: string              // ej: "America/Buenos_Aires"
  workflow: string              // flow ID a ejecutar
  workflowInput: Record<string, any>
  createdBy: string             // userId
  status: "active" | "paused" | "completed" | "cancelled" | "failed"
  lastRunAt?: string
  nextRunAt?: string
  runCount: number
  notifyOnFailure: boolean
  notifyTo: string[]
  executionHistory: ExecutionLog[]
}
```

**Persistencia:** `~/.backendkit/scheduler/tasks.json` (o SQLite).

---

## 4. Casos de uso concretos

### 📌 Recordatorio one-time

> **Usuario:** "Recordame mañana a las 11 llamar a socio"

```
Director interpreta "mañana a las 11" →
  when = "2026-06-18T11:00:00-03:00"

Scheduler-agent guarda →
  Al llegar la hora, dispara flow "send-reminder"
  → Usuario recibe 🔔 "Recordatorio: llamar a socio"
```

### 📅 Informe recurrente

> **Usuario:** "Los días 29 de cada mes, enviá email a gerencia con el health report"

```
Director →
  schedule_task({
    type: "cron",
    cron: "0 9 29 * *",           // 9am día 29
    workflow: "health-report-email",
    workflowInput: {
      to: ["gerencia@empresa.com"],
      include: ["vault", "fleet", "runs"]
    }
  })
```

### 🚀 Deploy automático

> **Usuario:** "Todos los lunes a las 10, deployá staging"

```
Director →
  cron: "0 10 * * 1"
  workflow: "deploy-staging"
  notifyOnFailure: true
```

### ⏳ Gate con timeout

> **Usuario:** "Si en 24hs nadie aprueba la solic[codex-context] ✓ Vault reindexed automatically
itud, escalá al líder"

Esto es particularmente interesante: un **one_time** que se crea al mismo tiempo que el gate:

```
schedule_task({
  type: "one_time",
  when: "+24h",                     // dentro de 24hs
  workflow: "escalate-approval",
  workflowInput: { runId, gateId }
})
```

Si alguien aprueba antes → `cancel_task(id)`. Si no → se dispara la escalación.

---

## 5. Engine de ejecución (proceso background)

```
Cada 30 segundos:
  1. Leer tasks.json
  2. Buscar: status=active AND nextRunAt <= now
  3. Para cada una:
     a. Ejecutar: orquestador.start_flow(workflow, input)
     b. Actualizar lastRunAt, nextRunAt, runCount
     c. Si one_time → status=completed
     d. Si error → status=failed, notificar
```

---

## 6. Seguridad

```json
{
  "schedule_task (one_time)":  "todos los roles",
  "schedule_task (cron)":      "solo admin, manager",
  "cancel_task":               "admin o creador",
  "list_scheduled":            "admin ve todas, usuario solo las suyas"
}
```

---

## 7. Lo que necesita el Director para que esto funcione

Para interpretar frases como *"mañana a las 11"* o *"cada 29 de mes"*, el Director necesita:

| Necesidad | Tool |
|---|---|
| Saber la hora actual | `get_current_time` |
| Saber la zona horaria del usuario | `get_user_timezone` |
| Parsear lenguaje natural a ISO/cron | Lógica interna del Director |
| Que el scheduler-agent exista | Registrar el agente en el pool |

---

## 8. Resumen de implementación

| Componente | Estado | Quién lo hace |
|---|---|---|
| **scheduler-agent** (agente MCP) | ❌ No existe | Lo creás vos |
| **tools** (schedule, list, cancel, etc.) | ❌ No existe | Lo implementás en el agente |
| **Persistencia** (tasks.json o SQLite) | ❌ No existe | Lo configurás en el agente |
| **Engine background** (cada 30s) | ❌ No existe | Proceso hijo del agente |
| **Parser de fechas** en el Director | ❌ No existe | Mejorar mi lógica |
| **Registro en el pool MCP** | ❌ No existe | Fleet deploy del agente |

---