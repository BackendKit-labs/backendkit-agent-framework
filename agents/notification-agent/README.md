# Notification-Agent

Agente MCP para notificaciones multicanal a usuarios finales de empresas (multi-tenant).

## Stack

- **Runtime:** Node.js 18+, TypeScript 5.x
- **Framework:** `@backendkit-labs/agent-core` (AgentMCPServer + engine pattern)
- **Ejecución:** `npx tsx` (sin build step)
- **Persistencia:** Archivos JSON en `~/.backendkit/notifier/`

## Instalación

```bash
cd notification-agent
npm install
cp .env.example .env   # Ajustar variables según entorno
```

## Uso

### Modo servidor MCP (stdio)

```bash
npx tsx src/notification-agent.ts
```

El servidor se comunica por stdio usando JSON-RPC 2.0. El Director del ecosistema BackendKit lo invoca automáticamente.

### Modo diagnóstico

```bash
npx tsx src/notification-agent.ts --test-all
```

Prueba todos los canales configurados y muestra un resumen.

## Tools (11)

| Tool | Descripción | Parámetros |
|------|-------------|------------|
| `notify_user` | Notifica a un usuario resolviendo el mejor canal según sus preferencias | `userId`, `companyId`, `title`, `body`, `context`, `priority?`, `forceChannel?`, `source` |
| `send_notification` | Envío directo por un canal específico | `channel`, `to?`, `subject?`, `body`, `priority?` |
| `notify_scheduled` | Programa una notificación para futuro (integra con Scheduler-Agent) | `userId`, `companyId`, `title`, `body`, `context`, `scheduleAt`, `timezone?`, `source` |
| `register_user_channels` | Registra/actualiza canales y preferencias del usuario | `userId`, `companyId`, `channels`, `preferences?` |
| `user_channels` | Consulta canales configurados de un usuario | `userId`, `companyId` |
| `list_channels` | Lista canales globales configurados | — |
| `test_channel` | Envía notificación de prueba a un canal y mide latencia | `channel`, `to?` |
| `get_notification_history` | Consulta historial de notificaciones | `userId?`, `companyId?`, `channel?`, `status?`, `source?`, `since?`, `limit?` |
| `register_device` | Registra dispositivo para notificaciones push | `userId`, `companyId`, `provider`, `token`, `platform` |
| `unregister_device` | Da de baja dispositivo push | `token`, `provider?` |
| `list_devices` | Lista dispositivos push registrados | `userId?`, `companyId?`, `provider?`, `active?`, `limit?` |

## Canales (8)

| Canal | Configuración | Env vars |
|-------|--------------|----------|
| **console** | Siempre disponible | — |
| **director** | Siempre disponible | — |
| **email** | SMTP | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` |
| **slack** | Webhook | `SLACK_WEBHOOK_URL` |
| **telegram** | Bot API | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` |
| **discord** | Webhook | `DISCORD_WEBHOOK_URL` |
| **webhook** | URL destino | — (se pasa en `to`) |
| **push** | FCM / Expo / OneSignal | `FCM_SERVER_KEY`, `EXPO_ACCESS_TOKEN`, `ONESIGNAL_APP_ID`, `ONESIGNAL_API_KEY` |

## Variables de Entorno

| Variable | Default | Descripción |
|----------|---------|-------------|
| `SMTP_HOST` | — | Host del servidor SMTP |
| `SMTP_PORT` | `587` | Puerto SMTP |
| `SMTP_USER` | — | Usuario SMTP |
| `SMTP_PASS` | — | Contraseña SMTP |
| `SMTP_FROM` | `noreply@notification-agent` | Dirección from para emails |
| `SLACK_WEBHOOK_URL` | — | Webhook URL de Slack |
| `TELEGRAM_BOT_TOKEN` | — | Token del bot de Telegram |
| `TELEGRAM_CHAT_ID` | — | Chat ID de Telegram |
| `DISCORD_WEBHOOK_URL` | — | Webhook URL de Discord |
| `FCM_SERVER_KEY` | — | Server key de Firebase Cloud Messaging |
| `EXPO_ACCESS_TOKEN` | — | Access token de Expo Push |
| `ONESIGNAL_APP_ID` | — | App ID de OneSignal |
| `ONESIGNAL_API_KEY` | — | API key de OneSignal |
| `NOTIFIER_DATA_DIR` | `~/.backendkit/notifier` | Directorio de datos persistentes |
| `SCHEDULER_URL` | `http://localhost:3100` | URL del Scheduler-Agent |

## Estructura del proyecto

```
src/
├── tools/                 # 11 handlers MCP
├── channels/              # 8 canales de notificación
│   └── push/              # 3 providers push (FCM, Expo, OneSignal)
├── services/              # Lógica de negocio
├── storage/               # Persistencia JSON
└── types/                 # Interfaces compartidas
```

## Persistencia

Los datos se almacenan en `~/.backendkit/notifier/`:

| Archivo | Propósito |
|---------|-----------|
| `config.json` | Configuración global (generada de env vars) |
| `users.json` | Usuarios con canales y preferencias |
| `history.json` | Historial de notificaciones enviadas |
| `devices.json` | Dispositivos push registrados |
| `scheduled.json` | Notificaciones programadas (respaldo local) |

## Integración con Scheduler-Agent

`notify_scheduled` delega la ejecución temporal al **Scheduler-Agent** del ecosistema:

1. Guarda localmente en `scheduled.json` (respaldo)
2. Registra en scheduler-agent vía `POST /tasks`
3. El scheduler ejecuta `notify_user` cuando la fecha llegue
4. Si el scheduler no está disponible, la notificación queda en `scheduled.json`

## Tolerancia a Fallos

- Cada canal tiene su propio try/catch
- Circuit breaker en canales HTTP (3 fallos → pausa 30s)
- Retry con backoff exponencial para errores de red
- Detección de tokens push expirados
- Respaldo local para notificaciones programadas
