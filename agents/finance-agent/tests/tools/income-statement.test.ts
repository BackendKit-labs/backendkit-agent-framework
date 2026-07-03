import { defineTool } from '../../src/core/tool-registry';
import { z } from 'zod';

// Mock de fetch global para simular llamadas HTTP
const mockFetch = jest.fn();
global.fetch = mockFetch;

// Definición de la tool de income statement
const incomeStatementTool = defineTool({
  name: 'get_income_statement',
  description: 'Obtiene el estado de resultados (PyG) para un período específico',
  inputSchema: z.object({
    period: z.string().min(1, 'El período es requerido').describe('Período contable (ej: "2024-01", "2024-Q1", "2024")'),
    companyId: z.string().optional().describe('ID de la empresa (opcional, usa default)'),
  }),
  handler: async ({ period, companyId }) => {
    const params = new URLSearchParams({ period });
    if (companyId) params.append('companyId', companyId);

    const response = await fetch(`http://localhost:3001/api/financial/income-statement?${params}`);
    if (!response.ok) {
      throw new Error(`Error al obtener estado de resultados: ${response.statusText}`);
    }
    return response.json();
  },
  version: '1.0.0',
  tags: ['financial', 'income-statement'],
});

describe('Income Statement Tool', () => {
  beforeEach(() => {
    mockFetch.mockClear();
  });

  it('should define the tool with correct metadata', () => {
    expect(incomeStatementTool.name).toBe('get_income_statement');
    expect(incomeStatementTool.description).toContain('estado de resultados');
    expect(incomeStatementTool.version).toBe('1.0.0');
    expect(incomeStatementTool.tags).toContain('financial');
  });

  it('should validate input schema correctly', () => {
    const validInput = { period: '2024-01' };
    const result = incomeStatementTool.inputSchema.safeParse(validInput);
    expect(result.success).toBe(true);
  });

  it('should reject input without period', () => {
    const invalidInput = {};
    const result = incomeStatementTool.inputSchema.safeParse(invalidInput);
    expect(result.success).toBe(false);
  });

  it('should reject input with empty period', () => {
    const invalidInput = { period: '' };
    const result = incomeStatementTool.inputSchema.safeParse(invalidInput);
    expect(result.success).toBe(false);
  });

  it('should accept input with optional companyId', () => {
    const validInput = { period: '2024-Q1', companyId: 'emp-001' };
    const result = incomeStatementTool.inputSchema.safeParse(validInput);
    expect(result.success).toBe(true);
  });

  it('should call fetch with correct URL when handler is executed', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ revenue: 100000, expenses: 80000, netIncome: 20000 }),
    });

    const result = await incomeStatementTool.handler({ period: '2024-01' });

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3001/api/financial/income-statement?period=2024-01'
    );
    expect(result).toEqual({ revenue: 100000, expenses: 80000, netIncome: 20000 });
  });

  it('should include companyId in URL when provided', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ revenue: 100000, expenses: 80000, netIncome: 20000 }),
    });

    await incomeStatementTool.handler({ period: '2024-01', companyId: 'emp-002' });

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:3001/api/financial/income-statement?period=2024-01&companyId=emp-002'
    );
  });

  it('should throw error when API returns non-ok response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      statusText: 'Not Found',
    });

    await expect(
      incomeStatementTool.handler({ period: '2024-13' })
    ).rejects.toThrow('Error al obtener estado de resultados: Not Found');
  });

  it('should handle network errors gracefully', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    await expect(
      incomeStatementTool.handler({ period: '2024-01' })
    ).rejects.toThrow('Network error');
  });

  it('should handle different period formats', () => {
    const formats = ['2024', '2024-01', '2024-Q1', '2024-H1'];
    formats.forEach(format => {
      const result = incomeStatementTool.inputSchema.safeParse({ period: format });
      expect(result.success).toBe(true);
    });
  });

  it('should reject non-string period values', () => {
    const invalidInputs = [
      { period: 2024 },
      { period: null },
      { period: undefined },
      { period: true },
    ];
    invalidInputs.forEach(input => {
      const result = incomeStatementTool.inputSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });
});