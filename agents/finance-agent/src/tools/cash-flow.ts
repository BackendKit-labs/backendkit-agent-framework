import { z } from 'zod';
import { defineTool } from '../core/tool-registry';

/**
 * Esquema de entrada para la tool get_cash_flow.
 * Permite filtrar por período y empresa.
 */
const GetCashFlowInputSchema = z.object({
  period: z
    .string()
    .regex(/^\d{4}-\d{2}$/, 'Formato de período inválido. Use YYYY-MM')
    .optional()
    .describe('Período en formato YYYY-MM (ej: 2025-01). Si no se especifica, retorna el último período disponible.'),
  companyId: z
    .string()
    .optional()
    .describe('Identificador de la empresa. Si no se especifica, usa la empresa por defecto.'),
});

/**
 * Tipo de entrada inferido del schema Zod.
 */
export type GetCashFlowInput = z.infer<typeof GetCashFlowInputSchema>;

/**
 * Tipo de salida del flujo de caja.
 */
export interface CashFlowData {
  /** Flujo de efectivo de actividades operativas */
  operating: number;
  /** Flujo de efectivo de actividades de inversión */
  investing: number;
  /** Flujo de efectivo de actividades de financiamiento */
  financing: number;
  /** Variación neta del efectivo (operating + investing + financing) */
  netVariation: number;
  /** Saldo final de efectivo después del período */
  endingBalance: number;
  /** Período al que corresponde el flujo */
  period: string;
  /** Timestamp de generación del dato */
  _timestamp: string;
}

/**
 * Genera datos mock de flujo de caja para un período dado.
 *
 * @param period - Período en formato YYYY-MM
 * @returns Datos mock de flujo de caja
 */
function generateMockCashFlow(period: string): CashFlowData {
  // Semilla pseudo-aleatoria basada en el período para datos consistentes
  const seed = period.split('-').reduce((acc, part) => acc + parseInt(part, 10), 0);
  const pseudoRandom = (offset: number) => ((seed * 9301 + offset * 49297) % 233280) / 233280;

  const operating = Math.round(50000 + pseudoRandom(1) * 30000); // 50k-80k
  const investing = Math.round(-20000 - pseudoRandom(2) * 15000); // -20k a -35k
  const financing = Math.round(-5000 - pseudoRandom(3) * 10000); // -5k a -15k

  const netVariation = operating + investing + financing;
  const endingBalance = Math.round(100000 + netVariation + pseudoRandom(4) * 5000);

  return {
    operating,
    investing,
    financing,
    netVariation,
    endingBalance,
    period,
    _timestamp: new Date().toISOString(),
  };
}

/**
 * Tool: get_cash_flow
 *
 * Obtiene el estado de flujo de caja (Cash Flow Statement) para un período específico.
 * Retorna datos mock temporales mientras no haya conexión con la API Gateway.
 */
export const getCashFlowTool = defineTool({
  name: 'get_cash_flow',
  description:
    'Obtiene el estado de flujo de caja (Cash Flow Statement) para un período específico. ' +
    'Incluye flujos operativos, de inversión y financiamiento, variación neta y saldo final.',
  inputSchema: GetCashFlowInputSchema,
  handler: async (input: GetCashFlowInput): Promise<CashFlowData> => {
    // Determinar el período: usar el provisto o el mes actual
    const period = input.period ?? new Date().toISOString().slice(0, 7);

    // Simular latencia de red (100-300ms)
    await new Promise((resolve) =>
      setTimeout(resolve, 100 + Math.random() * 200)
    );

    // Generar y retornar datos mock
    return generateMockCashFlow(period);
  },
  version: '1.0.0',
  tags: ['financial', 'cash-flow', 'mock'],
});