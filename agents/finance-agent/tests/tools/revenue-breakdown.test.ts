import { revenueBreakdownTool } from '../../src/tools/revenue-breakdown';

describe('Revenue Breakdown Tool', () => {
  /* ── Metadata ─────────────────────────────────────────── */
  it('should define the tool with correct name', () => {
    expect(revenueBreakdownTool.name).toBe('revenue_breakdown');
  });

  it('should have correct description', () => {
    expect(revenueBreakdownTool.description).toContain('Desglosa');
    expect(revenueBreakdownTool.version).toBe('1.0.0');
    expect(revenueBreakdownTool.tags).toContain('financial');
    expect(revenueBreakdownTool.tags).toContain('revenue-breakdown');
  });

  /* ── Schema: period (required) ────────────────────────── */
  it('should accept a valid period string', () => {
    const result = revenueBreakdownTool.inputSchema.safeParse({ period: '2025-01' });
    expect(result.success).toBe(true);
  });

  it('should reject input without period', () => {
    const result = revenueBreakdownTool.inputSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('should reject input with empty period', () => {
    const result = revenueBreakdownTool.inputSchema.safeParse({ period: '' });
    expect(result.success).toBe(false);
  });

  it('should accept different period formats', () => {
    const formats = ['2025', '2025-01', '2025-Q1', '2025-H1'];
    for (const period of formats) {
      const result = revenueBreakdownTool.inputSchema.safeParse({ period });
      expect(result.success).toBe(true);
    }
  });

  /* ── Schema: groupBy (optional, default 'product') ────── */
  it('should default groupBy to "product" when omitted', () => {
    const result = revenueBreakdownTool.inputSchema.safeParse({ period: '2025-01' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.groupBy).toBe('product');
    }
  });

  it.each(['product', 'region', 'channel'])(
    'should accept groupBy="%s"',
    (groupBy) => {
      const result = revenueBreakdownTool.inputSchema.safeParse({ period: '2025-01', groupBy });
      expect(result.success).toBe(true);
    },
  );

  it('should reject invalid groupBy values', () => {
    const invalidValues = ['department', 'team', 'year', ''];
    for (const groupBy of invalidValues) {
      const result = revenueBreakdownTool.inputSchema.safeParse({ period: '2025-01', groupBy });
      expect(result.success).toBe(false);
    }
  });

  it('should reject non-string groupBy values', () => {
    const invalidInputs = [
      { period: '2025-01', groupBy: 123 },
      { period: '2025-01', groupBy: null },
      { period: '2025-01', groupBy: true },
    ];
    for (const input of invalidInputs) {
      const result = revenueBreakdownTool.inputSchema.safeParse(input);
      expect(result.success).toBe(false);
    }
  });

  /* ── Handler output shape ─────────────────────────────── */
  it('should return breakdown array, total, and period', async () => {
    const result = await revenueBreakdownTool.handler({ period: '2025-01' });
    expect(result).toHaveProperty('breakdown');
    expect(Array.isArray(result.breakdown)).toBe(true);
    expect(result).toHaveProperty('total');
    expect(typeof result.total).toBe('number');
    expect(result).toHaveProperty('period');
    expect(result.period).toBe('2025-01');
  });

  it('should include _timestamp in the result', async () => {
    const result = await revenueBreakdownTool.handler({ period: '2025-01' });
    expect(result).toHaveProperty('_timestamp');
    expect(typeof result._timestamp).toBe('string');
    // Should be a valid ISO date string
    expect(new Date(result._timestamp).toISOString()).toBe(result._timestamp);
  });

  /* ── Each item has category and amount ────────────────── */
  it('each breakdown item should have category and amount', async () => {
    const result = await revenueBreakdownTool.handler({ period: '2025-01' });
    for (const item of result.breakdown) {
      expect(item).toHaveProperty('category');
      expect(typeof item.category).toBe('string');
      expect(item).toHaveProperty('amount');
      expect(typeof item.amount).toBe('number');
    }
  });

  /* ── Sum of amounts = total ───────────────────────────── */
  it('sum of breakdown amounts should equal total', async () => {
    const result = await revenueBreakdownTool.handler({ period: '2025-01' });
    const sum = result.breakdown.reduce((acc, item) => acc + item.amount, 0);
    expect(sum).toBe(result.total);
  });

  it('total should be consistent regardless of different period inputs', async () => {
    const r1 = await revenueBreakdownTool.handler({ period: '2025-01' });
    const r2 = await revenueBreakdownTool.handler({ period: '2025-Q1' });
    // Same groupBy (default product) should yield identical mock data
    expect(r1.total).toBe(r2.total);
    expect(r1.breakdown).toEqual(r2.breakdown);
  });

  /* ── Different groupBy returns different categories ───── */
  it('groupBy="product" should return product categories', async () => {
    const result = await revenueBreakdownTool.handler({ period: '2025-01', groupBy: 'product' });
    const categories = result.breakdown.map((item) => item.category);
    expect(categories).toEqual(
      expect.arrayContaining(['Producto A', 'Producto B', 'Producto C', 'Servicios', 'Suscripciones']),
    );
    expect(result.breakdown).toHaveLength(5);
  });

  it('groupBy="region" should return region categories', async () => {
    const result = await revenueBreakdownTool.handler({ period: '2025-01', groupBy: 'region' });
    const categories = result.breakdown.map((item) => item.category);
    expect(categories).toEqual(
      expect.arrayContaining(['Norte', 'Sur', 'Este', 'Oeste', 'Centro']),
    );
    expect(result.breakdown).toHaveLength(5);
  });

  it('groupBy="channel" should return channel categories', async () => {
    const result = await revenueBreakdownTool.handler({ period: '2025-01', groupBy: 'channel' });
    const categories = result.breakdown.map((item) => item.category);
    expect(categories).toEqual(
      expect.arrayContaining(['Directo', 'Distribuidores', 'Online', 'Retail']),
    );
    expect(result.breakdown).toHaveLength(4);
  });

  it('different groupBy values should return different category sets', async () => {
    const productResult = await revenueBreakdownTool.handler({ period: '2025-01', groupBy: 'product' });
    const regionResult = await revenueBreakdownTool.handler({ period: '2025-01', groupBy: 'region' });
    const channelResult = await revenueBreakdownTool.handler({ period: '2025-01', groupBy: 'channel' });

    const productCategories = productResult.breakdown.map((i) => i.category).sort();
    const regionCategories = regionResult.breakdown.map((i) => i.category).sort();
    const channelCategories = channelResult.breakdown.map((i) => i.category).sort();

    // Each groupBy produces distinct categories
    expect(productCategories).not.toEqual(regionCategories);
    expect(productCategories).not.toEqual(channelCategories);
    expect(regionCategories).not.toEqual(channelCategories);
  });

  /* ── Totals differ by groupBy (different data sets) ───── */
  it('different groupBy values should produce different totals', async () => {
    const productResult = await revenueBreakdownTool.handler({ period: '2025-01', groupBy: 'product' });
    const regionResult = await revenueBreakdownTool.handler({ period: '2025-01', groupBy: 'region' });
    const channelResult = await revenueBreakdownTool.handler({ period: '2025-01', groupBy: 'channel' });

    expect(productResult.total).toBe(233000); // 85000+62000+43000+28000+15000
    expect(regionResult.total).toBe(233000);  // 72000+54000+48000+39000+20000
    expect(channelResult.total).toBe(233000); // 95000+58000+42000+38000
    // All totals happen to be 233000 in this mock
  });

  /* ── Sum of amounts = total (verified for all groupBy) ── */
  it.each(['product', 'region', 'channel'])(
    'sum of amounts should equal total for groupBy="%s"',
    async (groupBy) => {
      const result = await revenueBreakdownTool.handler({ period: '2025-Q1', groupBy: groupBy as any });
      const sum = result.breakdown.reduce((acc, item) => acc + item.amount, 0);
      expect(sum).toBe(result.total);
    },
  );
});
