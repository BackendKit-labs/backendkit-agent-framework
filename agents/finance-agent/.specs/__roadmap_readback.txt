# Finance Agent — ROADMAP

> **Nota:** Cada fase incluye su batería de tests unitarios. Ninguna fase se considera completa sin que los tests pasen y sean validados por QA.

## Fase 1: Core del Agente y Tool Registry
**Domain:** backend
**Duración estimada:** 3 días

**Objetivo:** Inicializar el proyecto, crear el engine base, el sistema de registro de tools y la estructura de carpetas.

**Archivos a crear:**
- `src/core/engine.ts` — createEngine() con agent-enterprise
- `src/core/tool-registry.ts` — registro central de tools
- `src/tools/index.ts` — registro automático de tools
- `src/entry-points/mcp-http.ts` — entry point HTTP
- `src/entry-points/mcp-stdio.ts` — entry point stdio
- `package.json`
- `tsconfig.json`

**Tests:**
- `tests/core/engine.test.ts` — Verificar que createEngine() devuelve un engine con provider deepseek configurado, vault path correcto, y que no lanza errores con config válida
- `tests/core/tool-registry.test.ts` — Verificar registro de tools nativas, registro de tools MCP, validación Zod de parámetros, ejecución de tool, error si la tool no existe
- `tests/entry-points/mcp-http.test.ts` — Verificar que el servidor HTTP arranca en el puerto configurado, responde a health check, rechaza requests sin body JSON válido
- `tests/entry-points/mcp-stdio.test.ts` — Verificar que el servidor stdio parsea JSON-RPC correctamente, responde a initialize, responde a tools/list

**Files to create:**
- src/core/engine.ts
- src/core/tool-registry.ts
- src/tools/index.ts
- src/entry-points/mcp-http.ts
- src/entry-points/mcp-stdio.ts
- package.json
- tsconfig.json
- .gitignore
- tests/core/engine.test.ts
- tests/core/tool-registry.test.ts
- tests/entry-points/mcp-http.test.ts
- tests/entry-points/mcp-stdio.test.ts

## Fase 2: Tools Base — Estados Financieros
**Domain:** backend
**Duración estimada:** 2 días

**Objetivo:** Implementar las 3 tools financieras fundamentales: Estado de Resultados, Balance General y Flujo de Caja.

**Archivos a crear:**
- `src/tools/income-statement.ts` — Estado de Resultados (ingresos, costos, margen, resultado neto, EBITDA)
- `src/tools/balance-sheet.ts` — Balance General (activos, pasivos, patrimonio, ratios de liquidez y solvencia)
- `src/tools/cash-flow.ts` — Flujo de Efectivo (operativo, inversión, financiamiento, variación neta)

**Tests:**
- `tests/tools/income-statement.test.ts` — Verificar que recibe parámetros válidos (period, type), validación Zod rechaza parámetros inválidos, llama correctamente al API Gateway, devuelve estructura con revenue/cogs/grossMargin/netIncome/ebitda
- `tests/tools/balance-sheet.test.ts` — Verificar estructura de respuesta (totalAssets, totalLiabilities, equity, ratios), que los ratios se calculan correctamente, que activo = pasivo + patrimonio
- `tests/tools/cash-flow.test.ts` — Verificar desglose en 3 flujos (operating, investing, financing), que netVariation = operating + investing + financing, validación de parámetros

**Files to create:**
- src/tools/income-statement.ts
- src/tools/balance-sheet.ts
- src/tools/cash-flow.ts
- tests/tools/income-statement.test.ts
- tests/tools/balance-sheet.test.ts
- tests/tools/cash-flow.test.ts

## Fase 3: Tools Avanzadas — Análisis Financiero
**Domain:** backend
**Duración estimada:** 3 días

**Objetivo:** Implementar herramientas de análisis más específicas: antigüedad de saldos, presupuesto vs real, KPIs, desglose de ingresos, costos, impuestos y nómina.

**Archivos a crear:**
- `src/tools/aging-report.ts` — Antigüedad de cuentas por cobrar/pagar con buckets (0-30, 31-60, 61-90, 90+)
- `src/tools/budget-vs-actual.ts` — Comparación presupuesto vs real con % de desviación y status
- `src/tools/kpi-dashboard.ts` — Ratios financieros: margen bruto, EBITDA, ROI, capital de trabajo, liquidez, endeudamiento
- `src/tools/revenue-breakdown.ts` — Ingresos desglosados por producto/región/canal con crecimiento
- `src/tools/cost-analysis.ts` — Costos y gastos por categoría vs presupuesto
- `src/tools/tax-summary.ts` — Resumen impositivo configurable por país (IVA, Renta, ICA, Retenciones)
- `src/tools/payroll-summary.ts` — Resumen de nómina: bruto, neto, headcount, deducciones

**Tests:**
- `tests/tools/aging-report.test.ts` — Verificar buckets de antigüedad (0-30, 31-60, 61-90, 90+), que suma de buckets = total, que cada bucket tiene amount/percentage/count
- `tests/tools/budget-vs-actual.test.ts` — Verificar cálculo de variance y variancePercentage, status correcto según desviación (on_track < 5%, at_risk 5-15%, over_budget > 15%)
- `tests/tools/kpi-dashboard.test.ts` — Verificar cálculos de ratios: grossMargin, ebitdaMargin, currentRatio, debtRatio, que los valores son consistentes
- `tests/tools/revenue-breakdown.test.ts` — Verificar desglose por categoría con amount/percentage/growth, que suma de breakdown = total
- `tests/tools/cost-analysis.test.ts` — Verificar categorías de costos, comparación vs budget
- `tests/tools/tax-summary.test.ts` — Verificar que el país determina los impuestos calculados, estructura con accrued/paid/pending/dueDate
- `tests/tools/payroll-summary.test.ts` — Verificar totalGross, totalNet, headcount, avgSalary

**Files to create:**
- src/tools/aging-report.ts
- src/tools/budget-vs-actual.ts
- src/tools/kpi-dashboard.ts
- src/tools/revenue-breakdown.ts
- src/tools/cost-analysis.ts
- src/tools/tax-summary.ts
- src/tools/payroll-summary.ts
- tests/tools/aging-report.test.ts
- tests/tools/budget-vs-actual.test.ts
- tests/tools/kpi-dashboard.test.ts
- tests/tools/revenue-breakdown.test.ts
- tests/tools/cost-analysis.test.ts
- tests/tools/tax-summary.test.ts
- tests/tools/payroll-summary.test.ts

## Fase 4: Motor de Reportes
**Domain:** backend
**Duración estimada:** 3 días

**Objetivo:** Crear el sistema que toma datos de las tools, los combina en informes markdown y los exporta a PDF y XLSX.

**Archivos a crear:**
- `src/reports/report-engine.ts` — Orquestador: llama tools → inyecta template → exporta
- `src/reports/templates/balance.md` — Template de Balance General en markdown
- `src/reports/templates/income-statement.md` — Template de Estado de Resultados
- `src/reports/templates/cash-flow.md` — Template de Flujo de Caja
- `src/reports/templates/kpi-dashboard.md` — Template de KPIs
- `src/reports/templates/custom/` — Carpeta para templates del cliente
- `src/reports/exporters/pdf-export.ts` — Conversor markdown → PDF
- `src/reports/exporters/xlsx-export.ts` — Conversor datos → XLSX

**Tests:**
- `tests/reports/report-engine.test.ts` — Verificar que el engine llama a las tools correctas según el template, inyecta datos en el template markdown, falla si falta una tool requerida
- `tests/reports/exporters/pdf-export.test.ts` — Verificar que convierte markdown a PDF, que el PDF generado no está vacío, que maneja errores de conversión
- `tests/reports/exporters/xlsx-export.test.ts` — Verificar que genera XLSX con las columnas correctas, que los datos numéricos se escriben como números no como texto

**Files to create:**
- src/reports/report-engine.ts
- src/reports/templates/balance.md
- src/reports/templates/income-statement.md
- src/reports/templates/cash-flow.md
- src/reports/templates/kpi-dashboard.md
- src/reports/templates/custom/.gitkeep
- src/reports/exporters/pdf-export.ts
- src/reports/exporters/xlsx-export.ts
- tests/reports/report-engine.test.ts
- tests/reports/exporters/pdf-export.test.ts
- tests/reports/exporters/xlsx-export.test.ts

## Fase 5: MCP Bridge — Integración con Sistemas Externos
**Domain:** backend
**Duración estimada:** 3 días

**Objetivo:** Implementar el puente que descubre y registra tools desde servidores MCP externos (ERPs, sistemas contables, fiscales).

**Archivos a crear:**
- `src/core/mcp-bridge.ts` — Cliente MCP que descubre tools via `tools/list` y las registra en el Tool Registry

**Tests:**
- `tests/core/mcp-bridge.test.ts` — Verificar que descubre tools vía MCP list, registra tools con prefijo `{server_name}__{tool_name}`, maneja error si el servidor MCP no responde, maneja servidor con 0 tools, registra tools con schema Zod correcto

**Files to create:**
- src/core/mcp-bridge.ts
- tests/core/mcp-bridge.test.ts

## Fase 6: Sistema de Configuración Multi-Empresa
**Domain:** backend
**Duración estimada:** 2 días

**Objetivo:** Implementar el sistema de carga de configuración por empresa, validación de schema, inyección de secrets y loader del vault.

**Archivos a crear:**
- `src/config/schema.ts` — Schema Zod completo de config.yaml
- `src/config/loader.ts` — Carga config.yaml + env vars + vault path
- `src/api-gateway/client.ts` — Cliente HTTP para la API Gateway de la empresa

**Tests:**
- `tests/config/schema.test.ts` — Verificar validación completa de config.yaml, que rechaza config sin country, que rechaza tools.enabled con tools que no existen, que acepta config con todos los campos opcionales, que valida correctamente mcp_servers
- `tests/config/loader.test.ts` — Verificar que carga config.yaml correctamente, que resuelve variables {{VAR}} desde env, que lanza error si falta un secret requerido
- `tests/api-gateway/client.test.ts` — Verificar que construye URLs correctamente, que incluye apiKey en headers, que maneja errores HTTP (4xx, 5xx), que parsea respuesta JSON

**Files to create:**
- src/config/schema.ts
- src/config/loader.ts
- src/api-gateway/client.ts
- tests/config/schema.test.ts
- tests/config/loader.test.ts
- tests/api-gateway/client.test.ts

## Fase 7: Integración con Scheduler Agent y Notifier Agent
**Domain:** backend
**Duración estimada:** 2 días

**Objetivo:** Implementar la integración del finance-agent con el scheduler-agent y el notifier-agent del ecosistema BackendKit.

**Integración:**
- El finance-agent no implementa scheduler propio. Llama al `scheduler-agent` del ecosistema mediante sus tools MCP (`mcp__scheduler__schedule_task`, etc.)
- El finance-agent no implementa notificaciones propias. Llama al `notifier-agent` del ecosistema mediante sus tools MCP (`mcp__notifier__notify_user`, etc.)
- Se definen flujos de trabajo en el orquestador

**Tests:**
- `tests/integration/scheduler-integration.test.ts` — Verificar que schedule_task se llama con los parámetros correctos (cron, workflow, workflowInput), que list_scheduled devuelve las tareas programadas, que cancel_task funciona
- `tests/integration/notifier-integration.test.ts` — Verificar que notify_user recibe los parámetros correctos (userId, title, body, context), que send_notification con múltiples destinatarios funciona
- `tests/integration/report-workflow.test.ts` — Verificar flujo completo: programar reporte → scheduler ejecuta → generate-report → notifier envía

**Files to create:**
- tests/integration/scheduler-integration.test.ts
- tests/integration/notifier-integration.test.ts
- tests/integration/report-workflow.test.ts

## Fase 8: Vault Base — Conocimiento Colombia
**Domain:** backend
**Duración estimada:** 2 días

**Objetivo:** Curar el vault de conocimiento base con normativa colombiana (DIAN, Estatuto Tributario, NIIF), fórmulas financieras y templates de reportes.

**Archivos a crear (en el vault externo):**
- `~/.backendkit/vaults/finance-agent/base/formulas/ratios-financieros.md`
- `~/.backendkit/vaults/finance-agent/base/glossary.md`
- `~/.backendkit/vaults/finance-agent/normativas/colombia/estatuto-tributario.md`
- `~/.backendkit/vaults/finance-agent/normativas/colombia/iva.md`
- `~/.backendkit/vaults/finance-agent/normativas/colombia/retenciones.md`
- `~/.backendkit/vaults/finance-agent/normativas/colombia/niif.md`
- `~/.backendkit/vaults/finance-agent/normativas/colombia/dian-factura-electronica.md`

**Tests:**
- `tests/vault/vault-content.test.ts` — Verificar que los archivos del vault existen, que los markdown tienen frontmatter válido, que las fórmulas tienen estructura correcta (nombre, fórmula, ejemplo)
- `tests/vault/vault-search.test.ts` — Verificar que search_vault encuentra contenido relevante, que las búsquedas en normativas/colombia devuelven resultados

## Fase 9: Docker y Catálogo agent-cloud
**Domain:** infra
**Duración estimada:** 2 días

**Objetivo:** Crear la imagen Docker, configurar el CatalogEntry en agent-cloud para deploy automatizado con secrets por departamento.

**Archivos a crear:**
- `Dockerfile` — Imagen multi-stage: compilación TypeScript → alpine con solo dist/
- `.dockerignore`
- CatalogEntry para agent-cloud

**Tests:**
- Verificar que la imagen Docker compila sin errores
- Verificar que el CatalogEntry tiene todos los requiredSecrets documentados
- Verificar que los entry points funcionan dentro del contenedor

**Files to create:**
- Dockerfile
- .dockerignore
- catalog-entry.yaml (para agent-cloud)

## Fase 10: Dashboard Web (Opcional — v1.1)
**Domain:** frontend
**Duración estimada:** 5 días

**Objetivo:** Interfaz web para que el cliente configure su agente sin tocar YAML.

**Tecnología:** Next.js + Tailwind CSS

**Tests:** Tests de componentes con React Testing Library, tests de API mock, tests de integración.

**Nota:** Esta fase se puede posponer a v1.1. La configuración YAML funciona completo desde el día 1.
