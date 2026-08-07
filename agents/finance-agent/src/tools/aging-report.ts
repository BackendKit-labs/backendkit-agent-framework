import { z } from 'zod';
import { defineTool } from '../core/tool-registry';

/**
 * Input type for the aging-report tool.
 */
export interface AgingReportInput {
  period: string;
  type: 'receivable' | 'payable';
}

/**
 * Esquema de entrada para la tool aging-report.
 * - period: requerido, formato YYYY-MM
 * - type: opcional, default 'receivable' (receivable | payable)
 */
const AgingReportInputSchema = z.object({
  period: z
    .string()
    .regex(/^\d{4}-\d{2}$/, 'period debe tener formato YYYY-MM'),
  type: z.enum(['receivable', 'payable']).default('receivable'),
}) as z.ZodType<AgingReportInput>;

/**
 * Bucket de antigüedad de saldos.
 */
export interface AgingBucket {
  /** Nombre del bucket (ej: "0-30", "31-60", "61-90", "91+") */
  range: string;
  /** Monto total en el bucket */
  amount: number;
  /** Cantidad de facturas/items en el bucket */
  count: number;
  /** Porcentaje del total */
  percentage: number;
}

/**
 * Resultado de la tool aging-report.
 */
export interface AgingReportOutput {
  /** Buckets de antigüedad */
  buckets: AgingBucket[];
  /** Monto total de la cartera */
  total: number;
  /** Período consultado */
  period: string;
  /** Tipo de reporte */
  type: 'receivable' | 'payable';
  /** Timestamp de generación */
  _timestamp: string;
}

/**
 * Genera datos mock de aging report para el período y tipo solicitados.
 */
function generateMockAgingReport(input: AgingReportInput): AgingReportOutput {
  const { period, type } = input;

  // Simular montos base según el tipo
  const baseAmount = type === 'receivable' ? 1_250_000 : 890_000;

  // Distribución mock en buckets
  const buckets: AgingBucket[] = [
    { range: '0-30', amount: baseAmount * 0.45, count: 120, percentage: 45 },
    { range: '31-60', amount: baseAmount * 0.25, count: 65, percentage: 25 },
    { range: '61-90', amount: baseAmount * 0.15, count: 40, percentage: 15 },
    { range: '91+', amount: baseAmount * 0.15, count: 35, percentage: 15 },
  ];

  const total = buckets.reduce((sum, b) => sum + b.amount, 0);

  return {
    buckets,
    total: Math.round(total * 100) / 100,
    period,
    type,
    _timestamp: new Date().toISOString(),
  };
}

/**
 * Tool: aging-report
 * Genera un reporte de antigüedad de saldos (cuentas por cobrar o por pagar).
 */
export const agingReportTool = defineTool({
  name: 'aging-report',
  description:
    'Genera un reporte de antigüedad de saldos (aging report) para cuentas por cobrar (receivable) o por pagar (payable). Retorna buckets de antigüedad, total y metadata.',
  inputSchema: AgingReportInputSchema,
  tags: ['financial', 'aging-report'],
  version: '1.0.0',
  handler: async (input: AgingReportInput): Promise<AgingReportOutput> => {
    // Simular latencia de red/API
    await new Promise((resolve) => setTimeout(resolve, 100));
    return generateMockAgingReport(input);
  },
});