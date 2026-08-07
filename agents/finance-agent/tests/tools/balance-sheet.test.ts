import { getBalanceSheetTool } from '../../src/tools/balance-sheet';

describe('balance-sheet tool', () => {
  it('debe tener el nombre correcto', () => {
    expect(getBalanceSheetTool.name).toBe('get_balance_sheet');
  });

  it('debe tener tags financieros y de balance-sheet', () => {
    expect(getBalanceSheetTool.tags).toContain('financial');
    expect(getBalanceSheetTool.tags).toContain('balance-sheet');
  });

  it('debe tener versión definida', () => {
    expect(getBalanceSheetTool.version).toBe('1.0.0');
  });

  it('debe tener descripción no vacía', () => {
    expect(getBalanceSheetTool.description.length).toBeGreaterThan(0);
  });

  it('debe tener inputSchema definido', () => {
    expect(getBalanceSheetTool.inputSchema).toBeDefined();
  });

  it('debe rechazar period con formato inválido', () => {
    const result = getBalanceSheetTool.inputSchema.safeParse({ period: '2025/01' });
    expect(result.success).toBe(false);
  });

  it('debe aceptar period con formato válido', () => {
    const result = getBalanceSheetTool.inputSchema.safeParse({ period: '2025-01' });
    expect(result.success).toBe(true);
  });

  it('debe aceptar ausencia de period (opcional)', () => {
    const result = getBalanceSheetTool.inputSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('debe retornar estructura correcta con handler', async () => {
    const output = await getBalanceSheetTool.handler({ period: '2025-01' }, undefined as any);

    expect(output).toHaveProperty('totalAssets');
    expect(output).toHaveProperty('totalLiabilities');
    expect(output).toHaveProperty('equity');
    expect(output).toHaveProperty('ratios');
    expect(output).toHaveProperty('period');
    expect(output).toHaveProperty('_timestamp');

    expect(typeof output.totalAssets).toBe('number');
    expect(typeof output.totalLiabilities).toBe('number');
    expect(typeof output.equity).toBe('number');
    expect(output.period).toBe('2025-01');
  });

  it('debe cumplir que activo = pasivo + patrimonio', async () => {
    const output = await getBalanceSheetTool.handler({ period: '2025-01' }, undefined as any);
    expect(Math.abs(output.totalAssets - (output.totalLiabilities + output.equity))).toBeLessThan(0.01);
  });

  it('debe calcular los ratios financieros correctamente', async () => {
    const output = await getBalanceSheetTool.handler({ period: '2025-01' }, undefined as any);

    expect(output.ratios).toHaveProperty('liquidity');
    expect(output.ratios).toHaveProperty('solvency');
    expect(output.ratios).toHaveProperty('currentRatio');

    expect(output.ratios.liquidity).toBeCloseTo(output.totalAssets / output.totalLiabilities, 5);
    expect(output.ratios.solvency).toBeCloseTo(output.equity / output.totalAssets, 5);
  });

  it('debe usar el período por defecto si no se especifica', async () => {
    const output = await getBalanceSheetTool.handler({}, undefined as any);
    expect(output.period).toBe('2025-01');
  });

  it('debe generar _timestamp en formato ISO', async () => {
    const output = await getBalanceSheetTool.handler({ period: '2025-01' }, undefined as any);
    const isoRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
    expect(output._timestamp).toMatch(isoRegex);
  });
});
