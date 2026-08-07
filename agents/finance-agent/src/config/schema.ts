import { z } from 'zod';

// ──────────────────────────────────────────────
// CompanySchema
// ──────────────────────────────────────────────

export const CompanySchema = z.object({
  id: z.string().min(1, 'El ID de la empresa es requerido'),
  name: z.string().min(1, 'El nombre de la empresa es requerido'),
  country: z
    .string()
    .length(2, 'country debe tener exactamente 2 caracteres (ISO 3166-1 alpha-2)')
    .transform((v) => v.toUpperCase()),
  currency: z
    .string()
    .length(3, 'currency debe tener exactamente 3 caracteres (ISO 4217)')
    .transform((v) => v.toUpperCase()),
  fiscal_year_start: z
    .string()
    .regex(/^\d{2}-\d{2}$/, 'fiscal_year_start debe tener formato MM-DD (ej: 01-01)'),
});

// ──────────────────────────────────────────────
// DefaultProviderSchema
// ──────────────────────────────────────────────

export const DefaultProviderSchema = z.object({
  model: z.string().min(1, 'El modelo es requerido'),
  temperature: z.number().min(0).max(1).default(0.3),
});

// ──────────────────────────────────────────────
// ToolsEnabledSchema
// ──────────────────────────────────────────────

export const ALLOWED_TOOLS = [
  'balance_sheet',
  'income_statement',
  'cash_flow',
  'aging_report',
  'budget_vs_actual',
  'kpi_calculator',
  'tax_summary',
  'payroll_summary',
  'revenue_breakdown',
  'cost_analysis',
  'report_generator',
  'data_export',
] as const;

export const ToolsEnabledSchema = z.object({
  enabled: z.array(z.enum(ALLOWED_TOOLS)).min(1, 'Debe habilitar al menos una tool'),
});

// ──────────────────────────────────────────────
// GateConfigSchema / GatesSchema
// ──────────────────────────────────────────────

export const GateConfigSchema = z.object({
  enabled: z.boolean().default(false),
  requires_approval: z.boolean().default(true),
});

export const GatesSchema = z
  .object({
    email_report: GateConfigSchema.default({}),
    export_data: GateConfigSchema.default({}),
  })
  .strict();

// ──────────────────────────────────────────────
// MCPServerSchema
// ──────────────────────────────────────────────

export const MCPServerSchema = z
  .object({
    name: z.string().min(1, 'El nombre del servidor MCP es requerido'),
    transport: z.enum(['http', 'stdio']),
    url: z.string().optional(),
    command: z.string().optional(),
    args: z.array(z.string()).optional(),
    api_key: z.string().optional(),
    env: z.record(z.string()).optional(),
  })
  .refine((data) => (data.transport === 'stdio' ? !!data.command : true), {
    message: 'Un servidor MCP stdio requiere "command"',
    path: ['command'],
  })
  .refine((data) => (data.transport === 'http' ? !!data.url : true), {
    message: 'Un servidor MCP http requiere "url"',
    path: ['url'],
  });

// ──────────────────────────────────────────────
// SchedulerTaskSchema
// ──────────────────────────────────────────────

export const SchedulerTaskSchema = z.object({
  id: z.string().min(1, 'El ID de la tarea es requerido'),
  cron: z.string().min(1, 'La expresión cron es requerida'),
  workflow: z.string().min(1, 'El workflow es requerido'),
  workflowInput: z.record(z.unknown()).optional(),
  notifyOnFailure: z.boolean().default(true),
  notifyTo: z.array(z.string()).default([]),
});

// ──────────────────────────────────────────────
// NotificationConfigSchema
// ──────────────────────────────────────────────

const NotificationRecipientsSchema = z.object({
  recipients: z.array(z.string()).min(1, 'Debe haber al menos un destinatario'),
  channel: z.string().min(1, 'El canal es requerido'),
});

const AlertConfigSchema = z.object({
  recipients: z.array(z.string()).min(1, 'Debe haber al menos un destinatario'),
  channel: z.string().min(1, 'El canal es requerido'),
  priority: z.enum(['low', 'medium', 'high']).default('low'),
});

export const NotificationConfigSchema = z.object({
  default_channel: z.string().min(1, 'default_channel es requerido'),
  weekly_report: NotificationRecipientsSchema.optional(),
  alerts: AlertConfigSchema.optional(),
});

// ──────────────────────────────────────────────
// CompanyConfigSchema (integración completa)
// ──────────────────────────────────────────────

export const CompanyConfigSchema = z.object({
  company: CompanySchema,
  providers: z.object({
    default: DefaultProviderSchema,
  }),
  tools: ToolsEnabledSchema,
  gates: GatesSchema.default({}),
  mcp_servers: z.array(MCPServerSchema).default([]),
  scheduler: z
    .object({
      default_tasks: z.array(SchedulerTaskSchema).default([]),
    })
    .default({}),
  notifications: NotificationConfigSchema.optional(),
});

export type Company = z.infer<typeof CompanySchema>;
export type CompanyConfig = z.infer<typeof CompanyConfigSchema>;
