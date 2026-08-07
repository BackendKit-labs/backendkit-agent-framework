# Estado de Flujo de Efectivo — NIIF para Pymes (Sección 7)

**Período:** {{period}}
**Fecha de corte:** {{cutoffDate}}
**Generado el:** {{generatedAt}}
**Empresa:** {{companyName}} {{#if companyId}}(NIT: {{companyId}}){{/if}}
**Moneda funcional:** {{currency}} (COP)
**Base contable:** NIIF para Pymes — Sección 7: Estado de Flujos de Efectivo
**Método:** {{method}} (Directo / Indirecto)

---

## 1. Saldos de Efectivo y Equivalentes

| Concepto | Corte Anterior {{previousPeriod}} | Corte Actual {{period}} | Variación |
|---|---|---|---|
| Efectivo en caja | {{formatCurrency previousCash}} | {{formatCurrency currentCash}} | {{formatCurrency cashVariation}} |
| Bancos (cuentas corrientes y de ahorro) | {{formatCurrency previousBank}} | {{formatCurrency currentBank}} | {{formatCurrency bankVariation}} |
| Equivalentes de efectivo (inversiones de alta liquidez ≤ 90 días) | {{formatCurrency previousEquivalents}} | {{formatCurrency currentEquivalents}} | {{formatCurrency equivalentsVariation}} |
| **Total efectivo y equivalentes** | **{{formatCurrency previousTotalCash}}** | **{{formatCurrency currentTotalCash}}** | **{{formatCurrency totalCashVariation}}** |

---

## 2. Flujo de Efectivo por Actividades

### 2.1 Actividades de Operación

| Concepto | Valor |
|---|---|
| **Efectivo recibido de clientes** | |
| Recaudo de ventas de bienes y servicios | {{formatCurrency cashFromSales}} |
| Recaudo de cuentas por cobrar comerciales | {{formatCurrency cashFromReceivables}} |
| Otros recaudos operativos | {{formatCurrency otherOperatingInflows}} |
| *Total ingresos operativos* | *{{formatCurrency totalOperatingInflows}}* |
| |
| **Efectivo pagado por operaciones** | |
| Pago a proveedores de bienes y servicios | {{formatCurrency paymentsToSuppliers}} |
| Pago de nómina y prestaciones sociales | {{formatCurrency payrollPayments}} |
| Pago de aportes parafiscales (SENA, ICBF, CCF) | {{formatCurrency parafiscalPayments}} |
| Pago de seguridad social (salud, pensión, ARL) | {{formatCurrency socialSecurityPayments}} |
| Pago de impuestos (Renta, IVA, ICA, Retefuente) | {{formatCurrency taxPayments}} |
| Otros pagos operativos | {{formatCurrency otherOperatingOutflows}} |
| *Total egresos operativos* | *{{formatCurrency totalOperatingOutflows}}* |
| |
| **Flujo neto de actividades de operación** | **{{formatCurrency netOperatingCashFlow}}** |

### 2.2 Actividades de Inversión

| Concepto | Valor |
|---|---|
| Compra de propiedades, planta y equipo (PPyE) | {{formatCurrency purchasePPE}} |
| Venta de propiedades, planta y equipo | {{formatCurrency salePPE}} |
| Adquisición de intangibles (software, licencias, marcas) | {{formatCurrency purchaseIntangibles}} |
| Inversiones en instrumentos financieros (CDT, bonos, acciones) | {{formatCurrency financialInvestments}} |
| Venta de inversiones financieras | {{formatCurrency saleInvestments}} |
| Dividendos recibidos | {{formatCurrency dividendsReceived}} |
| **Flujo neto de actividades de inversión** | **{{formatCurrency netInvestingCashFlow}}** |

### 2.3 Actividades de Financiación

| Concepto | Valor |
|---|---|
| **Aportes de capital** | |
| Aumento de capital social | {{formatCurrency capitalContributions}} |
| |
| **Préstamos y obligaciones financieras** | |
| Desembolsos de créditos bancarios | {{formatCurrency loanProceeds}} |
| Pago de préstamos bancarios | {{formatCurrency loanRepayments}} |
| Pago de arrendamientos financieros (leasing) | {{formatCurrency leasePayments}} |
| |
| **Costos financieros** | |
| Intereses pagados | {{formatCurrency interestPaid}} |
| |
| **Distribución de utilidades** | |
| Dividendos pagados a accionistas | {{formatCurrency dividendsPaid}} |
| **Flujo neto de actividades de financiación** | **{{formatCurrency netFinancingCashFlow}}** |

---

## 3. Variación Neta del Efectivo

| Componente | Valor | % del Total |
|---|---|---|
| Flujo neto de actividades de operación | {{formatCurrency netOperatingCashFlow}} | {{operatingPercent}}% |
| Flujo neto de actividades de inversión | {{formatCurrency netInvestingCashFlow}} | {{investingPercent}}% |
| Flujo neto de actividades de financiación | {{formatCurrency netFinancingCashFlow}} | {{financingPercent}}% |
| **Variación neta del período** | **{{formatCurrency netVariation}}** | **100%** |
| Efectivo al inicio del período | {{formatCurrency openingBalance}} | |
| **Efectivo al final del período** | **{{formatCurrency endingBalance}}** | |

---

## 4. Conciliación del Efectivo y Equivalentes

| Concepto | Valor |
|---|---|
| Saldo inicial de efectivo y equivalentes | {{formatCurrency openingBalance}} |
| (+) Variación neta del período | {{formatCurrency netVariation}} |
| (+/-) Efecto por diferencia en cambio | {{formatCurrency fxEffect}} |
| (=) **Saldo final de efectivo y equivalentes** | **{{formatCurrency endingBalance}}** |

---

## 5. Indicadores de Liquidez y Gestión de Efectivo

| Indicador | Fórmula | Valor | Evaluación |
|---|---|---|---|
| Razón corriente | Activo corriente / Pasivo corriente | {{currentRatio}} | {{currentRatioStatus}} |
| Prueba ácida | (Activo corriente - Inventarios) / Pasivo corriente | {{acidTest}} | {{acidTestStatus}} |
| Capital de trabajo neto | Activo corriente - Pasivo corriente | {{formatCurrency workingCapital}} | {{workingCapitalStatus}} |
| Cobertura de efectivo (meses) | Efectivo final / (Egresos operativos mensuales) | {{cashCoverageMonths}} meses | {{cashCoverageStatus}} |
| Ciclo de efectivo (días) | Días CxC + Días Inventario - Días CxP | {{cashConversionCycle}} días | {{cashCycleStatus}} |
| EBITDA | Utilidad operativa + Depreciación + Amortización | {{formatCurrency ebitda}} | {{ebitdaStatus}} |
| Margen EBITDA | EBITDA / Ingresos operativos | {{ebitdaMargin}}% | {{ebitdaMarginStatus}} |

---

## 6. Análisis y Recomendaciones

{{analysis}}

---

## 7. Notas a los Estados Financieros (NIIF)

1. **Base de preparación:** Este estado de flujo de efectivo ha sido preparado de acuerdo con la Sección 7 de la NIIF para Pymes, utilizando el método {{method}}.
2. **Moneda funcional y de presentación:** Las cifras están expresadas en pesos colombianos (COP).
3. **Equivalentes de efectivo:** Se consideran equivalentes de efectivo las inversiones a corto plazo de alta liquidez con vencimiento original de tres meses o menos.
4. **Transacciones no monetarias:** Las transacciones de inversión y financiación que no requirieron uso de efectivo (ej. adquisición de activos mediante arrendamiento financiero, conversión de deuda a capital) se revelan en las notas a los estados financieros y no afectan este estado.
5. **IVA en flujo de efectivo:** El IVA se presenta como parte de las actividades de operación, consistente con la naturaleza del impuesto.
6. **Diferencias en cambio:** Las partidas en moneda extranjera se convierten a la tasa de cambio de la fecha de la transacción. Las diferencias en cambio realizadas y no realizadas se presentan en actividades de operación.

---

## 8. Cumplimiento Normativo Colombia

| Norma | Estado |
|---|---|
| NIIF para Pymes (Ley 1314 de 2009) | {{niifCompliance}} |
| Decreto 2649 de 1993 (Principios de Contabilidad Generalmente Aceptados) | {{decree2649Compliance}} |
| Decreto Único Reglamentario 2420 de 2015 | {{decree2420Compliance}} |
| Estatuto Tributario Nacional (retenciones, IVA, Renta) | {{taxCompliance}} |
| Circular Externa 100-000005 de 2021 (Supersociedades) | {{supersociedadesCompliance}} |

---

## 9. Alertas y Riesgos

{{#if alerts}}
{{#each alerts}}
- **{{severity}}:** {{message}} ({{date}})
{{/each}}
{{else}}
No se detectaron alertas significativas en el período.
{{/if}}

---

## 10. Firma y Aprobación

| Rol | Nombre | Fecha |
|---|---|---|
| Preparado por | {{preparedBy}} | {{preparedDate}} |
| Revisado por | {{reviewedBy}} | {{reviewedDate}} |
| Aprobado por (Representante Legal) | {{approvedBy}} | {{approvedDate}} |

---

*Documento generado automáticamente por Finance Agent — {{generatedAt}}*
*Este reporte no constituye asesoría contable ni fiscal. Consulte con su revisor fiscal o contador público para la toma de decisiones.*
