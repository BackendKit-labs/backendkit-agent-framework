// ──────────────────────────────────────────────
// Generador de datos mock determinísticos
// ──────────────────────────────────────────────
//
// Mismo patrón que usan las tools reales de finance-agent (ver
// src/tools/payroll-summary.ts): un hash simple del período produce una
// variación reproducible, así el mismo período siempre da los mismos
// números pero distintos períodos difieren entre sí.

function periodSeed(period: string): number {
  return period.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
}

function variationFactor(period: string, spread = 20): number {
  const seed = periodSeed(period);
  const variation = (seed % spread) - spread / 2;
  return 1 + variation / 100;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function getBalanceSheet(period: string) {
  const f = variationFactor(period);
  const totalAssets = Math.round(2_500_000 * f);
  const totalLiabilities = Math.round(1_100_000 * f);
  const equity = totalAssets - totalLiabilities;
  return {
    totalAssets,
    totalLiabilities,
    equity,
    ratios: {
      liquidity: round2(1.8 * f),
      solvency: round2(2.3 * f),
      currentRatio: round2(1.6 * f),
    },
    period,
    _timestamp: new Date().toISOString(),
  };
}

export function getIncomeStatement(period: string) {
  const f = variationFactor(period);
  const revenue = Math.round(1_250_000 * f);
  const cogs = Math.round(750_000 * f);
  const grossMargin = revenue - cogs;
  const operatingExpenses = Math.round(320_000 * f);
  const netIncome = grossMargin - operatingExpenses;
  const ebitda = Math.round(netIncome * 1.17);
  return {
    revenue,
    cogs,
    grossMargin,
    operatingExpenses,
    netIncome,
    ebitda,
    period,
    _timestamp: new Date().toISOString(),
  };
}

export function getCashFlow(period: string) {
  const f = variationFactor(period);
  const operating = Math.round(480_000 * f);
  const investing = Math.round(-150_000 * f);
  const financing = Math.round(-90_000 * f);
  const netVariation = operating + investing + financing;
  const endingBalance = Math.round(620_000 + netVariation);
  return {
    operating,
    investing,
    financing,
    netVariation,
    endingBalance,
    period,
    _timestamp: new Date().toISOString(),
  };
}

export function getAgingReport(period: string, type: 'receivable' | 'payable') {
  const f = variationFactor(period);
  const baseTotal = type === 'receivable' ? 380_000 : 210_000;
  const total = Math.round(baseTotal * f);
  const ranges = ['0-30', '31-60', '61-90', '90+'];
  const rawWeights = [0.45, 0.25, 0.18, 0.12];
  const buckets = ranges.map((range, i) => {
    const amount = Math.round(total * rawWeights[i]);
    return {
      range,
      amount,
      count: Math.max(1, Math.round((amount / 5000) * f)),
      percentage: round2(rawWeights[i] * 100),
    };
  });
  return {
    buckets,
    total,
    period,
    type,
    _timestamp: new Date().toISOString(),
  };
}

export function getBudgetVsActual(period: string, department?: string) {
  const f = variationFactor(period);
  const names = department
    ? [department]
    : ['Ventas', 'Costo de Ventas', 'Gastos Operativos', 'Marketing', 'Administración'];
  const baseBudgets = [500_000, 300_000, 150_000, 80_000, 60_000];
  const categories = names.map((name, i) => {
    const budget = Math.round((baseBudgets[i % baseBudgets.length]) * f);
    const actual = Math.round(budget * (0.85 + (periodSeed(period + name) % 30) / 100));
    const variance = actual - budget;
    return {
      name,
      budget,
      actual,
      variance,
      variancePercentage: round2((variance / budget) * 100),
    };
  });
  const totalBudget = categories.reduce((s, c) => s + c.budget, 0);
  const totalActual = categories.reduce((s, c) => s + c.actual, 0);
  return {
    categories,
    totalBudget,
    totalActual,
    totalVariance: totalActual - totalBudget,
    period,
    _timestamp: new Date().toISOString(),
  };
}

export function getKpiDashboard(period: string) {
  const f = variationFactor(period);
  const defs: Array<{ name: string; base: number; unit: string }> = [
    { name: 'Margen Bruto', base: 40, unit: '%' },
    { name: 'Margen EBITDA', base: 18, unit: '%' },
    { name: 'Liquidez Corriente', base: 1.6, unit: 'x' },
    { name: 'ROE', base: 15, unit: '%' },
    { name: 'ROA', base: 8, unit: '%' },
    { name: 'Rotación de Cartera', base: 45, unit: 'días' },
  ];
  const kpis = defs.map(({ name, base, unit }) => {
    const value = round2(base * f);
    const previousValue = round2(base);
    const variation = round2(value - previousValue);
    return {
      name,
      value,
      unit,
      trend: (variation > 0.01 ? 'up' : variation < -0.01 ? 'down' : 'stable') as
        | 'up'
        | 'down'
        | 'stable',
      previousValue,
      variation,
    };
  });
  return {
    kpis,
    period,
    _timestamp: new Date().toISOString(),
  };
}

export function getRevenueBreakdown(
  period: string,
  groupBy: 'product' | 'region' | 'channel',
) {
  const f = variationFactor(period);
  const groups: Record<typeof groupBy, string[]> = {
    product: ['Producto A', 'Producto B', 'Producto C', 'Servicios'],
    region: ['Norte', 'Centro', 'Sur', 'Exportación'],
    channel: ['Directo', 'Distribuidor', 'E-commerce', 'Licitación'],
  };
  const baseAmounts = [450_000, 320_000, 280_000, 200_000];
  const breakdown = groups[groupBy].map((category, i) => ({
    category,
    amount: Math.round(baseAmounts[i] * f),
  }));
  const total = breakdown.reduce((s, b) => s + b.amount, 0);
  return {
    breakdown,
    total,
    period,
    _timestamp: new Date().toISOString(),
  };
}

export function getCostAnalysis(period: string) {
  const f = variationFactor(period);
  const names = [
    'Materia Prima',
    'Mano de Obra Directa',
    'Gastos de Fabricación',
    'Gastos Administrativos',
    'Gastos de Ventas',
  ];
  const baseAmounts = [280_000, 190_000, 95_000, 70_000, 55_000];
  const categories = names.map((name, i) => {
    const budget = baseAmounts[i];
    const amount = Math.round(budget * f);
    const variance = amount - budget;
    return {
      name,
      amount,
      budget,
      variance,
      variancePercentage: round2((variance / budget) * 100),
    };
  });
  const totalCost = categories.reduce((s, c) => s + c.amount, 0);
  const totalBudget = categories.reduce((s, c) => s + c.budget, 0);
  return {
    categories,
    totalCost,
    totalBudget,
    period,
    _timestamp: new Date().toISOString(),
  };
}

export function getTaxSummary(period: string, country: string) {
  const f = variationFactor(period);
  const taxesByCountry: Record<string, Array<{ name: string; base: number; status: 'paid' | 'pending' | 'accrued' }>> = {
    CO: [
      { name: 'IVA', base: 1_500_000, status: 'paid' },
      { name: 'Renta', base: 3_200_000, status: 'accrued' },
      { name: 'ICA', base: 450_000, status: 'pending' },
      { name: 'Retefuente', base: 780_000, status: 'paid' },
    ],
    MX: [
      { name: 'IVA', base: 1_400_000, status: 'paid' },
      { name: 'ISR', base: 2_900_000, status: 'accrued' },
      { name: 'IMSS', base: 600_000, status: 'pending' },
    ],
  };
  const defs = taxesByCountry[country] ?? taxesByCountry.CO;
  const taxes = defs.map((t) => ({
    name: t.name,
    amount: Math.round(t.base * f),
    status: t.status,
    dueDate: undefined as string | undefined,
  }));
  const totalAccrued = taxes.filter((t) => t.status === 'accrued').reduce((s, t) => s + t.amount, 0);
  const totalPaid = taxes.filter((t) => t.status === 'paid').reduce((s, t) => s + t.amount, 0);
  const totalPending = taxes.filter((t) => t.status === 'pending').reduce((s, t) => s + t.amount, 0);
  return {
    taxes,
    totalAccrued,
    totalPaid,
    totalPending,
    period,
    country,
  };
}

export function getPayrollSummary(period: string) {
  const f = variationFactor(period);
  const totalGross = Math.round(125_000 * f);
  const headcount = Math.round(45 * f);
  const deductions = Math.round(26_250 * f);
  const totalNet = totalGross - deductions;
  const avgSalary = headcount > 0 ? round2(totalGross / headcount) : 0;
  return {
    totalGross,
    totalNet,
    headcount,
    avgSalary,
    deductions,
    period,
    _timestamp: new Date().toISOString(),
  };
}
