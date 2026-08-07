# Finance Agent — Specification

## 1. Propósito

Agente de inteligencia artificial especializado en **finanzas corporativas internas** (CFO Virtual). Responde consultas financieras, genera reportes ejecutivos y analiza la situación económica de una empresa, **sin acceso directo a bases de datos**. Todo el acceso a datos se realiza mediante herramientas intermediarias (tools) que se conectan a una API Gateway o a servidores MCP externos. Consulta su vault de conocimiento para fundamentar sus respuestas con el contexto específico de la empresa y el país, y se integra con el ecosistema BackendKit (scheduler-agent, notifier-agent) para programar actividades y enviar notificaciones.

## 2. Alcance

### 2.1 Qué HACE el agente

**Conocimiento y contexto:**
- Lee su vault de conocimiento — normativas del país (DIAN, AFIP, IRS, etc.), políticas internas de la empresa, fórmulas financieras, historial de decisiones, templates de reportes
- Usa el vault como fuente primaria de contexto antes de responder cualquier consulta

**Consultas financieras:**
- Responde preguntas sobre estados financieros (Balance, PyG, Flujo de Caja) consultando la API Gateway o MCP servers externos
- Consulta cuentas por cobrar/pagar y antigüedad de saldos
- Compara presupuesto vs real y alerta desviaciones
- Calcula y explica KPIs financieros (margen, EBITDA, liquidez, endeudamiento)
- Desglosa ingresos por producto/región/canal
- Analiza costos y gastos por categoría
- Resume situación impositiva (IVA, Renta, ICA, etc.) basándose en la normativa del país en su vault
- Consulta resumen de nómina

**Reportes:**
- Genera informes en Markdown, PDF y XLSX usando templates del vault (base + custom de la empresa)
- Permite templates personalizables por empresa

**Integración con el ecosistema BackendKit:**
- Se integra con el **scheduler-agent** para programar reportes periódicos (cierre mensual, informe semanal, alertas programadas)
- Se integra con el **notifier-agent** para enviar reportes y alertas por email, Slack, Telegram u otros canales configurados
- No reinventa el scheduling ni las notificaciones — usa los agentes del ecosistema

**Conexiones externas:**
- Se conecta a sistemas externos vía MCP Bridge (ERPs, contabilidad, DIAN, AFIP, SIAT, etc.)
- Descubre automáticamente las tools que ofrece cada MCP server externo

**Aprendizaje:**
- Aprende de cada interacción: guarda decisiones y patrones en su memoria para mejorar respuestas futuras

### 2.2 Qué NO HACE el agente

- ❌ No ejecuta SQL directo contra ninguna base de datos
- ❌ No modifica registros contables sin gate humano
- ❌ No aprueba pagos ni transferencias sin autorización
- ❌ No elimina datos financieros
- ❌ No hace trading ni recomendaciones de inversión en bolsa
- ❌ No accede a datos de una empresa distinta a la que lo tiene deployado
- ❌ No implementa su propio scheduler ni su propio sistema de notificaciones

## 3. Fuentes de Datos

El agente obtiene datos exclusivamente a través de:

1. **Vault RAG** — Conocimiento curado: normativas del país, políticas internas de la empresa, fórmulas financieras, historial de decisiones, templates de reportes. Es la PRIMERA fuente que consulta para contextualizar cualquier respuesta.
2. **API Gateway** — Capa REST intermedia que encapsula la base de datos corporativa (estados financieros, cuentas, facturas, nómina, etc.)
3. **MCP Servers externos** — Sistemas financieros ya existentes (Contpaqi, SAP, QuickBooks, DIAN, AFIP, SIAT, etc.)
4. **Scheduler Agent** — Para programación de tareas periódicas y reportes diferidos
5. **Notifier Agent** — Para envío de reportes y alertas por múltiples canales

Ninguna tool accede directamente a la base de datos.

## 4. Personalización por Empresa

Cada empresa despliega su propia instancia del agente con:

- **Vault propio:** normativas de su país, políticas internas, fórmulas, historial, templates custom
- **Configuración propia:** tools habilitadas, país, umbrales, gates
- **Secrets propios:** credenciales de BD, API keys fiscales
- **Modelo LLM propio:** cada empresa elige su proveedor y modelo
- **MCP servers propios:** conexión a sus sistemas existentes (ERP, contabilidad, etc.)
- **Canales de notificación propios:** email, Slack, Telegram, etc. configurados en el notifier-agent
- **Reportes programados propios:** qué informes, con qué frecuencia, a quién enviarlos

## 5. Usuarios Target

| Perfil | Casos de uso |
|---|---|
| CFO / Director Financiero | Dashboard ejecutivo, reportes, proyecciones, alertas automáticas |
| Contador | Cierres contables, balances, impuestos, reportes programados |
| Analista Financiero | KPIs, desviaciones, tendencias, informes periódicos |
| Tesorero | Flujo de caja, cuentas por pagar, liquidez, alertas de vencimiento |
| Auditor | Reportes históricos, trazabilidad, exportación de datos |

## 6. Criterios de Éxito

- Una empresa nueva se configura en < 30 minutos (subir config.yaml + vault + secrets)
- El agente consulta el vault como fuente primaria de contexto antes de responder
- Consultas respondidas en < 5 segundos (datos en caché o API rápida)
- Reportes generados en < 10 segundos (markdown + conversión a PDF/XLSX)
- Reportes programados se ejecutan automáticamente vía scheduler-agent sin intervención
- Notificaciones llegan por el canal configurado de cada empresa vía notifier-agent
- Sin falsos positivos en datos numéricos (precisión financiera)
- 100% de las consultas respondidas sin exponer SQL o acceso a BD
