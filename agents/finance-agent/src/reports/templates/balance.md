# Balance General

**Empresa:** {{company.name}}
**Período:** {{period}}
**Fecha de generación:** {{generatedAt}}
**Moneda:** {{company.currency}}

---

## Resumen Ejecutivo

| Indicador | Valor |
|---|---|
| **Total Activos** | {{formatCurrency totalAssets}} |
| **Total Pasivos** | {{formatCurrency totalLiabilities}} |
| **Patrimonio Neto** | {{formatCurrency equity}} |
| **Liquidez** | {{formatRatio ratios.liquidity}} |
| **Solvencia** | {{formatRatio ratios.solvency}} |
| **Razón Corriente** | {{formatRatio ratios.currentRatio}} |

---

## Activos

### Activos Corrientes

| Cuenta | Saldo |
|---|---|
| Efectivo y Equivalentes | {{formatCurrency currentAssets.cashAndEquivalents}} |
| Cuentas por Cobrar | {{formatCurrency currentAssets.accountsReceivable}} |
| Inventarios | {{formatCurrency currentAssets.inventory}} |
| Otros Activos Corrientes | {{formatCurrency currentAssets.otherCurrentAssets}} |
| **Total Activos Corrientes** | **{{formatCurrency currentAssets.total}}** |

### Activos No Corrientes

| Cuenta | Saldo |
|---|---|
| Propiedades, Planta y Equipo | {{formatCurrency nonCurrentAssets.propertyPlantEquipment}} |
| Activos Intangibles | {{formatCurrency nonCurrentAssets.intangibleAssets}} |
| Inversiones a Largo Plazo | {{formatCurrency nonCurrentAssets.longTermInvestments}} |
| Otros Activos No Corrientes | {{formatCurrency nonCurrentAssets.otherNonCurrentAssets}} |
| **Total Activos No Corrientes** | **{{formatCurrency nonCurrentAssets.total}}** |

### **Total Activos: {{formatCurrency totalAssets}}**

---

## Pasivos

### Pasivos Corrientes

| Cuenta | Saldo |
|---|---|
| Cuentas por Pagar | {{formatCurrency currentLiabilities.accountsPayable}} |
| Obligaciones Financieras Corto Plazo | {{formatCurrency currentLiabilities.shortTermDebt}} |
| Impuestos por Pagar | {{formatCurrency currentLiabilities.taxesPayable}} |
| Otros Pasivos Corrientes | {{formatCurrency currentLiabilities.otherCurrentLiabilities}} |
| **Total Pasivos Corrientes** | **{{formatCurrency currentLiabilities.total}}** |

### Pasivos No Corrientes

| Cuenta | Saldo |
|---|---|
| Obligaciones Financieras Largo Plazo | {{formatCurrency nonCurrentLiabilities.longTermDebt}} |
| Pasivos por Impuestos Diferidos | {{formatCurrency nonCurrentLiabilities.deferredTaxLiabilities}} |
| Otros Pasivos No Corrientes | {{formatCurrency nonCurrentLiabilities.otherNonCurrentLiabilities}} |
| **Total Pasivos No Corrientes** | **{{formatCurrency nonCurrentLiabilities.total}}** |

### **Total Pasivos: {{formatCurrency totalLiabilities}}**

---

## Patrimonio

| Cuenta | Saldo |
|---|---|
| Capital Social | {{formatCurrency equityDetails.capitalStock}} |
| Reservas | {{formatCurrency equityDetails.reserves}} |
| Utilidades Retenidas | {{formatCurrency equityDetails.retainedEarnings}} |
| Resultado del Ejercicio | {{formatCurrency equityDetails.netIncome}} |
| **Total Patrimonio** | **{{formatCurrency equity}}** |

---

## Ratios Financieros

| Ratio | Valor | Interpretación |
|---|---|---|
| **Liquidez** (Activo Corriente / Pasivo Corriente) | {{formatRatio ratios.liquidity}} | {{interpretLiquidity ratios.liquidity}} |
| **Solvencia** (Patrimonio / Activo Total) | {{formatRatio ratios.solvency}} | {{interpretSolvency ratios.solvency}} |
| **Razón Corriente** (Activo Corriente / Pasivo Corriente) | {{formatRatio ratios.currentRatio}} | {{interpretCurrentRatio ratios.currentRatio}} |
| **Endeudamiento** (Pasivo Total / Activo Total) | {{formatRatio ratios.debtRatio}} | {{interpretDebtRatio ratios.debtRatio}} |

---

## Notas

{{notes}}

---

*Reporte generado automáticamente por Finance Agent. Los datos presentados reflejan la información disponible al momento de la consulta.*
