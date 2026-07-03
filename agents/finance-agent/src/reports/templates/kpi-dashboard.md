# Dashboard de KPIs Financieros

**Período:** {{period}}
**Generado:** {{generatedAt}}
**Empresa:** {{companyName}}

---

## Resumen Ejecutivo

| Indicador | Valor | Tendencia | Variación vs Período Anterior |
|-----------|-------|-----------|-------------------------------|
{{#each kpis}}
| **{{name}}** | {{value}} {{unit}} | {{trendIndicator trend}} | {{#if variation}}{{#if (gt variation 0)}}+{{/if}}{{variation}} {{unit}}{{else}}—{{/if}} |
{{/each}}

---

## Rentabilidad

{{#each kpis}}
{{#if (inCategory name "rentabilidad")}}
### {{name}}

- **Valor actual:** {{value}} {{unit}}
- **Período anterior:** {{previousValue}} {{unit}}
- **Variación:** {{#if (gt variation 0)}}+{{/if}}{{variation}} {{unit}}
- **Tendencia:** {{trendLabel trend}}

{{/if}}
{{/each}}

## Liquidez

{{#each kpis}}
{{#if (inCategory name "liquidez")}}
### {{name}}

- **Valor actual:** {{value}} {{unit}}
- **Período anterior:** {{previousValue}} {{unit}}
- **Variación:** {{#if (gt variation 0)}}+{{/if}}{{variation}} {{unit}}
- **Tendencia:** {{trendLabel trend}}

{{/if}}
{{/each}}

## Endeudamiento

{{#each kpis}}
{{#if (inCategory name "endeudamiento")}}
### {{name}}

- **Valor actual:** {{value}} {{unit}}
- **Período anterior:** {{previousValue}} {{unit}}
- **Variación:** {{#if (gt variation 0)}}+{{/if}}{{variation}} {{unit}}
- **Tendencia:** {{trendLabel trend}}

{{/if}}
{{/each}}

## Eficiencia Operativa

{{#each kpis}}
{{#if (inCategory name "eficiencia")}}
### {{name}}

- **Valor actual:** {{value}} {{unit}}
- **Período anterior:** {{previousValue}} {{unit}}
- **Variación:** {{#if (gt variation 0)}}+{{/if}}{{variation}} {{unit}}
- **Tendencia:** {{trendLabel trend}}

{{/if}}
{{/each}}

---

## Glosario de KPIs

| KPI | Fórmula | Interpretación |
|-----|---------|----------------|
| **Margen Bruto** | (Ingresos - Costo de Ventas) / Ingresos × 100 | Porcentaje de ingresos que cubre gastos operativos y genera utilidad |
| **Margen EBITDA** | EBITDA / Ingresos × 100 | Rentabilidad operativa pura, excluye financiamiento, impuestos y depreciación |
| **Margen Neto** | Utilidad Neta / Ingresos × 100 | Rentabilidad final después de todos los gastos e impuestos |
| **Liquidez Corriente** | Activo Corriente / Pasivo Corriente | Capacidad de pago de obligaciones a corto plazo (> 1.5 es saludable) |
| **Prueba Ácida** | (Activo Corriente - Inventarios) / Pasivo Corriente | Liquidez más estricta, excluye inventarios de lenta realización |
| **Endeudamiento Total** | Pasivo Total / Activo Total × 100 | Porcentaje de activos financiados con deuda (< 60% es saludable) |
| **Endeudamiento Financiero** | Pasivo Financiero / Patrimonio × 100 | Nivel de deuda con entidades financieras vs capital propio |
| **ROE** | Utilidad Neta / Patrimonio × 100 | Retorno sobre el capital invertido por los accionistas |
| **ROA** | Utilidad Neta / Activo Total × 100 | Eficiencia en el uso de todos los activos para generar utilidad |
| **Rotación de Cartera** | (Cuentas por Cobrar × 365) / Ingresos | Días promedio que tarda en cobrar a clientes |
| **Rotación de Inventarios** | (Inventario Promedio × 365) / Costo de Ventas | Días promedio que el inventario permanece en almacén |
| **Ciclo de Efectivo** | Rotación Cartera + Rotación Inventarios - Rotación Proveedores | Días entre el pago a proveedores y el cobro a clientes |

---

## Alertas

{{#if alerts}}
{{#each alerts}}
- ⚠️ **{{level}}:** {{message}}
{{/each}}
{{else}}
- ✅ No se detectaron alertas críticas en este período.
{{/if}}

---

*Reporte generado automáticamente por Finance Agent — {{generatedAt}}*
