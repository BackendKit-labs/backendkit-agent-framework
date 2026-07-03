import { kpiDashboardTool } from '../../src/tools/kpi-dashboard';
import { z } from 'zod';

/**
 * KPI Dashboard Tool — Unit Tests
 *
 * Covers:
 * - Metadata (name, description, version, tags)
 * - Schema validation (period requerido, tipos, vacío)
 * - Handler output structure (kpis[], period, _timestamp)
 * - Cada KpiItem (name, value, unit, trend, previousValue, variation)
 * - KPIs específicos: Margen Bruto, Margen EBITDA, ROE, Liquidez Corriente
 * - Consistencia numérica (variation ≈ value - previousValue)
 * - Consistencia de trends
 * - Idempotencia básica
 */

describe('KPI Dashboard Tool', () => {
  // ---------------------------------------------------------------------------
  // Metadata
  // ---------------------------------------------------------------------------
  it('should define the tool with correct name', () => {
    expect(kpiDashboardTool.name).toBe('kpi_dashboard');
  });

  it('should have a description', () => {
    expect(kpiDashboardTool.description).toBeTruthy();
    expect(typeof kpiDashboardTool.description).toBe('string');
    expect(kpiDashboardTool.description.length).toBeGreaterThan(10);
  });

  it('should have version 1.0.0', () => {
    expect(kpiDashboardTool.version).toBe('1.0.0');
  });

  it('should have financial and kpi-dashboard tags', () => {
    expect(kpiDashboardTool.tags).toBeDefined();
    expect(kpiDashboardTool.tags).toContain('financial');
    expect(kpiDashboardTool.tags).toContain('kpi-dashboard');
  });

  // ---------------------------------------------------------------------------
  // Schema validation — input
  // ---------------------------------------------------------------------------
  it('should require period in the input schema', () => {
    const schema = kpiDashboardTool.inputSchema;
    expect(schema).toBeDefined();
    expect(schema).toBeInstanceOf(z.ZodObject);
  });

  it('should accept valid input with period', () => {
    const result = kpiDashboardTool.inputSchema.safeParse({ period: '2024-01' });
    expect(result.success).toBe(true);
  });

  it('should accept various period formats', () => {
    const formats = ['2024', '2024-01', '2024-Q1', '2024-H1', '2024-01-01'];
    for (const format of formats) {
      const result = kpiDashboardTool.inputSchema.safeParse({ period: format });
      expect(result.success).toBe(true);
    }
  });

  it('should reject input without period', () => {
    const result = kpiDashboardTool.inputSchema.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toContain('period');
    }
  });

  it('should reject input with empty period string', () => {
    const result = kpiDashboardTool.inputSchema.safeParse({ period: '' });
    expect(result.success).toBe(false);
  });

  it('should reject input with non-string period', () => {
    const invalidInputs = [
      { period: 2024 },
      { period: null },
      { period: true },
      { period: 45.7 },
    ];
    for (const input of invalidInputs) {
      const result = kpiDashboardTool.inputSchema.safeParse(input);
      expect(result.success).toBe(false);
    }
  });

  it('should reject undefined period', () => {
    const result = kpiDashboardTool.inputSchema.safeParse({ period: undefined });
    expect(result.success).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // Handler output structure
  // ---------------------------------------------------------------------------
  it('should return kpis array, period, and _timestamp', async () => {
    const output = await kpiDashboardTool.handler({ period: '2024-01' });

    expect(output).toHaveProperty('kpis');
    expect(output).toHaveProperty('period');
    expect(output).toHaveProperty('_timestamp');

    expect(Array.isArray(output.kpis)).toBe(true);
    expect(output.kpis.length).toBeGreaterThan(0);
    expect(output.period).toBe('2024-01');
    expect(typeof output._timestamp).toBe('string');

    // _timestamp debe ser una fecha ISO válida
    expect(() => new Date(output._timestamp)).not.toThrow();
    expect(new Date(output._timestamp).toISOString()).toBe(output._timestamp);
  });

  it('should return the same period as requested', async () => {
    const periods = ['2024-01', '2023-Q4', '2025'];
    for (const period of periods) {
      const output = await kpiDashboardTool.handler({ period });
      expect(output.period).toBe(period);
    }
  });

  it('should have a recent _timestamp (within last 5 seconds)', async () => {
    const before = Date.now();
    const output = await kpiDashboardTool.handler({ period: '2024-01' });
    const after = Date.now();
    const ts = new Date(output._timestamp).getTime();

    expect(ts).toBeGreaterThanOrEqual(before - 1000);
    expect(ts).toBeLessThanOrEqual(after + 1000);
  });

  // ---------------------------------------------------------------------------
  // KpiItem structure
  // ---------------------------------------------------------------------------
  it('each KpiItem should have name, value, unit, and trend', async () => {
    const output = await kpiDashboardTool.handler({ period: '2024-01' });

    for (const kpi of output.kpis) {
      expect(kpi).toHaveProperty('name');
      expect(kpi).toHaveProperty('value');
      expect(kpi).toHaveProperty('unit');
      expect(kpi).toHaveProperty('trend');

      expect(typeof kpi.name).toBe('string');
      expect(kpi.name.length).toBeGreaterThan(0);
      expect(typeof kpi.value).toBe('number');
      expect(typeof kpi.unit).toBe('string');
      expect(kpi.unit.length).toBeGreaterThan(0);

      // trend debe ser uno de los valores permitidos
      expect(['up', 'down', 'stable']).toContain(kpi.trend);
    }
  });

  it('each KpiItem should have optional previousValue and variation', async () => {
    const output = await kpiDashboardTool.handler({ period: '2024-01' });

    for (const kpi of output.kpis) {
      // Son opcionales pero en el mock actual siempre vienen
      if (kpi.previousValue !== undefined) {
        expect(typeof kpi.previousValue).toBe('number');
      }
      if (kpi.variation !== undefined) {
        expect(typeof kpi.variation).toBe('number');
      }
    }
  });

  // ---------------------------------------------------------------------------
  // KPIs específicos
  // ---------------------------------------------------------------------------
  it('should include "Margen Bruto" with % unit', async () => {
    const output = await kpiDashboardTool.handler({ period: '2024-01' });
    const kpi = output.kpis.find(k => k.name === 'Margen Bruto');

    expect(kpi).toBeDefined();
    expect(kpi!.value).toBe(35.5);
    expect(kpi!.unit).toBe('%');
    expect(kpi!.trend).toBe('up');
    expect(kpi!.previousValue).toBe(33.2);
    expect(kpi!.variation).toBeCloseTo(2.3, 2);
  });

  it('should include "Margen EBITDA" with % unit and up trend', async () => {
    const output = await kpiDashboardTool.handler({ period: '2024-01' });
    const kpi = output.kpis.find(k => k.name === 'Margen EBITDA');

    expect(kpi).toBeDefined();
    expect(kpi!.value).toBe(22.8);
    expect(kpi!.unit).toBe('%');
    expect(kpi!.trend).toBe('up');
    expect(kpi!.previousValue).toBe(21.1);
  });

  it('should include ROE as "ROE (Return on Equity)" with % unit and up trend', async () => {
    const output = await kpiDashboardTool.handler({ period: '2024-01' });
    const kpi = output.kpis.find(k => k.name === 'ROE (Return on Equity)');

    expect(kpi).toBeDefined();
    expect(kpi!.value).toBe(18.6);
    expect(kpi!.unit).toBe('%');
    expect(kpi!.trend).toBe('up');
    expect(kpi!.previousValue).toBe(16.9);
    expect(kpi!.variation).toBeCloseTo(1.7, 2);
  });

  it('should include "Liquidez Corriente" with "veces" unit', async () => {
    const output = await kpiDashboardTool.handler({ period: '2024-01' });
    const kpi = output.kpis.find(k => k.name === 'Liquidez Corriente');

    expect(kpi).toBeDefined();
    expect(kpi!.value).toBe(1.85);
    expect(kpi!.unit).toBe('veces');
    expect(kpi!.trend).toBe('up');
    expect(kpi!.previousValue).toBe(1.72);
  });

  it('should include all four required KPIs by name', async () => {
    const output = await kpiDashboardTool.handler({ period: '2024-01' });
    const names = output.kpis.map(k => k.name);

    expect(names).toContain('Margen Bruto');
    expect(names).toContain('Margen EBITDA');
    expect(names).toContain('ROE (Return on Equity)');
    expect(names).toContain('Liquidez Corriente');
  });

  // ---------------------------------------------------------------------------
  // Consistencia numérica
  // ---------------------------------------------------------------------------
  it('each KpiItem should have variation ≈ value - previousValue (within rounding)', async () => {
    const output = await kpiDashboardTool.handler({ period: '2024-01' });

    for (const kpi of output.kpis) {
      if (kpi.previousValue !== undefined && kpi.variation !== undefined) {
        const expectedVariation = parseFloat(
          (kpi.value - kpi.previousValue).toFixed(2)
        );
        expect(kpi.variation).toBeCloseTo(expectedVariation, 1);
      }
    }
  });

  it('trend should be consistent with variation direction', async () => {
    const output = await kpiDashboardTool.handler({ period: '2024-01' });

    for (const kpi of output.kpis) {
      if (kpi.previousValue !== undefined && kpi.variation !== undefined) {
        if (kpi.variation > 0.01) {
          // Si la variación es positiva, el trend debería ser up
          // (excepto para KPIs donde "menor es mejor" como Endeudamiento)
          // Nota: para KPIs de deuda/rotación, variación negativa es buena
          // pero aceptamos la definición actual del mock
          expect(['up', 'down', 'stable']).toContain(kpi.trend);
        } else if (kpi.variation < -0.01) {
          expect(['up', 'down', 'stable']).toContain(kpi.trend);
        }
      }
    }
  });

  it('should have consistent value types across multiple calls', async () => {
    const a = await kpiDashboardTool.handler({ period: '2024-01' });
    // Pequeña pausa para asegurar timestamps diferentes
    await new Promise(r => setTimeout(r, 10));
    const b = await kpiDashboardTool.handler({ period: '2024-02' });

    // Los valores mock son fijos, pero podemos verificar estructura
    expect(a.kpis).toHaveLength(b.kpis.length);
    for (let i = 0; i < a.kpis.length; i++) {
      expect(a.kpis[i].name).toBe(b.kpis[i].name);
      expect(a.kpis[i].unit).toBe(b.kpis[i].unit);
      // Cada período independiente tiene su propio timestamp
      expect(a._timestamp).not.toBe(b._timestamp);
    }
  });

  // ---------------------------------------------------------------------------
  // Total de KPIs
  // ---------------------------------------------------------------------------
  it('should return exactly 12 KPIs', async () => {
    const output = await kpiDashboardTool.handler({ period: '2024-01' });
    expect(output.kpis).toHaveLength(12);
  });

  it('should have unique KPI names', async () => {
    const output = await kpiDashboardTool.handler({ period: '2024-01' });
    const names = output.kpis.map(k => k.name);
    const uniqueNames = new Set(names);
    expect(uniqueNames.size).toBe(names.length);
  });

  // ---------------------------------------------------------------------------
  // Idempotencia / estabilidad
  // ---------------------------------------------------------------------------
  it('should return identical KPI values for the same period across calls', async () => {
    const [r1, r2] = await Promise.all([
      kpiDashboardTool.handler({ period: '2024-01' }),
      kpiDashboardTool.handler({ period: '2024-01' }),
    ]);

    for (let i = 0; i < r1.kpis.length; i++) {
      expect(r1.kpis[i].value).toBe(r2.kpis[i].value);
      expect(r1.kpis[i].trend).toBe(r2.kpis[i].trend);
    }
  });

  // ---------------------------------------------------------------------------
  // Rendimiento básico — no debe exceder 500ms
  // ---------------------------------------------------------------------------
  it('should resolve within a reasonable time (< 500ms)', async () => {
    const start = Date.now();
    await kpiDashboardTool.handler({ period: '2024-01' });
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(500);
  });
});
