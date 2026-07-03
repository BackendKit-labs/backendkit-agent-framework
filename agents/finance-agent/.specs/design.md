# Finance Agent — Design Document

## Project Structure

```
C:\Users\mairon.cuello\development\workspace-ia\agent-framework\agents\finance-agent\
│
├── src/
│   ├── core/
│   │   ├── engine.ts                    ← createEngine() con agent-enterprise
│   │   ├── tool-registry.ts             ← registro central de tools (nativas + MCP)
│   │   └── mcp-bridge.ts               ← descubrimiento y conexión a MCP servers externos
│   │
│   ├── tools/                           ← UNA tool = UN archivo, independiente
│   │   ├── income-statement.ts          │  Estado de Resultados
│   │   ├── balance-sheet.ts             │  Balance General
│   │   ├── cash-flow.ts                 │  Flujo de Efectivo
│   │   ├── aging-report.ts              │  Antigüedad de Saldos (CxC / CxP)
│   │   ├── budget-vs-actual.ts          │  Presupuesto vs Real
│   │   ├── kpi-dashboard.ts             │  KPIs y Ratios Financieros
│   │   ├── revenue-breakdown.ts         │  Ingresos por producto/región/canal
│   │   ├── cost-analysis.ts             │  Costos y Gastos por categoría
│   │   ├── tax-summary.ts               │  Situación Impositiva (IVA, Renta, ICA, etc.)
│   │   ├── payroll-summary.ts           │  Resumen de Nómina
│   │   └── index.ts                     │  Registro automático de todas las tools
│   │
│   ├── reports/                          ← MOTOR DE REPORTES
│   │   ├── report-engine.ts             │  Orquesta: datos → markdown → exportación
│   │   ├── templates/                   │  Plantillas de informes en markdown
│   │   │   ├── balance.md               │
│   │   │   ├── income-statement.md       │
│   │   │   ├── cash-flow.md             │
│   │   │   ├── kpi-dashboard.md         │
│   │   │   └── custom/                  │  ← Templates que el cliente puede agregar
│   │   └── exporters/
│   │       ├── pdf-export.ts            │  Markdown → PDF (via puppeteer / markdown-pdf)
│   │       └── xlsx-export.ts           │  Datos → XLSX (via exceljs)
│   │
│   ├── config/                           ← CONFIGURACIÓN POR EMPRESA
│   │   ├── schema.ts                    │  Esquema Zod de validación de config.yaml
│   │   └── loader.ts                    │  Carga config.yaml + env vars + vault path
│   │
│   ├── api-gateway/                      ← CAPA INTERMEDIARIA (única que toca la BD)
│   │   └── client.ts                    │  Cliente HTTP tipado para la API del ERP
│   │
│   └── entry-points/
│       ├── mcp-http.ts                  │  Entry point para deploy como MCP HTTP server
│       └── mcp-stdio.ts                 │  Entry point para deploy como MCP stdio
│
├── Dockerfile                            ← Imagen liviana (~200MB, solo engine + tools)
│
├── config/
│   └── orchestrator.yaml                 ← Config del orquestador del ecosistema
│
└── .specs/                               ← Documentos de diseño (este archivo vive aquí)
```

## 1. Arquitectura General

```
┌─────────────────────────────────────────────────────────────────────────┐
│  EMPRESA (Container Docker independiente)                               │
│                                                                         │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                    FINANCE AGENT                                  │  │
│  │                                                                   │  │
│  │  ┌──────────┐  ┌────────────────┐  ┌────────────────────────┐   │  │
│  │  │  Engine  │  │  Tool Registry │  │   MCP Bridge           │   │  │
│  │  │(LLM core)│◄─┤  (defineTool)  │◄─┤(descubre + registra    │   │  │
│  │  └──────────┘  └───────┬────────┘  │ MCP servers externos)  │   │  │
│  │                        │           └────────────────────────┘   │  │
│  │           ┌────────────┼──────────────┐                         │  │
│  │           │  Tools     │              │                         │  │
│  │           │  Nativas   │   ┌──────────▼──────────┐              │  │
│  │           │  (10 tools)│   │  Ecosistema MCP     │              │  │
│  │           └────────────┘   │  • contpaqi-mcp     │              │  │
│  │                             │  • dian-mcp         │              │  │
│  │                             │  • sap-mcp          │              │  │
│  │                             │  • quickbooks-mcp   │              │  │
│  │                             └─────────────────────┘              │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│           │                        │                                   │
└───────────┼────────────────────────┼───────────────────────────────────┘
            │                        │
            ▼                        ▼
   API Gateway (REST)       Procesos MCP externos
   │                         (ERP, DIAN, AFIP, etc.)
   ▼
┌──────────────┐
│ Base de Datos │
│ Corporativa   │
└──────────────┘

                    ─── Integración con el ecosistema BackendKit ───
                    ┌────────────────┐   ┌────────────────┐
                    │ Scheduler Agent│   │ Notifier Agent │
                    │                │   │                │
                    │ • Reportes     │   │ • Email        │
                    │   periódicos   │   │ • Slack        │
                    │ • Alertas      │   │ • Telegram     │
                    │   programadas  │   │ • Discord      │
                    │ • Cierres      │   │ • Push         │
                    │   automáticos  │   │                │
                    └────────────────┘   └────────────────┘
```

## 2. Tool Registry — Sistema de Plugins

Cada tool es un archivo independiente que exporta una interfaz estándar:

```typescript
// tools/_template.ts — Interfaz que toda tool debe implementar
interface FinanceTool {
  id: string;                    // nombre único de la tool
  description: string;           // descripción para el LLM
  schema: z.ZodObject<any>;      // validación de parámetros con Zod
  execute: (params: any, ctx: ToolContext) => Promise<ToolResult>;
}

interface ToolContext {
  apiGateway: ApiGatewayClient;  // para consultar la BD de la empresa
  config: CompanyConfig;         // config de la empresa actual
  vault: VaultReader;            // para buscar conocimiento en el vault
  scheduler: SchedulerClient;    // para programar tareas (usa scheduler-agent)
  notifier: NotifierClient;      // para enviar notificaciones (usa notifier-agent)
}
```

Las tools se registran automáticamente en `tools/index.ts`:

```typescript
// tools/index.ts
export const nativeTools: FinanceTool[] = [
  incomeStatementTool,
  balanceSheetTool,
  cashFlowTool,
  agingReportTool,
  budgetVsActualTool,
  kpiDashboardTool,
  revenueBreakdownTool,
  costAnalysisTool,
  taxSummaryTool,
  payrollSummaryTool,
];
```

## 3. MCP Bridge — Conexión a Sistemas Externos

El MCP Bridge descubre y registra tools de servidores MCP externos en runtime:

```yaml
# config/empresa.yaml (ejemplo)
mcp_servers:
  - name: contpaqi
    transport: stdio
    command: node
    args: ["./mcp-servers/contpaqi-mcp/dist/index.js"]
    env:
      DB_HOST: "{{DB_HOST}}"
      DB_USER: "{{DB_USER}}"
      DB_PASS: "{{DB_PASS}}"

  - name: dian
    transport: http
    url: "https://mcp-dian.empresa.com"
    api_key: "{{DIAN_API_KEY}}"
```

Flujo del bridge:
1. Al iniciar el agente, lee `config.yaml`
2. Para cada MCP server, crea un cliente MCP
3. Llama a `tools/list` del servidor para descubrir sus tools
4. Registra cada tool con prefijo `{server_name}__{tool_name}`
5. El LLM puede llamar `contpaqi__get_invoices` o `dian__send_invoice` como cualquier tool nativa

## 4. Integración con Scheduler Agent

El agente NO tiene su propio scheduler. Usa el **scheduler-agent** del ecosistema BackendKit.

**Flujo para programar un reporte periódico:**

```
Usuario: "Mandame el reporte de balance todos los lunes a las 9am"

1. Finance Agent interpreta la solicitud
2. Crea una tarea en scheduler-agent:
   schedule_task({
     type: "cron",
     cron: "0 9 * * 1",
     workflow: "finance-report",
     workflowInput: {
       company_id: "alfa-corp",
       template: "balance",
       format: ["pdf"],
       recipients: ["cfo@alfa-corp.com"]
     },
     notifyOnFailure: true
   })
3. Scheduler-agent persiste la tarea
4. Cada lunes 9am, scheduler-agent ejecuta el workflow
5. El workflow llama al finance-agent, genera el reporte, y usa notifier-agent para enviarlo
```

**Tipos de tareas que puede programar:**

| Tipo | Ejemplo |
|---|---|
| Reporte periódico | "Balance general todos los lunes 9am" |
| Alerta de vencimiento | "Alertar 5 días antes del vencimiento de IVA" |
| Cierre contable | "Generar cierre mensual el último día del mes a las 6pm" |
| Comparativa | "Comparar presupuesto vs real el 5 de cada mes" |
| One-time | "Hacerme un informe completo el 31 de diciembre" |

**Configuración en config.yaml:**

```yaml
# Reportes programados por defecto al deployar el agente
scheduler:
  default_tasks:
    - id: cierre-mensual
      cron: "0 18 28-31 * *"
      workflow: generate-report
      workflowInput:
        template: income-statement
        format: [pdf, xlsx]
      notifyOnFailure: true
      notifyTo: [cfo@empresa.com]
```

## 5. Integración con Notifier Agent

El agente NO envía notificaciones directamente. Usa el **notifier-agent** del ecosistema BackendKit.

**Canales disponibles (los que el notifier-agent soporta):**

| Canal | Uso típico |
|---|---|
| 📧 Email | Reportes formales, informes ejecutivos |
| 💬 Slack | Alertas rápidas, notificaciones al equipo |
| ✈️ Telegram | Alertas críticas al CFO |
| 📱 Push | Notificaciones móviles |
| Discord | Equipos que usan Discord |

**Flujo para enviar un reporte:**

```
1. Finance Agent genera el reporte (markdown o PDF)
2. Llama a notifier-agent:
   notify_user({
     userId: "cfo@alfa-corp.com",
     title: "Balance General - Q2 2026",
     body: "Adjunto el balance del Q2 con variaciones vs Q1",
     context: { type: "reporte", action: "view" },
     priority: "normal",
     source: "finance-agent"
   })
   O usa send_notification si es multi-destinatario:
   send_notification({
     channel: "email",
     to: ["cfo@alfa-corp.com", "contador@alfa-corp.com"],
     subject: "Balance General - Q2 2026",
     body: reporteMarkdown,
     priority: "normal"
   })
```

**Cuándo se usa cada uno:**

| Situación | Cómo se envía |
|---|---|
| Reporte programado semanal | `notifier__notify_user` (resuelve canal según preferencias) |
| Alerta de desviación >10% | `notifier__notify_user` con priority "high" |
| Resumen diario de caja | `notifier__send_notification` a lista fija de destinatarios |
| Notificación de error en scheduler | Automático vía `notifyOnFailure` del scheduler |

## 6. Vault RAG — Externo al Contenedor

El vault vive en `~/.backendkit/vaults/finance-agent/` y se monta como volumen:

```
~/.backendkit/vaults/finance-agent/
├── base/                              ← conocimiento COMPARTIDO (read-only)
│   ├── formulas/
│   │   └── ratios-financieros.md
│   └── glossary.md
│
├── normativas/
│   ├── colombia/                      ← normativa COLOMBIA (base)
│   │   ├── estatuto-tributario.md
│   │   ├── iva.md
│   │   ├── retenciones.md
│   │   └── niif.md
│   ├── argentina/                     ← normativa ARGENTINA
│   │   ├── iva.md
│   │   ├── ganancias.md
│   │   └── ingresos-brutos.md
│   └── ...                            ← cada país que se implemente
│
└── empresa-actual/                    ← datos específicos de la empresa (montado como volumen)
    ├── politicas/
    │   ├── limites-credito.md
    │   └── aprobaciones.md
    ├── historial/
    │   └── decisiones-financieras.md
    └── templates-custom/              ← templates que la empresa agregó
```

El contenedor monta:
```yaml
volumes:
  - ~/.backendkit/vaults/finance-agent/base:/vault/base:ro
  - ~/.backendkit/vaults/finance-agent/normativas/colombia:/vault/country:ro
  - /data/empresa-alfa/vault:/vault/company
```

## 7. Configuración por Empresa

```yaml
# config/empresa.yaml
company:
  id: alfa-corp
  name: Alfa Corp
  country: CO
  currency: COP
  fiscal_year_start: "01-01"

providers:
  default:
    model: claude-sonnet-4
    temperature: 0.1

tools:
  enabled:
    - get_income_statement
    - get_balance_sheet
    - get_cash_flow
    - get_aging_report
    - get_budget_vs_actual
    - get_kpi_dashboard
    - get_tax_summary
    - get_payroll_summary

gates:
  email_report:
    enabled: true
    requires_approval_if_contains: ["salarios", "bonos"]
  export_data:
    enabled: true
    requires_approval: false

mcp_servers:
  - name: contpaqi
    transport: stdio
    command: node
    args: ["./mcp-servers/contpaqi-mcp/dist/index.js"]
    env:
      DB_HOST: "{{DB_HOST}}"

# Integración con scheduler-agent
scheduler:
  default_tasks:
    - id: cierre-mensual
      cron: "0 8 1 * *"
      workflow: generate-report
      workflowInput:
        template: income-statement
        format: [pdf, xlsx]
      notifyOnFailure: true
      notifyTo: [cfo@alfa-corp.com]

# Integración con notifier-agent
notifications:
  default_channel: email
  weekly_report:
    recipients:
      - cfo@alfa-corp.com
      - contador@alfa-corp.com
    channel: email
  alerts:
    recipients:
      - cfo@alfa-corp.com
    channel: telegram
    priority: high
```

## 8. Motor de Reportes

El report engine sigue 3 pasos:

```
1. RECOLECTAR datos
   └── Llama N tools según el tipo de reporte
   └── Ej: get_income_statement + get_kpi_dashboard

2. RENDERIZAR template
   └── Toma el template markdown de reports/templates/ (o del vault)
   └── Inyecta datos con Handlebars/Mustache
   └── Genera markdown final

3. EXPORTAR
   └── markdown → PDF (puppeteer o markdown-pdf)
   └── datos → XLSX (exceljs)
   └── markdown + PDF → se envía vía notifier-agent
```

## 9. API Gateway Client

```typescript
// api-gateway/client.ts
class ApiGatewayClient {
  constructor(private baseUrl: string, private apiKey: string) {}

  async get<T>(endpoint: string, params?: Record<string, any>): Promise<T> {
    // Único punto de acceso a la BD corporativa
    // Siempre via HTTP, nunca SQL directo
  }
}
```

## 10. Seguridad

- El contenedor NO tiene variables de BD (solo secrets inyectados)
- El MCP Bridge solo conecta a servidores listados en config.yaml
- Cada tool registra auditoría (quién llamó, qué parametros, timestamp)
- Gates: acciones sensibles requieren aprobación humana
- Zero-trust: el agente no puede escalar privilegios dentro del container
- Las integraciones con scheduler y notifier usan el ecosistema, no implementación propia
