# Config-Agent

Gestor centralizado de configuración del ecosistema BackendKit. Administra config, secrets, versionado, validación y schemas de todos los agentes MCP.

## Stack

- **Runtime:** Node.js 18+, TypeScript 5.x
- **Framework:** `@backendkit-labs/agent-core` (AgentMCPServer + engine pattern)
- **Ejecución:** `npx tsx` (sin build step)
- **Persistencia:** Archivos JSON versionados en `~/.backendkit/config/`
- **Encriptación:** AES-256-GCM con crypto nativo de Node.js
- **Web UI:** Express + EJS (opcional, Fase 2)

## Instalación

```bash
cd config-agent
npm install
cp .env.example .env   # Ajustar variables según entorno
```

## Uso

### Modo servidor MCP (stdio)

```bash
npx tsx src/config-agent.ts
```

El servidor se comunica por stdio usando JSON-RPC 2.0. El Director del ecosistema BackendKit lo invoca automáticamente.

### Modo diagnóstico

```bash
npx tsx src/config-agent.ts --test-all
```

Muestra las 13 tools registradas y verifica que el agente funciona correctamente.

### Interfaz web

```bash
npx tsx src/config-agent.ts --serve-ui
# O con puerto y tema personalizados:
npx tsx src/config-agent.ts --serve-ui --port 4000 --theme dark
```

Abre http://localhost:3456 para el dashboard de configuración.

### Validar todos los agentes

```bash
npx tsx src/config-agent.ts --validate-all
```

### Detectar variables de entorno

```bash
npx tsx src/config-agent.ts --detect-env
```

### Exportar configuración

```bash
npx tsx src/config-agent.ts --export notification-agent --format env
npx tsx src/config-agent.ts --export notification-agent --format json
```

## Tools (13)

### Lectura (4)

| Tool | Descripción | Parámetros |
|------|-------------|------------|
| `get_config` | Obtener configuración de un agente | `agent_id`, `key?`, `version?`, `includeSecrets?` |
| `list_configs` | Listar configuración con metadata | `agent_id` |
| `diff_config` | Comparar dos versiones | `agent_id`, `version_a`, `version_b`, `format?` |
| `get_config_schema` | Obtener schema de un agente | `agent_id` |

### Escritura (5)

| Tool | Descripción | Parámetros |
|------|-------------|------------|
| `set_config` | Establecer un valor de configuración | `agent_id`, `key`, `value`, `message?`, `reload?` |
| `set_secret` | Guardar un secreto encriptado | `agent_id`, `key`, `value`, `message?`, `reload?` |
| `import_config` | Importar configuración batch | `agent_id`, `format`, `content`, `mode`, `message?` |
| `restore_config` | Restaurar versión anterior (inmutable) | `agent_id`, `version`, `reload?` |
| `commit_config` | Versionar explícitamente | `agent_id`, `message` |

### Operación (3)

| Tool | Descripción | Parámetros |
|------|-------------|------------|
| `validate_config` | Validar configuración contra schema | `agent_id`, `version?` |
| `reload_config` | Notificar recarga a un agente | `agent_id` |
| `detect_env` | Detectar variables de entorno | `agent_id`, `prefix?`, `save?`, `mode?` |

### Web UI (1)

| Tool | Descripción | Parámetros |
|------|-------------|------------|
| `serve_config_ui` | Iniciar interfaz web | `agent_id?`, `port?`, `theme?`, `autoOpen?` |

## Variables de Entorno

| Variable | Default | Descripción |
|----------|---------|-------------|
| `CONFIG_DATA_DIR` | `~/.backendkit/config` | Directorio de datos persistentes |
| `CONFIG_MASTER_KEY` | — | Clave maestra para encriptación (se genera automáticamente) |
| `CONFIG_UI_PORT` | `3456` | Puerto para la interfaz web |
| `CONFIG_UI_AUTO_OPEN` | `false` | Abrir navegador al iniciar UI |
| `CONFIG_UI_THEME` | `light` | Tema visual: light o dark |
| `CONFIG_AUTO_DETECT_ENV` | `true` | Detectar env vars al startup |
| `CONFIG_AUTO_VALIDATE` | `true` | Validar config después de cada cambio |

## Estructura del proyecto

```
config-agent/
├── src/
│   ├── tools/                 # 13 handlers MCP
│   ├── storage/               # Persistencia versionada + secrets + schemas
│   ├── services/              # Lógica de negocio (validator, differ, merger, inferer, envDetector)
│   ├── web/                   # Interfaz web (Express + EJS)
│   │   ├── routes/            # Dashboard, config, history, diff, api
│   │   ├── views/             # Templates EJS
│   │   └── public/            # CSS + JS (tema light/dark)
│   └── types/                 # Interfaces compartidas
├── package.json
├── tsconfig.json
├── .env.example
├── README.md
├── specification.md
├── design.md
└── ROADMAP.md
```

## Persistencia

Los datos se almacenan en `~/.backendkit/config/`:

| Archivo | Propósito |
|---------|-----------|
| `agents/{id}/v{N}__{date}_{msg}.json` | Versiones de configuración |
| `agents/{id}/current` | Symlink/archivo a la versión activa |
| `secrets/{id}.json` | Secrets encriptados (AES-256-GCM) |
| `secrets/master.key` | Clave maestra (generada automáticamente) |
| `schemas/{id}.json` | Schemas registrados por los agentes |
| `config-agent.json` | Configuración del propio config-agent |

## Integración con el Director

El Director invoca al config-agent con `ask_agent("config-agent", { tool, args })`.

### Patrones de uso

**1. El usuario da el valor explícitamente**
```
Usuario: "Cambiá el webhook de Slack a https://hooks.slack.com/ABC"
→ set_config("notification-agent", "SLACK_WEBHOOK_URL", "https://hooks.slack.com/ABC")
→ "✅ Webhook de Slack actualizado."
```

**2. El usuario pide cambio pero NO da el valor → preguntar**
```
Usuario: "Actualizá el token de Telegram"
→ "❓ Necesito el nuevo TELEGRAM_BOT_TOKEN para actualizarlo. ¿Cuál es?"
```

**3. Setup inicial guiado**
```
Usuario: "Configurá el notification-agent desde cero"
→ validate_config("notification-agent")
→ "❌ Faltan: SMTP_HOST, SMTP_USER, SMTP_PASS, SLACK_WEBHOOK_URL"
→ "Necesito que me des: 1) SMTP_HOST, 2) SMTP_USER..."
```

**4. Health-checker detecta problema**
```
health-checker → test_channel("telegram") → 401
health-checker → get_config("notification-agent", "TELEGRAM_BOT_TOKEN") → token existe
health-checker → "⚠️ Token de Telegram expiró. Necesito uno nuevo."
Usuario: "Ahí va: nuevo_token_456"
→ set_config("notification-agent", "TELEGRAM_BOT_TOKEN", "nuevo_token_456")
→ reload_config("notification-agent")
→ "✅ Telegram funcionando de nuevo."
```

## Tolerancia a Fallos

- Cada tool tiene su propio try/catch con mensajes claros
- Ninguna tool inventa valores — si falta input, falla con mensaje accionable
- Historial de versiones inmutable (nunca se modifican versiones existentes)
- Secrets encriptados con AES-256-GCM (detección de manipulación)
- Master key generada automáticamente al primer startup
- Fallback a archivo en Windows si symlink no está disponible
