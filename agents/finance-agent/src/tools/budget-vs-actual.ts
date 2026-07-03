import { z } from 'zod';
import { defineTool } from '../core/tool-registry';

/**
 * Esquema de entrada para la tool budget_vs_actual.
 * Permite filtrar por período (requerido) y departamento (opcional).
 */
const BudgetVsActualInputSchema = z.object({
  period: z
    .string()
    .min(1, 'El período es requerido')
    .describe('Período a consultar en formato YYYY-MM o YYYY'),
  department: z
    .string()
    .optional()
    .describe('Nombre del departamento para filtrar (opcional)'),
});

/**
 * Categoría individual del presupuesto vs real.
 */
interface BudgetCategory {
  name: string;
  budget: number;
  actual: number;
  variance: number;
  variancePercentage: number;
}

/**
 * Resultado de la comparación presupuesto vs real.
 */
interface BudgetVsActualResult {
  categories: BudgetCategory[];
  totalBudget: number;
  totalActual: number;
  totalVariance: number;
  period: string;
  _timestamp: string;
}

/**
 * Tool que compara el presupuesto planificado contra el gasto/ingreso real.
 * Retorna datos mock para desarrollo mientras no haya conexión a la API real.
 */
export const budgetVsActualTool = defineTool({
  name: 'budget_vs_actual',
  description:
    'Compara el presupuesto planificado contra los valores reales ejecutados en un período determinado. ' +
    'Retorna categorías con sus montos presupuestados, reales, variación absoluta y porcentual, ' +
    'junto con los totales consolidados. Opcionalmente se puede filtrar por departamento.',
  inputSchema: BudgetVsActualInputSchema,
  tags: ['financial', 'budget-vs-actual'],
  version: '1.0.0',

  handler: async (input: z.infer<typeof BudgetVsActualInputSchema>): Promise<BudgetVsActualResult> => {
    const { period, department } = input;

    // Datos mock para desarrollo
    const categories: BudgetCategory[] = [
      {
        name: 'Ventas',
        budget: 500000,
        actual: 485000,
        variance: -15000,
        variancePercentage: -3.0,
      },
      {
        name: 'Costo de Ventas',
        budget: 300000,
        actual: 310000,
        variance: 10000,
        variancePercentage: 3.33,
      },
      {
        name: 'Gastos Operativos',
        budget: 120000,
        actual: 115000,
        variance: -5000,
        variancePercentage: -4.17,
      },
      {
        name: 'Gastos de Marketing',
        budget: 50000,
        actual: 55000,
        variance: 5000,
        variancePercentage: 10.0,
      },
      {
        name: 'Gastos de Administración',
        budget: 40000,
        actual: 38000,
        variance: -2000,
        variancePercentage: -5.0,
      },
      {
        name: 'Inversiones',
        budget: 80000,
        actual: 75000,
        variance: -5000,
        variancePercentage: -6.25,
      },
    ];

    // Si se especifica un departamento, filtrar categorías relacionadas
    let filteredCategories = categories;
    if (department) {
      const deptLower = department.toLowerCase();
      filteredCategories = categories.filter((cat) =>
        cat.name.toLowerCase().includes(deptLower)
      );

      // Si no hay coincidencias, retornar array vacío con totales en cero
      if (filteredCategories.length === 0) {
        return {
          categories: [],
          totalBudget: 0,
          totalActual: 0,
          totalVariance: 0,
          period,
          _timestamp: new Date().toISOString(),
        };
      }
    }

    // Calcular totales
    const totalBudget = filteredCategories.reduce((sum, cat) => sum + cat.budget, 0);
    const totalActual = filteredCategories.reduce((sum, cat) => sum + cat.actual, 0);
    const totalVariance = totalActual - totalBudget;

    return {
      categories: filteredCategories,
      totalBudget,
      totalActual,
      totalVariance,
      period,
      _timestamp: new Date().toISOString(),
    };
  },
});

export default budgetVsActualTool;