import { z } from 'zod';
import { defineTool } from '../core/tool-registry';

/**
 * Esquema de entrada para la tool kpi-dashboard.
 * Requiere el período para el cual se desea obtener el dashboard de KPIs.
 */
const KpiDashboardInputSchema = z.object({
  period: z.string({
    required_error: 'El período es requerido',
    invalid_type_error: 'El período debe ser un string',
  }).min(1, 'El período no puede estar vacío'),
});

/**
 * Tipo inferido del esquema de entrada.
 */
type KpiDashboardInput = z.infer<typeof KpiDashboardInputSchema>;

/**
 * Interfaz que define la estructura de un KPI individual.
 */
interface KpiItem {
  name: string;
  value: number;
  unit: string;
  trend: 'up' | 'down' | 'stable';
  previousValue?: number;
  variation?: number;
}

/**
 * Interfaz que define la estructura de la respuesta del dashboard de KPIs.
 */
interface KpiDashboardOutput {
  kpis: KpiItem[];
  period: string;
  _timestamp: string;
}

/**
 * Tool que retorna un dashboard de KPIs financieros para un período dado.
 * 
 * @example
 * const result = await kpiDashboardTool.handler({ period: '2024-01' });
 * // {
 * //   kpis: [
 * //     { name: 'Margen Bruto', value: 35.5, unit: '%', trend: 'up', previousValue: 33.2, variation: 2.3 },
 * //     ...
 * //   ],
 * //   period: '2024-01',
 * //   _timestamp: '2024-01-15T10:30:00.000Z'
 * // }
 */
export const kpiDashboardTool = defineTool<KpiDashboardInput, KpiDashboardOutput>({
  name: 'kpi_dashboard',
  description: 'Obtiene un dashboard de KPIs financieros para el período especificado. Retorna indicadores clave como margen bruto, EBITDA, liquidez, endeudamiento, rentabilidad, entre otros.',
  inputSchema: KpiDashboardInputSchema,
  tags: ['financial', 'kpi-dashboard'],
  version: '1.0.0',
  handler: async (input: KpiDashboardInput): Promise<KpiDashboardOutput> => {
    // Simular un pequeño delay para emular una llamada a API
    await new Promise(resolve => setTimeout(resolve, 50));

    const timestamp = new Date().toISOString();

    // Datos mock de KPIs financieros
    const kpis: KpiItem[] = [
      {
        name: 'Margen Bruto',
        value: 35.5,
        unit: '%',
        trend: 'up',
        previousValue: 33.2,
        variation: 2.3,
      },
      {
        name: 'Margen EBITDA',
        value: 22.8,
        unit: '%',
        trend: 'up',
        previousValue: 21.1,
        variation: 1.7,
      },
      {
        name: 'Margen Neto',
        value: 12.4,
        unit: '%',
        trend: 'stable',
        previousValue: 12.1,
        variation: 0.3,
      },
      {
        name: 'Liquidez Corriente',
        value: 1.85,
        unit: 'veces',
        trend: 'up',
        previousValue: 1.72,
        variation: 0.13,
      },
      {
        name: 'Prueba Ácida',
        value: 1.25,
        unit: 'veces',
        trend: 'down',
        previousValue: 1.32,
        variation: -0.07,
      },
      {
        name: 'Endeudamiento Total',
        value: 58.3,
        unit: '%',
        trend: 'down',
        previousValue: 61.5,
        variation: -3.2,
      },
      {
        name: 'Endeudamiento Financiero',
        value: 32.1,
        unit: '%',
        trend: 'down',
        previousValue: 34.8,
        variation: -2.7,
      },
      {
        name: 'ROE (Return on Equity)',
        value: 18.6,
        unit: '%',
        trend: 'up',
        previousValue: 16.9,
        variation: 1.7,
      },
      {
        name: 'ROA (Return on Assets)',
        value: 7.8,
        unit: '%',
        trend: 'up',
        previousValue: 7.2,
        variation: 0.6,
      },
      {
        name: 'Rotación de Cartera',
        value: 45,
        unit: 'días',
        trend: 'down',
        previousValue: 48,
        variation: -3,
      },
      {
        name: 'Rotación de Inventarios',
        value: 62,
        unit: 'días',
        trend: 'stable',
        previousValue: 63,
        variation: -1,
      },
      {
        name: 'Ciclo de Efectivo',
        value: 38,
        unit: 'días',
        trend: 'down',
        previousValue: 42,
        variation: -4,
      },
    ];

    return {
      kpis,
      period: input.period,
      _timestamp: timestamp,
    };
  },
});

export default kpiDashboardTool;