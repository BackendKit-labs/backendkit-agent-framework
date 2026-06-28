
```
Necesito que implementes un agente MCP (Model Context Protocol) llamado **health-checker** en TypeScript/Node.js, para el ecosistema BackendKit.

## Arquitectura

Es un servidor MCP que se comunica por **stdio** con JSON-RPC 2.0. El Director lo invoca con `ask_agent("health-checker", ...)`.

## Tools que debe exponer

### 1. `system_health`
Check global completo. Sin parámetros de entrada. Devuelve un `HealthReport` completo (ver tipos abajo).

Internamente debe:
- Hacer ping al orquestador en `ORCHESTRATOR_URL` (env var) → medir latencia
- Ejecutar `ps aux | grep -E "node|docker"` o similar para ver procesos vivos
- Leer `/proc/meminfo`, `/proc/stat`, `df -h` para CPU, RAM, disco
- Leer `SCHEDULER_TASKS_PATH` (env var) si existe, para tareas vencidas
- Llamar al orquestador para listar agentes y runs registrados
- Verificar que el vault de codex responde (si `CODEX_VAULT_PATH` existe)
- Verificar conectividad a messaging broker si `BROKER_URL` está configurado

### 2. `check_agent`
Input: `{ agent_id: string }`
Output: `{ status: "up" | "down" | "unknown", latency_ms: number, last_seen?: string }`
Hace un ping al agente específico intentando resolver su endpoint desde el orquestador.

### 3. `check_environment`
Input: ninguno
Output: `{ cpu_percent, memory_percent, disk_percent, uptime, process_count, backendkit_processes: { agent_id, pid, cpu, mem }[] }`
Usa `os` y `child_process` para leer métricas del sistema.

### 4. `check_messaging`
Input: ninguno
Output: `{ broker: "connected" | "disconnected" | "not_configured", type: "redis" | "rabbitmq" | "none", queue_depth?: number, latency_ms?: number }`
Si no hay BROKER_URL configurado, responde `not_configured`.

### 5. `check_scheduler`
Input: ninguno
Output: `{ configured: boolean, tasks_scheduled: number, tasks_overdue: number, tasks_failed: number, tasks: { id, type, status, nextRunAt, overdue: boolean }[] }`
Lee el archivo de tasks del scheduler-agent si existe.

### 6. `end_to_end_test`
Input: `{ flow_id?: string }` — opcional, si no se pasa usa un flow de prueba "health-check-test" (crearlo si no existe)
Output: `{ success: boolean, flow_id: string, run_id: string, duration_ms: number, steps_completed: number, error?: string }`
Crea un flow mínimo que haga un echo y devuelva OK, lo ejecuta con `start_flow`, espera resultado.

## Tipos compartidos

```typescript
interface HealthReport {
  status: "healthy" | "degraded" | "down"
  timestamp: string
  checks: {
    orchestrator: { status: "up" | "down"; latency_ms: number }
    agents: {
      total: number
      alive: number
      dead: string[]
      unregistered: number
    }
    flows: {
      configured: number
      active_runs: number
      failed_last_hour: number
    }
    scheduler: {
      tasks_scheduled: number
      tasks_overdue: number
      tasks_failed: number
    }
    environment: {
      cpu_percent: number
      memory_percent: number
      disk_percent: number
      uptime: string
      process_count: number
    }
    messaging: {
      status: "connected" | "disconnected" | "not_configured"
      type: string
      queue_depth?: number
    }
    vault: {
      indexed: boolean
      notes: number
    }
  }
  summary: string
  recommended_actions: string[]
}
```

## Formato MCP (stdio)

Cada tool se expone como herramienta MCP estándar:

```json
// Request del Director
{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"system_health","arguments":{}}}

// Response del agente
{"jsonrpc":"2.0","id":1,"result":{"content":[{"type":"text","text":"{\"status\":\"healthy\",\"timestamp\":\"...\",...}"}]}}
```

Usá el SDK `@modelcontextprotocol/sdk` para simplificar.

## Configuración por environment variables

| Variable | Default | Descripción |
|----------|---------|-------------|
| `ORCHESTRATOR_URL` | `http://localhost:3000` | URL del orquestador |
| `SCHEDULER_TASKS_PATH` | `~/.backendkit/scheduler/tasks.json` | Ruta al scheduler |
| `CODEX_VAULT_PATH` | `~/.backendkit/vaults` | Ruta al vault |
| `BROKER_URL` | — | URL del broker de mensajería |
| `HEALTH_CHECK_INTERVAL` | `60000` | Intervalo del cache interno (ms) |

## Cache interno

Las tools deberían cachear resultados pesados por ~30 segundos para no sobrecargar el sistema en consultas frecuentes. Usá una variable global simple con timestamp de último refresh.

## Comportamiento en errores

Si algo falla (ej: no se puede conectar al orquestador), **no crashear**. Reportar `"down"` en ese check y seguir con los demás. El reporte completo siempre debe devolverse, incluso si algunos checks fallan.

## Salida esperada

Implementame esto en un solo archivo `health-checker.ts` que al hacer `npx tsx health-checker.ts` se conecte por stdio y empiece a responder tools. Incluí `package.json` con las dependencias mínimas.

Bonus: agregá un flag `--check-now` que, si se pasa, ejecuta `system_health` una vez y lo imprime en consola (útil para debug y para que el Director lo llame desde un cron).
```

---