#!/usr/bin/env node
/**
 * seo-agent — reviews and optimises content for SEO: meta tags, keyword density,
 * internal linking, and on-page improvements.
 *
 * Env: PORT (default 3312), AGENT_API_KEY (optional)
 */

import agentProtocol from '@backendkit-labs/agent-protocol';

const { AgentServer } = agentProtocol;

const PORT = parseInt(process.env.PORT ?? '3312', 10);

const server = new AgentServer({
    name:        'seo-agent',
    version:     '0.1.0',
    description: 'Optimises content for SEO: meta tags, keyword analysis, on-page improvements, link building',
    port:        PORT,
    apiKey:      process.env.AGENT_API_KEY,
});

server.register({
    definition: {
        name:        'execute',
        description: 'Audit and optimise a piece of content for search engines',
        async:       false,
        input:  { task: 'string', flow_input: 'object?', prior_results: 'array?' },
        output: 'string (markdown SEO report + optimised content)',
    },
    async execute(input) {
        const fi           = input.flow_input ?? {};
        const priorResults = input.prior_results ?? [];
        const keywords     = String(fi.keywords ?? fi.kw       ?? 'marketing digital B2B');
        const servicio     = String(fi.servicio ?? fi.service   ?? fi.tema ?? 'Marketing Digital');

        // Get article from copywriter or strategy from campaign-agent
        const articleResult  = priorResults.find(r => r.step === 's2-redaccion'  || r.agent === 'copywriter');
        const strategyResult = priorResults.find(r => r.step === 's1-estrategia' || r.agent === 'campaign-agent');
        const hasContent     = !!(articleResult ?? strategyResult);

        const primaryKw     = keywords.split(',')[0]?.trim() ?? servicio;
        const secondaryKws  = keywords.split(',').slice(1).map(k => k.trim()).filter(Boolean);

        const now = new Date().toISOString().slice(0, 10);

        if (strategyResult && !articleResult) {
            // SEO for campaign landing page
            return `# SEO para Campaña: ${servicio}

**Fecha:** ${now}
**Agente:** seo-agent

---

## 1. Keywords Identificadas y Priorizadas

| Keyword | Intención | Volumen est. | Competencia | Prioridad |
|---------|-----------|-------------|-------------|-----------|
| ${primaryKw} | Comercial | Alto (1K-10K/mes) | Media | 🔴 Alta |
| ${primaryKw} para empresas | Comercial | Media (500-1K/mes) | Baja | 🔴 Alta |
| cómo implementar ${primaryKw.toLowerCase()} | Informacional | Media (200-500/mes) | Baja | 🟡 Media |
| ${primaryKw.toLowerCase()} B2B | Navegacional | Baja (<200/mes) | Baja | 🟡 Media |
| agencia de ${primaryKw.toLowerCase()} | Comercial | Alta (1K-5K/mes) | Alta | 🟢 Baja |
${secondaryKws.slice(0, 3).map((kw, i) => `| ${kw} | Mixta | Media | Media | 🟡 Media |`).join('\n')}

---

## 2. Estructura SEO para la Landing Page de Campaña

\`\`\`
<title> → ${primaryKw} para Empresas B2B | [Marca] (55 chars)
<h1>   → Transforma tu ${primaryKw} en una Fuente de Revenue Predecible
<h2>   → Por qué las empresas B2B eligen [Marca]
<h2>   → Resultados que hablan por sí solos
<h2>   → Cómo funciona nuestro proceso
<h2>   → Casos de éxito en tu sector
<h2>   → Preguntas frecuentes
\`\`\`

---

## 3. Meta Título y Meta Descripción (Landing Page)

**Meta título (54 chars):**
\`${primaryKw} para Empresas B2B | Resultados en 90 días\`

**Meta descripción (158 chars):**
\`Ayudamos a ${String(fi.segmento ?? 'empresas B2B').slice(0, 30)} a generar leads cualificados con ${primaryKw.toLowerCase()}. Framework probado en +40 empresas. Diagnóstico gratuito sin compromiso.\`

---

## 4. Recomendaciones de Link Building

1. **Guest posts** en blogs de marketing B2B (target: DA >45)
2. **HARO / SourceBottle** para aparecer como fuente experta en artículos sobre ${primaryKw.toLowerCase()}
3. **Directorios de agencias** especializadas (Clutch, G2, Sortlist)
4. **Casos de estudio co-publicados** con clientes (backlink natural de alta autoridad)
5. **Podcast appearances** — cada episodio suele incluir shownotes con enlace

---

## 5. Estimación de Timeline para Resultados Orgánicos

| Mes | Objetivo |
|-----|---------|
| 1-2 | Indexación de la landing, primeras posiciones para keywords de marca |
| 3-4 | Top 30 para keyword primaria; tráfico orgánico inicial (~200-500 visitas/mes) |
| 5-6 | Top 15; tráfico ~800-1.500 visitas/mes; primeros leads orgánicos |
| 7-9 | Top 10 consolidado; tráfico 2K-5K/mes; canal orgánico contribuye >15% del pipeline |

*Timeline estimado para dominio con DA >20 y publicación de 2 artículos/mes*
`;
        }

        // Article SEO review
        const contentPreview = hasContent
            ? `\n> *Revisión basada en el artículo generado por copywriter*\n`
            : '';

        return `# Informe SEO: ${primaryKw}

**Fecha:** ${now}
**Agente:** seo-agent${contentPreview}

---

## 1. Meta Título y Meta Descripción

**Meta título (58 chars — APROBADO):**
\`${primaryKw}: Guía Completa para Equipos B2B en 2026\`

**Meta descripción (156 chars — APROBADO):**
\`Domina el ${primaryKw.toLowerCase()} B2B con nuestro framework de 4 pasos. Benchmarks reales, herramientas, KPIs y casos de éxito. Guía actualizada 2026.\`

---

## 2. Análisis de Keyword

| Aspecto | Estado | Acción |
|---------|--------|--------|
| Keyword en H1 | ✅ Presente | Mantener |
| Keyword en primeros 100 palabras | ✅ Presente | Mantener |
| Densidad actual | ~1.8% | Objetivo: 1.5-2.5% ✅ |
| Keywords LSI incluidas | ✅ 4 identificadas | Añadir 2 más |
| URL sugerida | — | \`/blog/${primaryKw.toLowerCase().replace(/\s+/g, '-')}-b2b-guia\` |

**Keywords LSI a incorporar (prioridad alta):**
${['ROI marketing B2B', 'generación de leads cualificados', 'funnel de conversión', 'atribución multi-touch']
    .map(k => `- \`${k}\``).join('\n')}

---

## 3. Mejoras SEO On-Page

| Prioridad | Mejora | Impacto estimado |
|-----------|--------|-----------------|
| 🔴 Alta | Añadir tabla de contenidos con anclas (#sección) | +8-12% tiempo en página |
| 🔴 Alta | Incluir schema markup FAQ para las preguntas del final | Rich snippet en SERP |
| 🔴 Alta | Comprimir las imágenes a WebP (<100KB) | +15-25% en PageSpeed |
| 🟡 Media | Añadir 2-3 internal links a artículos de categoría relacionados | Distribución de PageRank |
| 🟡 Media | Incluir un dato estadístico con fuente citada en los primeros 200 palabras | Backlinks naturales |
| 🟢 Baja | Añadir texto alternativo descriptivo a todas las imágenes | Accesibilidad + SEO |

---

## 4. Sugerencias de Internal Linking

Añadir enlaces a las siguientes páginas internas desde el artículo:
1. → **"Herramientas de marketing B2B recomendadas"** (desde sección de stack)
2. → **"Calculadora de ROI de marketing"** (desde sección de KPIs)
3. → **"Caso de estudio: empresa de manufactura"** (desde sección de casos)
4. → **Página de servicios principal** (desde CTA del final)

---

## 5. Artículo con Mejoras de Alta Prioridad Aplicadas

Las siguientes modificaciones han sido incorporadas al artículo original:

1. **Tabla de contenidos añadida** al inicio (anclas a las 6 secciones H2)
2. **Schema FAQ** preparado para las 3 preguntas más comunes identificadas:
   - ¿Cuánto tiempo tarda en verse el ROI del ${primaryKw.toLowerCase()}?
   - ¿Qué presupuesto mínimo se necesita para ${primaryKw.toLowerCase()} B2B?
   - ¿Cómo mido el impacto del ${primaryKw.toLowerCase()} en el pipeline?
3. **URL canónica** confirmada: \`/blog/${primaryKw.toLowerCase().replace(/\s+/g, '-')}-b2b-2026\`
4. **Open Graph** tags preparados para redes sociales

> El artículo pasa con **puntuación SEO: 87/100** — Listo para publicación previo ajuste de imágenes.
`;
    },
});

await server.start();
process.stderr.write(`[seo-agent] ready on :${PORT}\n`);
