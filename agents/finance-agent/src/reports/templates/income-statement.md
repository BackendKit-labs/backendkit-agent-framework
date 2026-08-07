# Estado de Resultados

**Período:** {{period}}
**Fecha de generación:** {{generatedAt}}
**Moneda:** {{currency}}

---

## Resumen Ejecutivo

| Métrica | Valor |
|---------|-------|
| Ingresos Totales | {{revenue}} |
| Costo de Ventas (COGS) | {{cogs}} |
| Utilidad Bruta | {{grossMargin}} |
| Margen Bruto | {{grossMarginPercent}} |
| Gastos Operativos | {{operatingExpenses}} |
| EBITDA | {{ebitda}} |
| Margen EBITDA | {{ebitdaMarginPercent}} |
| Utilidad Neta | {{netIncome}} |
| Margen Neto | {{netMarginPercent}} |

---

## Detalle de Ingresos

| Categoría | Monto | % del Total |
|-----------|-------|-------------|
{{#each revenueBreakdown}}
| {{category}} | {{amount}} | {{percentage}} |
{{/each}}

---

## Detalle de Costos y Gastos

### Costo de Ventas (COGS)

| Concepto | Monto | % de Ingresos |
|----------|-------|---------------|
{{#each cogsBreakdown}}
| {{concept}} | {{amount}} | {{percentage}} |
{{/each}}

### Gastos Operativos

| Concepto | Monto | % de Ingresos |
|----------|-------|---------------|
{{#each operatingExpensesBreakdown}}
| {{concept}} | {{amount}} | {{percentage}} |
{{/each}}

---

## Indicadores Clave

| Indicador | Valor | Interpretación |
|-----------|-------|----------------|
| Margen Bruto | {{grossMarginPercent}} | {{grossMarginInterpretation}} |
| Margen EBITDA | {{ebitdaMarginPercent}} | {{ebitdaInterpretation}} |
| Margen Neto | {{netMarginPercent}} | {{netIncomeInterpretation}} |
| Ratio de Gastos Operativos | {{operatingExpenseRatio}} | {{operatingExpenseInterpretation}} |

---

## Variación vs Período Anterior

| Métrica | Período Actual | Período Anterior | Variación | % Variación |
|---------|---------------|------------------|-----------|-------------|
{{#each vsPreviousPeriod}}
| {{metric}} | {{current}} | {{previous}} | {{variation}} | {{variationPercent}} |
{{/each}}

---

## Notas

{{#if notes}}
{{notes}}
{{else}}
*Sin notas adicionales para este período.*
{{/if}}

---

*Reporte generado automáticamente por Finance Agent — CFO Virtual*
