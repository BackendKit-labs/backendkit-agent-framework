import { z } from 'zod';
import { defineTool } from '../core/tool-registry';

/**
 * Input type for the tax-summary tool.
 */
export interface TaxSummaryInput {
  period: string;
  country: string;
}

/**
 * Esquema de entrada para la tool tax-summary.
 */
const TaxSummaryInputSchema = z.object({
  period: z.string().min(1, 'El período es requerido'),
  country: z.string().default('CO'),
}) as z.ZodType<TaxSummaryInput>;

/**
 * Esquema de salida para la tool tax-summary.
 */
const TaxSummaryOutputSchema = z.object({
  taxes: z.array(
    z.object({
      name: z.string(),
      amount: z.number(),
      status: z.enum(['paid', 'pending', 'accrued']),
      dueDate: z.string().optional(),
    })
  ),
  totalAccrued: z.number(),
  totalPaid: z.number(),
  totalPending: z.number(),
  period: z.string(),
  country: z.string(),
});

export type TaxSummaryOutput = z.infer<typeof TaxSummaryOutputSchema>;

/**
 * Tool que retorna un resumen de la situación impositiva para un período y país dados.
 * Los datos son mock para desarrollo y pruebas.
 */
export const taxSummaryTool = defineTool<TaxSummaryInput, TaxSummaryOutput>({
  name: 'tax-summary',
  description:
    'Obtiene un resumen de la situación impositiva (impuestos, totales acumulados, pagados y pendientes) para un período y país específicos.',
  inputSchema: TaxSummaryInputSchema,
  tags: ['financial', 'tax-summary'],
  version: '1.0.0',
  handler: async (input: TaxSummaryInput): Promise<TaxSummaryOutput> => {
    const { period, country } = TaxSummaryInputSchema.parse(input);

    // Datos mock para desarrollo
    const mockTaxes = [
      { name: 'IVA', amount: 1500000, status: 'paid' as const, dueDate: '2025-02-15' },
      { name: 'Renta', amount: 3200000, status: 'accrued' as const, dueDate: '2025-04-30' },
      { name: 'ICA', amount: 450000, status: 'pending' as const, dueDate: '2025-03-20' },
      { name: 'Retefuente', amount: 780000, status: 'paid' as const, dueDate: '2025-02-10' },
    ];

    const totalAccrued = mockTaxes
      .filter((t) => t.status === 'accrued')
      .reduce((sum, t) => sum + t.amount, 0);

    const totalPaid = mockTaxes
      .filter((t) => t.status === 'paid')
      .reduce((sum, t) => sum + t.amount, 0);

    const totalPending = mockTaxes
      .filter((t) => t.status === 'pending')
      .reduce((sum, t) => sum + t.amount, 0);

    return {
      taxes: mockTaxes,
      totalAccrued,
      totalPaid,
      totalPending,
      period,
      country,
    };
  },
});