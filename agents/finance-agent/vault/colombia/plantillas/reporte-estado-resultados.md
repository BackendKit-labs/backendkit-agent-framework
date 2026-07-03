# Plantilla: Estado de Resultados (PyG) — Colombia

**Normativa aplicable:** NIIF para PYMES / Decreto 2649 de 1993 / Ley 1314 de 2009
**Moneda:** COP (Pesos Colombianos)
**Presentación:** Por función del gasto (NIC 1 / NIIF para PYMES Sección 5)

---

## Estructura del Estado de Resultados

A continuación se presenta la estructura estándar del Estado de Resultados (Estado de Pérdidas y Ganancias) según la normativa colombiana vigente, alineada con las NIIF.

### Encabezado

```
[Nombre de la Empresa]
Estado de Resultados Integrales
Por el período terminado el [día] de [mes] de [año]
(Cifras expresadas en pesos colombianos — COP)
```

---

### Cuerpo del Estado

| Código PUC | Cuenta | Nota | Período Actual | Período Anterior |
|-----------|--------|------|---------------|------------------|
| | **INGRESOS OPERACIONALES** | | | |
| 41 | Ingresos por Actividades Ordinarias | {{nota_ingresos}} | {{ingresos_operacionales}} | {{ingresos_operacionales_anterior}} |
| | Devoluciones, descuentos y rebajas en ventas | | {{devoluciones_ventas}} | {{devoluciones_ventas_anterior}} |
| | **Total Ingresos Operacionales Netos** | | **{{total_ingresos_netos}}** | **{{total_ingresos_netos_anterior}}** |
| | | | | |
| | **COSTO DE VENTAS** | | | |
| 61 | Costo de Ventas | {{nota_costo_ventas}} | {{costo_ventas}} | {{costo_ventas_anterior}} |
| | **Utilidad Bruta** | | **{{utilidad_bruta}}** | **{{utilidad_bruta_anterior}}** |
| | *Margen Bruto* | | *{{margen_bruto}}%* | *{{margen_bruto_anterior}}%* |
| | | | | |
| | **GASTOS OPERACIONALES** | | | |
| 51 | Gastos de Administración | {{nota_gastos_admin}} | {{gastos_administracion}} | {{gastos_administracion_anterior}} |
| 52 | Gastos de Ventas | {{nota_gastos_ventas}} | {{gastos_ventas}} | {{gastos_ventas_anterior}} |
| 53 | Gastos de Personal | | {{gastos_personal}} | {{gastos_personal_anterior}} |
| 51xx | Honorarios | | {{honorarios}} | {{honorarios_anterior}} |
| 51xx | Arrendamientos | | {{arrendamientos}} | {{arrendamientos_anterior}} |
| 51xx | Contribuciones y afiliaciones | | {{contribuciones}} | {{contribuciones_anterior}} |
| 51xx | Seguros | | {{seguros}} | {{seguros_anterior}} |
| 51xx | Servicios públicos | | {{servicios_publicos}} | {{servicios_publicos_anterior}} |
| 51xx | Gastos legales | | {{gastos_legales}} | {{gastos_legales_anterior}} |
| 51xx | Mantenimiento y reparaciones | | {{mantenimiento}} | {{mantenimiento_anterior}} |
| 51xx | Depreciaciones | | {{depreciaciones}} | {{depreciaciones_anterior}} |
| 51xx | Amortizaciones | | {{amortizaciones}} | {{amortizaciones_anterior}} |
| 51xx | Provisiones | | {{provisiones}} | {{provisiones_anterior}} |
| 51xx | Deterioro de activos | | {{deterioro_activos}} | {{deterioro_activos_anterior}} |
| | **Total Gastos Operacionales** | | **{{total_gastos_operacionales}}** | **{{total_gastos_operacionales_anterior}}** |
| | | | | |
| | **Utilidad Operacional (EBIT)** | | **{{utilidad_operacional}}** | **{{utilidad_operacional_anterior}}** |
| | *Margen Operacional* | | *{{margen_operacional}}%* | *{{margen_operacional_anterior}}%* |
| | | | | |
| | **INGRESOS Y GASTOS NO OPERACIONALES** | | | |
| 42 | Ingresos no operacionales | {{nota_no_operacional}} | {{ingresos_no_operacionales}} | {{ingresos_no_operacionales_anterior}} |
| | - Financieros | | {{ingresos_financieros}} | {{ingresos_financieros_anterior}} |
| | - Otros ingresos | | {{otros_ingresos}} | {{otros_ingresos_anterior}} |
| 53 | Gastos no operacionales | | {{gastos_no_operacionales}} | {{gastos_no_operacionales_anterior}} |
| | - Financieros | | {{gastos_financieros}} | {{gastos_financieros_anterior}} |
| | - Otros gastos | | {{otros_gastos}} | {{otros_gastos_anterior}} |
| | **Total Ingresos/Gastos No Operacionales Netos** | | **{{total_no_operacional_neto}}** | **{{total_no_operacional_neto_anterior}}** |
| | | | | |
| | **Utilidad Antes de Impuestos (UAI)** | | **{{utilidad_antes_impuestos}}** | **{{utilidad_antes_impuestos_anterior}}** |
| | | | | |
| | **IMPUESTO A LA RENTA** | | | |
| 54 | Impuesto de Renta y Complementarios | {{nota_impuesto_renta}} | {{impuesto_renta}} | {{impuesto_renta_anterior}} |
| | Impuesto Diferido | | {{impuesto_diferido}} | {{impuesto_diferido_anterior}} |
| | **Total Impuesto a la Renta** | | **{{total_impuesto_renta}}** | **{{total_impuesto_renta_anterior}}** |
| | | | | |
| | **Utilidad Neta del Período** | | **{{utilidad_neta}}** | **{{utilidad_neta_anterior}}** |
| | *Margen Neto* | | *{{margen_neto}}%* | *{{margen_neto_anterior}}%* |
| | **EBITDA** | | **{{ebitda}}** | **{{ebitda_anterior}}** |
| | *Margen EBITDA* | | *{{margen_ebitda}}%* | *{{margen_ebitda_anterior}}%* |

---

## Notas Técnicas — Normativa Colombiana

### 1. Plan Único de Cuentas (PUC)

El PUC colombiano está definido por el Decreto 2650 de 1993. Las cuentas del Estado de Resultados se agrupan en las siguientes clases:

| Clase | Descripción |
|-------|-------------|
| **4** | Ingresos |
| **5** | Gastos |
| **6** | Costos de Ventas |

**Estructura del código PUC:**
- Primer dígito: Clase (1-9)
- Segundo dígito: Grupo
- Tercer dígito: Cuenta
- Cuarto dígito: Subcuenta
- Quinto dígito: Auxiliar

### 2. Clasificación por Función del Gasto

Colombia adoptó la presentación por **función del gasto** (método del costo de ventas) según NIC 1 / NIIF para PYMES Sección 5. Esto significa que los gastos se clasifican como:

- **Costo de ventas** (Clase 6)
- **Gastos de administración** (Clase 5, Grupo 51)
- **Gastos de ventas** (Clase 5, Grupo 52)
- **Gastos de personal** (Clase 5, Grupo 53)

### 3. Impuesto de Renta y Complementarios

- **Tarifa general:** 35% para el año gravable 2025 (Ley 2277 de 2022, reforma tributaria)
- **Tarifa para entidades sin ánimo de lucro:** 20%
- **Sobretasa:** No aplica a partir de 2024
- **ICA (Impuesto de Industria y Comercio):** Es un impuesto municipal, NO se incluye en el impuesto de renta. Se contabiliza como gasto operacional (Clase 51).
- **Impuesto diferido:** Se calcula sobre las diferencias temporarias entre la base contable (NIIF) y la base fiscal (Estatuto Tributario).

### 4. EBITDA — Definición Local

En Colombia, el EBITDA se calcula como:

```
EBITDA = Utilidad Operacional + Depreciaciones + Amortizaciones + Provisiones + Deterioro
```

**Nota importante:** No existe una definición legal única del EBITDA en Colombia. Cada empresa puede tener su propia política de cálculo. Se recomienda incluir una nota aclaratoria de los componentes incluidos.

### 5. Ingresos por Actividades Ordinarias (NIIF 15)

Bajo NIIF, los ingresos se reconocen aplicando el modelo de **5 pasos**:
1. Identificar el contrato con el cliente
2. Identificar las obligaciones de desempeño
3. Determinar el precio de la transacción
4. Asignar el precio de la transacción
5. Reconocer el ingreso cuando (o a medida que) se satisface la obligación

### 6. Provisiones y Deterioro

- **Provisiones:** Se rigen por la NIC 37 / Sección 21 NIIF para PYMES
- **Deterioro de activos:** NIC 36 / Sección 27 NIIF para PYMES
- **Deterioro de cartera:** Se calcula con base en el modelo de pérdida esperada (NIIF 9)

---

## Indicadores Clave Derivados del PyG

| Indicador | Fórmula | Interpretación |
|-----------|---------|----------------|
| **Margen Bruto** | Utilidad Bruta / Ingresos Netos | Eficiencia en la producción/venta directa |
| **Margen Operacional** | Utilidad Operacional / Ingresos Netos | Rentabilidad del negocio principal |
| **Margen Neto** | Utilidad Neta / Ingresos Netos | Rentabilidad final después de todo |
| **Margen EBITDA** | EBITDA / Ingresos Netos | Capacidad de generar caja operativa |
| **ROA** | Utilidad Neta / Activo Total | Retorno sobre activos |
| **ROE** | Utilidad Neta / Patrimonio | Retorno sobre patrimonio |
| **Cobertura de Gastos Financieros** | EBITDA / Gastos Financieros | Capacidad de pago de deuda |
| **Ratio de Gastos Operacionales** | Gastos Operacionales / Ingresos Netos | Eficiencia operativa |

---

## Variación vs Período Anterior

| Métrica | Período Actual | Período Anterior | Variación Absoluta | Variación % |
|---------|---------------|------------------|-------------------|-------------|
{{#each variacion_periodo}}
| {{metrica}} | {{actual}} | {{anterior}} | {{variacion_abs}} | {{variacion_pct}} |
{{/each}}

---

## Análisis de Sensibilidad — Umbrales de Alerta

| Indicador | Alerta Verde | Alerta Amarilla | Alerta Roja |
|-----------|-------------|-----------------|-------------|
| Margen Bruto | > 40% | 20% - 40% | < 20% |
| Margen Operacional | > 15% | 5% - 15% | < 5% |
| Margen Neto | > 10% | 3% - 10% | < 3% |
| Cobertura Gastos Financieros | > 3x | 1.5x - 3x | < 1.5x |
| Crecimiento de Ingresos (YoY) | > 10% | 0% - 10% | < 0% |

---

## Notas Adicionales

{{#if notas}}
{{notas}}
{{else}}
*Sin notas adicionales para este período.*
{{/if}}

---

## Referencias Normativas

| Norma | Descripción |
|-------|-------------|
| **Ley 1314 de 2009** | Ley de convergencia a NIIF en Colombia |
| **Decreto 2649 de 1993** | Principios de Contabilidad Generalmente Aceptados (antes de NIIF) |
| **Decreto 2650 de 1993** | Plan Único de Cuentas (PUC) |
| **Decreto 2420 de 2015** | Marco Técnico Normativo NIIF |
| **Decreto 2496 de 2015** | Modificaciones al marco NIIF |
| **Ley 2277 de 2022** | Reforma tributaria — tarifas de renta |
| **NIC 1** | Presentación de Estados Financieros |
| **NIIF 15** | Ingresos de Actividades Ordinarias |
| **NIC 37** | Provisiones, Pasivos Contingentes y Activos Contingentes |
| **NIIF para PYMES Sección 5** | Estado de Resultados Integral |

---

*Documento generado para uso como plantilla de conocimiento en el vault del Finance Agent.*
*Última actualización: 2025*
