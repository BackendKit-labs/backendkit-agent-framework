import { defineTool } from '../../src/core/tool-registry';
import { z } from 'zod';

// Mock de fetch global
const mockFetch = jest.fn();
global.fetch = mockFetch;

// Definición de la tool cash-flow (simplificada para test)
const cashFlowTool = defineTool({
  name: 'get_cash_flow',
  description: 'Obtiene el flujo de caja para un período específico',
  inputSchema: z.object({
    period: z.string().describe('Período contable (ej: 2025-01)'),
    companyId: z.string().optional().describe('ID de la empresa'),
  }),
  handler: async ({ period, companyId }) => {
    const url = companyId
      ? `http://api-gateway/finance/cash-flow?period=${period}&companyId=${companyId}`
      : `http://api-gateway/finance/cash-flow?period=${period}`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Error al obtener flujo de caja: ${response.statusText}`);
    }
    return response.json();
  },
});

describe('Cash Flow Tool', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('debe definir la tool correctamente', () => {
    expect(cashFlowTool).toBeDefined();
    expect(cashFlowTool.name).toBe('get_cash_flow');
    expect(cashFlowTool.description).toContain('flujo de caja');
  });

  it('debe tener un esquema de entrada válido', () => {
    expect(cashFlowTool.inputSchema).toBeDefined();
    const schema = cashFlowTool.inputSchema;
    expect(schema).toBeInstanceOf(z.ZodObject);
  });

  it('debe ejecutar el handler y retornar datos', async () => {
    const mockData = { cash_flow: { operating: 1000, investing: -500, financing: 200 } };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockData,
    });

    const result = await cashFlowTool.handler({ period: '2025-01' });
    expect(result).toEqual(mockData);
    expect(mockFetch).toHaveBeenCalledWith(
      'http://api-gateway/finance/cash-flow?period=2025-01'
    );
  });

  it('debe incluir companyId en la URL si se proporciona', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    });

    await cashFlowTool.handler({ period: '2025-01', companyId: 'emp-123' });
    expect(mockFetch).toHaveBeenCalledWith(
      'http://api-gateway/finance/cash-flow?period=2025-01&companyId=emp-123'
    );
  });

  it('debe lanzar error si la API responde con error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      statusText: 'Not Found',
    });

    await expect(cashFlowTool.handler({ period: '2025-01' })).rejects.toThrow(
      'Error al obtener flujo de caja: Not Found'
    );
  });
});