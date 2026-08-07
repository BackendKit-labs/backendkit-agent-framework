import { describe, it, expect } from '@jest/globals';
import {
  CompanySchema,
  DefaultProviderSchema,
  ToolsEnabledSchema,
  GateConfigSchema,
  GatesSchema,
  MCPServerSchema,
  SchedulerTaskSchema,
  NotificationConfigSchema,
  CompanyConfigSchema,
} from '../../src/config/schema';

// ──────────────────────────────────────────────
// CompanySchema
// ──────────────────────────────────────────────
describe('CompanySchema', () => {
  const validCompany = {
    id: 'emp-001',
    name: 'Test Corp',
    country: 'CO',
    currency: 'USD',
    fiscal_year_start: '01-01',
  };

  it('debe aceptar una empresa válida', () => {
    const result = CompanySchema.parse(validCompany);
    expect(result).toEqual(validCompany);
  });

  it('debe rechazar country con más de 2 caracteres', () => {
    const invalid = { ...validCompany, country: 'COL' };
    expect(() => CompanySchema.parse(invalid)).toThrow();
  });

  it('debe rechazar country con menos de 2 caracteres', () => {
    const invalid = { ...validCompany, country: 'C' };
    expect(() => CompanySchema.parse(invalid)).toThrow();
  });

  it('debe rechazar country vacío', () => {
    const invalid = { ...validCompany, country: '' };
    expect(() => CompanySchema.parse(invalid)).toThrow();
  });

  it('debe convertir country a mayúsculas', () => {
    const result = CompanySchema.parse({ ...validCompany, country: 'co' });
    expect(result.country).toBe('CO');
  });

  it('debe rechazar currency con más de 3 caracteres', () => {
    const invalid = { ...validCompany, currency: 'USDD' };
    expect(() => CompanySchema.parse(invalid)).toThrow();
  });

  it('debe rechazar currency con menos de 3 caracteres', () => {
    const invalid = { ...validCompany, currency: 'US' };
    expect(() => CompanySchema.parse(invalid)).toThrow();
  });

  it('debe convertir currency a mayúsculas', () => {
    const result = CompanySchema.parse({ ...validCompany, currency: 'usd' });
    expect(result.currency).toBe('USD');
  });

  it('debe rechazar fiscal_year_start con formato incorrecto', () => {
    const invalid = { ...validCompany, fiscal_year_start: '2024-01-01' };
    expect(() => CompanySchema.parse(invalid)).toThrow();
  });

  it('debe rechazar fiscal_year_start con formato MM/DD', () => {
    const invalid = { ...validCompany, fiscal_year_start: '01/01' };
    expect(() => CompanySchema.parse(invalid)).toThrow();
  });

  it('debe rechazar id vacío', () => {
    const invalid = { ...validCompany, id: '' };
    expect(() => CompanySchema.parse(invalid)).toThrow();
  });

  it('debe rechazar name vacío', () => {
    const invalid = { ...validCompany, name: '' };
    expect(() => CompanySchema.parse(invalid)).toThrow();
  });

  it('debe rechazar objeto vacío', () => {
    expect(() => CompanySchema.parse({})).toThrow();
  });

  it('debe rechazar null', () => {
    expect(() => CompanySchema.parse(null)).toThrow();
  });

  it('debe rechazar undefined', () => {
    expect(() => CompanySchema.parse(undefined)).toThrow();
  });
});

// ──────────────────────────────────────────────
// DefaultProviderSchema
// ──────────────────────────────────────────────
describe('DefaultProviderSchema', () => {
  const validProvider = {
    model: 'deepseek-chat',
    temperature: 0.3,
  };

  it('debe aceptar un provider válido', () => {
    const result = DefaultProviderSchema.parse(validProvider);
    expect(result).toEqual(validProvider);
  });

  it('debe asignar temperature por defecto 0.3 si no se especifica', () => {
    const result = DefaultProviderSchema.parse({ model: 'deepseek-chat' });
    expect(result.temperature).toBe(0.3);
  });

  it('debe aceptar temperature = 0', () => {
    const result = DefaultProviderSchema.parse({ model: 'deepseek-chat', temperature: 0 });
    expect(result.temperature).toBe(0);
  });

  it('debe aceptar temperature = 1', () => {
    const result = DefaultProviderSchema.parse({ model: 'deepseek-chat', temperature: 1 });
    expect(result.temperature).toBe(1);
  });

  it('debe rechazar temperature < 0', () => {
    const invalid = { model: 'deepseek-chat', temperature: -0.1 };
    expect(() => DefaultProviderSchema.parse(invalid)).toThrow();
  });

  it('debe rechazar temperature > 1', () => {
    const invalid = { model: 'deepseek-chat', temperature: 1.1 };
    expect(() => DefaultProviderSchema.parse(invalid)).toThrow();
  });

  it('debe rechazar model vacío', () => {
    const invalid = { model: '' };
    expect(() => DefaultProviderSchema.parse(invalid)).toThrow();
  });

  it('debe rechazar objeto sin model', () => {
    expect(() => DefaultProviderSchema.parse({ temperature: 0.5 })).toThrow();
  });
});

// ──────────────────────────────────────────────
// ToolsEnabledSchema
// ──────────────────────────────────────────────
describe('ToolsEnabledSchema', () => {
  it('debe aceptar un array de tools válidas', () => {
    const result = ToolsEnabledSchema.parse({
      enabled: ['balance_sheet', 'income_statement', 'cash_flow'],
    });
    expect(result.enabled).toEqual(['balance_sheet', 'income_statement', 'cash_flow']);
  });

  it('debe aceptar todas las tools permitidas', () => {
    const allTools = [
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
    ];
    const result = ToolsEnabledSchema.parse({ enabled: allTools });
    expect(result.enabled).toEqual(allTools);
  });

  it('debe rechazar una tool no permitida', () => {
    const invalid = { enabled: ['balance_sheet', 'invalid_tool'] };
    expect(() => ToolsEnabledSchema.parse(invalid)).toThrow();
  });

  it('debe rechazar array vacío', () => {
    const invalid = { enabled: [] };
    expect(() => ToolsEnabledSchema.parse(invalid)).toThrow();
  });

  it('debe rechazar si enabled no es array', () => {
    const invalid = { enabled: 'balance_sheet' };
    expect(() => ToolsEnabledSchema.parse(invalid)).toThrow();
  });

  it('debe rechazar si contiene strings vacíos', () => {
    const invalid = { enabled: ['balance_sheet', ''] };
    expect(() => ToolsEnabledSchema.parse(invalid)).toThrow();
  });

  it('debe rechazar si contiene números', () => {
    const invalid = { enabled: ['balance_sheet', 123] };
    expect(() => ToolsEnabledSchema.parse(invalid)).toThrow();
  });
});

// ──────────────────────────────────────────────
// GateConfigSchema
// ──────────────────────────────────────────────
describe('GateConfigSchema', () => {
  it('debe aceptar un gate con enabled=true y requires_approval=true', () => {
    const result = GateConfigSchema.parse({ enabled: true, requires_approval: true });
    expect(result).toEqual({ enabled: true, requires_approval: true });
  });

  it('debe aceptar un gate con enabled=false y requires_approval=false', () => {
    const result = GateConfigSchema.parse({ enabled: false, requires_approval: false });
    expect(result).toEqual({ enabled: false, requires_approval: false });
  });

  it('debe asignar valores por defecto si no se especifican', () => {
    const result = GateConfigSchema.parse({});
    expect(result).toEqual({ enabled: false, requires_approval: true });
  });

  it('debe rechazar enabled como string', () => {
    const invalid = { enabled: 'true' };
    expect(() => GateConfigSchema.parse(invalid)).toThrow();
  });

  it('debe rechazar requires_approval como número', () => {
    const invalid = { enabled: true, requires_approval: 1 };
    expect(() => GateConfigSchema.parse(invalid)).toThrow();
  });
});

// ──────────────────────────────────────────────
// GatesSchema
// ──────────────────────────────────────────────
describe('GatesSchema', () => {
  it('debe aceptar gates vacío y asignar defaults', () => {
    const result = GatesSchema.parse({});
    expect(result.email_report).toEqual({ enabled: false, requires_approval: true });
    expect(result.export_data).toEqual({ enabled: false, requires_approval: true });
  });

  it('debe aceptar configuración parcial', () => {
    const result = GatesSchema.parse({
      email_report: { enabled: true },
    });
    expect(result.email_report).toEqual({ enabled: true, requires_approval: true });
    expect(result.export_data).toEqual({ enabled: false, requires_approval: true });
  });

  it('debe aceptar configuración completa', () => {
    const result = GatesSchema.parse({
      email_report: { enabled: true, requires_approval: false },
      export_data: { enabled: true, requires_approval: true },
    });
    expect(result.email_report).toEqual({ enabled: true, requires_approval: false });
    expect(result.export_data).toEqual({ enabled: true, requires_approval: true });
  });

  it('debe rechazar gate extra no definido', () => {
    const invalid = { extra_gate: { enabled: true } };
    expect(() => GatesSchema.parse(invalid)).toThrow();
  });
});

// ──────────────────────────────────────────────
// MCPServerSchema
// ──────────────────────────────────────────────
describe('MCPServerSchema', () => {
  const validStdioServer = {
    name: 'erp-server',
    transport: 'stdio' as const,
    command: 'node',
    args: ['server.js'],
  };

  const validHttpServer = {
    name: 'dian-server',
    transport: 'http' as const,
    url: 'https://dian.api.example.com',
    api_key: 'sk-123',
  };

  it('debe aceptar un servidor MCP stdio válido', () => {
    const result = MCPServerSchema.parse(validStdioServer);
    expect(result.name).toBe('erp-server');
    expect(result.transport).toBe('stdio');
    expect(result.command).toBe('node');
  });

  it('debe aceptar un servidor MCP http válido', () => {
    const result = MCPServerSchema.parse(validHttpServer);
    expect(result.name).toBe('dian-server');
    expect(result.transport).toBe('http');
    expect(result.url).toBe('https://dian.api.example.com');
  });

  it('debe rechazar servidor sin name', () => {
    const invalid = { transport: 'stdio', command: 'node' };
    expect(() => MCPServerSchema.parse(invalid)).toThrow();
  });

  it('debe rechazar servidor sin transport', () => {
    const invalid = { name: 'test', command: 'node' };
    expect(() => MCPServerSchema.parse(invalid)).toThrow();
  });

  it('debe rechazar transport inválido', () => {
    const invalid = { name: 'test', transport: 'websocket' };
    expect(() => MCPServerSchema.parse(invalid)).toThrow();
  });

  it('debe rechazar servidor stdio sin command', () => {
    const invalid = { name: 'test', transport: 'stdio' };
    expect(() => MCPServerSchema.parse(invalid)).toThrow();
  });

  it('debe rechazar servidor http sin url', () => {
    const invalid = { name: 'test', transport: 'http', api_key: 'sk-123' };
    expect(() => MCPServerSchema.parse(invalid)).toThrow();
  });

  it('debe aceptar servidor http sin api_key', () => {
    const result = MCPServerSchema.parse({
      name: 'public-api',
      transport: 'http',
      url: 'https://api.example.com',
    });
    expect(result.api_key).toBeUndefined();
  });

  it('debe aceptar servidor con env opcional', () => {
    const result = MCPServerSchema.parse({
      ...validStdioServer,
      env: { NODE_ENV: 'production', DEBUG: 'true' },
    });
    expect(result.env).toEqual({ NODE_ENV: 'production', DEBUG: 'true' });
  });
});

// ──────────────────────────────────────────────
// SchedulerTaskSchema
// ──────────────────────────────────────────────
describe('SchedulerTaskSchema', () => {
  const validTask = {
    id: 'monthly-close',
    cron: '0 0 1 * *',
    workflow: 'generate-report',
    workflowInput: { reportType: 'monthly_close' },
    notifyOnFailure: true,
    notifyTo: ['cfo@company.com'],
  };

  it('debe aceptar una tarea válida', () => {
    const result = SchedulerTaskSchema.parse(validTask);
    expect(result.id).toBe('monthly-close');
    expect(result.cron).toBe('0 0 1 * *');
  });

  it('debe aceptar tarea sin notifyOnFailure (default true)', () => {
    const task = { ...validTask };
    delete task.notifyOnFailure;
    const result = SchedulerTaskSchema.parse(task);
    expect(result.notifyOnFailure).toBe(true);
  });

  it('debe aceptar tarea sin notifyTo (default [])', () => {
    const task = { ...validTask };
    delete task.notifyTo;
    const result = SchedulerTaskSchema.parse(task);
    expect(result.notifyTo).toEqual([]);
  });

  it('debe rechazar tarea sin id', () => {
    const invalid = { cron: '0 0 1 * *', workflow: 'test' };
    expect(() => SchedulerTaskSchema.parse(invalid)).toThrow();
  });

  it('debe rechazar tarea sin cron', () => {
    const invalid = { id: 'test', workflow: 'test' };
    expect(() => SchedulerTaskSchema.parse(invalid)).toThrow();
  });

  it('debe rechazar tarea sin workflow', () => {
    const invalid = { id: 'test', cron: '0 0 1 * *' };
    expect(() => SchedulerTaskSchema.parse(invalid)).toThrow();
  });

  it('debe rechazar cron inválido (no string)', () => {
    const invalid = { ...validTask, cron: 123 };
    expect(() => SchedulerTaskSchema.parse(invalid)).toThrow();
  });

  it('debe rechazar notifyTo con elementos no string', () => {
    const invalid = { ...validTask, notifyTo: [123] };
    expect(() => SchedulerTaskSchema.parse(invalid)).toThrow();
  });
});

// ──────────────────────────────────────────────
// NotificationConfigSchema
// ──────────────────────────────────────────────
describe('NotificationConfigSchema', () => {
  const validConfig = {
    default_channel: 'email',
    weekly_report: {
      recipients: ['cfo@company.com', 'analyst@company.com'],
      channel: 'email',
    },
    alerts: {
      recipients: ['cfo@company.com'],
      channel: 'slack',
      priority: 'high',
    },
  };

  it('debe aceptar una configuración de notificaciones válida', () => {
    const result = NotificationConfigSchema.parse(validConfig);
    expect(result.default_channel).toBe('email');
    expect(result.weekly_report.recipients).toHaveLength(2);
  });

  it('debe aceptar configuración sin weekly_report', () => {
    const config = {
      default_channel: 'email',
      alerts: {
        recipients: ['cfo@company.com'],
        channel: 'slack',
        priority: 'high',
      },
    };
    const result = NotificationConfigSchema.parse(config);
    expect(result.weekly_report).toBeUndefined();
  });

  it('debe aceptar configuración sin alerts', () => {
    const config = {
      default_channel: 'email',
      weekly_report: {
        recipients: ['cfo@company.com'],
        channel: 'email',
      },
    };
    const result = NotificationConfigSchema.parse(config);
    expect(result.alerts).toBeUndefined();
  });

  it('debe rechazar default_channel vacío', () => {
    const invalid = { default_channel: '' };
    expect(() => NotificationConfigSchema.parse(invalid)).toThrow();
  });

  it('debe rechazar weekly_report sin recipients', () => {
    const invalid = {
      default_channel: 'email',
      weekly_report: { channel: 'email' },
    };
    expect(() => NotificationConfigSchema.parse(invalid)).toThrow();
  });

  it('debe rechazar weekly_report con recipients vacío', () => {
    const invalid = {
      default_channel: 'email',
      weekly_report: { recipients: [], channel: 'email' },
    };
    expect(() => NotificationConfigSchema.parse(invalid)).toThrow();
  });

  it('debe rechazar alerts sin recipients', () => {
    const invalid = {
      default_channel: 'email',
      alerts: { channel: 'slack', priority: 'high' },
    };
    expect(() => NotificationConfigSchema.parse(invalid)).toThrow();
  });

  it('debe rechazar alerts con priority inválida', () => {
    const invalid = {
      default_channel: 'email',
      alerts: {
        recipients: ['cfo@company.com'],
        channel: 'slack',
        priority: 'urgent',
      },
    };
    expect(() => NotificationConfigSchema.parse(invalid)).toThrow();
  });

  it('debe aceptar alerts sin priority (default low)', () => {
    const config = {
      default_channel: 'email',
      alerts: {
        recipients: ['cfo@company.com'],
        channel: 'slack',
      },
    };
    const result = NotificationConfigSchema.parse(config);
    expect(result.alerts.priority).toBe('low');
  });
});

// ──────────────────────────────────────────────
// CompanyConfigSchema (integración completa)
// ──────────────────────────────────────────────
describe('CompanyConfigSchema', () => {
  const validFullConfig = {
    company: {
      id: 'emp-001',
      name: 'Test Corp',
      country: 'CO',
      currency: 'USD',
      fiscal_year_start: '01-01',
    },
    providers: {
      default: {
        model: 'deepseek-chat',
        temperature: 0.3,
      },
    },
    tools: {
      enabled: ['balance_sheet', 'income_statement', 'cash_flow'],
    },
    gates: {
      email_report: { enabled: true, requires_approval: false },
      export_data: { enabled: false, requires_approval: true },
    },
    mcp_servers: [
      {
        name: 'erp-server',
        transport: 'stdio',
        command: 'node',
        args: ['server.js'],
      },
    ],
    scheduler: {
      default_tasks: [
        {
          id: 'monthly-close',
          cron: '0 0 1 * *',
          workflow: 'generate-report',
          workflowInput: { reportType: 'monthly_close' },
          notifyOnFailure: true,
          notifyTo: ['cfo@company.com'],
        },
      ],
    },
    notifications: {
      default_channel: 'email',
      weekly_report: {
        recipients: ['cfo@company.com'],
        channel: 'email',
      },
      alerts: {
        recipients: ['cfo@company.com'],
        channel: 'slack',
        priority: 'high',
      },
    },
  };

  it('debe aceptar una configuración completa y válida', () => {
    const result = CompanyConfigSchema.parse(validFullConfig);
    expect(result.company.id).toBe('emp-001');
    expect(result.providers.default.model).toBe('deepseek-chat');
    expect(result.tools.enabled).toContain('balance_sheet');
    expect(result.gates.email_report.enabled).toBe(true);
    expect(result.mcp_servers).toHaveLength(1);
    expect(result.scheduler.default_tasks).toHaveLength(1);
    expect(result.notifications.default_channel).toBe('email');
  });

  it('debe aceptar configuración mínima (solo company, providers, tools)', () => {
    const minimal = {
      company: {
        id: 'emp-001',
        name: 'Test Corp',
        country: 'CO',
        currency: 'USD',
        fiscal_year_start: '01-01',
      },
      providers: {
        default: { model: 'deepseek-chat' },
      },
      tools: {
        enabled: ['balance_sheet'],
      },
    };
    const result = CompanyConfigSchema.parse(minimal);
    expect(result.company.id).toBe('emp-001');
    expect(result.gates).toBeDefined();
    expect(result.mcp_servers).toEqual([]);
    expect(result.scheduler.default_tasks).toEqual([]);
    expect(result.notifications).toBeUndefined();
  });

  it('debe rechazar configuración sin company', () => {
    const invalid = {
      providers: { default: { model: 'deepseek-chat' } },
      tools: { enabled: ['balance_sheet'] },
    };
    expect(() => CompanyConfigSchema.parse(invalid)).toThrow();
  });

  it('debe rechazar configuración sin providers', () => {
    const invalid = {
      company: {
        id: 'emp-001',
        name: 'Test Corp',
        country: 'CO',
        currency: 'USD',
        fiscal_year_start: '01-01',
      },
      tools: { enabled: ['balance_sheet'] },
    };
    expect(() => CompanyConfigSchema.parse(invalid)).toThrow();
  });

  it('debe rechazar configuración sin tools', () => {
    const invalid = {
      company: {
        id: 'emp-001',
        name: 'Test Corp',
        country: 'CO',
        currency: 'USD',
        fiscal_year_start: '01-01',
      },
      providers: { default: { model: 'deepseek-chat' } },
    };
    expect(() => CompanyConfigSchema.parse(invalid)).toThrow();
  });

  it('debe rechazar configuración con company inválida', () => {
    const invalid = {
      company: {
        id: 'emp-001',
        name: 'Test Corp',
        country: 'COL', // 3 caracteres
        currency: 'USD',
        fiscal_year_start: '01-01',
      },
      providers: { default: { model: 'deepseek-chat' } },
      tools: { enabled: ['balance_sheet'] },
    };
    expect(() => CompanyConfigSchema.parse(invalid)).toThrow();
  });

  it('debe rechazar configuración con tools no permitidas', () => {
    const invalid = {
      company: {
        id: 'emp-001',
        name: 'Test Corp',
        country: 'CO',
        currency: 'USD',
        fiscal_year_start: '01-01',
      },
      providers: { default: { model: 'deepseek-chat' } },
      tools: { enabled: ['hacker_tool'] },
    };
    expect(() => CompanyConfigSchema.parse(invalid)).toThrow();
  });

  it('debe rechazar configuración con temperature fuera de rango', () => {
    const invalid = {
      company: {
        id: 'emp-001',
        name: 'Test Corp',
        country: 'CO',
        currency: 'USD',
        fiscal_year_start: '01-01',
      },
      providers: { default: { model: 'deepseek-chat', temperature: 2.5 } },
      tools: { enabled: ['balance_sheet'] },
    };
    expect(() => CompanyConfigSchema.parse(invalid)).toThrow();
  });

  it('debe rechazar null como configuración', () => {
    expect(() => CompanyConfigSchema.parse(null)).toThrow();
  });

  it('debe rechazar undefined como configuración', () => {
    expect(() => CompanyConfigSchema.parse(undefined)).toThrow();
  });

  it('debe rechazar array como configuración', () => {
    expect(() => CompanyConfigSchema.parse([])).toThrow();
  });
});