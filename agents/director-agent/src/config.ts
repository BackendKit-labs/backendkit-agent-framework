import { z } from 'zod';
import { readFileSync, existsSync } from 'node:fs';
import * as path from 'node:path';
import * as yaml from 'yaml';

// ── Schemas ───────────────────────────────────────────────────────────────────

const ProviderSchema = z.object({
    base_url: z.string().optional(),
    model:    z.string(),
    api_key:  z.string().optional(),
});

const AgentSchema = z.object({
    name:    z.string(),
    command: z.string(),
    args:    z.array(z.string()).default([]),
    env:     z.record(z.string()).optional(),
});

export const DirectorConfigSchema = z.object({
    director: z.object({
        name:           z.string().default('Director'),
        provider:       z.string().default('deepseek'),
        ws_port:        z.number().default(3500),
        max_iterations: z.number().default(20),
    }),
    providers: z.record(ProviderSchema).default({}),
    agents:    z.array(AgentSchema).default([]),
});

export type DirectorConfig = z.infer<typeof DirectorConfigSchema>;
export type AgentEntry     = z.infer<typeof AgentSchema>;

// ── Loader ────────────────────────────────────────────────────────────────────

export interface LoadedConfig {
    config:    DirectorConfig;
    configDir: string;
}

export function loadConfig(configPath: string): LoadedConfig {
    const resolved = path.resolve(configPath);
    if (!existsSync(resolved)) {
        throw new Error(`director.yaml not found: ${resolved}`);
    }
    const raw      = yaml.parse(readFileSync(resolved, 'utf-8')) as unknown;
    const expanded = expandEnv(raw);
    const result   = DirectorConfigSchema.safeParse(expanded);
    if (!result.success) {
        const issues = result.error.issues.map(i => `  ${i.path.join('.')}: ${i.message}`).join('\n');
        throw new Error(`Invalid director.yaml:\n${issues}`);
    }
    return { config: result.data, configDir: path.dirname(resolved) };
}

/** Resolves an agent's relative args paths to absolute, relative to the config dir. */
export function resolveAgentArgs(entry: AgentEntry, configDir: string): string[] {
    return entry.args.map(arg => {
        // Only resolve things that look like relative paths (start with ./ or ../)
        if (arg.startsWith('./') || arg.startsWith('../')) {
            return path.resolve(configDir, arg);
        }
        return arg;
    });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function expandEnv(obj: unknown): unknown {
    if (typeof obj === 'string') {
        return obj.replace(/\$\{(\w+)\}/g, (_, key: string) => process.env[key] ?? '');
    }
    if (Array.isArray(obj)) return obj.map(expandEnv);
    if (obj !== null && typeof obj === 'object') {
        return Object.fromEntries(
            Object.entries(obj as Record<string, unknown>).map(([k, v]) => [k, expandEnv(v)]),
        );
    }
    return obj;
}
