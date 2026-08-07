#!/usr/bin/env node
import 'dotenv/config';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

// ──────────────────────────────────────────────
// Adaptador MCP
// ──────────────────────────────────────────────
//
// Esto es lo que un agente real hablaría para consultar un ERP: el ERP no
// sabe qué es MCP, expone su propia API (ver ../erp-api/server.ts); este
// adaptador es la pieza delgada que traduce llamadas MCP → llamadas HTTP a
// esa API y devuelve el resultado como tool MCP. El mismo patrón habría que
// replicar para cada ERP real que se integre (Contpaqi, SAP, Odoo, etc.).

const ERP_API_URL = process.env.ERP_API_URL || 'http://localhost:4100';

async function callErpApi(endpoint: string, params: Record<string, string | undefined>): Promise<unknown> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) query.set(key, value);
  }
  const qs = query.toString();
  const url = `${ERP_API_URL}${endpoint}${qs ? `?${qs}` : ''}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`ERP respondió HTTP ${response.status} en ${endpoint}`);
  }
  return response.json();
}

function toToolResult(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

const server = new McpServer({
  name: 'mock-erp-agent',
  version: '0.1.0',
});

// El SDK de MCP infiere `server.tool()` con generics muy profundos combinados
// con los shapes de zod — con ~10 tools registradas eso hace que tsc se quede
// sin memoria (heap out of memory) intentando resolver cada instanciación.
// Este wrapper corta la inferencia: castea `server.tool` a `any` UNA vez y
// declara una firma simple y no genérica, así cada llamada de abajo se
// chequea contra un tipo trivial en vez del overload real del SDK.
type ToolArgs = Record<string, unknown>;
const registerTool = server.tool.bind(server) as unknown as (
  name: string,
  description: string,
  shape: z.ZodRawShape,
  handler: (args: ToolArgs) => Promise<{ content: Array<{ type: 'text'; text: string }> }>,
) => void;

// ── Tools ─────────────────────────────────────────────────────────────────
// Mismos nombres que las tools nativas de finance-agent — al conectarse vía
// mcp_servers en config.yaml, MCPBridge las registra como
// "{serverName}__{toolName}" (ej. "erp__get_balance_sheet").

registerTool(
  'get_balance_sheet',
  'Obtiene el balance general (activos, pasivos, patrimonio) para un período.',
  { period: z.string().optional() },
  async (args) => toToolResult(await callErpApi('/api/financials/balance-sheet', { period: args.period as string | undefined })),
);

registerTool(
  'get_income_statement',
  'Obtiene el estado de resultados (PyG) para un período.',
  { period: z.string() },
  async (args) => toToolResult(await callErpApi('/api/financials/income-statement', { period: args.period as string })),
);

registerTool(
  'get_cash_flow',
  'Obtiene el flujo de efectivo (operativo, inversión, financiamiento) para un período.',
  { period: z.string().optional(), companyId: z.string().optional() },
  async (args) => toToolResult(await callErpApi('/api/financials/cash-flow', { period: args.period as string | undefined })),
);

registerTool(
  'aging-report',
  'Obtiene la antigüedad de saldos de cuentas por cobrar o por pagar.',
  { period: z.string(), type: z.enum(['receivable', 'payable']).optional() },
  async (args) =>
    toToolResult(
      await callErpApi('/api/financials/aging-report', {
        period: args.period as string,
        type: args.type as string | undefined,
      }),
    ),
);

registerTool(
  'budget_vs_actual',
  'Compara presupuesto vs real por categoría para un período.',
  { period: z.string(), department: z.string().optional() },
  async (args) =>
    toToolResult(
      await callErpApi('/api/financials/budget-vs-actual', {
        period: args.period as string,
        department: args.department as string | undefined,
      }),
    ),
);

registerTool(
  'kpi_dashboard',
  'Obtiene los KPIs y ratios financieros clave para un período.',
  { period: z.string() },
  async (args) => toToolResult(await callErpApi('/api/financials/kpi-dashboard', { period: args.period as string })),
);

registerTool(
  'revenue_breakdown',
  'Desglosa los ingresos por producto, región o canal para un período.',
  { period: z.string(), groupBy: z.enum(['product', 'region', 'channel']).optional() },
  async (args) =>
    toToolResult(
      await callErpApi('/api/financials/revenue-breakdown', {
        period: args.period as string,
        groupBy: args.groupBy as string | undefined,
      }),
    ),
);

registerTool(
  'cost_analysis',
  'Obtiene el desglose de costos y gastos por categoría para un período.',
  { period: z.string() },
  async (args) => toToolResult(await callErpApi('/api/financials/cost-analysis', { period: args.period as string })),
);

registerTool(
  'tax-summary',
  'Obtiene el resumen de la situación impositiva para un período y país.',
  { period: z.string(), country: z.string().optional() },
  async (args) =>
    toToolResult(
      await callErpApi('/api/financials/tax-summary', {
        period: args.period as string,
        country: args.country as string | undefined,
      }),
    ),
);

registerTool(
  'get_payroll_summary',
  'Obtiene el resumen de nómina para un período.',
  { period: z.string() },
  async (args) => toToolResult(await callErpApi('/api/payroll/summary', { period: args.period as string })),
);

// ── Transporte: stdio ─────────────────────────────────────────────────────

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('[mock-erp-agent] Error al iniciar el adaptador MCP:', err);
  process.exit(1);
});

// Para conectar desde finance-agent (config.yaml):
// mcp_servers:
//   - name: erp
//     transport: stdio
//     command: node
//     args: ["./mock-erp-agent/dist/mcp-adapter/server.js"]
//     env:
//       ERP_API_URL: "http://localhost:4100"
