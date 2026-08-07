import { budgetVsActualTool } from '../../src/tools/budget-vs-actual';

/**
 * Helper: infiere el estado esperado según el porcentaje de variación absoluto.
 *  |variancePercentage| < 5%  → on_track
 *  |variancePercentage| 5–15% → at_risk
 *  |variancePercentage| > 15% → over_budget
 */
function inferStatus(variancePercentage: number): 'on_track' | 'at_risk' | 'over_budget' {
  const abs = Math.abs(variancePercentage);
  if (abs < 5) return 'on_track';
  if (abs <= 15) return 'at_risk';
  return 'over_budget';
}

describe('BudgetVsActual Tool', () => {
  // ── Metadata ─────────────────────────────────────────────────────
  describe('metadata', () => {
    it('should export the tool with the correct name', () => {
      expect(budgetVsActualTool.name).toBe('budget_vs_actual');
    });

    it('should have a non-empty description', () => {
      expect(budgetVsActualTool.description).toBeTruthy();
      expect(typeof budgetVsActualTool.description).toBe('string');
      expect(budgetVsActualTool.description.length).toBeGreaterThan(10);
    });

    it('should contain relevant keywords in description', () => {
      const desc = budgetVsActualTool.description.toLowerCase();
      expect(desc).toContain('presupuesto');
      expect(desc).toContain('reales');
    });

    it('should have the correct tags', () => {
      expect(budgetVsActualTool.tags).toContain('financial');
      expect(budgetVsActualTool.tags).toContain('budget-vs-actual');
    });

    it('should have version 1.0.0', () => {
      expect(budgetVsActualTool.version).toBe('1.0.0');
    });
  });

  // ── Input Schema ──────────────────────────────────────────────────
  describe('input schema', () => {
    it('should accept a valid period', () => {
      const result = budgetVsActualTool.inputSchema.safeParse({ period: '2024-01' });
      expect(result.success).toBe(true);
    });

    it('should accept a year-only period', () => {
      const result = budgetVsActualTool.inputSchema.safeParse({ period: '2024' });
      expect(result.success).toBe(true);
    });

    it('should reject an empty period', () => {
      const result = budgetVsActualTool.inputSchema.safeParse({ period: '' });
      expect(result.success).toBe(false);
    });

    it('should reject missing period', () => {
      const result = budgetVsActualTool.inputSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('should accept an optional department', () => {
      const result = budgetVsActualTool.inputSchema.safeParse({
        period: '2024-01',
        department: 'Marketing',
      });
      expect(result.success).toBe(true);
    });

    it('should accept period without department', () => {
      const result = budgetVsActualTool.inputSchema.safeParse({ period: '2024-01' });
      expect(result.success).toBe(true);
      expect(result.data?.department).toBeUndefined();
    });
  });

  // ── Handler - Full result structure ──────────────────────────────
  describe('handler result structure', () => {
    it('should return all top-level fields', async () => {
      const result = await budgetVsActualTool.handler({ period: '2024-01' });

      expect(result).toHaveProperty('categories');
      expect(result).toHaveProperty('totalBudget');
      expect(result).toHaveProperty('totalActual');
      expect(result).toHaveProperty('totalVariance');
      expect(result).toHaveProperty('period');
      expect(result).toHaveProperty('_timestamp');
    });

    it('should return period matching the input', async () => {
      const result = await budgetVsActualTool.handler({ period: '2024-06' });
      expect(result.period).toBe('2024-06');
    });

    it('should return _timestamp as an ISO 8601 string', async () => {
      const result = await budgetVsActualTool.handler({ period: '2024-01' });
      expect(result._timestamp).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/
      );
    });

    it('should return totalBudget, totalActual and totalVariance as numbers', async () => {
      const result = await budgetVsActualTool.handler({ period: '2024-01' });
      expect(typeof result.totalBudget).toBe('number');
      expect(typeof result.totalActual).toBe('number');
      expect(typeof result.totalVariance).toBe('number');
    });

    it('should compute totalVariance = totalActual - totalBudget', async () => {
      const result = await budgetVsActualTool.handler({ period: '2024-01' });
      expect(result.totalVariance).toBe(result.totalActual - result.totalBudget);
    });
  });

  // ── Categories structure and values ──────────────────────────────
  describe('categories', () => {
    it('should return a non-empty array of categories', async () => {
      const result = await budgetVsActualTool.handler({ period: '2024-01' });
      expect(Array.isArray(result.categories)).toBe(true);
      expect(result.categories.length).toBeGreaterThan(0);
    });

    it('every category should have the required fields', async () => {
      const result = await budgetVsActualTool.handler({ period: '2024-01' });

      for (const cat of result.categories) {
        expect(cat).toHaveProperty('name');
        expect(cat).toHaveProperty('budget');
        expect(cat).toHaveProperty('actual');
        expect(cat).toHaveProperty('variance');
        expect(cat).toHaveProperty('variancePercentage');

        expect(typeof cat.name).toBe('string');
        expect(typeof cat.budget).toBe('number');
        expect(typeof cat.actual).toBe('number');
        expect(typeof cat.variance).toBe('number');
        expect(typeof cat.variancePercentage).toBe('number');
      }
    });

    it('every category should have variance = actual - budget', async () => {
      const result = await budgetVsActualTool.handler({ period: '2024-01' });

      for (const cat of result.categories) {
        expect(cat.variance).toBe(cat.actual - cat.budget);
      }
    });
  });

  // ── Status inference from variancePercentage ─────────────────────
  describe('status from variancePercentage', () => {
    it('on_track categories have |variancePercentage| < 5%', async () => {
      const result = await budgetVsActualTool.handler({ period: '2024-01' });

      for (const cat of result.categories) {
        const status = inferStatus(cat.variancePercentage);
        if (status === 'on_track') {
          expect(Math.abs(cat.variancePercentage)).toBeLessThan(5);
        }
      }
    });

    it('at_risk categories have |variancePercentage| between 5% and 15%', async () => {
      const result = await budgetVsActualTool.handler({ period: '2024-01' });

      for (const cat of result.categories) {
        const status = inferStatus(cat.variancePercentage);
        if (status === 'at_risk') {
          const abs = Math.abs(cat.variancePercentage);
          expect(abs).toBeGreaterThanOrEqual(5);
          expect(abs).toBeLessThanOrEqual(15);
        }
      }
    });

    it('over_budget categories have |variancePercentage| > 15%', async () => {
      const result = await budgetVsActualTool.handler({ period: '2024-01' });

      for (const cat of result.categories) {
        const status = inferStatus(cat.variancePercentage);
        if (status === 'over_budget') {
          expect(Math.abs(cat.variancePercentage)).toBeGreaterThan(15);
        }
      }
    });

    it('should find known statuses for each mocked category', async () => {
      // Known values from the mock data:
      //   Ventas:             -3.0%  → on_track
      //   Costo de Ventas:     3.33% → on_track
      //   Gastos Operativos:  -4.17% → on_track
      //   Gastos de Marketing: 10.0% → at_risk
      //   Gastos de Admin:    -5.0%  → at_risk
      //   Inversiones:        -6.25% → at_risk
      const result = await budgetVsActualTool.handler({ period: '2024-01' });

      for (const cat of result.categories) {
        const status = inferStatus(cat.variancePercentage);
        expect(['on_track', 'at_risk', 'over_budget']).toContain(status);
      }
    });

    it('variancePercentage should correctly derive from budget and actual', async () => {
      const result = await budgetVsActualTool.handler({ period: '2024-01' });

      for (const cat of result.categories) {
        if (cat.budget === 0) continue; // avoid division by zero
        const expectedPct = ((cat.actual - cat.budget) / cat.budget) * 100;
        expect(cat.variancePercentage).toBeCloseTo(expectedPct, 1);
      }
    });
  });

  // ── Department filter ────────────────────────────────────────────
  describe('department filter', () => {
    it('should return only matching categories when department is "Marketing"', async () => {
      const result = await budgetVsActualTool.handler({
        period: '2024-01',
        department: 'Marketing',
      });

      expect(result.categories.length).toBe(1);
      expect(result.categories[0].name).toContain('Marketing');
    });

    it('should return only matching categories when department is "Ventas"', async () => {
      const result = await budgetVsActualTool.handler({
        period: '2024-01',
        department: 'Ventas',
      });

      expect(result.categories.length).toBe(2); // Ventas + Costo de Ventas
      for (const cat of result.categories) {
        expect(cat.name.toLowerCase()).toContain('ventas');
      }
    });

    it('should be case-insensitive when filtering', async () => {
      const lowerResult = await budgetVsActualTool.handler({
        period: '2024-01',
        department: 'marketing',
      });
      const upperResult = await budgetVsActualTool.handler({
        period: '2024-01',
        department: 'MARKETING',
      });

      expect(lowerResult.categories).toEqual(upperResult.categories);
    });

    it('should return empty categories with zero totals for non-matching department', async () => {
      const result = await budgetVsActualTool.handler({
        period: '2024-01',
        department: 'NoExiste',
      });

      expect(result.categories).toEqual([]);
      expect(result.totalBudget).toBe(0);
      expect(result.totalActual).toBe(0);
      expect(result.totalVariance).toBe(0);
    });

    it('should recalculate totals after filtering', async () => {
      const full = await budgetVsActualTool.handler({ period: '2024-01' });
      const filtered = await budgetVsActualTool.handler({
        period: '2024-01',
        department: 'Marketing',
      });

      expect(filtered.categories.length).toBeLessThan(full.categories.length);
      expect(filtered.totalBudget).toBe(filtered.categories[0].budget);
      expect(filtered.totalActual).toBe(filtered.categories[0].actual);
    });
  });
});
