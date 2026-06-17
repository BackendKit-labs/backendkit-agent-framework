#!/usr/bin/env node
/**
 * analytics-agent — defines measurement plans: KPIs, benchmarks, tracking setup,
 * dashboard specs, optimisation criteria, and ROI targets.
 *
 * Env: PORT (default 3315), AGENT_API_KEY (optional)
 */

import agentProtocol from '@backendkit-labs/agent-protocol';

const { AgentServer } = agentProtocol;

const PORT = parseInt(process.env.PORT ?? '3315', 10);

const server = new AgentServer({
    name:        'analytics-agent',
    version:     '0.1.0',
    description: 'Defines KPIs, measurement plans, tracking setup, dashboards, and ROI targets',
    port:        PORT,
    apiKey:      process.env.AGENT_API_KEY,
});

server.register({
    definition: {
        name:        'execute',
        description: 'Build a complete measurement and analytics plan for a campaign',
        async:       false,
        input:  { task: 'string', flow_input: 'object?', prior_results: 'array?' },
        output: 'string (markdown analytics and measurement plan)',
    },
    async execute(input) {
        const fi           = input.flow_input ?? {};
        const priorResults = input.prior_results ?? [];
        const servicio     = String(fi.servicio    ?? fi.service   ?? 'Marketing Digital B2B');
        const presupuesto  = String(fi.presupuesto ?? fi.budget    ?? '€5.000');
        const duracion     = String(fi.duracion    ?? fi.duration  ?? '3 meses');

        const strategyResult = priorResults.find(r => r.step === 's1-estrategia' || r.agent === 'campaign-agent');
        const copyResult     = priorResults.find(r => r.step === 's2-copies'     || r.agent === 'copywriter');
        const seoResult      = priorResults.find(r => r.step === 's3-seo-contenido' || r.agent === 'seo-agent');

        const priorCount = [strategyResult, copyResult, seoResult].filter(Boolean).length;
        const priorNote  = priorCount > 0
            ? `\n> *Plan de medición construido a partir de: ${[
                strategyResult && 'estrategia de campaña (campaign-agent)',
                copyResult     && 'copies (copywriter)',
                seoResult      && 'análisis SEO (seo-agent)',
              ].filter(Boolean).join(', ')}*\n`
            : '';

        const budgetNum  = parseInt(presupuesto.replace(/[^0-9]/g, ''), 10) || 5000;
        const leadsTarget = Math.max(20, Math.round(budgetNum / 90));
        const cplMax     = Math.round(budgetNum / leadsTarget);
        const cplTarget  = Math.round(cplMax * 0.85);

        const ticketMedio  = budgetNum * 4;
        const tasaCierre   = 0.22;
        const ltv          = ticketMedio * 2.5;
        const cacMax       = Math.round(ltv / 3);
        const cplRentable  = Math.round(cacMax / (leadsTarget * tasaCierre / leadsTarget * 4));

        const now = new Date().toISOString().slice(0, 10);

        return `# Plan de Medición: ${servicio}

**Fecha:** ${now}
**Agente:** analytics-agent
**Campaña:** ${duracion} · Presupuesto: ${presupuesto}${priorNote}

---

## 1. KPIs Primarios (máximo 3, vinculados al negocio)

| KPI | Objetivo | Por qué importa |
|-----|---------|-----------------|
| **Leads Cualificados (ICP fit)** | ${leadsTarget} en ${duracion} | Métrica de output directamente vinculada al pipeline |
| **CPL (Coste por Lead Cualificado)** | ≤€${cplTarget} | Eficiencia de la inversión; si supera €${cplMax}, la campaña no es rentable |
| **Pipeline Atribuible a Marketing** | ≥€${Math.round(leadsTarget * tasaCierre * ticketMedio)} | El ROI real — conecta el gasto con el revenue potencial |

---

## 2. KPIs Secundarios por Canal

### LinkedIn Ads
| Métrica | Objetivo | Umbral de alarma |
|---------|---------|-----------------|
| CTR | >0.8% | <0.4% → revisar creativo |
| CPC | <€4.50 | >€7 → pausar anuncio |
| CPL en plataforma | <€${Math.round(cplMax * 0.8)} | >€${cplMax} → revisar segmentación |
| Tasa de conversión landing | >25% | <15% → revisar página |
| Frequency | <3.5/usuario | >4.5 → ampliar audiencia o rotar creativos |

### Content Marketing / SEO
| Métrica | Objetivo | Umbral de alarma |
|---------|---------|-----------------|
| Visitas orgánicas al artículo ancla | >1.000/mes (mes 3) | — |
| Tiempo en página | >3:30 min | <2 min → revisar contenido |
| Scroll depth | >65% | <40% → optimizar estructura |
| Leads desde orgánico | >8% del total | — |

### Email Marketing
| Métrica | Objetivo | Umbral de alarma |
|---------|---------|-----------------|
| Tasa de apertura | >38% | <25% → revisar subject lines |
| CTR | >5.5% | <3% → revisar CTA y cuerpo |
| Tasa de conversión (email → reunión) | >2% | <1% → revisar propuesta de email 4 |
| Tasa de baja | <0.3% | >0.8% → revisar frecuencia y relevancia |

---

## 3. Benchmarks de Referencia (sector B2B, ${new Date().getFullYear()})

| Métrica | Malo | Aceptable | Bueno | Excelente |
|---------|------|-----------|-------|-----------|
| CTR LinkedIn Ads | <0.35% | 0.35-0.8% | 0.8-1.5% | >1.5% |
| CPL LinkedIn | >€200 | €120-200 | €80-120 | <€80 |
| Conv. landing B2B | <10% | 10-20% | 20-30% | >30% |
| Apertura email | <20% | 20-30% | 30-45% | >45% |
| MQL→SQL | <15% | 15-25% | 25-40% | >40% |
| Ciclo de ventas | >120d | 90-120d | 60-90d | <60d |

---

## 4. Plan de Tracking

### GA4 — Eventos a Configurar

\`\`\`javascript
// Conversiones principales (marcar como "conversion" en GA4)
gtag('event', 'lead_capture', {
  form_name: 'landing_guia_campana',
  lead_source: utm_source,      // pasar via dataLayer
  lead_medium: utm_medium,
});

gtag('event', 'meeting_booked', {
  meeting_type: 'diagnostico_gratuito',
  lead_source: utm_source,
});

// Micro-conversiones (para optimización)
gtag('event', 'cta_click',        { cta_text: 'descargar_guia' });
gtag('event', 'scroll_depth',     { percent: 75 });          // artículo ancla
gtag('event', 'email_sequence',   { step: 'email_4_clic' }); // via webhook CRM
\`\`\`

### LinkedIn Insight Tag
- Instalar en todas las páginas del sitio
- Crear audiencia de retargeting: visitantes de la landing (ventana: 90 días)
- Conversión: "Formulario completado" (evento de GA4 → LinkedIn via CAPI)

### UTM Structure (consistente en toda la campaña)

\`\`\`
utm_source   = linkedin | google | email | organic
utm_medium   = paid_social | cpc | email | organic
utm_campaign = campana-${servicio.toLowerCase().replace(/\s+/g, '-').slice(0, 20)}-${now.slice(0, 7)}
utm_content  = [creativo-a | creativo-b | email-1 | email-4]
utm_term     = [keyword si aplica]
\`\`\`

---

## 5. Dashboard Semanal (Looker Studio / Metabase)

**Vista ejecutiva (5 KPIs en portada):**
- Leads acumulados vs objetivo (gauge)
- CPL real vs objetivo (gauge)
- Pipeline atribuible a marketing (€)
- Presupuesto gastado vs disponible (%)
- MQLs → SQLs esta semana (número)

**Vista operativa (para el equipo):**
- Tabla de anuncios: impresiones, CTR, CPC, CPL, leads — ordenada por CPL
- Embudo de conversión: clics → leads → MQLs → SQLs (funnel visual)
- Performance de emails: apertura, CTR, conversión por email en la secuencia
- Fuentes de leads: breakdown por canal (LinkedIn, orgánico, email, referido)
- Tendencia semanal de CPL (línea + objetivo)

---

## 6. Criterios de Optimización

### Cuándo PAUSAR un anuncio
- CTR < 0.35% después de 500 impresiones
- CPL > €${Math.round(cplMax * 1.3)} en las primeras 2 semanas
- Frequency > 4.5 sin refresco de creativo

### Cuándo ESCALAR un anuncio
- CTR > 1.2% con >1.000 impresiones
- CPL < €${Math.round(cplTarget * 0.85)}
- Leads generados con tasa MQL > 40%
- → Acción: duplicar presupuesto cada 7 días hasta encontrar el punto de inflexión

### Cuándo REVISAR la landing page
- Tasa de conversión < 15% con tráfico > 300 visitas
- → A/B test de headline + CTA (herramienta: Google Optimize / VWO)

---

## 7. ROI Target — CPL Máximo Aceptable

**Supuestos del modelo:**
| Variable | Valor |
|---------|-------|
| Ticket medio del servicio | €${ticketMedio.toLocaleString()} |
| LTV estimado (2.5 contratos) | €${ltv.toLocaleString()} |
| Tasa de cierre histórica | ${Math.round(tasaCierre * 100)}% |
| CAC máximo aceptable (1/3 del LTV) | €${cacMax.toLocaleString()} |

**Cálculo:**
\`\`\`
CPL_rentable = CAC_max × tasa_cierre
             = €${cacMax} × ${Math.round(tasaCierre * 100)}%
             = €${Math.round(cacMax * tasaCierre)}

→ CPL máximo aceptable: €${Math.round(cacMax * tasaCierre)}
→ CPL objetivo de campaña: €${cplTarget} (margen de seguridad del 15%)
\`\`\`

**Conclusión:** Con un CPL ≤ €${cplTarget}, la campaña genera un ROI positivo incluso con la tasa de cierre más conservadora del sector (${Math.round(tasaCierre * 100)}%).

---

> *Plan de medición generado automáticamente — revisar con el equipo antes de activar el tracking de producción.*
`;
    },
});

await server.start();
process.stderr.write(`[analytics-agent] ready on :${PORT}\n`);
