import { agingReportTool } from '../../src/tools/aging-report';

describe('aging-report tool', () => {
  it('debe tener el nombre correcto', () => {
    expect(agingReportTool.name).toBe('aging-report');
  });

  it('debe tener tags financieros y de aging', () => {
    expect(agingReportTool.tags).toContain('financial');
    expect(agingReportTool.tags).toContain('aging-report');
  });

  it('debe tener versión definida', () => {
    expect(agingReportTool.version).toBe('1.0.0');
  });

  it('debe tener descripción no vacía', () => {
    expect(agingReportTool.description.length).toBeGreaterThan(0);
  });

  it('debe tener inputSchema definido', () => {
    expect(agingReportTool.inputSchema).toBeDefined();
  });

  it('debe rechazar period inválido', async () => {
    const result = agingReportTool.inputSchema.safeParse({
      period: '2025/03',
    });
    expect(result.success).toBe(false);
  });

  it('debe aceptar period válido sin type (default receivable)', async () => {
    const result = agingReportTool.inputSchema.safeParse({
      period: '2025-03',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe('receivable');
    }
  });

  it('debe aceptar type payable explícito', async () => {
    const result = agingReportTool.inputSchema.safeParse({
      period: '2025-03',
      type: 'payable',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe('payable');
    }
  });

  it('debe rechazar type inválido', async () => {
    const result = agingReportTool.inputSchema.safeParse({
      period: '2025-03',
      type: 'invalid',
    });
    expect(result.success).toBe(false);
  });

  it('debe retornar estructura correcta con handler', async () => {
    const output = await agingReportTool.handler({
      period: '2025-03',
      type: 'receivable',
    });

    expect(output).toHaveProperty('buckets');
    expect(output).toHaveProperty('total');
    expect(output).toHaveProperty('period');
    expect(output).toHaveProperty('type');
    expect(output).toHaveProperty('_timestamp');

    expect(output.period).toBe('2025-03');
    expect(output.type).toBe('receivable');
    expect(typeof output.total).toBe('number');
    expect(output.total).toBeGreaterThan(0);

    // Verificar buckets
    expect(Array.isArray(output.buckets)).toBe(true);
    expect(output.buckets.length).toBeGreaterThan(0);

    for (const bucket of output.buckets) {
      expect(bucket).toHaveProperty('range');
      expect(bucket).toHaveProperty('amount');
      expect(bucket).toHaveProperty('count');
      expect(bucket).toHaveProperty('percentage');
      expect(typeof bucket.amount).toBe('number');
      expect(typeof bucket.count).toBe('number');
      expect(typeof bucket.percentage).toBe('number');
    }

    // Verificar que la suma de los montos de los buckets sea igual al total
    const sumAmounts = output.buckets.reduce((sum, b) => sum + b.amount, 0);
    expect(Math.abs(sumAmounts - output.total)).toBeLessThan(0.01);

    // Verificar que la suma de porcentajes sea ~100%
    const sumPercentages = output.buckets.reduce((sum, b) => sum + b.percentage, 0);
    expect(Math.abs(sumPercentages - 100)).toBeLessThan(0.01);

    // Verificar _timestamp
    expect(() => new Date(output._timestamp)).not.toThrow();
  });

  it('debe retornar datos diferentes para payable', async () => {
    const receivable = await agingReportTool.handler({
      period: '2025-03',
      type: 'receivable',
    });
    const payable = await agingReportTool.handler({
      period: '2025-03',
      type: 'payable',
    });

    // Los montos deben ser diferentes porque la lógica mock usa base distinta
    expect(receivable.total).not.toBe(payable.total);
    expect(receivable.type).toBe('receivable');
    expect(payable.type).toBe('payable');
  });

  it('debe generar _timestamp en formato ISO', async () => {
    const output = await agingReportTool.handler({
      period: '2025-03',
    });
    const isoRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
    expect(output._timestamp).toMatch(isoRegex);
  });
});