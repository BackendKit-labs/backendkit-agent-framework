# Estado de Flujo de Efectivo

**Período:** {{period}}
**Generado:** {{generatedAt}}
**Empresa:** {{companyName}} {{#if companyId}}({{companyId}}){{/if}}

---

## Resumen Ejecutivo

| Concepto | Valor |
|---|---|
| Saldo inicial de efectivo | {{formatCurrency openingBalance}} |
| Flujo neto del período | {{formatCurrency netVariation}} |
| Saldo final de efectivo | **{{formatCurrency endingBalance}}** |
| Variación porcentual | {{percentageChange}}% |

---

## Flujo de Efectivo por Actividad

### 1. Actividades Operativas

| Concepto | Valor |
|---|---|
| Efectivo generado por operaciones | {{formatCurrency operating}} |
| **Total flujo operativo** | **{{formatCurrency operating}}** |

> **Interpretación:** {{operatingAnalysis}}

### 2. Actividades de Inversión

| Concepto | Valor |
|---|---|
| Efectivo utilizado en inversiones | {{formatCurrency investing}} |
| **Total flujo de inversión** | **{{formatCurrency investing}}** |

> **Interpretación:** {{investingAnalysis}}

### 3. Actividades de Financiamiento

| Concepto | Valor |
|---|---|
| Efectivo utilizado en financiamiento | {{formatCurrency financing}} |
| **Total flujo de financiamiento** | **{{formatCurrency financing}}** |

> **Interpretación:** {{financingAnalysis}}

---

## Flujo Neto del Período

| Componente | Valor | % del Total |
|---|---|---|
| Flujo operativo | {{formatCurrency operating}} | {{operatingPercent}}% |
| Flujo de inversión | {{formatCurrency investing}} | {{investingPercent}}% |
| Flujo de financiamiento | {{formatCurrency financing}} | {{financingPercent}}% |
| **Flujo neto total** | **{{formatCurrency netVariation}}** | **100%** |

---

## Indicadores Clave

| Indicador | Valor | Evaluación |
|---|---|---|
| Cobertura de efectivo (meses) | {{cashCoverageMonths}} | {{cashCoverageStatus}} |
| Ratio de liquidez inmediata | {{quickRatio}} | {{quickRatioStatus}} |
| Capital de trabajo | {{formatCurrency workingCapital}} | {{workingCapitalStatus}} |

---

## Análisis y Recomendaciones

{{analysis}}

---

## Notas

- Los valores están expresados en {{currency}}.
- Este reporte se genera con datos disponibles al momento de la consulta.
- Para un análisis más detallado, consulte el Balance General y el Estado de Resultados del mismo período.

---

*Reporte generado automáticamente por Finance Agent — {{generatedAt}}*
