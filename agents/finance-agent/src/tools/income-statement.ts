import { z } from 'zod';
import { defineTool } from '../core/tool-registry';

/**
 * Schema de entrada para la tool get_income_statement.
 * Valida que period sea una cadena no vacía.
 */
const IncomeStatementInputSchema = z.object({
  period: z.string().min(1, 'El período es requerido'),
});

/**
 * Tipo inferido del schema de entrada.
 */
export type IncomeStatementInput = z.infer<typeof IncomeStatementInputSchema>;

/**
 * Tipo de salida de la tool.
 */
export interface IncomeStatementOutput {
  revenue: number;
  cogs: number;
  grossMargin: number;
  operatingExpenses: number;
  netIncome: number;
  ebitda: number;
  period: string;
  _timestamp: string;
}

/**
 * Tool que obtiene el estado de resultados (PyG) para un período dado.
 * Por ahora retorna datos mock; en el futuro consultará la API Gateway.
 */
export const getIncomeStatementTool = defineTool({
  name: 'get_income_statement',
  description: 'Obtiene el estado de resultados (Pérdidas y Ganancias) para un período específico. Retorna revenue, cogs, grossMargin, operatingExpenses, netIncome, ebitda.',
  inputSchema: IncomeStatementInputSchema,
  handler: async (input: IncomeStatementInput): Promise<IncomeStatementOutput> => {
    // Mock data temporal — reemplazar con llamada real a API Gateway
    return {
      revenue: 1_250_000,
      cogs: 750_000,
      grossMargin: 500_000,
      operatingExpenses: 320_000,
      netIncome: 180_000,
      ebitda: 210_000,
      period: input.period,
      _timestamp: new Date().toISOString(),
    };
  },
  version: '1.0.0',
  tags: ['financial', 'income-statement'],
});