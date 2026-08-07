# mock-erp-agent

ERP mock para probar la integración de `finance-agent` (o cualquier agente) con
un sistema externo real, sin depender de un ERP de verdad durante el desarrollo.

Simula el patrón que se va a repetir con cada ERP real (Contpaqi, SAP, Odoo,
etc.): el ERP **no habla MCP**, expone su propia API; alguien construye un
**adaptador MCP** delgado delante que traduce llamadas MCP a esa API.

```
agente (finance-agent)
   │  MCP (stdio)
   ▼
mcp-adapter/server.ts   ← lo único que el agente conoce
   │  HTTP
   ▼
erp-api/server.ts        ← simula la API "nativa" del ERP
```

## Correr en desarrollo

Dos procesos, en terminales separadas:

```bash
npm run build          # una vez (o cada vez que cambies el código)
npm run start:api       # API REST del ERP — http://localhost:4100
npm run start:mcp       # adaptador MCP (stdio) — llama a ERP_API_URL
```

`ERP_API_URL` (default `http://localhost:4100`) le dice al adaptador dónde
está la API REST. `ERP_API_PORT` (default `4100`) es el puerto de la API REST.

## Tools expuestas por el adaptador MCP

Mismos nombres que las tools nativas de `finance-agent`, para que al
conectarlas vía `mcp_servers` en `config.yaml` queden disponibles como
`{serverName}__{toolName}` (ej. `erp__get_balance_sheet`):

`get_balance_sheet`, `get_income_statement`, `get_cash_flow`, `aging-report`,
`budget_vs_actual`, `kpi_dashboard`, `revenue_breakdown`, `cost_analysis`,
`tax-summary`, `get_payroll_summary`.

## Conectar desde finance-agent

```yaml
mcp_servers:
  - name: erp
    transport: stdio
    command: node
    args: ["../mock-erp-agent/dist/mcp-adapter/server.js"]
    env:
      ERP_API_URL: "http://localhost:4100"
```

## Datos mock

`src/erp-api/data.ts` genera datos determinísticos por período (mismo período
→ mismos números, distinto período → variación reproducible), con el mismo
patrón de hash que ya usan las tools reales de finance-agent. `tax-summary`
soporta `country=CO` y `country=MX` con distintos tipos de impuestos, a modo
de ejemplo de cómo el ERP real sí puede ramificar por país (a diferencia del
tool nativo actual de finance-agent, que hoy está hardcodeado a Colombia).
