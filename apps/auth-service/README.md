# Auth Service

Servicio de autenticación y gestión de identidad para el ecosistema BackendKit. Emite JWTs que el director-agent y vault-manager usan para controlar acceso. Basado en Next.js 14 (App Router) con SQLite vía libsql / Turso.

```
Usuario / admin UI
      │
      ▼
Auth Service  :4000            (Next.js + SQLite)
      │
      ├── JWT  →  director-agent  (valida token, lee tools[] del payload)
      └── JWT  →  vault-manager   (valida token, lee vault[] del payload)
```

El JWT incluye en su payload:
- `role` — rol del usuario (`admin`, `development`, `devops`, `hr`, etc.)
- `tools` — lista de tools del director que el usuario puede invocar
- `vault` — namespaces del vault a los que tiene acceso
- `apps` — aplicaciones habilitadas (`director`, `vault-manager`)
- `dept` — departamento (opcional)

---

## Levantar el servicio

### Desarrollo local

```bash
cd apps/auth-service

# 1. Variables de entorno
cp .env.example .env 2>/dev/null || cat > .env << 'EOF'
AUTH_SECRET=cambia-esto-en-produccion-minimo-32-chars
# SQLite local (default — no necesita configuración extra)
# Para Turso cloud, descomenta:
# TURSO_URL=libsql://tu-db.turso.io
# TURSO_TOKEN=tu-token
EOF

# 2. Iniciar en modo dev
npm run dev
# → http://localhost:4000
```

La DB SQLite se crea automáticamente en la primera request a `/api/setup` o `/api/auth/login`. No hay paso de migración manual — `ensureSchema()` crea las tablas si no existen.

### Producción (Next.js standalone)

```bash
npm run build
npm start
# → http://localhost:4000
```

### Docker

El servicio no incluye `docker-compose.yml` propio porque la DB es un archivo SQLite embebido. Si querés dockerizarlo:

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY . .
RUN npm ci && npm run build

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
ENV AUTH_SECRET=<tu-secreto>
ENV PORT=4000
EXPOSE 4000
CMD ["node", "server.js"]
```

### Con Turso (SQLite cloud)

Para persistencia en producción sin gestionar un archivo de DB:

```bash
# .env
TURSO_URL=libsql://tu-base.turso.io
TURSO_TOKEN=eyJhbGci...
AUTH_SECRET=cambia-esto-en-produccion
```

---

## Setup inicial (primera vez)

```bash
BASE=http://localhost:4000

# Verificar si el setup es necesario
curl $BASE/api/setup
# → { "setupRequired": true }

# Crear el primer usuario admin (solo funciona si la DB está vacía)
curl -X POST $BASE/api/setup \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"minimo10chars","name":"Administrador"}'
# → { "ok": true, "message": "Usuario \"admin\" creado como admin." }
```

Después del primer usuario, `POST /api/setup` devuelve `409` — permanentemente cerrado.

---

## Variables de entorno

| Variable | Requerida | Descripción |
|---|---|---|
| `AUTH_SECRET` | Sí | Clave de firma JWT (mínimo 32 caracteres) |
| `TURSO_URL` | No | URL de DB Turso (`libsql://...`). Si no se define, usa SQLite local. |
| `TURSO_TOKEN` | No | Token de acceso Turso |

---

## API Reference

### Setup

```
GET  /api/setup   → { setupRequired: boolean }
POST /api/setup   body: { username, password, name? }   → { ok, message }   (solo si DB vacía)
```

---

### Auth

```
POST /api/auth/login    body: { username, password }  → { token, user }
POST /api/auth/verify   body: { token }               → { valid: true, user: payload }
                                                       → { valid: false, error }  (401)
```

**Login acepta `username` o `email`** en el campo `username`.

**Lockout por intentos fallidos:** 5 intentos incorrectos bloquean la cuenta 5 minutos. La respuesta incluye el contador actual (`"Contraseña incorrecta (3/5)"`) y el tiempo restante si está bloqueada.

**Token payload:**

```json
{
  "sub":   "uuid-del-usuario",
  "role":  "development",
  "dept":  "backend",
  "tools": ["search_vault", "orchestrator_run", "..."],
  "vault": ["backend/", "infra/"],
  "apps":  ["director"]
}
```

---

### Users  *(requiere admin)*

```
GET    /api/users          → lista de usuarios (sin passwordHash)
POST   /api/users          body: { username, password, role, name?, email?, department?,
                                   canUseDirector?, canUseVault?,
                                   directorTools?, vaultNamespaces? }
GET    /api/users/:id
PUT    /api/users/:id      body: campos a actualizar (todos opcionales)
DELETE /api/users/:id      → soft delete (active: false)
```

Campos de usuario:

| Campo | Tipo | Descripción |
|---|---|---|
| `username` | string | Único |
| `role` | string | Nombre del rol (`admin`, `development`, `devops`, `hr`, `sales`, `finance`, `viewer`) |
| `department` | string | Nombre del departamento |
| `canUseDirector` | bool | Puede acceder al director-agent |
| `canUseVault` | bool | Puede acceder al vault-manager |
| `directorTools` | string[] \| null | Override per-user de tools (si null, hereda del rol) |
| `vaultNamespaces` | string[] \| null | Namespaces del vault accesibles |

**Roles y tools:** si `directorTools` es `null`, el token lleva las tools configuradas en el rol. Si se define, sobreescribe el rol — útil para permisos personalizados sin crear un rol nuevo.

---

### Roles  *(GET público, write requiere admin)*

Los roles definen qué tools del director puede invocar un usuario. Al crear un rol, se le asigna una lista de tools.

```
GET    /api/roles          → lista de roles activos (público)
POST   /api/roles          body: { name, label, description?, tools?: string[] }
GET    /api/roles/:id      (admin)
PUT    /api/roles/:id      body: { label?, description?, tools?, active? }  (admin)
DELETE /api/roles/:id      → soft delete  (admin)
```

`name` es el identificador kebab-case (ej: `tech-lead`).  
`tools` es un array con los nombres exactos de las tools del director.

**Grupos de tools disponibles:**

| Grupo | Tools de ejemplo |
|---|---|
| Vault (lectura) | `search_vault`, `vault_status`, `read_note` |
| Vault (escritura) | `curate_path`, `curate_link`, `reindex_vault`, `reset_vault` |
| Coder (SDD) | `orchestrator_design`, `orchestrator_run`, `orchestrator_approve` |
| Proyectos | `project_list`, `project_switch`, `project_create` |
| Flows | `run_flow`, `run_task`, `run_status`, `list_runs` |
| Scheduler | `schedule_task`, `list_scheduled`, `cancel_task` |
| Health | `system_health`, `check_agent`, `check_environment` |
| Configuración | `get_config`, `set_config`, `set_secret`, `reload_config` |
| Deploy (Fleet) | `deploy_agent`, `stop_agent`, `list_deployments` |
| Notificaciones | `notify_user`, `send_notification`, `test_channel` |

---

### Departments  *(GET público, write requiere admin)*

Departamentos organizativos. Se reflejan en el campo `dept` del JWT y en los filtros de vault visibility del director.

```
GET    /api/departments           → lista de departamentos activos (público)
POST   /api/departments           body: { name, description? }  (admin)
GET    /api/departments/:id       (admin)
PUT    /api/departments/:id       body: { name?, description?, active? }  (admin)
DELETE /api/departments/:id       → soft delete  (admin)
```

---

## Ejemplos rápidos

```bash
BASE=http://localhost:4000

# Login
TOKEN=$(curl -s -X POST $BASE/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"minimo10chars"}' | jq -r .token)

# Crear un rol "devops" con tools de deploy + health
curl -X POST $BASE/api/roles \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "devops",
    "label": "DevOps",
    "tools": ["deploy_agent","stop_agent","list_deployments","fleet_health","system_health","check_environment"]
  }'

# Crear un usuario del equipo de infra
curl -X POST $BASE/api/users \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "maria",
    "password": "segura123!",
    "name": "María García",
    "role": "devops",
    "department": "infraestructura",
    "canUseDirector": true,
    "canUseVault": false
  }'

# Verificar un token
curl -X POST $BASE/api/auth/verify \
  -H "Content-Type: application/json" \
  -d "{\"token\":\"$TOKEN\"}"

# Listar usuarios
curl $BASE/api/users -H "Authorization: Bearer $TOKEN"

# Desactivar un usuario
curl -X DELETE $BASE/api/users/<uuid> -H "Authorization: Bearer $TOKEN"
```

---

## Integración con director-agent

El director lee `AUTH_SECRET` para validar los tokens que recibe en sus WebSocket / HTTP connections.

```bash
# .env del director-agent
AUTH_SECRET=mismo-valor-que-en-auth-service
AUTH_SERVICE_URL=http://localhost:4000   # usado por vault-manager para verify
```

El director extrae del JWT:
- `tools[]` → qué tools del RBAC puede invocar (capa 2 de access control)
- `vault[]` → qué namespaces del vault son visibles (capa 4 de vault visibility)
- `apps[]` → a qué aplicaciones puede conectarse

---

## Comandos

```bash
npm run dev          # modo desarrollo, hot reload, puerto 4000
npm run build        # compilar para producción
npm start            # producción, puerto 4000
npm run db:studio    # Drizzle Studio (UI para inspeccionar la DB)
npm run db:push      # sincronizar schema (dev only)
```
