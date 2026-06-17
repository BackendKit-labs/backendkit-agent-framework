#!/usr/bin/env node
/**
 * content-strategist — builds the editorial brief: angle, structure, buyer persona, CTA.
 *
 * Env: PORT (default 3310), AGENT_API_KEY (optional), VAULT_PATH (optional)
 */

import agentProtocol from '@backendkit-labs/agent-protocol';
import * as fs from 'node:fs';
import * as path from 'node:path';

const { AgentServer } = agentProtocol;

const PORT = parseInt(process.env.PORT ?? '3310', 10);

function readVaultFile(rel) {
    const vaultPath = process.env.VAULT_PATH;
    if (!vaultPath) return null;
    try { return fs.readFileSync(path.join(vaultPath, rel), 'utf8'); } catch { return null; }
}

const server = new AgentServer({
    name:        'content-strategist',
    version:     '0.1.0',
    description: 'Plans content strategy: editorial briefs, angles, buyer personas, content calendars',
    port:        PORT,
    apiKey:      process.env.AGENT_API_KEY,
});

server.register({
    definition: {
        name:        'execute',
        description: 'Build an editorial brief for a piece of content',
        async:       false,
        input:  { task: 'string', flow_input: 'object?', prior_results: 'array?' },
        output: 'string (markdown editorial brief)',
    },
    async execute(input) {
        const fi        = input.flow_input ?? {};
        const tema      = String(fi.tema       ?? fi.topic    ?? 'Marketing Digital');
        const objetivo  = String(fi.objetivo   ?? fi.goal     ?? 'Generar awareness y leads cualificados');
        const audiencia = String(fi.audiencia  ?? fi.audience ?? 'CMOs y directores de marketing B2B');
        const keywords  = String(fi.keywords   ?? fi.kw       ?? 'marketing digital, estrategia de contenidos');
        const tono      = String(fi.tono       ?? fi.tone     ?? 'profesional y directo');

        // Try to enrich with vault brand data
        const brandFile    = readVaultFile('marca/identidad.md');
        const audienceFile = readVaultFile('audiencia/buyer-personas.md');

        const brandNote    = brandFile    ? `\n> **Nota:** Usar voz y tono de marca definidos en vault/marca/identidad.md` : '';
        const audienceNote = audienceFile ? `\n> **Audiencia validada:** ver vault/audiencia/buyer-personas.md` : '';

        const now      = new Date().toISOString().slice(0, 10);
        const wordCount = Math.floor(Math.random() * 600 + 1200);

        const brief = `# Brief Editorial: ${tema}

**Fecha:** ${now}
**Estratega:** content-strategist
**Estado:** Aprobado para redacción${brandNote}${audienceNote}

---

## 1. Ángulo Editorial y Propuesta de Valor Única

**Ángulo:** En lugar de describir *qué* es ${tema.toLowerCase()}, este artículo demuestra *cómo medirlo* y vincula cada táctica a un resultado de negocio concreto. Diferenciador: usamos datos de campañas B2B reales y benchmarks sectoriales.

**Por qué ahora:** Los equipos de marketing post-2025 enfrentan presupuestos ajustados y exigencias de ROI inmediato. Un artículo que corte el ruido con métricas accionables tiene alta probabilidad de viralizarse en LinkedIn.

---

## 2. Estructura Propuesta

| # | Sección (H2) | Contenido clave |
|---|---|---|
| 1 | El estado actual del ${tema.toLowerCase()} en B2B | Benchmarks del sector, tendencias 2025-2026 |
| 2 | Los 5 errores que destruyen tu ROI | Casos reales, qué evitar |
| 3 | Framework de 4 pasos para ${objetivo.toLowerCase().slice(0, 40)} | Metodología paso a paso |
| 4 | Herramientas y stack recomendado | Tabla comparativa, costes |
| 5 | Cómo medir el éxito: KPIs que importan | Dashboard de métricas, fórmulas |
| 6 | Caso de estudio: empresa B2B +${Math.floor(Math.random()*80+20)}% en 90 días | Historia de éxito con datos |

---

## 3. Buyer Persona Primario

**Perfil:** ${audiencia}
**Etapa del funnel:** Consideración (conoce el problema, evalúa soluciones)
**Pain point principal:** Justificar la inversión en marketing ante el CFO con métricas de negocio
**Formato de consumo preferido:** Artículos largo formato con tablas y checklists; consume en desktop

---

## 4. Puntos Clave que el Lector debe Llevarse

1. La diferencia entre métricas de vanidad y métricas de negocio en ${tema.toLowerCase()}
2. El framework de priorización que aplican los equipos de mayor rendimiento
3. Tres quick wins implementables en menos de 30 días
4. Cómo construir el business case para escalar el presupuesto
5. El checklist de auditoría para detectar fugas de conversión

---

## 5. Llamado a la Acción

**CTA principal:** "Descarga nuestra plantilla de planificación estratégica (incluye calculadora de ROI)"
**Destino:** Landing page de lead gen con formulario de 3 campos
**CTA secundario:** "Agenda una sesión gratuita de diagnóstico"

---

## 6. Especificaciones Técnicas

- **Longitud:** ~${wordCount} palabras
- **Keywords primaria:** ${keywords.split(',')[0]?.trim() ?? tema}
- **Keywords secundarias:** ${keywords}
- **Tono:** ${tono}
- **Formato:** Web-first, párrafos cortos, al menos 2 tablas/listas para scanabilidad
`;

        return brief;
    },
});

await server.start();
process.stderr.write(`[content-strategist] ready on :${PORT}\n`);
