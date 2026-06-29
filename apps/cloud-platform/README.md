# Cloud Platform

Control plane de infraestructura para el ecosistema BackendKit. Gestiona el ciclo de vida completo de agentes y aplicaciones: departments, deployables, catalog de templates, workflows y runtime adapters (Docker / k8s).

```
director-agent
    └── cloud-mcp (MCP stdio)
            └── Cloud Platform REST API  :3100
                    ├── Departments  (unidades organizativas + secrets cifrados)
                    ├── Deployables  (agentes/apps que se despliegan)
                    ├── Catalog      (templates reutilizables)
                    ├── Workflows    (pipelines multi-step)
                    └── Director     (runtime: deploy, stop, logs, metrics)
```

---

## Entornos

### Desarrollo local

Requiere Postgres y Redis corriendo (ver abajo). La app se levanta en modo watch — reinicia sola al guardar.

```bash
cd apps/cloud-platform

# 1. Variables de entorno
cp .env.example .env
# Edita .env — mínimo: JWT_SECRET

# 2. Dependencias de infraestructura (solo DB + Redis)
docker compose up db redis -d

# 3. Migraciones (primera vez o después de un pull)
for f in migrations/*.sql; do psql $DATABASE_URL -f "$f"; done

# 4. Arrancar
npm run start:dev
# → http://localhost:3000
```

> Puerto por defecto en dev: **3000**. Cambialo con `PORT=3100` en `.env`.

---

### Docker Compose (app + DB + Redis)

Todo en un solo comando. La app se expone en el puerto **3100** del host.

```bash
cd apps/cloud-platform

cp .env.example .env
# Edita al menos JWT_SECRET

docker compose up -d
docker compose logs -f app   # seguir logs
docker compose down          # detener
```

Variables clave para override en `.env`:

| Variable | Default | Descripción |
|---|---|---|
| `PORT` | `3100` | Puerto en el host |
| `JWT_SECRET` | *(cambiar)* | Clave de firma JWT |
| `DATABASE_URL` | `postgresql://...@db:5432/cloud_platform` | Override completo de DB |
| `RUNTIME_ENABLED` | `docker` | Runtimes activos: `docker`, `k8s`, o ambos `docker,k8s` |
| `DOCKER_HOST` | `unix:///var/run/docker.sock` | Socket Docker. Windows: `npipe:////./pipe/docker_engine` |

> **Seguridad:** el mount de `/var/run/docker.sock` es root-equivalente sobre el host. En producción usá un socket-proxy o k8s + RBAC.

---

### Kubernetes

```bash
cd apps/cloud-platform/k8s

# Aplicar todo (namespace, RBAC, configmap, deployment, service, ingress)
kubectl apply -k .

# Verificar
kubectl get all -n cloud-platform

# Logs
kubectl logs -n cloud-platform deploy/cloud-platform-backend -f
```

Configuración requerida antes de aplicar:

```bash
# Crear el secret con los valores reales (NO commitear secret.yaml)
kubectl create secret generic cloud-platform-secrets \
  --namespace cloud-platform \
  --from-literal=JWT_SECRET=<tu-clave> \
  --from-literal=DATABASE_URL=postgresql://user:pass@host:5432/cloud_platform
```

Variables de entorno en k8s — editá `k8s/configmap.yaml`:

```yaml
RUNTIME_ENABLED: "k8s"
K8S_NAMESPACE: "cloud-platform"   # namespace donde se crean los agents
```

---

## Setup inicial (primera vez)

> **Identidad unificada:** cloud-platform NO gestiona usuarios. El registro y el login
> viven en **auth-service** (único IdP). cloud-platform solo valida los JWT que emite
> auth-service, usando la clave compartida `AUTH_SECRET`. Ver `.specs/adr-unified-auth.md`.

```bash
BASE=http://localhost:3100        # cloud-platform
AUTH=http://localhost:4000        # auth-service (único IdP)

# 1. (En auth-service) crear el primer admin y loguear → obtener JWT
#    Ver apps/auth-service/README.md. Resumido:
curl -X POST $AUTH/api/setup \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"minimo10chars","name":"Administrador"}'

TOKEN=$(curl -s -X POST $AUTH/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"minimo10chars"}' | jq -r .token)

# 2. Con ese JWT, crear la API key M2M para el director en cloud-platform (se muestra UNA vez)
curl -X POST $BASE/api-keys \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"director-key","scopes":["*"]}'
# → guarda el campo "key": "bkc_xxx..."
```

> Requisito: `AUTH_SECRET` en cloud-platform debe ser **idéntico** al de auth-service para
> que sus JWT validen.

Configurá el director con esa key:

```bash
# .env del director-agent
CLOUD_PLATFORM_URL=http://localhost:3100
CLOUD_PLATFORM_API_KEY=bkc_xxx...
```

---

## Autenticación

Todos los endpoints (excepto `GET /director/status`, `GET /director/health`, `GET /director/runtimes`) requieren autenticación.

| Tipo | Header | Cuándo usarlo |
|---|---|---|
| JWT | `Authorization: Bearer <token>` | Usuario humano. **Lo emite auth-service**, cloud-platform solo lo valida (stateless, con `AUTH_SECRET`). |
| API Key | `X-Api-Key: bkc_xxx` | Machine-to-machine (director, CI, scripts) |

El guard `FlexAuthGuard` acepta ambos en cualquier endpoint protegido. El endpoint `/api-keys` solo acepta JWT (para gestionar keys necesitás ser humano).

Autorización: el guard `AuthzGuard` exige la tool cloud correspondiente (claim `tools[]` del JWT o `scopes[]` de la ApiKey) vía `@RequireTool(...)`, y el scope por departamento usa el claim `dept` (match contra `Department.slug`). Ver `.specs/adr-unified-auth.md`.

---

## API Reference

### Auth

cloud-platform **no expone** endpoints de registro/login. La identidad la gestiona
**auth-service** (`apps/auth-service`, puerto 4000): `POST /api/setup`, `POST /api/auth/login`
→ `{ token }`. cloud-platform solo valida ese JWT. Ver `.specs/adr-unified-auth.md`.

### Departments

Unidades organizativas que agrupan deployables y almacenan secrets para inject en runtime.

```
GET    /departments              ?slug=&name=
POST   /departments              body: { name, slug, description?, icon?, color? }
GET    /departments/:id
PATCH  /departments/:id
DELETE /departments/:id

GET    /departments/:id/secrets          → [{ key, createdAt }]  (sin valores)
POST   /departments/:id/secrets          body: { key: "OPENAI_API_KEY", value: "sk-..." }
DELETE /departments/:id/secrets/:key
```

Los secrets se inyectan automáticamente como variables de entorno al hacer deploy de un deployable del departamento.

### Deployables

Representan una instancia de agente o app que puede ser desplegada.

```
GET    /deployables              ?departmentId=&kind=agent|app&status=running|stopped|...
POST   /deployables              body: { name, kind, departmentId?, catalogKey?, image?, runtime?, model? }
GET    /deployables/:id
PATCH  /deployables/:id
DELETE /deployables/:id
```

`kind`: `agent` | `app`  
`runtime`: `docker` | `k8s` | `process`  
`status`: `pending` | `starting` | `running` | `stopped` | `error`

### Catalog

Templates reutilizables. Al crear un deployable con `catalogKey`, hereda imagen, env y `requiredSecrets` del template.

```
GET    /catalog                  ?category=dev|knowledge|hr|finance|ops|infra|custom
POST   /catalog                  body: { key, displayName, image, kind?, category?, env?, requiredSecrets?, runtime? }
GET    /catalog/:id
PATCH  /catalog/:id
DELETE /catalog/:id
```

`requiredSecrets` es una lista de keys (`UPPER_SNAKE_CASE`) que el departamento **debe** tener configurados antes de poder desplegar ese template. El director valida esto antes de tocar el runtime.

### Director (runtime)

```
GET  /director/status            → estado general (sin auth)
GET  /director/health            → health check (sin auth)
GET  /director/runtimes          → estado de cada runtime adapter (sin auth)
GET  /director/catalog           ?category=  → catalog view (sin auth)
GET  /director/metrics           → { totalDeployables, activeDeployables, byKind, byStatus, uptime }
GET  /director/agents            → deployables activos con runtimeHandle
GET  /director/agents/:id/logs   → logs del runtime (docker/k8s)

POST /director/deploy            body: { deployableId, image?, env? }  → DeployResult
POST /director/:id/stop          → detiene el runtime (preserva el Deployable en DB)
POST /director/execute/:id       body: { command }                     → exec en el contenedor
```

**Flujo deploy:**
1. Resuelve el template del catalog (`catalogKey`)
2. Valida que el department tenga todos los `requiredSecrets`
3. Inyecta secrets + vars estructurales (`AGENT_ID`, `AGENT_TYPE`, `MODEL`)
4. Llama al runtime adapter (Docker o k8s)
5. Actualiza `status` y `runtimeHandle` en el Deployable

### Workflows

Pipelines multi-step asociados a un departamento. La ejecución de steps es responsabilidad del orquestador externo; cloud-platform gestiona el estado.

```
GET    /workflows                ?departmentId=&status=draft|active|paused
POST   /workflows                body: { name, trigger, status?, departmentId?, steps?: [{order,deployableId?,config?}] }
GET    /workflows/:id            → workflow con steps ordenados
PATCH  /workflows/:id            body: partial + steps (reemplaza todos los steps si se envía)
DELETE /workflows/:id

POST   /workflows/:id/run        body: { input? }  → WorkflowRun { status: "pending" }
GET    /workflows/:id/runs       → historial de ejecuciones
GET    /workflows/runs/:runId    → estado de una ejecución
```

`trigger`: `manual` | `webhook` | `scheduled`

### API Keys

Solo accesible con JWT (no con API key).

```
GET    /api-keys         → lista (sin keyHash, sin valor)
POST   /api-keys         body: { name, scopes?, expiresAt? }  → CreateApiKeyResult (key se muestra UNA vez)
DELETE /api-keys/:id     → revoca
```

---

## Runtimes

| Runtime | Estado | Notas |
|---|---|---|
| `docker` | Disponible | Requiere Docker daemon. Usa `DOCKER_HOST`. |
| `k8s` | Disponible | Auto-detecta kubeconfig → in-cluster → `~/.kube/config`. Override con `K8S_KUBECONFIG`. |
| `process` | Coming soon | Ejecución local como proceso del host. |

Activar múltiples runtimes:

```bash
RUNTIME_ENABLED=docker,k8s
```

Verificar estado en runtime:

```bash
curl http://localhost:3100/director/runtimes
# → [{ kind: "docker", reachable: "reachable", ... }, { kind: "k8s", ... }]
```

---

## Integración con director-agent

cloud-platform se conecta al director via `cloud-mcp` (MCP stdio). El director usa sus 17 tools para operar la plataforma.

`agents/director-agent/director.yaml`:

```yaml
- name: cloud
  command: node
  args: ["../cloud-mcp/dist/server.js"]
  env:
    CLOUD_PLATFORM_URL: ${CLOUD_PLATFORM_URL}
    CLOUD_PLATFORM_API_KEY: ${CLOUD_PLATFORM_API_KEY}
```

Tools disponibles via director: `list_departments`, `get_department`, `list_deployables`, `get_deployable`, `cloud_deploy`, `cloud_stop`, `cloud_metrics`, `cloud_deployed_agents`, `list_catalog`, `get_catalog_entry`, `create_catalog_entry`, `update_catalog_entry`, `list_workflows`, `get_workflow`, `run_workflow`, `list_workflow_runs`, `get_workflow_run`.

---

## Comandos útiles

```bash
# Dev
npm run start:dev     # watch mode
npm run build         # compilar
npm test              # tests

# Docker
make docker-up        # levantar todo
make docker-down      # bajar
make docker-logs      # logs en vivo
make docker-build     # rebuild imagen

# k8s
make k8s-deploy       # kubectl apply -k k8s/
make k8s-status       # kubectl get all -n cloud-platform
make k8s-delete       # eliminar recursos

# Migrations (manual)
psql $DATABASE_URL -f migrations/0001_add_runtime_fields.sql
# ... 0002 a 0007
```
