# Balance General — Colombia (NIIF / PUC)

**Empresa:** {{nombre_empresa}}
**NIT:** {{nit_empresa}}
**Período:** {{periodo}}
**Fecha de corte:** {{fecha_corte}}
**Fecha de generación:** {{fecha_generacion}}
**Moneda:** {{moneda}} (COP — Pesos Colombianos)
**Normativa:** {{marco_normativo}} (NIIF para Pymes / NIIF Plenas / Decreto 2649 de 1993)
**Presentación:** Clasificado (corriente / no corriente) — NIC 1 / NIIF para PYMES Sección 4

---

## Resumen Ejecutivo

| Indicador | Valor |
|---|---|
| **Total Activos** | {{formato_moneda total_activos}} |
| **Total Pasivos** | {{formato_moneda total_pasivos}} |
| **Patrimonio Neto** | {{formato_moneda total_patrimonio}} |
| **Razón Corriente** | {{formato_razon razon_corriente}} |
| **Nivel de Endeudamiento** | {{formato_porcentaje nivel_endeudamiento}} |
| **Capital de Trabajo Neto** | {{formato_moneda capital_trabajo_neto}} |

---

## Activos

### Activos Corrientes (Códigos PUC 11 — 15)

| Código PUC | Cuenta | Nota | Saldo |
|---|---|---|---|
| 11 | **Efectivo y Equivalentes al Efectivo** | {{nota_efectivo}} | **{{formato_moneda efectivo_equivalentes}}** |
| 1105 | Caja | | {{formato_moneda caja}} |
| 1110 | Bancos (Cuentas Corrientes y de Ahorro) | | {{formato_moneda bancos}} |
| 1120 | Fondos | | {{formato_moneda fondos}} |
| 1125 | Equivalentes de Efectivo (CDT, inversiones ≤ 90 días) | | {{formato_moneda equivalentes_efectivo}} |
| 12 | **Inversiones** | {{nota_inversiones}} | **{{formato_moneda inversiones}}** |
| 1205 | Inversiones en Instrumentos de Deuda | | {{formato_moneda inversiones_deuda}} |
| 1210 | Inversiones en Instrumentos de Patrimonio | | {{formato_moneda inversiones_patrimonio}} |
| 13 | **Deudores Comerciales y Otras Cuentas por Cobrar** | {{nota_deudores}} | **{{formato_moneda deudores}}** |
| 1305 | Clientes Nacionales | | {{formato_moneda clientes_nacionales}} |
| 1310 | Clientes del Exterior | | {{formato_moneda clientes_exterior}} |
| 1320 | Cuentas por Cobrar a Vinculados Económicos | | {{formato_moneda vinculados_economicos}} |
| 1355 | Anticipos y Avances | | {{formato_moneda anticipos}} |
| 1365 | Cuentas por Cobrar a Trabajadores | | {{formato_moneda cuentas_trabajadores}} |
| 1380 | Deudores Varios | | {{formato_moneda deudores_varios}} |
| 1385 | Deterioro Acumulado de Cuentas por Cobrar (CR) | | ({{formato_moneda deterioro_cartera}}) |
| 14 | **Inventarios** | {{nota_inventarios}} | **{{formato_moneda inventarios}}** |
| 1405 | Materias Primas | | {{formato_moneda materias_primas}} |
| 1410 | Productos en Proceso | | {{formato_moneda productos_proceso}} |
| 1415 | Productos Terminados | | {{formato_moneda productos_terminados}} |
| 1420 | Mercancías no Fabricadas por la Empresa | | {{formato_moneda mercancias}} |
| 1430 | Inventarios en Tránsito | | {{formato_moneda inventarios_transito}} |
| 1455 | Deterioro Acumulado de Inventarios (CR) | | ({{formato_moneda deterioro_inventarios}}) |
| 15 | **Otros Activos Corrientes** | {{nota_otros_activos_corrientes}} | **{{formato_moneda otros_activos_corrientes}}** |
| 1505 | Gastos Pagados por Anticipado | | {{formato_moneda gastos_anticipados}} |
| 1510 | Cargos Diferidos | | {{formato_moneda cargos_diferidos}} |
| 1515 | Instrumentos Financieros Derivados | | {{formato_moneda derivados}} |
| | **Total Activos Corrientes** | | **{{formato_moneda total_activos_corrientes}}** |

### Activos No Corrientes (Códigos PUC 16 — 19)

| Código PUC | Cuenta | Nota | Saldo |
|---|---|---|---|
| 16 | **Propiedades, Planta y Equipo (PPE)** | {{nota_ppe}} | **{{formato_moneda propiedades_planta_equipo}}** |
| 1605 | Terrenos | | {{formato_moneda terrenos}} |
| 1610 | Construcciones y Edificaciones | | {{formato_moneda construcciones}} |
| 1615 | Maquinaria y Equipo | | {{formato_moneda maquinaria}} |
| 1620 | Equipo de Oficina | | {{formato_moneda equipo_oficina}} |
| 1625 | Equipo de Computación y Comunicaciones | | {{formato_moneda equipo_computacion}} |
| 1630 | Flota y Equipo de Transporte | | {{formato_moneda flota_transporte}} |
| 1635 | Depreciación Acumulada (CR) | | ({{formato_moneda depreciacion_acumulada}}) |
| 1640 | Deterioro Acumulado de PPE (CR) | | ({{formato_moneda deterioro_ppe}}) |
| 17 | **Activos Intangibles** | {{nota_intangibles}} | **{{formato_moneda intangibles}}** |
| 1705 | Plusvalía (Goodwill) | | {{formato_moneda plusvalia}} |
| 1710 | Marcas, Patentes y Licencias | | {{formato_moneda marcas_patentes}} |
| 1715 | Software y Programas Informáticos | | {{formato_moneda software}} |
| 1720 | Amortización Acumulada de Intangibles (CR) | | ({{formato_moneda amortizacion_acumulada}}) |
| 1725 | Deterioro Acumulado de Intangibles (CR) | | ({{formato_moneda deterioro_intangibles}}) |
| 18 | **Inversiones a Largo Plazo** | {{nota_inversiones_lp}} | **{{formato_moneda inversiones_largo_plazo}}** |
| 1805 | Inversiones en Subsidiarias | | {{formato_moneda subsidiarias}} |
| 1810 | Inversiones en Asociadas | | {{formato_moneda asociadas}} |
| 1815 | Inversiones en Negocios Conjuntos | | {{formato_moneda negocios_conjuntos}} |
| 19 | **Otros Activos No Corrientes** | {{nota_otros_activos_no_corrientes}} | **{{formato_moneda otros_activos_no_corrientes}}** |
| 1905 | Activos por Impuestos Diferidos | | {{formato_moneda impuesto_diferido_activo}} |
| 1910 | Activos Biológicos | | {{formato_moneda activos_biologicos}} |
| 1915 | Activos Mantenidos para la Venta | | {{formato_moneda activos_venta}} |
| 1920 | Otros Activos | | {{formato_moneda otros_activos}} |
| | **Total Activos No Corrientes** | | **{{formato_moneda total_activos_no_corrientes}}** |

### **Total Activos: {{formato_moneda total_activos}}**

---

## Pasivos

### Pasivos Corrientes (Códigos PUC 21 — 24)

| Código PUC | Cuenta | Nota | Saldo |
|---|---|---|---|
| 21 | **Obligaciones Financieras — Corto Plazo** | {{nota_obligaciones_financieras_cp}} | **{{formato_moneda obligaciones_financieras_cp}}** |
| 2105 | Bancos Nacionales | | {{formato_moneda bancos_nacionales_cp}} |
| 2110 | Bancos del Exterior | | {{formato_moneda bancos_exterior_cp}} |
| 2115 | Sobregiros | | {{formato_moneda sobregiros}} |
| 2120 | Obligaciones por Arrendamientos Financieros CP | | {{formato_moneda arrendamientos_financieros_cp}} |
| 22 | **Proveedores** | {{nota_proveedores}} | **{{formato_moneda proveedores}}** |
| 2205 | Proveedores Nacionales | | {{formato_moneda proveedores_nacionales}} |
| 2210 | Proveedores del Exterior | | {{formato_moneda proveedores_exterior}} |
| 23 | **Cuentas por Pagar** | {{nota_cuentas_por_pagar}} | **{{formato_moneda cuentas_por_pagar}}** |
| 2305 | Costos y Gastos por Pagar | | {{formato_moneda costos_gastos_por_pagar}} |
| 2310 | Acreedores Varios | | {{formato_moneda acreedores_varios}} |
| 2335 | Dividendos por Pagar | | {{formato_moneda dividendos_por_pagar}} |
| 2340 | Retención en la Fuente por Pagar | | {{formato_moneda retefuente}} |
| 2345 | Impuesto a las Ventas (IVA) por Pagar | | {{formato_moneda iva_por_pagar}} |
| 2350 | Impuesto de Industria y Comercio (ICA) por Pagar | | {{formato_moneda ica_por_pagar}} |
| 2355 | Impuesto de Renta y Complementarios por Pagar | | {{formato_moneda renta_por_pagar}} |
| 2360 | Contribuciones y Afiliaciones | | {{formato_moneda contribuciones}} |
| 2365 | Retenciones y Aportes de Nómina | | {{formato_moneda retenciones_nomina}} |
| 2370 | Acreedores Oficiales | | {{formato_moneda acreedores_oficiales}} |
| 24 | **Otros Pasivos Corrientes** | {{nota_otros_pasivos_corrientes}} | **{{formato_moneda otros_pasivos_corrientes}}** |
| 2405 | Pasivos por Arrendamientos — Corto Plazo | | {{formato_moneda pasivos_arrendamientos_cp}} |
| 2410 | Anticipos Recibidos de Clientes | | {{formato_moneda anticipos_clientes}} |
| 2415 | Ingresos Recibidos por Anticipado | | {{formato_moneda ingresos_anticipados}} |
| 2420 | Provisiones — Corto Plazo | | {{formato_moneda provisiones_cp}} |
| | **Total Pasivos Corrientes** | | **{{formato_moneda total_pasivos_corrientes}}** |

### Pasivos No Corrientes (Códigos PUC 21 — 26, Largo Plazo)

| Código PUC | Cuenta | Nota | Saldo |
|---|---|---|---|
| 21 | **Obligaciones Financieras — Largo Plazo** | {{nota_obligaciones_financieras_lp}} | **{{formato_moneda obligaciones_financieras_lp}}** |
| 2105 | Bancos Nacionales — Largo Plazo | | {{formato_moneda bancos_nacionales_lp}} |
| 2110 | Bancos del Exterior — Largo Plazo | | {{formato_moneda bancos_exterior_lp}} |
| 2120 | Obligaciones por Arrendamientos Financieros LP | | {{formato_moneda arrendamientos_financieros_lp}} |
| 23 | **Cuentas por Pagar — Largo Plazo** | {{nota_cuentas_por_pagar_lp}} | **{{formato_moneda cuentas_por_pagar_lp}}** |
| 2330 | Proveedores — Largo Plazo | | {{formato_moneda proveedores_lp}} |
| 24 | **Pasivos por Impuestos Diferidos** | {{nota_impuesto_diferido_pasivo}} | **{{formato_moneda impuesto_diferido_pasivo}}** |
| 2405 | Impuesto de Renta Diferido | | {{formato_moneda renta_diferida}} |
| 25 | **Provisiones — Largo Plazo** | {{nota_provisiones_lp}} | **{{formato_moneda provisiones_lp}}** |
| 2505 | Provisiones para Obligaciones Laborales (Prestaciones Sociales) | | {{formato_moneda obligaciones_laborales}} |
| 2510 | Provisiones para Contingencias | | {{formato_moneda contingencias}} |
| 2515 | Provisiones para Desmantelamiento | | {{formato_moneda desmantelamiento}} |
| 26 | **Otros Pasivos No Corrientes** | {{nota_otros_pasivos_no_corrientes}} | **{{formato_moneda otros_pasivos_no_corrientes}}** |
| 2605 | Pasivos por Arrendamientos — Largo Plazo | | {{formato_moneda pasivos_arrendamientos_lp}} |
| 2610 | Ingresos Diferidos — Largo Plazo | | {{formato_moneda ingresos_diferidos_lp}} |
| | **Total Pasivos No Corrientes** | | **{{formato_moneda total_pasivos_no_corrientes}}** |

### **Total Pasivos: {{formato_moneda total_pasivos}}**

---

## Patrimonio (Códigos PUC 31 — 38)

| Código PUC | Cuenta | Nota | Saldo |
|---|---|---|---|
| 31 | **Capital Social** | {{nota_capital}} | **{{formato_moneda capital_social}}** |
| 3105 | Capital Suscrito y Pagado | | {{formato_moneda capital_suscrito_pagado}} |
| 3110 | Capital Suscrito por Pagar | | ({{formato_moneda capital_por_pagar}}) |
| 3115 | Aportes Sociales | | {{formato_moneda aportes_sociales}} |
| 32 | **Superávit de Capital** | {{nota_superavit_capital}} | **{{formato_moneda superavit_capital}}** |
| 3205 | Prima en Colocación de Acciones | | {{formato_moneda prima_colocacion}} |
| 3210 | Superávit por Valorizaciones | | {{formato_moneda valorizaciones}} |
| 3215 | Superávit por Donaciones | | {{formato_moneda donaciones}} |
| 33 | **Reservas** | {{nota_reservas}} | **{{formato_moneda reservas}}** |
| 3305 | Reserva Legal | | {{formato_moneda reserva_legal}} |
| 3310 | Reservas Estatutarias | | {{formato_moneda reservas_estatutarias}} |
| 3315 | Reservas Ocasionales | | {{formato_moneda reservas_ocasionales}} |
| 34 | **Resultados del Ejercicio** | {{nota_resultados_ejercicio}} | **{{formato_moneda resultados_ejercicio}}** |
| 3405 | Utilidad del Ejercicio | | {{formato_moneda utilidad_ejercicio}} |
| 3410 | Pérdida del Ejercicio | | ({{formato_moneda perdida_ejercicio}}) |
| 35 | **Resultados de Ejercicios Anteriores** | {{nota_resultados_anteriores}} | **{{formato_moneda resultados_anteriores}}** |
| 3505 | Utilidades Acumuladas | | {{formato_moneda utilidades_acumuladas}} |
| 3510 | Pérdidas Acumuladas | | ({{formato_moneda perdidas_acumuladas}}) |
| 36 | **Superávit por Revaluación de PPE** | {{nota_revaluacion_ppe}} | **{{formato_moneda revaluacion_ppe}}** |
| 37 | **Otro Resultado Integral (ORI)** | {{nota_ori}} | **{{formato_moneda otro_resultado_integral}}** |
| 3705 | Ganancia/(Pérdida) por Conversión de Estados Financieros | | {{formato_moneda conversion_extranjera}} |
| 3710 | Ganancia/(Pérdida) por Medición de Instrumentos Financieros | | {{formato_moneda medicion_instrumentos}} |
| 38 | **Dividendos Decretados en Acciones** | {{nota_dividendos_acciones}} | **{{formato_moneda dividendos_acciones}}** |
| | **Total Patrimonio** | | **{{formato_moneda total_patrimonio}}** |

---

## Ecuación Contable

| Concepto | Valor |
|---|---|
| **Total Activos** | {{formato_moneda total_activos}} |
| **Total Pasivos** | ({{formato_moneda total_pasivos}}) |
| **Total Patrimonio** | = **{{formato_moneda total_patrimonio}}** |
| **Total Pasivos + Patrimonio** | **{{formato_moneda total_pasivos_mas_patrimonio}}** |
| **Diferencia (Activos − (Pasivos + Patrimonio))** | **{{formato_moneda diferencia_contable}}** |

---

## Indicadores Financieros Clave

| Indicador | Fórmula | Valor | Interpretación |
|---|---|---|---|
| **Razón Corriente** | Activo Corriente / Pasivo Corriente | {{formato_razon razon_corriente}} | {{interpretar_razon_corriente razon_corriente}} |
| **Prueba Ácida** | (Activo Corriente − Inventarios) / Pasivo Corriente | {{formato_razon prueba_acida}} | {{interpretar_prueba_acida prueba_acida}} |
| **Capital de Trabajo Neto** | Activo Corriente − Pasivo Corriente | {{formato_moneda capital_trabajo_neto}} | {{interpretar_capital_trabajo capital_trabajo_neto}} |
| **Nivel de Endeudamiento** | Pasivo Total / Activo Total | {{formato_porcentaje nivel_endeudamiento}} | {{interpretar_endeudamiento nivel_endeudamiento}} |
| **Endeudamiento Financiero** | Obligaciones Financieras / Pasivo Total | {{formato_porcentaje endeudamiento_financiero}} | {{interpretar_endeudamiento_financiero endeudamiento_financiero}} |
| **Concentración del Endeudamiento CP** | Pasivo Corriente / Pasivo Total | {{formato_porcentaje concentracion_endeudamiento}} | {{interpretar_concentracion concentracion_endeudamiento}} |
| **Razón Patrimonio a Activo** | Patrimonio / Activo Total | {{formato_porcentaje patrimonio_activo}} | {{interpretar_patrimonio_activo patrimonio_activo}} |
| **Razón Patrimonio a Pasivo** | Patrimonio / Pasivo Total | {{formato_razon patrimonio_pasivo}} | {{interpretar_patrimonio_pasivo patrimonio_pasivo}} |
| **Rentabilidad del Patrimonio (ROE)** | Utilidad Neta / Patrimonio | {{formato_porcentaje roe}} | {{interpretar_roe roe}} |
| **Rentabilidad del Activo (ROA)** | Utilidad Neta / Activo Total | {{formato_porcentaje roa}} | {{interpretar_roa roa}} |
| **Cobertura de Intereses** | EBITDA / Gastos Financieros | {{formato_razon cobertura_intereses}} | {{interpretar_cobertura cobertura_intereses}} |

---

## Notas a los Estados Financieros

{{#if notas}}
{{notas}}
{{else}}
*Sin notas adicionales para este período.*
{{/if}}

---

## Referencias Normativas

| Norma | Descripción |
|---|---|
| **Ley 1314 de 2009** | Ley de convergencia a NIIF en Colombia |
| **Decreto 2649 de 1993** | Principios de Contabilidad Generalmente Aceptados (PCGA) |
| **Decreto 2650 de 1993** | Plan Único de Cuentas (PUC) para comerciantes |
| **Decreto 2420 de 2015** | Marco Técnico Normativo de NIIF en Colombia (Decreto Único Reglamentario) |
| **Decreto 2496 de 2015** | Modificaciones al marco NIIF |
| **Resolución 139 de 2015** | PUC para entidades vigiladas por la SuperSociedades |
| **Ley 2277 de 2022** | Reforma tributaria — tarifas de renta |
| **Código de Comercio** | Artículos 444 a 456 — Estados Financieros |
| **NIC 1** | Presentación de Estados Financieros |
| **NIC 16** | Propiedades, Planta y Equipo |
| **NIC 36** | Deterioro del Valor de los Activos |
| **NIC 37** | Provisiones, Pasivos Contingentes y Activos Contingentes |
| **NIIF 9** | Instrumentos Financieros |
| **NIIF 15** | Ingresos de Actividades Ordinarias |
| **NIIF 16** | Arrendamientos |
| **NIIF para PYMES Sección 4** | Estado de Situación Financiera |

---

## Información Complementaria

| Dato | Valor |
|---|---|
| **Tipo de Entidad** | {{tipo_entidad}} (SAS / SA / Ltda / E.U. / Otra) |
| **Grupo NIIF** | {{grupo_niif}} (Grupo 1 — NIIF Plenas / Grupo 2 — NIIF Pymes / Grupo 3 — Microempresas) |
| **Clasificación por Tamaño** | {{clasificacion_tamano}} (Micro / Pequeña / Mediana / Grande) |
| **Supervisión** | {{entidad_supervision}} (SuperSociedades / Superfinanciera / Otra / Ninguna) |
| **Base de Preparación** | {{base_preparacion}} (NIIF Plenas / NIIF Pymes / Contabilidad Local) |
| **Moneda Funcional** | {{moneda_funcional}} |
| **Presentación en** | {{moneda_presentacion}} |
| **Cifras expresadas en** | {{redondeo}} (Unidades / Miles / Millones de pesos) |
| **Período Anterior** | {{periodo_anterior}} |
| **Tasa de Cambio (TRM) al cierre** | {{trm_cierre}} COP/USD |

---

## Notas Técnicas — Normativa Colombiana

### 1. Plan Único de Cuentas (PUC)

El PUC colombiano está definido por el Decreto 2650 de 1993. Las cuentas del Balance General se agrupan en las siguientes clases:

| Clase | Descripción |
|---|---|
| **1** | Activos |
| **2** | Pasivos |
| **3** | Patrimonio |

**Estructura del código PUC:**
- Primer dígito: Clase (1-9)
- Segundo dígito: Grupo
- Tercer dígito: Cuenta
- Cuarto dígito: Subcuenta
- Quinto dígito: Auxiliar

### 2. Clasificación Corriente / No Corriente

Bajo NIIF (NIC 1 / Sección 4 NIIF Pymes), un activo/pasivo se clasifica como **corriente** si:
- Se espera realizar/pagar dentro del ciclo normal de operación (generalmente 12 meses)
- Se mantiene principalmente para negociación
- Es efectivo o equivalente de efectivo sin restricciones

### 3. Deterioro de Activos

- **Deterioro de cartera (NIIF 9):** Modelo de pérdida esperada. Ya no se usa el modelo de pérdida incurrida (PCGA anterior).
- **Deterioro de PPE (NIC 36):** Se reconoce cuando el valor en libros excede el valor recuperable.
- **Deterioro de inventarios (NIC 2):** Se reconoce cuando el costo excede el valor neto realizable.

### 4. Arrendamientos (NIIF 16)

Desde la adopción de NIIF 16, los arrendamientos operativos se contabilizan como activos por derecho de uso (PPE) con un pasivo por arrendamiento. Ya no existe la distinción entre arrendamiento operativo y financiero para el arrendatario.

### 5. Impuesto Diferido (NIC 12)

Se reconoce impuesto diferido por:
- Diferencias temporarias entre la base contable (NIIF) y la base fiscal (Estatuto Tributario)
- Pérdidas fiscales no utilizadas
- Créditos fiscales no utilizados

### 6. Provisiones (NIC 37)

Se reconocen cuando:
- Existe una obligación presente (legal o implícita) como resultado de un evento pasado
- Es probable que se requiera una salida de recursos
- El monto puede estimarse de manera fiable

---

## Alertas y Riesgos

{{#if alertas}}
{{#each alertas}}
- **{{severidad}}:** {{mensaje}} ({{fecha}})
{{/each}}
{{else}}
No se detectaron alertas significativas en el período.
{{/if}}

---

## Firma y Aprobación

| Rol | Nombre | Fecha |
|---|---|---|
| **Preparado por** (Contador) | {{preparado_por}} | {{fecha_preparacion}} |
| **Revisado por** (Revisor Fiscal) | {{revisado_por}} | {{fecha_revision}} |
| **Aprobado por** (Representante Legal) | {{aprobado_por}} | {{fecha_aprobacion}} |

---

*Documento generado automáticamente por Finance Agent — {{fecha_generacion}}*
*Este informe se prepara de acuerdo con el marco normativo colombiano aplicable (NIIF / Decreto 2649 de 1993). Los datos presentados reflejan la información disponible al momento de la consulta. Este reporte no constituye asesoría contable ni fiscal. Consulte con su contador público o revisor fiscal antes de tomar decisiones basadas en este reporte.*
