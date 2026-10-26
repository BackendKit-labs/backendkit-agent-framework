#!/usr/bin/env node
/**
 * social-media-agent — creates distribution plans for LinkedIn, X/Twitter, and Instagram
 * based on the SEO-optimised article from the content pipeline.
 *
 * Env: PORT (default 3313), AGENT_API_KEY (optional)
 */

import agentProtocol from '@backendkit-labs/agent-protocol';

const { AgentServer } = agentProtocol;

const PORT = parseInt(process.env.PORT ?? '3313', 10);

const server = new AgentServer({
    name:        'social-media-agent',
    version:     '0.1.0',
    description: 'Creates social media distribution plans: LinkedIn, Twitter/X, content calendars',
    port:        PORT,
    host:        process.env.HOST ?? '127.0.0.1',
    apiKey:      process.env.AGENT_API_KEY,
});

server.register({
    definition: {
        name:        'execute',
        description: 'Build a social media distribution plan for published content',
        async:       false,
        input:  { task: 'string', flow_input: 'object?', prior_results: 'array?' },
        output: 'string (markdown social media plan)',
    },
    async execute(input) {
        const fi           = input.flow_input ?? {};
        const priorResults = input.prior_results ?? [];
        const tema         = String(fi.tema       ?? fi.topic    ?? 'Marketing Digital');
        const audiencia    = String(fi.audiencia  ?? fi.audience ?? 'directores de marketing B2B');

        const seoResult    = priorResults.find(r => r.step === 's3-seo'      || r.agent === 'seo-agent');
        const copyResult   = priorResults.find(r => r.step === 's2-redaccion'|| r.agent === 'copywriter');
        const hasPrior     = !!(seoResult ?? copyResult);

        const primaryKw = String(fi.keywords ?? tema).split(',')[0]?.trim() ?? tema;
        const now       = new Date().toISOString().slice(0, 10);

        // Generate dates for the content calendar
        const d0 = new Date(); d0.setDate(d0.getDate() +  0);
        const d3 = new Date(); d3.setDate(d3.getDate() +  3);
        const d7 = new Date(); d7.setDate(d7.getDate() +  7);
        const fmt = (d) => d.toISOString().slice(0, 10);

        return `# Plan de Distribución en Redes: ${tema}

**Fecha de ejecución:** ${now}
**Agente:** social-media-agent
**Audiencia objetivo:** ${audiencia}
${hasPrior ? '\n> *Basado en el artículo optimizado por seo-agent*\n' : ''}

---

## LinkedIn (Canal Principal)

### Post de Lanzamiento — ${fmt(d0)}

**Hook (primera línea que se ve sin expandir):**
> "El 68% de los equipos de marketing B2B no pueden demostrar su impacto en el pipeline."

**Cuerpo del post:**

El 68% de los equipos de marketing B2B no pueden demostrar su impacto en el pipeline.

¿Estás en ese 68%?

Después de analizar más de 40 empresas B2B en los últimos 18 meses, identificamos 3 patrones que separan a los que crecen de los que estancan:

**1. Obsesión por el CPL cualificado, no por el volumen de leads**
Un lead que no es ICP es ruido. El equipo top quartile rechaza el 60% de los leads que el bottom quartile celebra.

**2. Marketing y ventas comparten la definición de MQL**
No es un acuerdo de una vez. Es una revisión mensual. Las empresas que hacen esto tienen un ciclo 40% más corto.

**3. Un dashboard de negocio, no de marketing**
Pipeline atribuible, CAC, ratio CAC:LTV. No impresiones. No seguidores.

Escribí sobre esto en detalle en mi último artículo sobre ${primaryKw.toLowerCase()} B2B.

Link en los comentarios 👇

\`\`\`
Formato: Texto nativo largo (no adjuntar link en el post)
Agregar link en primer comentario a los 30 min de publicar
Mejor hora: martes o miércoles, 8-9 AM (hora local de la audiencia)
\`\`\`

---

### Post de Seguimiento — ${fmt(d7)}

**Ángulo diferente: el contraargumento**

> "Por qué más contenido no te dará más leads (y qué sí funciona)"

Hay una creencia muy extendida en marketing B2B: si publicas más, recibes más.

Es falsa.

Las empresas que más contenido producen no son las que más pipeline generan. Las que mejor pipeline generan son las que producen el contenido correcto para la persona correcta en el momento correcto.

Eso tiene nombre: contenido con intención de búsqueda.

Antes de crear tu próximo post, pregúntate:
→ ¿Qué está buscando activamente mi ICP esta semana?
→ ¿Tengo algo mejor que lo que ya existe sobre ese tema?
→ ¿Puedo conectar ese contenido con una acción comercial concreta?

Si la respuesta a las tres es sí, crea. Si no, espera.

(Amplío esto con ejemplos reales en el artículo que publiqué la semana pasada — link en comentarios)

---

## Twitter / X

### Hilo (6 tweets) — ${fmt(d0)}

**Tweet 1/6 (apertura):**
> El ${primaryKw.toLowerCase()} B2B en 2026 funciona diferente.
>
> Analizamos 40+ empresas. Encontramos 6 patrones que separan a las que crecen de las que estancan.
>
> Hilo 🧵

**Tweet 2/6:**
> 1/ CPL vs volumen de leads
>
> Las mejores no celebran 500 leads al mes.
> Celebran 80 leads con fit perfecto.
>
> Señal: tienen una definición de ICP escrita y actualizada trimestralmente.

**Tweet 3/6:**
> 2/ Atribución multi-touch desde el día 1
>
> ¿De dónde vienen tus clientes reales? No tus leads. Tus clientes.
>
> La mayoría no lo sabe. Las mejores sí, y ajustan el presupuesto en consecuencia.

**Tweet 4/6:**
> 3/ Marketing y ventas comparten el mismo dashboard
>
> No un informe mensual en PDF.
> Un dashboard en tiempo real que ambos equipos miran cada semana.
>
> Sin ese acuerdo, optimizas para métricas que nadie en ventas valora.

**Tweet 5/6:**
> 4/ Content marketing ≠ publicar mucho
>
> Publicar 3 artículos al mes con intención de búsqueda clara → resultados.
> Publicar 15 posts de redes sin estrategia → ruido.
>
> El volumen no compensa la falta de estrategia.

**Tweet 6/6:**
> 5/ El ciclo de venta como KPI de marketing
>
> ¿Tu marketing está acortando el ciclo de venta?
> Si no puedes responder eso, hay una conversación pendiente con el equipo de sales.
>
> Artículo completo con datos y framework: [link]
>
> RT si esto le vendría bien a alguien de tu equipo 👇

---

### Tweet Individual de Impacto — ${fmt(d3)}

> "El mejor indicador de la madurez de un equipo de marketing B2B no es cuánto publican.
>
> Es si pueden responder esta pregunta: ¿cuánto pipeline generamos el mes pasado?
>
> La mayoría no puede."

---

## Calendario de Distribución

| Fecha | Plataforma | Formato | Estado |
|-------|-----------|---------|--------|
| ${fmt(d0)} | LinkedIn | Post de lanzamiento (texto largo) | Pendiente |
| ${fmt(d0)} | Twitter/X | Hilo de 6 tweets | Pendiente |
| ${fmt(d3)} | Twitter/X | Tweet individual de impacto | Pendiente |
| ${fmt(d7)} | LinkedIn | Post de seguimiento (ángulo opuesto) | Pendiente |

---

## Métricas de Éxito para Esta Distribución

| KPI | Objetivo LinkedIn | Objetivo Twitter/X |
|-----|----------------|--------------------|
| Impresiones | >5.000 | >2.000 |
| Engagement rate | >4% | >3% |
| Clicks al artículo | >150 | >80 |
| Leads directos (comentarios + DMs) | >5 | >2 |

> *Revisión de performance: 7 días post-publicación. Ajustar hora y formato si engagement < objetivo.*
`;
    },
});

await server.start();
process.stderr.write(`[social-media-agent] ready on :${PORT}\n`);
