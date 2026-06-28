
---

```
# 📬 Notification-Agent — Especificación completa para implementación

Implementá un servidor MCP (Model Context Protocol) sobre stdio en **TypeScript/Node.js** llamado **notification-agent**. Es un agente especialista que el **Director** invoca con `ask_agent("notification-agent", ...)` para gestionar notificaciones hacia **usuarios finales de empresas** (multi-tenant).

---

## 📐 Principios de diseño

### Clean Code — aplicá estos principios rigurosamente:

1. **Nombres significativos**:
   - `notifyUser()`, `sendEmail()`, `resolveBestChannel()`, no `doIt()`, `process()`, `handle()`
   - Variables con nombre del dominio: `pendingNotifications`, `userChannelPreferences`, `deliveryAttempt`

2. **Funciones pequeñas y una sola responsabilidad**:
   - `sendEmail()` solo envía email. `sendPush()` solo envía push.
   - `resolveBestChannel()` solo elige canal. No mezclar lógica de envío con lógica de resolución.
   - Cada función ≤ 20 líneas. Si se alarga, extraé.

3. **Sin efectos secundarios ocultos**:
   - `sendEmail()` no debe guardar en history. La guardada la hace el caller.
   - Separación clara: comando ≠ query.

4. **Manejo de errores con intención**:
   - Usar Result pattern o errores explícitos. Nada de try/catch genéricos que tragan todo.
   - Cada error con mensaje legible para el Director.

5. **DRY (Don't Repeat Yourself)**:
   - La lógica de HTTP POST para Slack, Discord, webhooks es la misma → extraé `httpPost(url, body, headers)`.
   - La lógica de elegir canal se repite en `notifyUser` y en la resolucion de fallbacks → extraé `resolveChannel()`.

6. **Separación por capas**:
   ```
   src/
     tools/          ← handlers MCP (solo reciben args, delegan)
     channels/       ← un archivo por canal: email.ts, push.ts, slack.ts, etc.
     services/       ← lógica de negocio: resolveChannel, fallback, quietHours
     storage/        ← persistencia: read/write JSON files
     types/          ← interfaces compartidas
     notification-agent.ts  ← entry point MCP
   ```

---

## 🏗️ Librería base: `@backendkit-labs/agent-core`

Usá **`@backendkit-labs/agent-core`** como base para construir el servidor MCP. Investigá su API real en el momento de implementar (corré `npm view @backendkit-labs/agent-core` o revisá su README). El patrón general del ecosistema es:

```typescript
// Patrón esperado (basado en el director-agent):
import { createMcpServer, registerTool } from "@backendkit-labs/agent-core";
// o similar. Revisá la API real del package.
```

Dependencias base que ya sabemos que usa el ecosistema:
```json
{
  "dependencies": {
    "@backendkit-labs/agent-core": "^1.0.0",
    "@modelcontextprotocol/sdk": "^1.0.0",
    "zod": "^3.22.0",
    "dotenv": "^16.3.0"
  }
}
```

Si `@backendkit-labs/agent-core` no cubre algo (ej: helpers HTTP), usá `axios`. Si no cubre validación, usá `zod`. Si no cubre persistencia, implementala con `fs` nativo.

---

## 🛠️ Tools a implementar (11 tools)

### 2.1 `notify_user` — PRINCIPAL. Notificar a un usuario de empresa

```typescript
Input: {
  userId: string
  companyId: string
  title: string
  body: string
  context: {
    type: "factura" | "alerta" | "recordatorio" | "aprobacion" | "sistema" | "otro"
    action?: "view" | "approve" | "pay" | "dismiss" | "open"
    referenceId?: string
    referenceUrl?: string
  }
  priority?: "low" | "normal" | "high" | "critical"
  forceChannel?: "email" | "push" | "telegram" | "slack" | "discord" | "in_app"
  source: string
}
Output: {
  id: string
  userId: string
  channel: string               // canal usado
  status: "sent" | "failed"
  deliveredAt: string
  fallbackUsed?: boolean
  attempts: { channel: string; status: string; error?: string }[]
}
```

**Comportamiento interno de `notify_user`:**
1. Buscar al usuario en `users.json` → obtener sus canales configurados y `preferences.order`
2. Si `forceChannel` está definido → validar que existe y está verificado, sino error
3. Si no → `resolveBestChannel(userId, companyId, priority)` que considera:
   - Orden de preferencia del usuario
   - Canales verificados
   - Quiet hours (saltear intrusivos: push, telegram, slack si está en horario silencio)
4. Intentar envío por el mejor canal
5. Si falla → **fallback automático** al siguiente canal en `preferences.order`
6. Si todos fallan → `status: "failed"` con detalle de cada intento
7. Guardar en historial con todos los intentos

### 2.2 `send_notification` — Envío directo por canal (bajo nivel)

```typescript
Input: {
  channel: "console" | "director" | "email" | "slack" | "telegram" | "discord" | "webhook" | "push"
  to?: string | string[]
  subject?: string
  body: string
  priority?: "low" | "normal" | "high" | "critical"
  attachments?: { filename: string; content: string; contentType: string }[]
  push?: PushPayload
  metadata?: { source?: string; userId?: string; companyId?: string; flow_id?: string; run_id?: string }
}
Output: { id: string; channel: string; status: "sent" | "queued" | "failed"; deliveredAt: string; error?: string }
```

### 2.3 `notify_scheduled` — Notificación programada

```typescript
Input: {
  userId: string; companyId: string; title: string; body: string; context: object
  scheduleAt: string; timezone?: string; priority?: string; source: string
}
Output: { id: string; scheduledAt: string; status: "scheduled" }
```

### 2.4 `register_user_channels` — Registrar/actualizar canales de un usuario

```typescript
Input: {
  userId: string; companyId: string
  channels: {
    email?: { address: string; verified: boolean }
    push?: { provider: "fcm" | "expo" | "onesignal"; token: string; platform: "ios" | "android" | "web" }
    telegram?: { chatId: string; username?: string }
    slack?: { webhookUrl: string; channel?: string }
    discord?: { webhookUrl: string }
    whatsapp?: { phone: string }
    in_app?: { enabled: boolean }
  }
  preferences?: {
    order: string[]
    quiet_hours?: { start: string; end: string; timezone: string }
    do_not_disturb?: boolean
  }
}
Output: { userId: string; status: "registered" | "updated"; recommendedChannel: string }
```

### 2.5 `user_channels` — Consultar canales de un usuario

```typescript
Input: { userId: string; companyId: string }
Output: {
  userId: string; companyId: string
  channels: { name: string; configured: boolean; verified: boolean; lastUsed?: string; preference: number }[]
  recommendedChannel: string; hasActiveChannel: boolean
}
```

### 2.6 `list_channels` — Canales globales configurados

```typescript
Input: {}
Output: { channels: { name: string; configured: boolean; type: "push" | "pull"; lastTested?: string }[] }
```

### 2.7 `test_channel` — Probar un canal

```typescript
Input: { channel: string; to?: string }
Output: { success: boolean; latencyMs: number; message: string }
```

### 2.8 `get_notification_history` — Historial

```typescript
Input: { userId?: string; companyId?: string; channel?: string; status?: "sent" | "failed"; source?: string; since?: string; limit?: number }
Output: { total: number; notifications: { id: string; userId?: string; companyId?: string; channel: string; title: string; body_preview: string; status: string; deliveredAt: string; error?: string; source?: string; fallbackUsed?: boolean }[] }
```

### 2.9 `register_device` — Registrar dispositivo push

```typescript
Input: { userId: string; companyId: string; provider: "fcm" | "expo" | "onesignal"; token: string; platform: "ios" | "android" | "web"; deviceInfo?: { osVersion?: string; appVersion?: string; model?: string }; tags?: Record<string, string> }
Output: { id: string; registeredAt: string; status: "active" }
```

### 2.10 `unregister_device` — Dar de baja dispositivo

```typescript
Input: { token: string; provider?: string }
Output: { status: "unregistered" }
```

### 2.11 `list_devices` — Listar dispositivos

```typescript
Input: { userId?: string; companyId?: string; provider?: string; active?: boolean; limit?: number }
Output: { total: number; devices: { id: string; userId: string; companyId: string; provider: string; token: string; platform: string; active: boolean; lastSeen: string; registeredAt: string }[] }
```

---

## 📲 PushPayload — Notificaciones push

```typescript
interface PushPayload {
  provider?: "fcm" | "expo" | "onesignal"
  tokens: string[]
  title: string; body: string
  icon?: string; image?: string
  sound?: "default" | "critical" | "silent"
  badge?: number
  data?: Record<string, any>
  actions?: { id: string; title: string; action: "open_url" | "deep_link" | "dismiss"; url?: string }[]
  group?: string; groupSummary?: string
  androidPriority?: "high" | "normal" | "low"
  iosInterruptionLevel?: "active" | "critical" | "passive" | "timeSensitive"
  ttl?: number
  segments?: string[]
}
```

**Endpoint por provider:**
- **FCM**: `POST https://fcm.googleapis.com/fcm/send` con header `Authorization: key={FCM_SERVER_KEY}`
- **Expo**: `POST https://exp.host/--/api/v2/push/send`
- **OneSignal**: `POST https://onesignal.com/api/v1/notifications` con header `Authorization: Basic {ONESIGNAL_API_KEY}`

---

## 📡 Canales — implementación de cada uno

| Canal | Implementación | Env vars |
|-------|---------------|----------|
| **console** | `console.log` con emoji, timestamp, prioridad | Ninguna |
| **director** | Devuelve string Markdown listo para respuesta del Director | Ninguna |
| **email** | Nodemailer SMTP | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` |
| **slack** | Webhook HTTP con blocks (header, body, color según prioridad) | `SLACK_WEBHOOK_URL` |
| **telegram** | Bot API → `sendMessage` con `parse_mode: Markdown` | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` |
| **discord** | Webhook HTTP con embeds (color según prioridad) | `DISCORD_WEBHOOK_URL` |
| **webhook** | POST genérico a URL en `to` | Ninguna |
| **push** | FCM / Expo / OneSignal | `FCM_SERVER_KEY`, `EXPO_ACCESS_TOKEN`, `ONESIGNAL_APP_ID`, `ONESIGNAL_API_KEY` |

**Colores por prioridad:**
- critical → `#FF0000` 🔴
- high → `#FFA500` 🟠
- normal → `#3498DB` 🔵
- low → `#95A5A6` ⚪

---

## 💾 Almacenamiento persistente

Tres archivos en `NOTIFIER_DATA_DIR` (default: `~/.backendkit/notifier/`):

### `config.json` — Config global (leída de env vars al startup)
```json
{ "channels": { "email": {...}, "slack": {...}, ... }, "defaults": { "priority": "normal", "maxRetries": 3, "retryDelayMs": 10000 } }
```

### `history.json` — Historial de notificaciones
```json
{ "notifications": { "notif-uuid": { id, userId, companyId, channel, title, body, status, createdAt, deliveredAt, error, retryCount, fallbackUsed, source, context } } }
```

### `users.json` — Usuarios con sus canales y preferencias
```json
{ "users": { "empresa-7:user-42": { userId, companyId, channels: {...}, preferences: {...}, devices: [...] } } }
```

### `devices.json` — Índice de dispositivos por token
```json
{ "devices": { "fcm:abc123": { id, userId, companyId, provider, token, platform, active, lastSeen } } }
```

---

## 🔄 Lógica de resolución de canales (Clean Code: extraé a `resolveBestChannel()`)

```
resolveBestChannel(userId, companyId, priority):
  1. Obtener usuario de users.json
  2. Si no existe → throw "Usuario no registrado"
  3. Obtener preferences.order: ["push", "email", "telegram"]
  4. Para cada canal en orden:
     a. Verificar configurado y verified
     b. Si priority !== "critical" y está en quiet_hours → skip intrusivos
     c. Si priority === "critical" → ignorar quiet hours
  5. Devolver el primer canal disponible
  6. Si ninguno → null
```

```
notify_user:
  1. channel = forceChannel ?? resolveBestChannel(userId, companyId, priority)
  2. Intentar send_notification(channel, ...)
  3. Si falla → fallback: siguiente canal en preferences.order
  4. Si todos fallan → status: "failed"
  5. Guardar en history.json
```

---

## 🔁 Retry lógica (Clean Code: extraé a `withRetry()`)

```
withRetry(fn, maxRetries=3, delayMs=10000):
  for intento in 1..maxRetries:
    resultado = fn()
    si resultado.ok → devolver resultado
    si error es 401/403/autenticación → NO reintentar, marcar failed
    si error de red/timeout → esperar delayMs, reintentar
  devolver último error
```

- Si push falla por token expirado (FCM error `NotRegistered`, `InvalidRegistration`) → marcar `device.active = false`

---

## 🔗 Integración con el Director

### Formato de entrada
El Director te llama con `ask_agent("notification-agent", '{ "tool": "...", "args": {...} }')`.
Cada tool MCP lleva nombre y argumentos con JSON-RPC 2.0 sobre stdio.

### Canal "director"
Cuando el canal es `"director"`, NO enviar nada externo. Devolver en `content` un string Markdown listo para que el Director lo incluya en su respuesta.

```
Input: { channel: "director", body: "Deploy completado" }
Output: { id, status: "sent", content: "✅ **Deploy completado exitosamente**" }
```

### Manejo de errores para el Director
Siempre devolver mensajes que el Director pueda mostrar textualmente:
```
{ status: "failed", error: "TELEGRAM_BOT_TOKEN no configurado. Usá TELEGRAM_BOT_TOKEN=xxx en las env vars." }
```

---

## 🌍 Environment variables

```bash
# === EMAIL ===
SMTP_HOST=; SMTP_PORT=587; SMTP_USER=; SMTP_PASS=; SMTP_FROM=noreply@midominio.com

# === SLACK ===
SLACK_WEBHOOK_URL=

# === TELEGRAM ===
TELEGRAM_BOT_TOKEN=; TELEGRAM_CHAT_ID=

# === DISCORD ===
DISCORD_WEBHOOK_URL=

# === PUSH ===
FCM_SERVER_KEY=; FCM_DEFAULT_ICON=
EXPO_ACCESS_TOKEN=
ONESIGNAL_APP_ID=; ONESIGNAL_API_KEY=

# === AGENT ===
NOTIFIER_DATA_DIR=~/.backendkit/notifier
```

---

## 📦 package.json

```json
{
  "name": "@backendkit-labs/notification-agent",
  "version": "1.0.0",
  "type": "module",
  "dependencies": {
    "@backendkit-labs/agent-core": "^1.0.0",
    "@modelcontextprotocol/sdk": "^1.0.0",
    "zod": "^3.22.0",
    "dotenv": "^16.3.0",
    "nodemailer": "^6.9.0",
    "uuid": "^9.0.0",
    "axios": "^1.6.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@types/nodemailer": "^6.4.0",
    "@types/uuid": "^9.0.0",
    "typescript": "^5.3.0",
    "tsx": "^4.7.0"
  },
  "scripts": {
    "start": "tsx src/notification-agent.ts",
    "dev": "tsx watch src/notification-agent.ts",
    "test-all": "tsx src/notification-agent.ts --test-all"
  }
}
```

---

## 🧹 Estructura de archivos esperada

```
notification-agent/
├── src/
│   ├── tools/
│   │   ├── notifyUser.ts
│   │   ├── sendNotification.ts
│   │   ├── registerUserChannels.ts
│   │   ├── userChannels.ts
│   │   ├── listChannels.ts
│   │   ├── testChannel.ts
│   │   ├── getHistory.ts
│   │   ├── registerDevice.ts
│   │   ├── unregisterDevice.ts
│   │   ├── listDevices.ts
│   │   └── notifyScheduled.ts
│   ├── channels/
│   │   ├── email.ts
│   │   ├── slack.ts
│   │   ├── telegram.ts
│   │   ├── discord.ts
│   │   ├── webhook.ts
│   │   ├── push/
│   │   │   ├── fcm.ts
│   │   │   ├── expo.ts
│   │   │   └── onesignal.ts
│   │   ├── console.ts
│   │   └── director.ts
│   ├── services/
│   │   ├── resolveChannel.ts     ← lógica de mejor canal + fallbacks
│   │   ├── quietHours.ts         ← validación de horarios
│   │   └── withRetry.ts          ← retry pattern
│   ├── storage/
│   │   ├── config.ts
│   │   ├── history.ts
│   │   └── users.ts
│   ├── types/
│   │   ├── notification.ts
│   │   ├── channel.ts
│   │   ├── user.ts
│   │   └── push.ts
│   └── notification-agent.ts     ← entry point MCP
├── package.json
├── tsconfig.json
└── README.md
```

Cada archivo de canal en `channels/` exporta UNA SOLA función pública con firma idéntica:

```typescript
// Ejemplo: channels/email.ts
export async function sendEmail(params: SendEmailParams): Promise<ChannelResult> { ... }

// Todas siguen esta interfaz:
interface ChannelResult {
  success: boolean;
  status: "sent" | "failed";
  deliveredAt: string;
  error?: string;
  latencyMs: number;
}
```

---

## 🏁 Entry point: `notification-agent.ts`

```typescript
// 1. Cargar dotenv
// 2. Inicializar storage (cargar config.json, users.json, etc.)
// 3. Crear servidor MCP con @backendkit-labs/agent-core (investigar API exacta)
// 4. Registrar las 11 tools (cada tool llama a su handler en tools/)
// 5. Iniciar stdio transport
// 6. Si --test-all, correr test en todos los canales configurados y exit(0)
```

---

## 🧪 Flag `--test-all`

```
$ tsx src/notification-agent.ts --test-all

Testing all configured channels...

  ✅ console    → OK (0ms)
  ✅ director   → OK (0ms)
  ✅ email      → OK (240ms)
  ❌ slack      → FAILED: 401 Unauthorized. Revisá SLACK_WEBHOOK_URL
  ✅ telegram   → OK (180ms)
  ⚪ discord    → not configured
  ✅ push (FCM) → OK (320ms)

Summary: 5/8 configured, 4/5 passed
```

---

## ✅ Entregable esperado

1. `src/` con toda la estructura de carpetas y archivos
2. `package.json` con dependencias
3. `tsconfig.json`
4. `README.md` con:
   - Instalación (`npm install`)
   - Configuración (env vars)
   - Uso (`npx tsx src/notification-agent.ts`)
   - Integración en `director.yaml`
   - Ejemplo de `--test-all`

---

## 📋 Checklist de verificación final

- [ ] Implementa las 11 tools MCP
- [ ] Usa `@backendkit-labs/agent-core` como base (investigar API real)
- [ ] Sigue Clean Code: funciones pequeñas, una responsabilidad, nombres claros, sin side effects
- [ ] Separación por capas: tools/ → channels/ → services/ → storage/
- [ ] Cada canal en su propio archivo con interfaz común `ChannelResult`
- [ ] `notify_user` tiene resolución automática de canal + fallbacks
- [ ] Push soporta 3 providers: FCM, Expo, OneSignal
- [ ] Retry lógica con `withRetry()`
- [ ] Persistencia en `~/.backendkit/notifier/` (config, history, users, devices)
- [ ] Canal "director" devuelve Markdown para el Director
- [ ] Flag `--test-all` funcional
- [ ] README con instrucciones completas
- [ ] El agente corre con solo `npx tsx notification-agent.ts`
```

---