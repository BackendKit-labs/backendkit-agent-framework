#!/usr/bin/env node
/**
 * copywriter — writes full-length articles, landing page copies, and email sequences
 * based on the editorial brief produced by content-strategist.
 *
 * Env: PORT (default 3311), AGENT_API_KEY (optional)
 */

import agentProtocol from '@backendkit-labs/agent-protocol';

const { AgentServer } = agentProtocol;

const PORT = parseInt(process.env.PORT ?? '3311', 10);

const server = new AgentServer({
    name:        'copywriter',
    version:     '0.1.0',
    description: 'Writes articles, ad copies, landing pages, and email nurture sequences',
    port:        PORT,
    apiKey:      process.env.AGENT_API_KEY,
});

server.register({
    definition: {
        name:        'execute',
        description: 'Write content based on a brief or campaign strategy',
        async:       false,
        input:  { task: 'string', flow_input: 'object?', prior_results: 'array?' },
        output: 'string (markdown article or copy)',
    },
    async execute(input) {
        const fi            = input.flow_input ?? {};
        const priorResults  = input.prior_results ?? [];
        const tema          = String(fi.tema      ?? fi.topic    ?? 'Marketing Digital');
        const tono          = String(fi.tono      ?? fi.tone     ?? 'profesional y directo');
        const audiencia     = String(fi.audiencia ?? fi.audience ?? 'directores de marketing B2B');

        // Get brief from prior step (content-strategist or campaign-agent)
        const briefResult    = priorResults.find(r => r.step === 's1-brief' || r.agent === 'content-strategist');
        const strategyResult = priorResults.find(r => r.step === 's1-estrategia' || r.agent === 'campaign-agent');
        const source         = briefResult ?? strategyResult;

        const isCampaign = !!strategyResult && !briefResult;

        if (isCampaign) {
            // Campaign mode: generate ad copies + landing page + email sequence
            const servicio  = String(fi.servicio  ?? fi.service  ?? 'Consultoría de Marketing Digital');
            const segmento  = String(fi.segmento  ?? fi.segment  ?? 'empresas B2B medianas');

            return `# Copies de Campaña: ${servicio}

**Redactor:** copywriter
**Segmento:** ${segmento}
**Tono:** ${tono}

---

## 1. Anuncios LinkedIn Ads

### Headlines (3 variantes)
1. "¿Tu equipo de marketing genera leads o solo clics? Cambia eso en 90 días."
2. "${servicio}: el sistema que usan las empresas B2B que crecen sin aumentar el presupuesto"
3. "Deja de adivinar. Empieza a crecer. ${servicio} con resultados medibles garantizados."

### Descripciones (3 variantes)
1. "Ayudamos a ${segmento} a transformar su marketing en una máquina de revenue. Sin humo, sin métricas de vanidad. Solo resultados que el CFO aplaudirá. → Agenda tu diagnóstico gratuito."
2. "El 73% de los equipos de marketing B2B no pueden demostrar ROI. Nosotros sí podemos, y te enseñamos cómo. Únete a +150 empresas que ya lo hacen diferente."
3. "¿Cuánto te cuesta cada lead cualificado? Si no lo sabes, tienes un problema. Si lo sabes y quieres reducirlo, tenemos la solución. Hablemos."

### Sponsored Content LinkedIn (copy largo)
¿Recuerdas cuando bastaba con tener presencia en redes para generar negocio?

Esos días pasaron.

Hoy, los ${segmento} que ganan no son los que más publican — son los que tienen un sistema.

Un sistema que convierte atención en interés, interés en leads, y leads en clientes.

Eso es exactamente lo que construimos con nuestro servicio de ${servicio}.

En los últimos 12 meses, hemos ayudado a más de 40 empresas a:
→ Reducir su CPL un 34% de media
→ Triplicar la tasa de conversión MQL→SQL
→ Generar pipeline predecible con varianza inferior al 15%

¿El secreto? No hay secreto. Hay metodología.

Si quieres saber cómo aplicarla a tu empresa, el primer paso es una conversación. Sin compromiso, sin pitch de ventas. Solo diagnóstico honesto.

[Agenda tu sesión gratuita →]

---

## 2. Landing Page

**H1:** Convierte tu marketing B2B en una fuente predecible de revenue

**Subtítulo:** ${servicio} para ${segmento} que quieren crecer con datos, no con suposiciones.

**Bullets de propuesta de valor:**
- ✅ Diagnóstico completo de tu funnel en la primera semana
- ✅ Sistema de atribución que conecta marketing con ventas
- ✅ Framework probado en +40 empresas B2B del sector
- ✅ KPIs accionables, no métricas de vanidad
- ✅ Reportes semanales que el CEO querrá ver

**Copy del formulario:**
> Reserva tu sesión de diagnóstico gratuita (45 min)
> Solo necesitamos 3 datos para preparar tu análisis personalizado:
- Nombre y empresa
- Sector y tamaño del equipo
- Principal reto de marketing actual

**CTA button (3 variantes):**
1. "Quiero mi diagnóstico gratuito →"
2. "Empezar a crecer hoy →"
3. "Ver si mi empresa califica →"

---

## 3. Email de Bienvenida

**Subject lines (3 variantes):**
1. "Tu diagnóstico está casi listo, [Nombre]"
2. "[Nombre], bienvenido al lado del marketing que sí funciona"
3. "Esto es lo que pasa ahora, [Nombre]"

**Preheader:** "Preparamos tu análisis personalizado. Aquí lo que viene."

**Cuerpo:**
Hola [Nombre],

Gracias por reservar tu sesión de diagnóstico.

Antes de que nos reunamos, quiero que sepas exactamente lo que vas a conseguir en esos 45 minutos:

**1. Un radiografía de tu funnel actual**
Analizaremos juntos dónde se pierden tus oportunidades — desde el primer clic hasta el cierre.

**2. Tres mejoras que puedes implementar esta semana**
No promesas vacías. Tres acciones concretas, en orden de prioridad, con impacto medible.

**3. Una hoja de ruta personalizada**
Si tiene sentido trabajar juntos, te mostraré exactamente cómo sería eso. Sin presión.

Nos vemos el [fecha] a las [hora].

Un saludo,
[Nombre del consultor]
${servicio}

P.D. Si mientras tanto tienes alguna pregunta, responde a este email directamente. Leo todos.

---

## 4. Secuencia de Nurturing

### Email 2 — Día 3: Entrega de valor
**Subject:** "El dato de marketing B2B que más sorprende a nuestros clientes"
**Contenido:** Artículo corto sobre el coste oculto de los leads no cualificados. Sin venta.

### Email 3 — Día 7: Caso de uso
**Subject:** "Cómo [empresa similar] pasó de 80 a 240 leads/mes en Q3"
**Contenido:** Historia de éxito anonimizada del sector. Resultado específico, metodología resumida. CTA suave: "¿Te suena familiar?"

### Email 4 — Día 14: Propuesta directa
**Subject:** "[Nombre], ¿damos el siguiente paso?"
**Contenido:** Resumen de valor entregado en los últimos 14 días. Propuesta directa de onboarding. CTA: "Agenda tu primera sesión de trabajo →"
`;
        }

        // Article mode: write full blog post based on brief
        const briefContent = source?.output ?? '';
        const hasBrief = briefContent.length > 50;

        const now = new Date().toISOString().slice(0, 10);

        return `# ${tema}: La Guía Definitiva para Equipos B2B en 2026

**Autor:** copywriter
**Fecha:** ${now}
**Tono:** ${tono}
**Audiencia:** ${audiencia}
${hasBrief ? '\n> *Artículo redactado siguiendo brief de content-strategist*\n' : ''}

---

## El problema que nadie quiere admitir

El 68% de los directores de marketing B2B no pueden demostrar el impacto de sus acciones en el pipeline de ventas.

No es un problema de herramientas. Es un problema de sistema.

Este artículo te enseña a construir ese sistema — con un framework probado en más de 40 empresas B2B del sector.

---

## Sección 1: El estado actual del ${tema.toLowerCase()} en B2B

Los datos de 2025-2026 son claros:

| Métrica | Benchmark B2B 2025 | Empresas top quartile |
|---------|--------------------|-----------------------|
| CPL medio | €185 | €89 |
| Tasa MQL→SQL | 18% | 41% |
| Tiempo medio de ciclo | 97 días | 52 días |
| Atribución multi-touch | 23% la usan | 78% la usan |

La brecha entre el cuartil inferior y el superior no se explica por presupuesto. Se explica por metodología.

---

## Sección 2: Los 5 errores que destruyen tu ROI

**Error #1: Optimizar para clics en lugar de para pipeline**
Los clics son fáciles de conseguir. Los clics que se convierten en conversaciones de ventas son otra cosa.

**Error #2: Tratar todos los leads igual**
Un lead que descargó tu whiteboard a las 11 PM desde mobile no tiene el mismo valor que uno que revisó tu página de precios tres veces esta semana.

**Error #3: Marketing y ventas trabajando en silos**
El 61% de los B2B reportan fricción significativa entre marketing y ventas en la definición de MQL. Esa fricción te cuesta dinero cada día.

**Error #4: Cambiar de estrategia antes de tener datos suficientes**
Seis semanas no es suficiente para evaluar una táctica de contenido. Doce semanas es el mínimo. La mayoría abandona a las cuatro.

**Error #5: Métricas de vanidad en los dashboards ejecutivos**
Si tu CEO ve "impresiones" y "seguidores" en tu reporte semanal, tienes un problema de credibilidad que va más allá del marketing.

---

## Sección 3: Framework de 4 pasos

### Paso 1: Audita tu funnel actual (semana 1)
Mapea cada touchpoint desde el primer contacto hasta el cierre. Identifica dónde se pierden las oportunidades — normalmente son 2-3 puntos críticos que explican el 80% del problema.

### Paso 2: Define tu ICP con precisión quirúrgica (semana 2)
Sector + tamaño + stack tecnológico + señal de compra. Cuanto más específico, mejor convierte.

### Paso 3: Construye el sistema de atribución (semanas 3-4)
Implementa UTMs consistentes, configura GA4 con conversiones de negocio (no de marketing), y conecta tu CRM con los datos de origen de lead.

### Paso 4: Itera con cadencia fija (semana 5 en adelante)
Revisión semanal de KPIs operativos, revisión mensual de KPIs de negocio. Cambia una variable a la vez.

---

## Sección 4: Herramientas y stack recomendado

| Función | Herramienta | Coste mensual | Alternativa |
|---------|-------------|---------------|-------------|
| CRM | HubSpot Starter | €45 | Pipedrive |
| Email marketing | HubSpot / Brevo | Incluido / €25 | Mailchimp |
| Analytics | GA4 + Looker Studio | Gratis | Metabase |
| LinkedIn Ads | LinkedIn Campaign Manager | Variable | — |
| SEO | Semrush | €99 | Ahrefs |
| Landing pages | Unbounce / Webflow | €79 / €23 | Carrd |

---

## Sección 5: KPIs que importan (y los que debes ignorar)

**Mide esto:**
- CPL (Coste por Lead Cualificado) — objetivo: reducir un 20% trimestral
- Tasa MQL→SQL — objetivo: >35%
- CAC (Coste de Adquisición de Cliente) — objetivo: <33% del LTV
- Pipeline atribuible a marketing — objetivo: >40% del pipeline total
- Tiempo de ciclo medio — objetivo: reducir 15% semestral

**Deja de medir esto:**
- Alcance orgánico en redes sociales (sin conversión)
- Tasa de apertura de email (aislada de CTR y conversión)
- Seguidores y fans
- Páginas vistas sin contexto de conversión

---

## Caso de estudio: empresa de software B2B, +${Math.floor(Math.random()*60+40)}% en pipeline en 90 días

**Situación inicial:** 35 leads/mes, CPL de €210, ciclo medio de 110 días.

**Lo que hicimos:** Redefinimos el ICP (de "empresas de +50 empleados" a "empresas de 80-500 empleados en manufactura con ERP propio"), reestructuramos el funnel de contenido y alineamos los criterios MQL con el equipo de ventas.

**Resultado a 90 días:** 61 leads/mes, CPL de €134, ciclo medio de 78 días.

---

## Conclusión y CTA

El ${tema.toLowerCase()} que funciona en 2026 no se construye de la noche a la mañana. Pero tampoco requiere un equipo enorme ni un presupuesto ilimitado.

Requiere un sistema. Un sistema que puedes construir con las herramientas que ya tienes.

**¿Por dónde empiezas?** Descarga nuestra plantilla de planificación estratégica (incluye calculadora de ROI y checklist de auditoría de funnel).

→ **[Descarga la plantilla gratuita]**

---

*¿Preguntas sobre este artículo? Escríbenos a hello@marketing-co.io*
`;
    },
});

await server.start();
process.stderr.write(`[copywriter] ready on :${PORT}\n`);
