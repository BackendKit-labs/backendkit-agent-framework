/**
 * Publica el registry de tools disponibles en el Director.
 * Se escribe a ~/.backendkit/auth/director-registry.json cada vez que el director arranca.
 * El auth-service lo lee para mostrar las tools reales en el workspace editor.
 */

import * as fs   from 'node:fs/promises';
import * as path from 'node:path';
import * as os   from 'node:os';
import type { MCPClientManager } from '@backendkit-labs/agent-core';

export const REGISTRY_PATH = process.env['DIRECTOR_REGISTRY_PATH']
    ?? path.join(os.homedir(), '.backendkit', 'auth', 'director-registry.json');

/** Etiquetas legibles por servidor MCP */
const SERVER_LABELS: Record<string, string> = {
    codex:     'Codex — Vault & Conocimiento',
    coder:     'Coder — SDD (backend, QA, security, infra)',
    runs:      'Runs — Flows de negocio',
    fleet:     'Fleet — Deploy de agentes',
    cloud:     'Cloud — Departments, Deployables & Workflows',
    config:    'Config — Configuración centralizada',
    scheduler: 'Scheduler — Programación de tareas',
    health:    'Health — Monitoreo del ecosistema',
    notifier:  'Notifier — Notificaciones multicanal',
};

export interface ToolGroup {
    label:  string;
    server: string;
    tools:  string[];
}

export interface DirectorRegistry {
    generated: string;
    directorVersion: string;
    groups:   ToolGroup[];
    allTools: string[];
}

export async function writeRegistryFile(mcp: MCPClientManager): Promise<void> {
    const servers = mcp.getServerInfo();

    const groups: ToolGroup[] = servers
        .map(s => ({
            label:  SERVER_LABELS[s.name] ?? `${s.name} — Agente MCP`,
            server: s.name,
            tools:  mcp.getServerTools(s.name).map(t => {
                const parts = t.name.split('__');
                return parts[parts.length - 1] ?? t.name;
            }),
        }))
        .filter(g => g.tools.length > 0);

    const registry: DirectorRegistry = {
        generated:       new Date().toISOString(),
        directorVersion: '0.1.0',
        groups,
        allTools:        groups.flatMap(g => g.tools),
    };

    await fs.mkdir(path.dirname(REGISTRY_PATH), { recursive: true });
    await fs.writeFile(REGISTRY_PATH, JSON.stringify(registry, null, 2), 'utf-8');

    process.stderr.write(
        `[director-agent] Registry publicado → ${REGISTRY_PATH} (${registry.allTools.length} tools, ${groups.length} agentes)\n`,
    );
}
