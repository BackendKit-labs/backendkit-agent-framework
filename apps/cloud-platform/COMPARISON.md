# Comparación — cloud-platform vs. plataformas de despliegue MCP enterprise

> Referencia: [Prefect — Best MCP Deployment Platforms for Enterprise (2026)](https://www.prefect.io/resources/best-mcp-deployment-platforms-enterprise-2026)
>
> Fecha del análisis: 2026-06-29 · Modelo de dominio: ver `ARCHITECTURE.md`

## TL;DR — categorías distintas con solapamiento parcial

El artículo de Prefect compara **MCP gateways / proxies** (Kong AI Gateway, Prefect
Horizon, Composio, MintMCP, TrueFoundry, Lunar MCPX, Bifrost, Microsoft MCP Gateway,
Cloudflare Workers). Esas plataformas se sientan **delante** de muchos servidores MCP y
resuelven: descubrimiento centralizado, RBAC a nivel de *tool*, inyección de identidad
OAuth y auditoría inmutable de "qué agente llamó qué tool con qué datos y cuándo".

**cloud-platform es un control plane de despliegue**, no un gateway MCP. Resuelve un
problema adyacente: desplegar agentes/apps como contenedores (Docker/k8s), organizados
por *department*, con catálogo de templates, secrets e inyección en runtime, y un
`director-agent` que orquesta. El MCP aquí es el *transporte* hacia el director
(`cloud-mcp` stdio), no el producto.

**Conclusión:** no competimos de frente con esas 9 plataformas — operamos una capa por
debajo. La rúbrica enterprise del artículo sí aplica como checklist, y ahí tenemos gaps
claros. Son **complementarios**: un gateway MCP podría sentarse delante del runtime que
cloud-platform despliega.

## Dimensiones de evaluación (rúbrica Prefect)

| Dimensión | Gateways del artículo | cloud-platform | Veredicto |
|---|---|---|---|
| **Lifecycle completo** (deploy, discovery, access, monitoring) | Foco en discovery + access de MCP servers existentes | Fuerte en **deploy** (RuntimeSPI Docker/k8s, reconciler, catalog, workflows); débil en discovery de MCP servers de terceros | ⚠️ Parcial |
| **Auth & access control** (SSO SAML/OIDC, RBAC por tool, credential mgmt) | SAML/OIDC, Entra ID, OAuth con identity injection, RBAC down-to-tool | JWT + ApiKey con `scopes[]`. Sin SSO/OIDC, sin RBAC granular, sin identity injection | ❌ Gap grande |
| **Audit & compliance** (logs inmutables, SOC2, DLP) | Audit logs inmutables, SOC2 Type II, DLP | `lastUsedAt` en ApiKey + logs de contenedor. Sin audit trail inmutable, sin DLP, sin SOC2 | ❌ Gap grande |
| **Compatibilidad cliente MCP** (Claude Desktop, agents, multi-cliente) | Multi-cliente por diseño | Un consumidor: el director-agent vía `cloud-mcp` stdio | ❌ No es multi-cliente |
| **Modelo de despliegue** (SaaS / self-hosted / hybrid) | Mix; varios managed SaaS | Self-hosted (Docker Compose, k8s con RBAC). Single-tenant (Organization implícita) | ✅ / ⚠️ |
| **Setup & testing** (speed-to-prod, MCP Inspector, local) | MCP Inspector, testing local | `start:dev`, Makefile, k8s manifests, Dockerfile listos. Sin MCP Inspector / testing de tools | ✅ / ⚠️ |

## Dónde estamos bien

- **RuntimeSPI abstraída** (Docker → k8s → process) con principio **anti-fake**: los
  adapters `coming_soon` lanzan `ServiceUnavailableException`, nunca simulan éxito. Más
  maduro que el "deployment model" de varios del artículo.
- **Catálogo con `requiredSecrets`** validados antes de tocar runtime — gobernanza real
  de pre-deploy.
- **Secrets scoped por department** con inyección automática en deploy — buen modelo
  (aunque sin cifrado en Fase 1).
- **RuntimeReconciler** sincroniza DB ↔ Docker real al boot. Pocos lo hacen.

## Gaps frente a la rúbrica enterprise (priorizados)

1. **Secrets en texto plano** (`ARCHITECTURE.md` §Secret). Gap #1 para cualquier claim
   enterprise. Existe un módulo `src/vault/` sin cerrar. → cifrado con KMS/Vault.
2. **Sin SSO/OIDC ni RBAC granular.** Hoy JWT + ApiKey con scopes binarios (`["*"]`), y una
   identidad local **duplicada** frente a `auth-service`. La rúbrica exige SAML/OIDC + Entra
   ID + RBAC por recurso/acción. → unificar en auth-service como único IdP, ver
   `.specs/adr-unified-auth.md`.
3. **Sin audit log inmutable.** No podemos responder "quién desplegó qué, cuándo, con qué
   secrets". → tabla append-only de eventos.
4. **Security review desactualizado** (`.security/security-review.md`, 2024-01-15, scope
   solo 2 archivos de auth). No cubre RuntimeSPI ni el mount `docker.sock`
   root-equivalent — nuestra mayor superficie de ataque.
5. **Observabilidad sin OpenTelemetry.** Hay `/director/metrics` + logs, pero sin tracing
   distribuido (requisito del artículo).
6. **Multi-tenancy no implementada** (Organization implícita). OK hoy, bloqueante para SaaS.
7. **Sin rate limiting ni budget controls** por ApiKey/department.
8. **Sin MCP Inspector / testing de tools** en el flujo de setup.

## Posicionamiento recomendado

No reposicionar cloud-platform como "MCP deployment platform" para competir con esas 9 —
perderíamos en las dimensiones de gateway que no tenemos. Posicionarlo como lo que es:
**control plane de despliegue de inteligencia operacional por departamento**. Si queremos
que el *acceso* a esos agentes sea enterprise-grade, considerar poner un gateway MCP (o un
proxy propio) **delante** del runtime — complementarios, igual que la relación ya descrita
con `auth-service` en `ARCHITECTURE.md`.

El plan de cierre de gaps está en `.specs/IMPROVEMENT-PLAN.md`.
