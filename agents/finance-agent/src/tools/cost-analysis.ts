import { z } from 'zod';
import { defineTool } from '../core/tool-registry';

/**
 * Esquema de entrada para la tool cost_analysis.
 * Requiere el período a analizar.
 */
const CostAnalysisInputSchema = z.object({
  period: z.string({
    required_error: 'El período es requerido',
    invalid_type_error: 'El período debe ser un string',
  }).min(1, 'El período no puede estar vacío'),
});

/**
 * Tipo inferido del schema de entrada.
 */
type CostAnalysisInput = z.infer<typeof CostAnalysisInputSchema>;

/**
 * Categoría de costo individual.
 */
interface CostCategory {
  name: string;
  amount: number;
  budget: number;
  variance: number;
  variancePercentage: number;
}

/**
 * Resultado del análisis de costos.
 */
interface CostAnalysisResult {
  categories: CostCategory[];
  totalCost: number;
  totalBudget: number;
  period: string;
  _timestamp: string;
}

/**
 * Tool que analiza costos y gastos por categoría.
 * Retorna datos mock para desarrollo y pruebas.
 */
export const costAnalysisTool = defineTool<CostAnalysisInput, CostAnalysisResult>({
  name: 'cost_analysis',
  description: 'Analiza costos y gastos por categoría para un período específico. Retorna desglose por categoría con montos reales vs presupuestados, variaciones y totales.',
  inputSchema: CostAnalysisInputSchema,
  tags: ['financial', 'cost-analysis'],
  version: '1.0.0',
  handler: async (input: CostAnalysisInput): Promise<CostAnalysisResult> => {
    // Datos mock para desarrollo
    const categories: CostCategory[] = [
      {
        name: 'Materia Prima',
        amount: 450000,
        budget: 420000,
        variance: 30000,
        variancePercentage: 7.14,
      },
      {
        name: 'Mano de Obra Directa',
        amount: 280000,
        budget: 300000,
        variance: -20000,
        variancePercentage: -6.67,
      },
      {
        name: 'Gastos de Fabricación',
        amount: 185000,
        budget: 175000,
        variance: 10000,
        variancePercentage: 5.71,
      },
      {
        name: 'Gastos Administrativos',
        amount: 120000,
        budget: 115000,
        variance: 5000,
        variancePercentage: 4.35,
      },
      {
        name: 'Gastos de Ventas',
        amount: 95000,
        budget: 100000,
        variance: -5000,
        variancePercentage: -5.00,
      },
      {
        name: 'Depreciación',
        amount: 45000,
        budget: 45000,
        variance: 0,
        variancePercentage: 0,
      },
      {
        name: 'Servicios Públicos',
        amount: 32000,
        budget: 30000,
        variance: 2000,
        variancePercentage: 6.67,
      },
      {
        name: 'Arrendamientos',
        amount: 55000,
        budget: 55000,
        variance: 0,
        variancePercentage: 0,
      },
    ];

    const totalCost = categories.reduce((sum, cat) => sum + cat.amount, 0);
    const totalBudget = categories.reduce((sum, cat) => sum + cat.budget, 0);

    return {
      categories,
      totalCost,
      totalBudget,
      period: input.period,
      _timestamp: new Date().toISOString(),
    };
  },
});

export default costAnalysisTool;