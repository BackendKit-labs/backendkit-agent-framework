import {
  ExportFormatSchema,
  ReportRequestSchema,
  registerTemplateTools,
  getToolsForTemplate,
  renderTemplate,
  registerExporter,
  getExporter,
  resetReportEngineRegistries,
  ReportEngine,
  Exporter,
  CollectedData,
  ReportResult,
  ReportRequest,
} from '../../src/reports/report-engine';
import { ToolRegistry } from '../../src/core/tool-registry';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockExecuteTool = jest.fn();
const mockTemplateLoader = jest.fn();

function createMockToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.executeTool = mockExecuteTool;
  return registry;
}

function createEngine(options?: { registry?: ToolRegistry; loader?: (name: string) => Promise<string> }): ReportEngine {
  return new ReportEngine({
    toolRegistry: options?.registry ?? createMockToolRegistry(),
    templateLoader: options?.loader ?? mockTemplateLoader,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockTemplateLoader.mockReset();
  mockExecuteTool.mockReset();

  // TEMPLATE_TOOL_MAP y el registro de exportadores son estado module-level
  // compartido — sin este reset, los tests que registran templates/exporters
  // custom (más abajo en este archivo) contaminan a los que corren después.
  resetReportEngineRegistries();

  // Default mock: template loader returns a simple template
  mockTemplateLoader.mockResolvedValue('Template content for {{toolName}}');
});

// ---------------------------------------------------------------------------
// ExportFormatSchema
// ---------------------------------------------------------------------------

describe('ExportFormatSchema', () => {
  it('should accept "markdown"', () => {
    const result = ExportFormatSchema.safeParse('markdown');
    expect(result.success).toBe(true);
  });

  it('should accept "pdf"', () => {
    const result = ExportFormatSchema.safeParse('pdf');
    expect(result.success).toBe(true);
  });

  it('should accept "xlsx"', () => {
    const result = ExportFormatSchema.safeParse('xlsx');
    expect(result.success).toBe(true);
  });

  it('should reject invalid format', () => {
    const result = ExportFormatSchema.safeParse('html');
    expect(result.success).toBe(false);
  });

  it('should reject empty string', () => {
    const result = ExportFormatSchema.safeParse('');
    expect(result.success).toBe(false);
  });

  it('should reject non-string values', () => {
    expect(ExportFormatSchema.safeParse(123).success).toBe(false);
    expect(ExportFormatSchema.safeParse(null).success).toBe(false);
    expect(ExportFormatSchema.safeParse(undefined).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ReportRequestSchema
// ---------------------------------------------------------------------------

describe('ReportRequestSchema', () => {
  const validRequest = {
    template: 'balance',
    period: '2026-Q1',
    formats: ['markdown'],
  };

  it('should accept a valid request', () => {
    const result = ReportRequestSchema.safeParse(validRequest);
    expect(result.success).toBe(true);
  });

  it('should reject request without template', () => {
    const result = ReportRequestSchema.safeParse({ period: '2026-Q1', formats: ['markdown'] });
    expect(result.success).toBe(false);
  });

  it('should reject request with empty template', () => {
    const result = ReportRequestSchema.safeParse({ ...validRequest, template: '' });
    expect(result.success).toBe(false);
  });

  it('should reject request without period', () => {
    const result = ReportRequestSchema.safeParse({ template: 'balance', formats: ['markdown'] });
    expect(result.success).toBe(false);
  });

  it('should reject request with empty period', () => {
    const result = ReportRequestSchema.safeParse({ ...validRequest, period: '' });
    expect(result.success).toBe(false);
  });

  it('should reject request without formats', () => {
    const result = ReportRequestSchema.safeParse({ template: 'balance', period: '2026-Q1' });
    expect(result.success).toBe(false);
  });

  it('should reject request with empty formats array', () => {
    const result = ReportRequestSchema.safeParse({ ...validRequest, formats: [] });
    expect(result.success).toBe(false);
  });

  it('should reject request with invalid format in formats', () => {
    const result = ReportRequestSchema.safeParse({ ...validRequest, formats: ['html'] });
    expect(result.success).toBe(false);
  });

  it('should default extraToolNames to empty array when omitted', () => {
    const result = ReportRequestSchema.safeParse(validRequest);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.extraToolNames).toEqual([]);
    }
  });

  it('should accept extraToolNames when provided', () => {
    const result = ReportRequestSchema.safeParse({
      ...validRequest,
      extraToolNames: ['get_custom_metric'],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.extraToolNames).toEqual(['get_custom_metric']);
    }
  });

  it('should accept optional title and subtitle', () => {
    const result = ReportRequestSchema.safeParse({
      ...validRequest,
      title: 'Balance General',
      subtitle: 'Q1 2026',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.title).toBe('Balance General');
      expect(result.data.subtitle).toBe('Q1 2026');
    }
  });

  it('should accept multiple formats', () => {
    const result = ReportRequestSchema.safeParse({
      ...validRequest,
      formats: ['markdown', 'pdf', 'xlsx'],
    });
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// registerTemplateTools / getToolsForTemplate
// ---------------------------------------------------------------------------

describe('registerTemplateTools / getToolsForTemplate', () => {
  it('should return empty array for unregistered template', () => {
    const tools = getToolsForTemplate('non_existent_template');
    expect(tools).toEqual([]);
  });

  it('should return tools for a known template', () => {
    const tools = getToolsForTemplate('balance');
    expect(tools).toEqual(['get_balance_sheet']);
  });

  it('should return tools for income-statement template', () => {
    const tools = getToolsForTemplate('income-statement');
    expect(tools).toEqual(['get_income_statement']);
  });

  it('should return tools for cash-flow template', () => {
    const tools = getToolsForTemplate('cash-flow');
    expect(tools).toEqual(['get_cash_flow']);
  });

  it('should register a custom template and retrieve its tools', () => {
    registerTemplateTools('custom_report', ['get_revenue', 'get_expenses']);
    const tools = getToolsForTemplate('custom_report');
    expect(tools).toEqual(['get_revenue', 'get_expenses']);
  });

  it('should overwrite existing template tools when re-registering', () => {
    registerTemplateTools('balance', ['custom_balance_tool']);
    const tools = getToolsForTemplate('balance');
    expect(tools).toEqual(['custom_balance_tool']);
    // El beforeEach global llama a resetReportEngineRegistries(), que
    // restaura 'balance' antes del próximo test.
  });

  it('should register a template with empty tools array', () => {
    registerTemplateTools('empty_template', []);
    const tools = getToolsForTemplate('empty_template');
    expect(tools).toEqual([]);
  });

  it('should return distinct arrays for different templates', () => {
    const balanceTools = getToolsForTemplate('balance');
    const incomeTools = getToolsForTemplate('income-statement');
    expect(balanceTools).not.toEqual(incomeTools);
  });
});

// ---------------------------------------------------------------------------
// renderTemplate
// ---------------------------------------------------------------------------

describe('renderTemplate', () => {
  it('should replace {{toolName}} with the data from the matching tool', () => {
    const data: CollectedData[] = [
      { toolName: 'get_balance_sheet', data: { total: 1000 }, executionTimeMs: 10, success: true },
    ];
    const result = renderTemplate('Balance: {{get_balance_sheet.total}}', data);
    expect(result).toBe('Balance: 1000');
  });

  it('should replace {{toolName}} with JSON when value is an object', () => {
    const data: CollectedData[] = [
      { toolName: 'get_balance_sheet', data: { assets: 500, liabilities: 200 }, executionTimeMs: 10, success: true },
    ];
    const result = renderTemplate('Data: {{get_balance_sheet}}', data);
    const expected = JSON.stringify({ assets: 500, liabilities: 200 }, null, 2);
    expect(result).toBe(`Data: ${expected}`);
  });

  it('should replace nested path like {{toolName.property.sub}}', () => {
    const data: CollectedData[] = [
      { toolName: 'get_report', data: { meta: { version: '2.0' } }, executionTimeMs: 10, success: true },
    ];
    const result = renderTemplate('Version: {{get_report.meta.version}}', data);
    expect(result).toBe('Version: 2.0');
  });

  it('should leave unreplaced variables as-is when tool is not in data', () => {
    const data: CollectedData[] = [];
    const result = renderTemplate('Value: {{missing_tool.value}}', data);
    expect(result).toBe('Value: {{missing_tool.value}}');
  });

  it('should leave unreplaced variables as-is when path does not exist in object', () => {
    const data: CollectedData[] = [
      { toolName: 'tool_a', data: { existing: 42 }, executionTimeMs: 5, success: true },
    ];
    const result = renderTemplate('Value: {{tool_a.non_existent}}', data);
    expect(result).toBe('Value: {{tool_a.non_existent}}');
  });

  it('should skip tools that failed (success: false)', () => {
    const data: CollectedData[] = [
      { toolName: 'failed_tool', data: { secret: 'value' }, executionTimeMs: 5, success: false, error: 'Error' },
    ];
    const result = renderTemplate('Value: {{failed_tool.secret}}', data);
    expect(result).toBe('Value: {{failed_tool.secret}}');
  });

  it('should skip tools with undefined data', () => {
    const data: CollectedData[] = [
      { toolName: 'tool_a', data: undefined, executionTimeMs: 5, success: true },
    ];
    const result = renderTemplate('Value: {{tool_a}}', data);
    expect(result).toBe('Value: {{tool_a}}');
  });

  it('should replace multiple variables in the same template', () => {
    const data: CollectedData[] = [
      { toolName: 'tool_a', data: { name: 'Alpha' }, executionTimeMs: 5, success: true },
      { toolName: 'tool_b', data: { name: 'Beta' }, executionTimeMs: 5, success: true },
    ];
    const result = renderTemplate('A: {{tool_a.name}} B: {{tool_b.name}}', data);
    expect(result).toBe('A: Alpha B: Beta');
  });

  it('should return template unchanged when no variables present', () => {
    const data: CollectedData[] = [
      { toolName: 'tool_a', data: { x: 1 }, executionTimeMs: 5, success: true },
    ];
    const result = renderTemplate('Plain text without variables', data);
    expect(result).toBe('Plain text without variables');
  });

  it('should handle path resolution on null intermediate values', () => {
    const data: CollectedData[] = [
      { toolName: 'tool_a', data: { level: null }, executionTimeMs: 5, success: true },
    ];
    const result = renderTemplate('Value: {{tool_a.level.nested}}', data);
    expect(result).toBe('Value: {{tool_a.level.nested}}');
  });

  it('should convert non-object primitives to strings', () => {
    const data: CollectedData[] = [
      { toolName: 'tool_a', data: 42, executionTimeMs: 5, success: true },
    ];
    const result = renderTemplate('Value: {{tool_a}}', data);
    expect(result).toBe('Value: 42');
  });

  it('should handle boolean values', () => {
    const data: CollectedData[] = [
      { toolName: 'tool_a', data: true, executionTimeMs: 5, success: true },
    ];
    const result = renderTemplate('Value: {{tool_a}}', data);
    expect(result).toBe('Value: true');
  });
});

// ---------------------------------------------------------------------------
// registerExporter / getExporter
// ---------------------------------------------------------------------------

describe('registerExporter / getExporter', () => {
  it('should return the markdown exporter by default', () => {
    const exporter = getExporter('markdown');
    expect(exporter).toBeDefined();
    expect(exporter!.format).toBe('markdown');
  });

  it('should return undefined for unregistered format', () => {
    const exporter = getExporter('pdf');
    expect(exporter).toBeUndefined();
  });

  it('should return undefined for xlsx when not registered', () => {
    const exporter = getExporter('xlsx');
    expect(exporter).toBeUndefined();
  });

  it('should register a custom exporter', () => {
    const mockExporter: Exporter = {
      format: 'pdf',
      export: jest.fn().mockResolvedValue('pdf-content'),
    };
    registerExporter(mockExporter);

    const retrieved = getExporter('pdf');
    expect(retrieved).toBe(mockExporter);
  });

  it('should register and retrieve an xlsx exporter', () => {
    const mockExporter: Exporter = {
      format: 'xlsx',
      export: jest.fn().mockResolvedValue('xlsx-base64'),
    };
    registerExporter(mockExporter);

    const retrieved = getExporter('xlsx');
    expect(retrieved).toBe(mockExporter);
  });

  it('should overwrite an existing exporter when re-registering', () => {
    const first: Exporter = {
      format: 'pdf',
      export: jest.fn().mockResolvedValue('first'),
    };
    const second: Exporter = {
      format: 'pdf',
      export: jest.fn().mockResolvedValue('second'),
    };
    registerExporter(first);
    registerExporter(second);

    const retrieved = getExporter('pdf');
    expect(retrieved).toBe(second);
  });

  it('should call export on registered exporter with correct arguments', async () => {
    const mockExport = jest.fn().mockResolvedValue('exported-content');
    const mockExporter: Exporter = {
      format: 'pdf',
      export: mockExport,
    };
    registerExporter(mockExporter);

    const exporter = getExporter('pdf')!;
    const result = await exporter.export('# Title', []);
    expect(mockExport).toHaveBeenCalledWith('# Title', []);
    expect(result).toBe('exported-content');
  });
});

// ---------------------------------------------------------------------------
// ReportEngine
// ---------------------------------------------------------------------------

describe('ReportEngine', () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = createMockToolRegistry();
    // Default: executeTool succeeds
    mockExecuteTool.mockResolvedValue({
      success: true,
      data: { total: 5000, items: [] },
      executionTimeMs: 15,
      toolName: 'get_balance_sheet',
    });
  });

  describe('constructor', () => {
    it('should create an engine when valid options are provided', () => {
      const engine = createEngine({ registry });
      expect(engine).toBeInstanceOf(ReportEngine);
    });

    it('should throw when toolRegistry is omitted', () => {
      expect(() => {
        new ReportEngine({} as any);
      }).toThrow();
    });

    it('should throw when templateLoader is omitted', () => {
      expect(() => {
        new ReportEngine({ toolRegistry: registry } as any);
      }).toThrow();
    });
  });

  describe('generate - success scenarios', () => {
    it('should generate a report for a known template', async () => {
      const engine = createEngine({ registry });
      mockTemplateLoader.mockResolvedValue('# {{title}}\nTotal: {{get_balance_sheet.total}}');

      const result = await engine.generate({
        template: 'balance',
        period: '2026-Q1',
        formats: ['markdown'],
      });

      expect(result.success).toBe(true);
      expect(result.title).toBe('Reporte: balance');
      expect(result.period).toBe('2026-Q1');
      expect(result.generatedAt).toBeDefined();
      expect(result.markdown).toContain('Total: 5000');
      expect(result.collectedData).toHaveLength(1);
      expect(result.collectedData[0].toolName).toBe('get_balance_sheet');
      expect(result.totalExecutionTimeMs).toBeGreaterThanOrEqual(0);
    });

    it('should use custom title when provided', async () => {
      const engine = createEngine({ registry });
      mockTemplateLoader.mockResolvedValue('# {{title}}');

      const result = await engine.generate({
        template: 'balance',
        period: '2026-Q1',
        formats: ['markdown'],
        title: 'Balance General Q1 2026',
      });

      expect(result.title).toBe('Balance General Q1 2026');
    });

    it('should execute extra tools alongside template tools', async () => {
      const engine = createEngine({ registry });
      mockExecuteTool
        .mockResolvedValueOnce({ success: true, data: { total: 5000 }, executionTimeMs: 10, toolName: 'get_balance_sheet' })
        .mockResolvedValueOnce({ success: true, data: { ratio: 1.5 }, executionTimeMs: 5, toolName: 'get_ratio' });

      const result = await engine.generate({
        template: 'balance',
        period: '2026-Q1',
        formats: ['markdown'],
        extraToolNames: ['get_ratio'],
      });

      expect(result.success).toBe(true);
      expect(result.collectedData).toHaveLength(2);
      expect(result.collectedData[0].toolName).toBe('get_balance_sheet');
      expect(result.collectedData[1].toolName).toBe('get_ratio');
    });

    it('should export to multiple formats', async () => {
      // Register PDF exporter for this test
      const pdfExport = jest.fn().mockResolvedValue('pdf-content');
      const pdfExporter: Exporter = { format: 'pdf', export: pdfExport };
      registerExporter(pdfExporter);

      const engine = createEngine({ registry });
      mockTemplateLoader.mockResolvedValue('# Report');

      const result = await engine.generate({
        template: 'balance',
        period: '2026-Q1',
        formats: ['markdown', 'pdf'],
      });

      expect(result.success).toBe(true);
      expect(result.exports.markdown).toBeDefined();
      expect(result.exports.pdf).toBeDefined();
      expect(result.exports.pdf).toBe('pdf-content');
    });

    it('should include generatedAt as a valid ISO string', async () => {
      const engine = createEngine({ registry });
      const result = await engine.generate({
        template: 'balance',
        period: '2026-Q1',
        formats: ['markdown'],
      });

      expect(() => new Date(result.generatedAt)).not.toThrow();
      expect(new Date(result.generatedAt).toISOString()).toBe(result.generatedAt);
    });

    it('should set success:true on the report result', async () => {
      const engine = createEngine({ registry });
      const result = await engine.generate({
        template: 'balance',
        period: '2026-Q1',
        formats: ['markdown'],
      });

      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
    });
  });

  describe('generate - error handling', () => {
    it('should handle unknown template (no tools registered)', async () => {
      const engine = createEngine({ registry });

      const result = await engine.generate({
        template: 'non_existent',
        period: '2026-Q1',
        formats: ['markdown'],
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('No hay tools registradas');
      expect(result.collectedData).toHaveLength(0);
      expect(result.markdown).toBe('');
    });

    it('should handle tool execution failure gracefully', async () => {
      mockExecuteTool.mockResolvedValue({
        success: false,
        data: undefined,
        executionTimeMs: 5,
        toolName: 'get_balance_sheet',
        error: 'API error',
      });

      const engine = createEngine({ registry });
      mockTemplateLoader.mockResolvedValue('# Report');

      const result = await engine.generate({
        template: 'balance',
        period: '2026-Q1',
        formats: ['markdown'],
      });

      expect(result.success).toBe(true); // Report itself succeeds but marks tool failure
      expect(result.collectedData[0].success).toBe(false);
      expect(result.collectedData[0].error).toBe('API error');
    });

    it('should handle tool throwing an exception', async () => {
      mockExecuteTool.mockRejectedValue(new Error('Connection refused'));

      const engine = createEngine({ registry });
      mockTemplateLoader.mockResolvedValue('# Report');

      const result = await engine.generate({
        template: 'balance',
        period: '2026-Q1',
        formats: ['markdown'],
      });

      expect(result.success).toBe(true);
      expect(result.collectedData[0].success).toBe(false);
      expect(result.collectedData[0].error).toBe('Connection refused');
      expect(result.collectedData[0].executionTimeMs).toBe(0);
    });

    it('should handle template loader failure by using default template', async () => {
      mockTemplateLoader.mockRejectedValue(new Error('File not found'));

      const engine = createEngine({ registry });

      const result = await engine.generate({
        template: 'balance',
        period: '2026-Q1',
        formats: ['markdown'],
      });

      expect(result.success).toBe(true);
      // Default template is used, so markdown should not be empty
      expect(result.markdown).toBeTruthy();
      expect(result.markdown).toContain('**Template:** balance');
    });

    it('should handle invalid request (empty formats) gracefully', async () => {
      const engine = createEngine({ registry });

      const result = await engine.generate({
        template: 'balance',
        period: '2026-Q1',
        formats: [],
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should handle exporter failure gracefully', async () => {
      const failingExporter: Exporter = {
        format: 'pdf',
        export: jest.fn().mockRejectedValue(new Error('PDF generation failed')),
      };
      registerExporter(failingExporter);

      const engine = createEngine({ registry });
      mockTemplateLoader.mockResolvedValue('# Report');

      const result = await engine.generate({
        template: 'balance',
        period: '2026-Q1',
        formats: ['markdown', 'pdf'],
      });

      expect(result.success).toBe(true);
      expect(result.exports.markdown).toBeDefined();
      expect(result.exports.pdf).toContain('Error exporting');
      expect(result.exports.pdf).toContain('PDF generation failed');
    });

    it('should handle missing exporter for a format', async () => {
      const engine = createEngine({ registry });
      mockTemplateLoader.mockResolvedValue('# Report');

      const result = await engine.generate({
        template: 'balance',
        period: '2026-Q1',
        formats: ['markdown', 'xlsx'], // xlsx exporter not registered by default
      });

      expect(result.success).toBe(true);
      expect(result.exports.markdown).toBeDefined();
      expect(result.exports.xlsx).toContain('Exportador para "xlsx" no está registrado');
    });

    it('should catch unexpected errors in generate and return error result', async () => {
      const engine = createEngine({ registry });
      // Force a crash in collectData by making executeTool throw a non-standard error
      mockExecuteTool.mockImplementation(() => {
        throw 'string error'; // non-Error throw
      });

      const result = await engine.generate({
        template: 'balance',
        period: '2026-Q1',
        formats: ['markdown'],
      });

      // The error is caught in collectData (try/catch around the tool)
      // So the report itself should succeed but the tool data shows failure
      expect(result.success).toBe(true);
      expect(result.collectedData[0].success).toBe(false);
      expect(result.collectedData[0].error).toBe('string error');
    });
  });

  describe('generate - integration with templates', () => {
    it('should render template variables with collected data', async () => {
      mockExecuteTool.mockResolvedValue({
        success: true,
        data: { total: 10000, count: 42 },
        executionTimeMs: 10,
        toolName: 'get_balance_sheet',
      });
      mockTemplateLoader.mockResolvedValue(
        '# Finance Report\nTotal: {{get_balance_sheet.total}}\nCount: {{get_balance_sheet.count}}',
      );

      const engine = createEngine({ registry });
      const result = await engine.generate({
        template: 'balance',
        period: '2026-Q1',
        formats: ['markdown'],
      });

      expect(result.markdown).toContain('Total: 10000');
      expect(result.markdown).toContain('Count: 42');
    });

    it('should leave unmatched variables in the rendered output', async () => {
      mockExecuteTool.mockResolvedValue({
        success: true,
        data: { value: 100 },
        executionTimeMs: 10,
        toolName: 'get_balance_sheet',
      });
      mockTemplateLoader.mockResolvedValue(
        '# Report\nValue: {{get_balance_sheet.value}}\nMissing: {{nonexistent.path}}',
      );

      const engine = createEngine({ registry });
      const result = await engine.generate({
        template: 'balance',
        period: '2026-Q1',
        formats: ['markdown'],
      });

      expect(result.markdown).toContain('Value: 100');
      expect(result.markdown).toContain('{{nonexistent.path}}');
    });
  });
});

// ---------------------------------------------------------------------------
// ReportResult structural tests
// ---------------------------------------------------------------------------

describe('ReportResult structure', () => {
  it('should return all required fields on success', async () => {
    const registry = createMockToolRegistry();
    mockExecuteTool.mockResolvedValue({
      success: true,
      data: { total: 5000 },
      executionTimeMs: 10,
      toolName: 'get_balance_sheet',
    });
    mockTemplateLoader.mockResolvedValue('# Report');

    const engine = createEngine({ registry });
    const result = await engine.generate({
      template: 'balance',
      period: '2026-Q1',
      formats: ['markdown'],
    });

    // Verify all required fields exist
    expect(result).toHaveProperty('title');
    expect(result).toHaveProperty('period');
    expect(result).toHaveProperty('generatedAt');
    expect(result).toHaveProperty('collectedData');
    expect(result).toHaveProperty('markdown');
    expect(result).toHaveProperty('exports');
    expect(result).toHaveProperty('totalExecutionTimeMs');
    expect(result).toHaveProperty('success');

    // Type checks
    expect(typeof result.title).toBe('string');
    expect(typeof result.period).toBe('string');
    expect(Array.isArray(result.collectedData)).toBe(true);
    expect(typeof result.markdown).toBe('string');
    expect(typeof result.exports).toBe('object');
    expect(typeof result.totalExecutionTimeMs).toBe('number');
    expect(typeof result.success).toBe('boolean');
  });

  it('should return all required fields on failure', async () => {
    const registry = createMockToolRegistry();
    const engine = createEngine({ registry });

    const result = await engine.generate({
      template: 'non_existent',
      period: '2026-Q1',
      formats: ['markdown'],
    });

    expect(result).toHaveProperty('title');
    expect(result).toHaveProperty('period');
    expect(result).toHaveProperty('generatedAt');
    expect(result).toHaveProperty('collectedData');
    expect(result).toHaveProperty('markdown');
    expect(result).toHaveProperty('exports');
    expect(result).toHaveProperty('totalExecutionTimeMs');
    expect(result).toHaveProperty('success');
    expect(result).toHaveProperty('error');
    expect(result.success).toBe(false);
    expect(typeof result.error).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// CollectedData structural validation
// ---------------------------------------------------------------------------

describe('CollectedData structure', () => {
  it('should include all required fields on success', async () => {
    const registry = createMockToolRegistry();
    mockExecuteTool.mockResolvedValue({
      success: true,
      data: { value: 100 },
      executionTimeMs: 42,
      toolName: 'get_balance_sheet',
    });
    mockTemplateLoader.mockResolvedValue('# Report');

    const engine = createEngine({ registry });
    const result = await engine.generate({
      template: 'balance',
      period: '2026-Q1',
      formats: ['markdown'],
    });

    const cd = result.collectedData[0];
    expect(cd.toolName).toBe('get_balance_sheet');
    expect(cd.data).toEqual({ value: 100 });
    expect(cd.executionTimeMs).toBe(42);
    expect(cd.success).toBe(true);
    expect(cd.error).toBeUndefined();
  });

  it('should include error field on failure', async () => {
    const registry = createMockToolRegistry();
    mockExecuteTool.mockResolvedValue({
      success: false,
      data: undefined,
      executionTimeMs: 5,
      toolName: 'get_balance_sheet',
      error: 'Something went wrong',
    });
    mockTemplateLoader.mockResolvedValue('# Report');

    const engine = createEngine({ registry });
    const result = await engine.generate({
      template: 'balance',
      period: '2026-Q1',
      formats: ['markdown'],
    });

    const cd = result.collectedData[0];
    expect(cd.success).toBe(false);
    expect(cd.error).toBe('Something went wrong');
    expect(cd.data).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Edge cases - template loader behavior
// ---------------------------------------------------------------------------

describe('ReportEngine - template loader edge cases', () => {
  it('should use default template when loader throws non-Error', async () => {
    const registry = createMockToolRegistry();
    mockExecuteTool.mockResolvedValue({
      success: true,
      data: { total: 5000 },
      executionTimeMs: 10,
      toolName: 'get_balance_sheet',
    });
    mockTemplateLoader.mockRejectedValue('File missing');

    const engine = createEngine({ registry });
    const result = await engine.generate({
      template: 'balance',
      period: '2026-Q1',
      formats: ['markdown'],
    });

    expect(result.success).toBe(true);
    expect(result.markdown).toContain('**Template:** balance');
  });

  it('should handle very large template content', async () => {
    const registry = createMockToolRegistry();
    mockExecuteTool.mockResolvedValue({
      success: true,
      data: { value: 'x' },
      executionTimeMs: 10,
      toolName: 'get_balance_sheet',
    });
    const largeTemplate = '# Big Report\n' + 'A'.repeat(10000) + '\nValue: {{get_balance_sheet.value}}';
    mockTemplateLoader.mockResolvedValue(largeTemplate);

    const engine = createEngine({ registry });
    const result = await engine.generate({
      template: 'balance',
      period: '2026-Q1',
      formats: ['markdown'],
    });

    expect(result.success).toBe(true);
    expect(result.markdown.length).toBeGreaterThan(10000);
    expect(result.markdown).toContain('Value: x');
  });

  it('should handle template with no variables', async () => {
    const registry = createMockToolRegistry();
    mockExecuteTool.mockResolvedValue({
      success: true,
      data: { value: 100 },
      executionTimeMs: 10,
      toolName: 'get_balance_sheet',
    });
    mockTemplateLoader.mockResolvedValue('Static content without variables');

    const engine = createEngine({ registry });
    const result = await engine.generate({
      template: 'balance',
      period: '2026-Q1',
      formats: ['markdown'],
    });

    expect(result.success).toBe(true);
    expect(result.markdown).toBe('Static content without variables');
  });
});

// ---------------------------------------------------------------------------
// Edge cases - multiple tools and formats
// ---------------------------------------------------------------------------

describe('ReportEngine - multiple tools and formats', () => {
  it('should collect data from all registered template tools', async () => {
    const registry = createMockToolRegistry();
    mockExecuteTool
      .mockResolvedValueOnce({ success: true, data: { total: 100 }, executionTimeMs: 5, toolName: 'tool_a' })
      .mockResolvedValueOnce({ success: true, data: { total: 200 }, executionTimeMs: 5, toolName: 'tool_b' });

    // Register a template with two tools
    registerTemplateTools('multi_tool', ['tool_a', 'tool_b']);

    mockTemplateLoader.mockResolvedValue('# Multi Report');

    const engine = createEngine({ registry });
    const result = await engine.generate({
      template: 'multi_tool',
      period: '2026-Q1',
      formats: ['markdown'],
    });

    expect(result.collectedData).toHaveLength(2);
    expect(result.collectedData[0].toolName).toBe('tool_a');
    expect(result.collectedData[1].toolName).toBe('tool_b');
  });

  it('should export to all requested formats', async () => {
    // Register PDF and XLSX exporters
    const pdfExport = jest.fn().mockResolvedValue('pdf-data');
    const xlsxExport = jest.fn().mockResolvedValue('xlsx-data');
    registerExporter({ format: 'pdf', export: pdfExport });
    registerExporter({ format: 'xlsx', export: xlsxExport });

    const registry = createMockToolRegistry();
    mockExecuteTool.mockResolvedValue({
      success: true,
      data: { total: 100 },
      executionTimeMs: 5,
      toolName: 'get_balance_sheet',
    });
    mockTemplateLoader.mockResolvedValue('# Report');

    const engine = createEngine({ registry });
    const result = await engine.generate({
      template: 'balance',
      period: '2026-Q1',
      formats: ['markdown', 'pdf', 'xlsx'],
    });

    expect(result.exports.markdown).toBeDefined();
    expect(result.exports.pdf).toBe('pdf-data');
    expect(result.exports.xlsx).toBe('xlsx-data');
  });

  it('should preserve correct execution order of tools', async () => {
    const registry = createMockToolRegistry();
    const executionOrder: string[] = [];

    mockExecuteTool.mockImplementation(async (name: string) => {
      executionOrder.push(name);
      return { success: true, data: {}, executionTimeMs: 1, toolName: name };
    });

    registerTemplateTools('ordered', ['first_tool', 'second_tool', 'third_tool']);
    mockTemplateLoader.mockResolvedValue('# Ordered');

    const engine = createEngine({ registry });
    await engine.generate({
      template: 'ordered',
      period: '2026-Q1',
      formats: ['markdown'],
    });

    expect(executionOrder).toEqual(['first_tool', 'second_tool', 'third_tool']);
  });
});
