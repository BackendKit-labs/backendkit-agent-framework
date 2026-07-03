import { getPayrollSummary } from '../../src/tools/payroll-summary';

describe('Payroll Summary Tool', () => {
  // ── Metadata ─────────────────────────────────────────────────────
  describe('metadata', () => {
    it('should define the tool with correct name', () => {
      expect(getPayrollSummary.name).toBe('get_payroll_summary');
    });

    it('should have a non-empty description', () => {
      expect(getPayrollSummary.description).toBeTruthy();
      expect(typeof getPayrollSummary.description).toBe('string');
      expect(getPayrollSummary.description.length).toBeGreaterThan(10);
    });

    it('should contain relevant keywords in description', () => {
      const desc = getPayrollSummary.description.toLowerCase();
      expect(desc).toContain('nómina');
      expect(desc).toContain('resumen');
    });

    it('should have the correct tags', () => {
      expect(getPayrollSummary.tags).toContain('financial');
      expect(getPayrollSummary.tags).toContain('payroll-summary');
    });

    it('should have version 1.0.0 by default', () => {
      expect(getPayrollSummary.version).toBe('1.0.0');
    });
  });

  // ── Input Schema Validation ──────────────────────────────────────
  describe('input schema validation', () => {
    it('should require period', () => {
      const result = getPayrollSummary.inputSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('should reject empty period string', () => {
      const result = getPayrollSummary.inputSchema.safeParse({ period: '' });
      expect(result.success).toBe(false);
    });

    it('should accept valid period formats', () => {
      const validPeriods = ['2025-01', '2025-Q1', '2025', '2025-H1'];
      validPeriods.forEach((period) => {
        const result = getPayrollSummary.inputSchema.safeParse({ period });
        expect(result.success).toBe(true);
      });
    });

    it('should reject non-string period values', () => {
      const invalidInputs = [
        { period: 2024 },
        { period: null },
        { period: true },
      ];
      invalidInputs.forEach((input) => {
        const result = getPayrollSummary.inputSchema.safeParse(input);
        expect(result.success).toBe(false);
      });
    });

    it('should accept long/verbose period strings', () => {
      // The schema only enforces string + min(1), so long strings are valid
      const result = getPayrollSummary.inputSchema.safeParse({ period: '2025-01-extra-info' });
      expect(result.success).toBe(true);
    });

    it('should reject undefined period', () => {
      const result = getPayrollSummary.inputSchema.safeParse({ period: undefined });
      expect(result.success).toBe(false);
    });
  });

  // ── Handler Output Structure ────────────────────────────────────
  describe('handler output structure', () => {
    it('should return all required fields', async () => {
      const result = await getPayrollSummary.handler({ period: '2025-01' });

      expect(result).toHaveProperty('totalGross');
      expect(result).toHaveProperty('totalNet');
      expect(result).toHaveProperty('headcount');
      expect(result).toHaveProperty('avgSalary');
      expect(result).toHaveProperty('deductions');
      expect(result).toHaveProperty('period');
      expect(result).toHaveProperty('_timestamp');
    });

    it('should return all fields with correct types', async () => {
      const result = await getPayrollSummary.handler({ period: '2025-01' });

      expect(typeof result.totalGross).toBe('number');
      expect(typeof result.totalNet).toBe('number');
      expect(typeof result.headcount).toBe('number');
      expect(typeof result.avgSalary).toBe('number');
      expect(typeof result.deductions).toBe('number');
      expect(typeof result.period).toBe('string');
      expect(typeof result._timestamp).toBe('string');
    });

    it('should return period matching the input', async () => {
      const result = await getPayrollSummary.handler({ period: '2025-01' });
      expect(result.period).toBe('2025-01');
    });

    it('should return _timestamp as an ISO 8601 string', async () => {
      const result = await getPayrollSummary.handler({ period: '2025-06' });

      expect(result._timestamp).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
      );
    });

    it('should have no extra fields beyond the defined interface', async () => {
      const result = await getPayrollSummary.handler({ period: '2025-01' });
      const allowedKeys = [
        'totalGross', 'totalNet', 'headcount', 'avgSalary',
        'deductions', 'period', '_timestamp',
      ];

      expect(Object.keys(result).sort()).toEqual(allowedKeys.sort());
    });
  });

  // ── Handler Numeric Invariants ───────────────────────────────────
  describe('handler numeric invariants', () => {
    it('totalNet should equal totalGross minus deductions', async () => {
      const result = await getPayrollSummary.handler({ period: '2025-02' });

      expect(result.totalNet).toBe(result.totalGross - result.deductions);
    });

    it('avgSalary should approximately equal totalGross / headcount (within rounding)', async () => {
      const result = await getPayrollSummary.handler({ period: '2025-03' });

      const expectedAvg = Math.round((result.totalGross / result.headcount) * 100) / 100;
      expect(result.avgSalary).toBe(expectedAvg);
    });

    it('headcount should be greater than 0', async () => {
      const result = await getPayrollSummary.handler({ period: '2025-04' });

      expect(result.headcount).toBeGreaterThan(0);
    });

    it('totalGross should be greater than totalNet, and totalNet greater than 0', async () => {
      const result = await getPayrollSummary.handler({ period: '2025-05' });

      expect(result.totalGross).toBeGreaterThan(result.totalNet);
      expect(result.totalNet).toBeGreaterThan(0);
    });

    it('deductions should be less than totalGross', async () => {
      const result = await getPayrollSummary.handler({ period: '2025-06' });

      expect(result.deductions).toBeLessThan(result.totalGross);
    });

    it('avgSalary should be a positive number', async () => {
      const result = await getPayrollSummary.handler({ period: '2025-07' });

      expect(result.avgSalary).toBeGreaterThan(0);
    });

    it('all numeric values should be integers (except avgSalary which has 2 decimal places)', async () => {
      const result = await getPayrollSummary.handler({ period: '2025-08' });

      // totalGross, totalNet, deductions, headcount should be integers
      expect(Number.isInteger(result.totalGross)).toBe(true);
      expect(Number.isInteger(result.totalNet)).toBe(true);
      expect(Number.isInteger(result.deductions)).toBe(true);
      expect(Number.isInteger(result.headcount)).toBe(true);

      // avgSalary has 2 decimal places
      const decimalParts = result.avgSalary.toString().split('.');
      if (decimalParts.length > 1) {
        expect(decimalParts[1].length).toBeLessThanOrEqual(2);
      }
    });
  });

  // ── Multi-Period Determinism ────────────────────────────────────
  describe('multi-period determinism', () => {
    it('should produce deterministic output for the same period', async () => {
      // _timestamp refleja el momento real de generación, no es determinístico
      // entre llamadas — se excluye de la comparación a propósito.
      const { _timestamp: _t1, ...result1 } = await getPayrollSummary.handler({ period: '2025-Q1' });
      const { _timestamp: _t2, ...result2 } = await getPayrollSummary.handler({ period: '2025-Q1' });

      expect(result1).toEqual(result2);
    });

    it('should pass all invariants for multiple periods', async () => {
      const periods = ['2025-Q1', '2025-Q2', '2024', '2024-12', '2025-H1'];

      for (const period of periods) {
        const result = await getPayrollSummary.handler({ period });

        // All fields present
        expect(result).toHaveProperty('totalGross');
        expect(result).toHaveProperty('totalNet');
        expect(result).toHaveProperty('headcount');
        expect(result).toHaveProperty('avgSalary');
        expect(result).toHaveProperty('deductions');
        expect(result).toHaveProperty('period');
        expect(result.period).toBe(period);

        // Invariants
        expect(result.totalNet).toBe(result.totalGross - result.deductions);

        const expectedAvg = Math.round((result.totalGross / result.headcount) * 100) / 100;
        expect(result.avgSalary).toBe(expectedAvg);

        expect(result.headcount).toBeGreaterThan(0);
        expect(result.totalGross).toBeGreaterThan(result.totalNet);
        expect(result.totalNet).toBeGreaterThan(0);
      }
    });

    it('should produce different results for different periods', async () => {
      const resultA = await getPayrollSummary.handler({ period: '2025-01' });
      const resultB = await getPayrollSummary.handler({ period: '2025-02' });

      // Different periods should produce different hashes (and thus different values)
      // unless by very low probability collision
      expect(resultA.totalGross).not.toBe(resultB.totalGross);
    });
  });

  // ── Timestamp ────────────────────────────────────────────────────
  describe('_timestamp field', () => {
    it('should return a _timestamp field', async () => {
      const result = await getPayrollSummary.handler({ period: '2025-06' });

      expect(result).toHaveProperty('_timestamp');
      expect(typeof result._timestamp).toBe('string');
      expect(() => new Date(result._timestamp)).not.toThrow();
    });

    it('should generate a fresh timestamp on each call (within same period)', async () => {
      // Two calls in rapid succession — timestamps should be different
      // because they capture the current time
      const result1 = await getPayrollSummary.handler({ period: '2025-06' });
      // Small delay to ensure different millisecond
      await new Promise((resolve) => setTimeout(resolve, 5));
      const result2 = await getPayrollSummary.handler({ period: '2025-06' });

      expect(result1._timestamp).not.toBe(result2._timestamp);
    });
  });
});
