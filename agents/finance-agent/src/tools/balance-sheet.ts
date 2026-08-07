import { z } from 'zod';
import { defineTool } from '../core/tool-registry';

/**
 * Esquema de entrada para la tool get_balance_sheet.
 * Permite filtrar por período (opcional).
 */
const GetBalanceSheetInputSchema = z.object({
  period: z
    .string()
    .regex(/^\d{4}-\d{2}$/, 'Formato de período inválido. Use YYYY-MM (ej: 2025-01)')
    .optional()
    .describe('Período contable en formato YYYY-MM. Si no se especifica, retorna el último período disponible.'),
});

/**
 * Esquema de salida para la tool get_balance_sheet.
 */
const BalanceSheetSchema = z.object({
  totalAssets: z.number().nonnegative(),
  totalLiabilities: z.number().nonnegative(),
  equity: z.number(),
  ratios: z.object({
    liquidity: z.number().nonnegative(),
    solvency: z.number().nonnegative(),
    currentRatio: z.number().nonnegative(),
  }),
  period: z.string(),
  _timestamp: z.string(),
});

export type GetBalanceSheetInput = z.infer<typeof GetBalanceSheetInputSchema>;
export type BalanceSheet = z.infer<typeof BalanceSheetSchema>;

/**
 * Mock/data temporal de balance general.
 * En producción, esto consultaría la API Gateway o un MCP server externo.
 */
function generateMockBalanceSheet(period?: string): BalanceSheet {
  const effectivePeriod = period ?? '2025-01';
  const totalAssets = 1_250_000.00;
  const totalLiabilities = 750_000.00;
  const equity = totalAssets - totalLiabilities; // 500_000.00

  return {
    totalAssets,
    totalLiabilities,
    equity,
    ratios: {
      liquidity: totalAssets / totalLiabilities, // ~1.67
      solvency: equity / totalAssets, // 0.4
      currentRatio: totalAssets / totalLiabilities, // ~1.67 (mismo que liquidity en este mock simplificado)
    },
    period: effectivePeriod,
    _timestamp: new Date().toISOString(),
  };
}

/**
 * Tool: get_balance_sheet
 * Obtiene el balance general de la empresa para un período específico.
 * Retorna activos totales, pasivos totales, patrimonio y ratios financieros.
 */
export const getBalanceSheetTool = defineTool({
  name: 'get_balance_sheet',
  description: 'Obtiene el balance general de la empresa: activos totales, pasivos totales, patrimonio y ratios financieros (liquidez, solvencia, razón corriente).',
  inputSchema: GetBalanceSheetInputSchema,
  handler: async (input: GetBalanceSheetInput): Promise<BalanceSheet> => {
    // Simular latencia de red/API
    await new Promise((resolve) => setTimeout(resolve, 100));

    return generateMockBalanceSheet(input.period);
  },
  version: '1.0.0',
  tags: ['financial', 'balance-sheet'],
});