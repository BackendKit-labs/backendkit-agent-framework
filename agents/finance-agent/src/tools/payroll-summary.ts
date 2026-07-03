import { z } from 'zod';
import { defineTool } from '../core/tool-registry';

/**
 * Esquema de entrada para la tool get_payroll_summary.
 * Permite filtrar por período (requerido).
 */
const GetPayrollSummaryInputSchema = z.object({
  period: z.string({
    required_error: 'El período es requerido (ej: "2025-01", "2025-Q1", "2025")',
    invalid_type_error: 'El período debe ser un string',
  }).min(1, 'El período no puede estar vacío'),
});

/**
 * Tipo inferido del schema de entrada.
 */
type GetPayrollSummaryInput = z.infer<typeof GetPayrollSummaryInputSchema>;

/**
 * Interfaz del resultado del resumen de nómina.
 */
interface PayrollSummaryResult {
  totalGross: number;
  totalNet: number;
  headcount: number;
  avgSalary: number;
  deductions: number;
  period: string;
  _timestamp: string;
}

/**
 * Tool que retorna un resumen de nómina para un período dado.
 * 
 * @example
 * const result = await getPayrollSummary.handler({ period: "2025-01" });
 * // => { totalGross: 125000, totalNet: 98750, headcount: 45, avgSalary: 2777.78, deductions: 26250, period: "2025-01", _timestamp: "2025-03-15T10:30:00.000Z" }
 */
export const getPayrollSummary = defineTool<GetPayrollSummaryInput, PayrollSummaryResult>({
  name: 'get_payroll_summary',
  description: 'Obtiene un resumen ejecutivo de nómina para un período específico. Retorna totales brutos, netos, cantidad de empleados, salario promedio y deducciones.',
  inputSchema: GetPayrollSummaryInputSchema,
  tags: ['financial', 'payroll-summary'],
  version: '1.0.0',
  handler: async ({ period }: GetPayrollSummaryInput): Promise<PayrollSummaryResult> => {
    // Simular datos mock basados en el período
    const baseGross = 125000;
    const baseHeadcount = 45;
    const baseDeductions = 26250;

    // Variación mock según el período para simular datos realistas
    const periodHash = period.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const variation = (periodHash % 20) - 10; // entre -10 y +9
    const factor = 1 + variation / 100;

    const totalGross = Math.round(baseGross * factor);
    const headcount = Math.round(baseHeadcount * factor);
    const deductions = Math.round(baseDeductions * factor);
    const totalNet = totalGross - deductions;
    const avgSalary = headcount > 0 ? Math.round((totalGross / headcount) * 100) / 100 : 0;

    return {
      totalGross,
      totalNet,
      headcount,
      avgSalary,
      deductions,
      period,
      _timestamp: new Date().toISOString(),
    };
  },
});