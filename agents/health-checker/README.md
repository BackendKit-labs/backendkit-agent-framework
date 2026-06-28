# Health-Checker

Agente MCP para monitoreo de salud del ecosistema BackendKit.

## Stack

- **Runtime:** Node.js 18+, TypeScript 5.x
- **Framework:** `@backendkit-labs/mcp-server` (AgentMCPServer + engine pattern)
- **Ejecución:** `npx tsx` (sin build step)
- **Dependencias:** `@backendkit-labs/mcp-server`, `@backendkit-labs/agent-core`, `zod`, `dotenv`

## Instalación

```bash
cd health-checker
npm install
cp .env.example .env   # Ajustar variables según entorno
```

## Uso

### Modo servidor MCP (stdio)

```bash
npx tsx health-checker.ts
```

El servidor se comunica por stdio usando JSON-RPC 2.0. El Director del ecosistema BackendKit lo invoca automáticamente.

### Modo CLI (debug)

```bash
npx tsx health-checker.ts --check-now
```

Ejecuta `system_health` una vez y muestra el reporte en consola. Útil para debug y para ser llamado desde un cron.

## Tools

| Tool | Descripción | Parámetros |
|------|-------------|------------|
| `system_health` | Reporte completo de salud del ecosistema | — |
| `check_agent` | Verifica el estado de un agente específico | `agent_id: string` |
| `check_environment` | Métricas del sistema local (CPU, RAM, disco, procesos) | — |
| `check_messaging` | Verifica conectividad al broker de mensajería | — |
| `check_scheduler` | Lee tareas del scheduler-agent y reporta su estado | — |
| `check_vault` | Verifica el estado del vault de codex (notas indexadas) | — |
| `end_to_end_test` | Ejecuta un test de integración end-to-end | `flow_id?: string` |

## Variables de Entorno

| Variable | Default | Descripción |
|----------|---------|-------------|
| `ORCHESTRATOR_URL` | `http://localhost:3000` | URL del orquestador BackendKit |
| `SCHEDULER_TASKS_PATH` | `~/.backendkit/scheduler/tasks.json` | Ruta al archivo de tareas del scheduler |
| `CODEX_VAULT_PATH` | `~/.backendkit/vaults` | Ruta al vault de codex |
| `BROKER_URL` | — | URL del broker de mensajería (Redis o RabbitMQ) |
| `HEALTH_CHECK_INTERVAL` | `60000` | Intervalo de cache interno (ms) |

## Estructura del proyecto

```
src/
├── types.ts                  # Interfaces compartidas
├── cache.ts                  # Cache Manager (TTL 30s)
├── fetch.ts                  # Helper HTTP con timeout
├── checks/
│   ├── environment.ts        # Métricas de sistema (CPU, RAM, disco)
│   ├── orchestrator.ts       # Comunicación con el orquestador
│   ├── messaging.ts          # Conectividad al broker (TCP)
│   ├── scheduler.ts          # Lectura de tareas del scheduler
│   ├── vault.ts              # Verificación del vault de codex
│   └── e2e.ts                # Test end-to-end
├── engine.ts                 # Registry pattern + handlers
├── tools.ts                  # Schemas Zod + buildPrompt
└── main.ts                   # Entry point
```

## Reporte de Salud

El reporte de `system_health` incluye:

```json
{
  "status": "healthy | degraded | down",
  "timestamp": "2026-01-01T00:00:00.000Z",
  "checks": {
    "orchestrator": { "status": "up | down", "latency_ms": 123 },
    "agents": { "total": 5, "alive": 4, "dead": ["agent-x"], "unregistered": 0 },
    "flows": { "configured": 10, "active_runs": 2, "failed_last_hour": 0 },
    "scheduler": { "configured": true, "tasks_scheduled": 15, "tasks_overdue": 1, "tasks_failed": 0 },
    "environment": { "cpu_percent": 45.2, "memory_percent": 72.1, "disk_percent": 68.5, "uptime": "5d 12h 30m", "process_count": 312 },
    "messaging": { "status": "connected | disconnected | not_configured", "type": "redis | rabbitmq | none" },
    "vault": { "indexed": true, "notes": 336 }
  },
  "summary": "Health check - Orquestador: up, Agentes: 4/5, Flows: 2, Scheduler: 15 tasks, Vault: 336 notas",
  "recommended_actions": []
}
```

## Cache

Resultados pesados se cachean por 30 segundos para no sobrecargar el sistema en consultas frecuentes. El cache es en memoria y se pierde al reiniciar el proceso.

## Tolerancia a Fallos

Si un check individual falla (ej: orquestador no responde, archivo no existe), se reporta como `"down"` y se continúa con los demás checks. El reporte completo siempre se devuelve.
