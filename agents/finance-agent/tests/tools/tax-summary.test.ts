import { taxSummaryTool } from '../../src/tools/tax-summary';
import type { TaxSummaryInput, TaxSummaryOutput } from '../../src/tools/tax-summary';

describe('Tax Summary Tool', () => {
  describe('metadata', () => {
    it('should export the tool with correct name', () => {
      expect(taxSummaryTool.name).toBe('tax-summary');
    });

    it('should have a description', () => {
      expect(taxSummaryTool.description).toBeDefined();
      expect(taxSummaryTool.description.length).toBeGreaterThan(0);
    });

    it('should have version 1.0.0', () => {
      expect(taxSummaryTool.version).toBe('1.0.0');
    });

    it('should have financial and tax-summary tags', () => {
      expect(taxSummaryTool.tags).toContain('financial');
      expect(taxSummaryTool.tags).toContain('tax-summary');
    });
  });

  describe('inputSchema', () => {
    it('should accept a valid input with period only', () => {
      const result = taxSummaryTool.inputSchema.safeParse({ period: '2025-01' });
      expect(result.success).toBe(true);
    });

    it('should reject input without period', () => {
      const result = taxSummaryTool.inputSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('should reject input with empty period string', () => {
      const result = taxSummaryTool.inputSchema.safeParse({ period: '' });
      expect(result.success).toBe(false);
    });

    it('should set country default to CO when not provided', () => {
      const result = taxSummaryTool.inputSchema.safeParse({ period: '2025-01' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.country).toBe('CO');
      }
    });

    it('should accept a custom country value', () => {
      const result = taxSummaryTool.inputSchema.safeParse({ period: '2025-01', country: 'US' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.country).toBe('US');
      }
    });

    it('should accept different period formats', () => {
      const formats = ['2025', '2025-01', '2025-Q1', '2025-H1', '2025-01-01'];
      formats.forEach(format => {
        const result = taxSummaryTool.inputSchema.safeParse({ period: format });
        expect(result.success).toBe(true);
      });
    });
  });

  describe('handler - output structure', () => {
    let output: TaxSummaryOutput;

    beforeAll(async () => {
      output = await taxSummaryTool.handler({ period: '2025-01' });
    });

    it('should return taxes as an array', () => {
      expect(Array.isArray(output.taxes)).toBe(true);
    });

    it('should return totalAccrued as a number', () => {
      expect(typeof output.totalAccrued).toBe('number');
    });

    it('should return totalPaid as a number', () => {
      expect(typeof output.totalPaid).toBe('number');
    });

    it('should return totalPending as a number', () => {
      expect(typeof output.totalPending).toBe('number');
    });

    it('should return the requested period', () => {
      expect(output.period).toBe('2025-01');
    });

    it('should return the default country CO', () => {
      expect(output.country).toBe('CO');
    });

    it('should return custom country when provided', async () => {
      const customOutput = await taxSummaryTool.handler({ period: '2025-01', country: 'MX' });
      expect(customOutput.country).toBe('MX');
    });
  });

  describe('handler - tax items structure', () => {
    let output: TaxSummaryOutput;

    beforeAll(async () => {
      output = await taxSummaryTool.handler({ period: '2025-01' });
    });

    it('should have all taxes with valid structure (name, amount, status, optional dueDate)', () => {
      output.taxes.forEach((tax) => {
        expect(typeof tax.name).toBe('string');
        expect(tax.name.length).toBeGreaterThan(0);
        expect(typeof tax.amount).toBe('number');
        expect(tax.amount).toBeGreaterThan(0);
        expect(['paid', 'pending', 'accrued']).toContain(tax.status);
        // dueDate is optional, but if present must be a non-empty string
        if (tax.dueDate !== undefined) {
          expect(typeof tax.dueDate).toBe('string');
          expect(tax.dueDate.length).toBeGreaterThan(0);
        }
      });
    });
  });

  describe('handler - total calculations', () => {
    it('should compute totalAccrued as sum of accrued taxes', async () => {
      const output = await taxSummaryTool.handler({ period: '2025-01' });
      const expected = output.taxes
        .filter(t => t.status === 'accrued')
        .reduce((sum, t) => sum + t.amount, 0);
      expect(output.totalAccrued).toBe(expected);
    });

    it('should compute totalPaid as sum of paid taxes', async () => {
      const output = await taxSummaryTool.handler({ period: '2025-01' });
      const expected = output.taxes
        .filter(t => t.status === 'paid')
        .reduce((sum, t) => sum + t.amount, 0);
      expect(output.totalPaid).toBe(expected);
    });

    it('should compute totalPending as sum of pending taxes', async () => {
      const output = await taxSummaryTool.handler({ period: '2025-01' });
      const expected = output.taxes
        .filter(t => t.status === 'pending')
        .reduce((sum, t) => sum + t.amount, 0);
      expect(output.totalPending).toBe(expected);
    });

    it('should have totalAccrued + totalPaid + totalPending equal sum of all tax amounts', async () => {
      const output = await taxSummaryTool.handler({ period: '2025-01' });
      const sumOfAmounts = output.taxes.reduce((sum, t) => sum + t.amount, 0);
      const totalFromFields = output.totalAccrued + output.totalPaid + output.totalPending;
      expect(totalFromFields).toBe(sumOfAmounts);
    });

    it('should have all totals be non-negative numbers', async () => {
      const output = await taxSummaryTool.handler({ period: '2025-01' });
      expect(output.totalAccrued).toBeGreaterThanOrEqual(0);
      expect(output.totalPaid).toBeGreaterThanOrEqual(0);
      expect(output.totalPending).toBeGreaterThanOrEqual(0);
    });
  });

  describe('handler - consistency across calls', () => {
    it('should return the same mock data for any period', async () => {
      const output1 = await taxSummaryTool.handler({ period: '2025-01' });
      const output2 = await taxSummaryTool.handler({ period: '2024-12' });
      // Mock data is static, so tax items and totals should match
      expect(output1.taxes).toEqual(output2.taxes);
      expect(output1.totalAccrued).toBe(output2.totalAccrued);
      expect(output1.totalPaid).toBe(output2.totalPaid);
      expect(output1.totalPending).toBe(output2.totalPending);
    });

    it('should preserve the custom country but not alter mock data', async () => {
      const output = await taxSummaryTool.handler({ period: '2025-01', country: 'AR' });
      expect(output.country).toBe('AR');
      expect(output.period).toBe('2025-01');
      expect(output.taxes.length).toBeGreaterThan(0);
    });
  });
});
