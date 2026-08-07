import { z } from 'zod';
import { defineTool } from '../core/tool-registry';

/**
 * Input type for the revenue_breakdown tool.
 */
export interface RevenueBreakdownInput {
  period: string;
  groupBy: 'product' | 'region' | 'channel';
}

/**
 * Esquema de entrada para la tool revenue_breakdown.
 * Permite filtrar por período (requerido) y agrupar por producto/región/canal (opcional, default 'product').
 */
const RevenueBreakdownInputSchema = z.object({
  period: z.string().min(1, 'El período es requerido (ej: "2025-01", "2025-Q1", "2025")'),
  groupBy: z.enum(['product', 'region', 'channel']).default('product'),
}) as z.ZodType<RevenueBreakdownInput>;

/**
 * Tool que retorna un desglose de ingresos mock para el período solicitado.
 * 
 * @example
 * const result = await revenueBreakdownTool.handler({ period: "2025-01", groupBy: "product" });
 * // {
 * //   breakdown: [{ category: "Producto A", amount: 50000 }, ...],
 * //   total: 150000,
 * //   period: "2025-01",
 * //   _timestamp: "2025-04-08T12:00:00.000Z"
 * // }
 */
export const revenueBreakdownTool = defineTool({
  name: 'revenue_breakdown',
  description: 'Desglosa los ingresos por producto, región o canal para un período específico. Retorna un array de categorías con montos, el total del período y metadatos.',
  inputSchema: RevenueBreakdownInputSchema,
  tags: ['financial', 'revenue-breakdown'],
  version: '1.0.0',
  handler: async (input: RevenueBreakdownInput) => {
    const { period, groupBy } = input;

    // Mock de datos según el tipo de agrupación
    const mockData: Record<string, Array<{ category: string; amount: number }>> = {
      product: [
        { category: 'Producto A', amount: 85000 },
        { category: 'Producto B', amount: 62000 },
        { category: 'Producto C', amount: 43000 },
        { category: 'Servicios', amount: 28000 },
        { category: 'Suscripciones', amount: 15000 },
      ],
      region: [
        { category: 'Norte', amount: 72000 },
        { category: 'Sur', amount: 54000 },
        { category: 'Este', amount: 48000 },
        { category: 'Oeste', amount: 39000 },
        { category: 'Centro', amount: 20000 },
      ],
      channel: [
        { category: 'Directo', amount: 95000 },
        { category: 'Distribuidores', amount: 58000 },
        { category: 'Online', amount: 42000 },
        { category: 'Retail', amount: 38000 },
      ],
    };

    const breakdown = mockData[groupBy] ?? mockData.product;
    const total = breakdown.reduce((sum, item) => sum + item.amount, 0);

    return {
      breakdown,
      total,
      period,
      _timestamp: new Date().toISOString(),
    };
  },
});

export default revenueBreakdownTool;