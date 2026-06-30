# agent-cloud — Arquitectura de la Plataforma

## Visión

agent-cloud es una **plataforma de despliegue de inteligencia operacional** para empresas. Permite que cada área (HR, Legal, Finanzas, IT, Operaciones, Atención al Cliente) tenga sus propios agentes de IA y aplicaciones corriendo, adaptados a sus flujos de trabajo específicos.

No está limitada a proyectos de código generados por bk-coder. Es una plataforma general para desplegar cualquier agente o app como contenedor, organizado por departamento empresarial, con el `director-agent` como cerebro pensante que orquesta los despliegues y flujos.

---

## Dos capas complementarias

```
┌─────────────────────────────────────────────────────────────┐
│                    CAPA DE INTELIGENCIA                      │
│                                                              │
│   director-agent  (AI brain — agent-framework)              │
│   ┌──────────────────────────────────────────────────────┐  │
│   │  Entiende contexto empresarial y necesidades del    │  │
│   │  usuario. Decide qué desplegar, cuándo y para qué  │  │
│   │  departamento. Orquesta workflows multi-agente.     │  │
│   │  Responde: "necesito un flujo legal para contratos" │  │
│   └──────────────────────────────────────────────────┘  │  │
│                          │                                   │
│              llama via REST API + ApiKey                     │
└──────────────────────────┼──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│                    CAPA DE INFRAESTRUCTURA                   │
│                                                              │
│   agent-cloud  (NestJS + TypeORM + Docker)                   │
│   ┌──────────────────────────────────────────────────────┐  │
│   │  Department / Deployable / Secret / Workflow        │  │
│   │  CatalogEntry / ApiKey                              │  │
│   │  RuntimeRegistry (Docker → k8s → process)           │  │
│   │  API REST consumible por humanos Y por AI           │  │
│   └──────────────────────────────────────────────────┘  │  │
│                          │                                   │
│              controla via Docker API / k8s API               │
└──────────────────────────┼──────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│                    CAPA DE EJECUCIÓN                         │
│                                                              │
│   knowledge-vault  │  hr-onboarding  │  support-bot  │  ... │
│   (contenedores con contrato agent-image)                    │
└─────────────────────────────────────────────────────────────┘
```

---

## Modelo de Dominio

### Organization
```
id, name, slug
```
Un tenant. Hoy implícito (single-tenant). La estructura lo soporta cuando sea necesario.

---

### Department
```
id, name, slug, description, icon, color
orgId (FK → Organization)
```
Área de negocio: HR, Legal, Finanzas, IT, Operaciones, Atención al Cliente, etc.
Es la unidad organizativa central. Todo deployable y workflow pertenece a un departamento.

---

### Deployable  ← unidad de despliegue
```
id, name, description
kind:          'agent' | 'app'
status:        pending | starting | running | stopped | error
departmentId   (FK → Department)

-- origen --
catalogKey     (template que se usó para crearlo)
image          (imagen Docker; override del catálogo si se especifica)
runtime:       'docker' | 'k8s' | 'process'

-- runtime vivo --
runtimeHandle  (container ID / pod name / process PID)

-- para kind='agent' --
model          (LLM: claude-opus-4-8, claude-sonnet-4-6, etc.)
mcpPort        (puerto MCP si expone herramientas MCP)

-- para kind='app' --
publicPort
publicUrl      (URL asignada cuando levanta)
framework      (nextjs | fastapi | express | custom)
```

Reemplaza la entidad `Agent` original. Un agente MCP y una app web son ambos deployables — se distinguen por `kind`.

---

### Secret
```
id, key, value
departmentId (FK → Department)
```
Scoped al área. Al hacer deploy de un deployable, el director inyecta automáticamente todos los secrets del `departmentId` correspondiente. Sin encriptación en Fase 1 (se añade con KMS/Vault en prod multi-tenant).

---

### Workflow
```
id, name, description, trigger
status:      draft | active | paused
departmentId (FK → Department)
steps:       WorkflowStep[]
```
Representa un flujo de negocio compuesto por varios deployables. El director-agent puede crear y ejecutar workflows para responder a solicitudes empresariales complejas.

**Ejemplo:**
```
Workflow: "Revisión de contrato nuevo"  (Dept: Legal)
  Step 1 → document-analyzer   (extrae cláusulas del PDF)
  Step 2 → contract-reviewer   (evalúa riesgos)
  Step 3 → knowledge-vault     (busca precedentes internos)
  Step 4 → [notifica al responsable legal con el análisis]
```

---

### WorkflowStep
```
id, order, config
deployableId (FK → Deployable)
workflowId   (FK → Workflow)
```

---

### ApiKey
```
id, name, keyHash (SHA-256 del key en texto plano), scopes[]
createdAt, lastUsedAt, expiresAt?
```
Para autenticación machine-to-machine. El director-agent usa una ApiKey para llamar a agent-cloud sin sesión de usuario. Los scopes controlan qué endpoints puede usar cada clave.

---

### CatalogEntry
```
key, displayName, description
kind:            'agent' | 'app'
category:        'horizontal' | 'hr' | 'legal' | 'finance' | 'it' | 'ops' | 'support' | 'custom'
image, command[], defaultEnv{}
defaultModel
requiredSecrets: string[]   ← keys que deben existir en el dept para poder desplegar
```

---

### Diagrama de relaciones

```
Organization (1) ──── (N) Department
Department   (1) ──── (N) Deployable
Department   (1) ──── (N) Secret
Department   (1) ──── (N) Workflow
Workflow     (1) ──── (N) WorkflowStep ──── (1) Deployable
ApiKey             (global, scoped por permissions)
CatalogEntry       (global, blueprint inmutable)
```

---

## Catálogo Enterprise

### Horizontal (cualquier departamento)
| key | displayName | función |
|-----|-------------|---------|
| `knowledge-vault` | Knowledge Vault | RAG + búsqueda semántica sobre docs del área |
| `document-analyzer` | Doc Analyzer | analiza PDFs/contratos, extrae datos estructurados |
| `meeting-assistant` | Meeting Assistant | resume reuniones, genera action items |
| `search-assistant` | Search Assistant | búsqueda semántica sobre documentación interna |

### HR
| key | displayName | función |
|-----|-------------|---------|
| `hr-onboarding` | Onboarding Bot | guía a nuevos empleados en el proceso de ingreso |
| `hr-policy-bot` | Policy Bot | responde preguntas sobre políticas internas |
| `hr-recruitment` | Recruitment Assistant | asiste en el screening de candidatos |

### Legal
| key | displayName | función |
|-----|-------------|---------|
| `contract-reviewer` | Contract Reviewer | revisa contratos, marca riesgos y cláusulas problemáticas |
| `compliance-checker` | Compliance Checker | verifica documentos contra normativas y regulaciones |

### Finanzas
| key | displayName | función |
|-----|-------------|---------|
| `budget-analyzer` | Budget Analyzer | analiza gastos, proyecciones y anomalías |
| `expense-reviewer` | Expense Reviewer | revisa informes de gastos y detecta irregularidades |

### IT / Ingeniería
| key | displayName | función |
|-----|-------------|---------|
| `code-assistant` | Code Assistant | bk-coder empaquetado como agente de desarrollo |
| `incident-responder` | Incident Responder | asistencia en incidentes de infraestructura |
| `docs-generator` | Docs Generator | genera documentación técnica desde código |

### Soporte / Operaciones
| key | displayName | función |
|-----|-------------|---------|
| `support-bot` | Support Bot | atención al cliente, respuesta a tickets |
| `escalation-assistant` | Escalation Assistant | enruta y prioriza tickets de soporte |

### Genérico
| key | displayName | función |
|-----|-------------|---------|
| `custom` | Custom | imagen y configuración completamente libre |

---

## API REST — superficie para el director-agent

El director-agent es un cliente primario. Autenticación via header `X-Api-Key`. Todos los endpoints humanos también aceptan JWT Bearer.

### Departments
```
GET    /departments                         listar áreas
POST   /departments                         crear área
GET    /departments/:id                     detalle
PATCH  /departments/:id                     actualizar
DELETE /departments/:id                     eliminar
GET    /departments/:id/deployables         deployables del área
GET    /departments/:id/secrets             listar keys (no valores)
POST   /departments/:id/secrets             registrar secreto
DELETE /departments/:id/secrets/:key        eliminar secreto
```

### Deployables
```
GET    /deployables                         listar (filtros: departmentId, kind, status)
POST   /deployables                         crear y desplegar
GET    /deployables/:id                     estado, handle, config
PATCH  /deployables/:id                     actualizar config
DELETE /deployables/:id                     stop + remove
POST   /deployables/:id/stop               solo stop (mantiene registro)
POST   /deployables/:id/start              re-desplegar stopped
GET    /deployables/:id/logs               logs del contenedor
GET    /deployables/:id/health             health del contenedor
```

### Catalog
```
GET    /catalog                             listar templates
GET    /catalog/:key                        template específico (image, requiredSecrets, etc.)
```

### Workflows
```
GET    /workflows                           listar (filtros: departmentId, status)
POST   /workflows                           crear workflow con steps
GET    /workflows/:id                       detalle + steps
PATCH  /workflows/:id                       actualizar
DELETE /workflows/:id                       eliminar
POST   /workflows/:id/run                   ejecutar workflow
GET    /workflows/:id/runs                  historial de ejecuciones
GET    /workflows/runs/:runId               estado de una ejecución
```

### Director (métricas y runtime)
```
GET    /director/health                     salud de la plataforma
GET    /director/metrics                    métricas agregadas
GET    /director/runtimes                   runtimes disponibles y su estado
GET    /director/catalog                    alias de /catalog (conveniencia)
```

### ApiKeys
```
GET    /api-keys                            listar claves
POST   /api-keys                            crear clave (retorna el plain-text una sola vez)
DELETE /api-keys/:id                        revocar
```

---

## RuntimeSPI

Runtime abstraído detrás de una interfaz estable. Hoy: Docker. Mañana: k8s, process.

```typescript
interface RuntimeAdapter {
  readonly kind: 'docker' | 'k8s' | 'process';
  readonly availability: 'available' | 'coming_soon' | 'unavailable';
  ping(): Promise<RuntimeDaemonStatus>;
  deploy(spec: AgentSpec): Promise<RuntimeHandle>;
  stop(handleId: string): Promise<void>;
  remove(handleId: string): Promise<void>;
  status(handleId: string): Promise<RuntimeStatus>;
  logs(handleId: string, opts?): Promise<string>;
  list(): Promise<RuntimeHandle[]>;
  streamLogs?(handleId: string): AsyncIterable<string>;
}
```

| Adapter | Estado | Notas |
|---------|--------|-------|
| `DockerAdapter` | ✅ implementado | usa `/var/run/docker.sock` |
| `K8sAdapter` | ⬜ coming_soon | Fase 4 — manifests k8s ya existen |
| `ProcessAdapter` | ⬜ coming_soon | dev local — MCPClientManager |

**Seguridad:** el socket de Docker es root-equivalent. En producción usar socket-proxy o k8s + RBAC.

**Anti-fake:** los adapters `coming_soon` lanzan `ServiceUnavailableException`, nunca simulan éxito.

---

## Contrato de imagen de agente

Todo contenedor desplegado por agent-cloud debe cumplir:

1. Proceso long-lived (no termina hasta SIGTERM)
2. Lee `AGENT_ID`, `AGENT_TYPE`, `MODEL` desde variables de entorno
3. Expone `GET /health` en el puerto configurado → responde 200 + JSON `{status, agentId, type, uptime}`
4. Maneja `SIGTERM` con graceful shutdown

**Implementado:** `knowledge-vault` (`agents/codex-context-agent-v2/Dockerfile` en agent-framework)
**Referencia:** `docker/agent-runtime/entrypoint.mjs`

---

## Relación con abac-service

`apps/abac-service` gestiona identidad y autorización de personas (login, roles, departments, ABAC con json-rules-engine). director-api gestiona **deployables operacionales**.

Son complementarios:
- `abac-service` → quién puede usar qué (identidad + políticas)
- `director-api` → qué agentes y apps corren dónde (infraestructura de IA)

El JWT emitido por abac-service incluye `{ sub, roles, department, permissions }`. director-api lo valida con `FlexAuthGuard` (EdDSA → ApiKey).

---

## MCP Resources — Autorización ABAC

### Concepto

Los MCP Resources son contexto pre-cargado que el host inyecta en el LLM **antes** del primer token, a diferencia de los Tools que el LLM invoca durante la inferencia. Dado que los Resources se cargan silenciosamente, deben estar gateados por ABAC con la misma rigurosidad que los Tools.

### Modelo de dos capas

```
Acceso efectivo = department_ceiling ∩ user_grant
```

| Capa | Define | Unidad | Quién configura |
|------|--------|--------|-----------------|
| **Department ceiling** | Máximo de URIs disponibles para el área | `DepartmentResource` (uri_pattern) | Admin de plataforma |
| **User grant** | Subconjunto real del usuario | `vault_resources[]` en perfil | Admin de departamento |

Si el usuario no tiene `vault_resources` explícito → hereda todos los Resources del department (default sin fricción). Si los tiene → intersección.

### URI patterns por department (primera etapa)

| Department | Resources autorizados |
|------------|----------------------|
| `development` | `jira://*`, `director://workflows`, `director://agents/health` |
| `sales` | `hubspot://contacts/*`, `hubspot://deals/pipeline`, `odoo://customers/*`, `odoo://products/catalog` |
| `finance` | `odoo://invoices/*`, `odoo://products/catalog` |
| `hr` | _(sin recursos de negocio — solo contexto de plataforma)_ |
| `devops` | `director://workflows`, `director://agents/health`, `director://deployables` |

### Políticas en json-rules-engine

```json
{
  "name": "sales-rep-resources",
  "conditions": {
    "all": [
      { "fact": "department", "operator": "equal",    "value": "sales" },
      { "fact": "role",       "operator": "notEqual", "value": "sales-manager" }
    ]
  },
  "effect": "allow",
  "resources": ["hubspot://contacts/*", "odoo://customers/*"]
}
```

El engine evalúa `{ department, role }` del JWT y devuelve los URI patterns efectivos. Un manager puede superar la restricción de rol dentro del mismo department ceiling.

### Flujo de resolución

```
JWT: { department: "sales", role: "sales-rep", sub: "usr_123" }

abac-service evalúa en orden:
  1. ¿usr_123 tiene vault_resources explícito? → usa ese
  2. Si no → evalúa policies por (department, role)
  3. Intersecta con department ceiling

mcp-server filtra resources/list y resources/read contra la lista efectiva
```

### Endpoint nuevo en abac-service

```
GET /resources/allowed
Headers: Authorization: Bearer <jwt>
Response: { patterns: ["hubspot://contacts/*", "odoo://customers/*"] }
```

### Esquema de datos

```sql
-- Techo por department
CREATE TABLE department_resources (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  department  VARCHAR(100) NOT NULL,
  uri_pattern VARCHAR(500) NOT NULL,  -- e.g. "hubspot://contacts/*"
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Override opcional por usuario (se guarda en user.vault_resources jsonb)
-- No requiere tabla nueva — extiende el campo vault existente
```

### Puntos de consumo

| Consumidor | Cómo usa los Resources |
|------------|------------------------|
| **director-agent** | Lee Resources relevantes y los inyecta en el system prompt del especialista antes de rutear |
| **Claude Desktop / Cursor / Cline** | Subscribirse a Resources vía config MCP — el IDE inyecta el contexto en cada conversación |
| **agent-studio** | Panel de gestión: lista Resources disponibles, preview de contenido, estado de subscripción por agente |

### Comparación con vault[] de Tools

| | `vault[]` (tools) | `vault_resources[]` (nuevo) |
|--|-------------------|-----------------------------|
| Granularidad | Tool exacta (`jira_get_issue`) | Patrón URI (`jira://*`) |
| Definido por | Usuario individual | Department → User override |
| Evaluado por | `vault-filter.ts` en director-agent | `abac-service` + mcp-server middleware |
| Silencio | El LLM decide cuándo llamar | El host pre-carga sin decisión del LLM |

---

## Roadmap de implementación

```
PR 1 — Department entity + migración SQL
PR 2 — Deployable (rename Agent → Deployable, kind, departmentId)
PR 3 — Secret entity + inyección automática en deploy
PR 4 — ApiKey entity + middleware auth machine-to-machine
PR 5 — Workflow + WorkflowStep entities + endpoint /run
PR 6 — MCP connector en director-agent (tools → agent-cloud REST)
PR 7 — CatalogEntry enterprise completo (category + requiredSecrets)
PR 8 — k8s adapter real (Fase 4)
```

---

## Estado actual

| Componente | Estado |
|------------|--------|
| RuntimeSPI (`RuntimeAdapter` interface + `RuntimeRegistry`) | ✅ |
| `DockerAdapter` (deploy/stop/remove/status/logs/list) | ✅ |
| `RuntimeReconciler` (reconcilia DB con Docker real al boot) | ✅ |
| `AgentCatalog` (catálogo en memoria, seed básico) | ✅ parcial |
| `Agent` entity (base para Deployable) | ✅ base — migrar |
| `DirectorService` (usa RuntimeRegistry + AgentCatalog) | ✅ base — extender |
| `Department` entity | ⬜ PR 1 |
| `Deployable` (rename + kind + departmentId) | ⬜ PR 2 |
| `Secret` entity + inyección | ⬜ PR 3 |
| `ApiKey` entity + auth middleware | ⬜ PR 4 |
| `Workflow` + `WorkflowStep` | ⬜ PR 5 |
| director-agent MCP connector → agent-cloud | ⬜ PR 6 |
| CatalogEntry enterprise completo | ⬜ PR 7 |
| k8s adapter | ⬜ PR 8 |
| Frontend dashboard (Next.js) | ⬜ Fase 6 |
