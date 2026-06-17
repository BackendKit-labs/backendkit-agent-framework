import { readFileSync } from 'node:fs';
import * as path from 'node:path';

/** Loads SOUL.md (the director's identity + routing rules) from the config dir. */
export function loadSoul(configDir: string): string {
    try {
        return readFileSync(path.join(configDir, 'SOUL.md'), 'utf-8');
    } catch {
        return 'Sos el Director del ecosistema BackendKit. Entendés al usuario y delegás al agente correcto.';
    }
}

export interface ServerTopology {
    name:      string;
    toolCount: number;
    tools:     string[];
}

/**
 * Builds the full system prompt: SOUL.md + a live snapshot of which agents are
 * actually connected right now and what tools each exposes. This grounds the
 * LLM's routing in reality — it only routes to planes that are online.
 */
export function buildSystemPrompt(soul: string, topology: ServerTopology[]): string {
    if (topology.length === 0) {
        return `${soul}\n\n## Estado actual\nNingún agente especialista está conectado. Respondé directamente y avisá al usuario que las capacidades de delegación no están disponibles.`;
    }
    const lines = topology.map(t => `- **${t.name}** (${t.toolCount} tools): ${t.tools.join(', ')}`);
    return `${soul}\n\n## Agentes conectados ahora mismo\nEstas son las herramientas disponibles en esta sesión. Solo podés delegar a estos planos:\n${lines.join('\n')}`;
}
