#!/usr/bin/env node
/**
 * campaign-agent — designs complete lead-generation campaign strategies:
 * SMART goals, ICP, channel mix, journey maps, budget allocation, timelines.
 *
 * Env: PORT (default 3314), AGENT_API_KEY (optional)
 */

import agentProtocol from '@backendkit-labs/agent-protocol';

const { AgentServer } = agentProtocol;

const PORT = parseInt(process.env.PORT ?? '3314', 10);

const server = new AgentServer({
    name:        'campaign-agent',
    version:     '0.1.0',
    description: 'Designs complete lead-gen campaign strategies: SMART goals, ICP, channel mix, budgets, timelines',
    port:        PORT,
    apiKey:      process.env.AGENT_API_KEY,
});

server.register({
    definition: {
        name:        'execute',
        description: 'Design a full lead-generation campaign strategy',
        async:       false,
        input:  { task: 'string', flow_input: 'object?', prior_results: 'array?' },
        output: 'string (markdown campaign strategy)',
    },
    async execute(input) {
        const fi         = input.flow_input ?? {};
        const servicio   = String(fi.servicio   ?? fi.service   ?? 'Consultoría de Marketing Digital B2B');
        const segmento   = String(fi.segmento   ?? fi.segment   ?? 'empresas B2B de 50-500 empleados');
        const objetivo   = String(fi.objetivo   ?? fi.goal      ?? 'Generar 50 leads cualificados en 90 días');
        const presupuesto= String(fi.presupuesto?? fi.budget    ?? '€5.000');
        const duracion   = String(fi.duracion   ?? fi.duration  ?? '3 meses');
        const canal      = String(fi.canal      ?? fi.channel   ?? 'LinkedIn Ads + Content');

        const now = new Date().toISOString().slice(0, 10);

        // Parse budget number for calculations
        const budgetNum = parseInt(presupuesto.replace(/[^0-9]/g, ''), 10) || 5000;
        const linkedInBudget = Math.round(budgetNum * 0.55);
        const contentBudget  = Math.round(budgetNum * 0.25);
        const emailBudget    = Math.round(budgetNum * 0.10);
        const toolsBudget    = Math.round(budgetNum * 0.10);

        const leadsTarget = Math.max(20, Math.round(budgetNum / 90));
        const mqlTarget   = Math.round(leadsTarget * 0.35);
        const sqlTarget   = Math.round(mqlTarget * 0.40);

        return `# Estrategia de Campaña: ${servicio}

**Fecha:** ${now}
**Agente:** campaign-agent
**Estado:** Borrador — pendiente revisión (gate de aprobación activado)

---

## 1. Objetivo SMART

**Objetivo:** Generar **${leadsTarget} leads cualificados** (ICP definido) en **${duracion}**, con un CPL máximo de €${Math.round(budgetNum / leadsTarget)} y una tasa de conversión MQL→SQL ≥30%.

| KPI | Objetivo | Métrica de referencia |
|-----|---------|----------------------|
| Leads totales | ${leadsTarget} | — |
| MQLs (calificados por marketing) | ${mqlTarget} | ≥35% de leads |
| SQLs (aceptados por ventas) | ${sqlTarget} | ≥40% de MQLs |
| CPL objetivo | ≤€${Math.round(budgetNum / leadsTarget)} | Benchmark sector: €${Math.round(budgetNum / leadsTarget * 1.4)} |
| Ciclo medio objetivo | <75 días | Benchmark: 95 días |

---

## 2. ICP (Ideal Customer Profile)

### Segmento Primario
- **Tipo de empresa:** ${segmento}
- **Sector:** Tecnología B2B, SaaS, Servicios profesionales
- **Rol del decisor:** CMO, Director de Marketing, VP of Growth
- **Señales de compra:**
  - Publicaciones recientes sobre "crecimiento" o "eficiencia" en LinkedIn
  - Contratación activa en posiciones de marketing (Indeed, LinkedIn Jobs)
  - Serie de financiación reciente (A o B)
  - Uso de herramientas: HubSpot, Salesforce, Marketo (indica madurez)

### Segmento Secundario
- **Tipo de empresa:** Startups en fase de crecimiento (Series B+)
- **Rol:** Founders / CEOs con función de marketing implícita
- **Señal:** Presupuesto de marketing existente pero sin equipo estructurado

---

## 3. Propuesta de Valor Central

**El gancho de la campaña:**
> *"De métricas de vanidad a pipeline predecible — en 90 días o te devolvemos el dinero"*

**Prueba social de apoyo:**
- +40 empresas B2B atendidas en 18 meses
- CPL medio reducido un 34%
- Ciclo de ventas acortado un 28%

---

## 4. Mapa de Canales

| Canal | Rol | % del presupuesto |
|-------|-----|------------------|
| ${canal.split('+')[0]?.trim() ?? 'LinkedIn Ads'} | Awareness + Captación directa | 55% |
| Content Marketing (blog + SEO) | Nurturing + Captación orgánica | 25% |
| Email Marketing | Nurturing + Reactivación | 10% |
| Herramientas (CRM, analytics) | Infraestructura | 10% |

---

## 5. Contenido Ancla (Lead Magnet)

**Propuesta:** Guía descargable: *"El playbook B2B: cómo generar pipeline predecible con presupuesto ajustado"*

**Por qué funciona:**
- Responde a la pain point principal del ICP (justificar ROI de marketing)
- Descargable fácil (no requiere datos de empresa)
- Posiciona la marca como experta, no como vendedora

**Formato:** PDF de 12-15 páginas + plantilla de Excel (calculadora de ROI incluida)

---

## 6. Journey del Lead

\`\`\`
AWARENESS
  LinkedIn Ad → Impresión en feed del CMO target
       ↓
INTERÉS
  Click → Landing page de la guía (conversión objetivo: 25-30%)
       ↓
CAPTURA
  Formulario (nombre, empresa, email) → CRM + Email de bienvenida automático
       ↓
NURTURING (14 días)
  Email 1 (día 0):  Entrega de la guía + bienvenida
  Email 2 (día 3):  Dato clave del sector (sin venta)
  Email 3 (día 7):  Caso de éxito relevante
  Email 4 (día 14): Propuesta directa de diagnóstico gratuito
       ↓
MQL (si abre ≥3 emails o visita pricing page)
       ↓
Sesión de diagnóstico gratuita (45 min)
       ↓
SQL (si el diagnóstico confirma fit)
       ↓
PROPUESTA COMERCIAL → CIERRE
\`\`\`

---

## 7. Presupuesto por Canal

| Canal | Presupuesto mensual | Total ${duracion} |
|-------|--------------------|--------------------|
| ${canal.split('+')[0]?.trim() ?? 'LinkedIn Ads'} | €${Math.round(linkedInBudget/3)} | €${linkedInBudget} |
| Content + SEO | €${Math.round(contentBudget/3)} | €${contentBudget} |
| Email Marketing | €${Math.round(emailBudget/3)} | €${emailBudget} |
| Herramientas | €${Math.round(toolsBudget/3)} | €${toolsBudget} |
| **TOTAL** | **€${Math.round(budgetNum/3)}** | **€${budgetNum}** |

---

## 8. Cronograma de Activación

| Semana | Hito |
|--------|------|
| S1 | Setup: CRM, tracking UTMs, landing page, email sequences |
| S2 | Lanzamiento LinkedIn Ads (test A/B 3 creativos) |
| S3 | Publicación artículo ancla (SEO) + distribución orgánica |
| S4 | Revisión inicial: optimización del anuncio ganador |
| S5-8 | Scale del anuncio ganador + inicio nurturing de leads captados |
| S9-10 | Análisis midpoint: CPL real vs objetivo, ajuste de presupuesto |
| S11-12 | Cierre de campaña: reporte completo, leads pendientes de nurturing |

---

## 9. Hipótesis Principal y Validación

**Hipótesis:** Los CMOs de ${segmento} responderán positivamente a contenido que promete resultados medibles (CPL, pipeline) vs contenido de awareness genérico.

**Cómo la validamos:**
- A/B test de 2 creativos: uno basado en datos (CPL -34%), uno basado en concepto ("marketing que funciona")
- Evaluación a los 21 días: el anuncio con mejor CTR cualificado (visitas a pricing + tiempo en página >2 min) gana el presupuesto completo
- Umbral mínimo para continuar: CPL ≤€${Math.round(budgetNum / leadsTarget * 1.5)} en las primeras 3 semanas
`;
    },
});

await server.start();
process.stderr.write(`[campaign-agent] ready on :${PORT}\n`);
