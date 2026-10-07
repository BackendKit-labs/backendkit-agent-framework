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
    /**
     * Per-tool-call MCP timeout in ms — MCPClientManager defaults to 30_000, too
     * short for tools that intentionally block server-side (e.g. coder's
     * orchestrator_status with wait_seconds up to 120s). Set higher than the
     * longest legitimate blocking call this server exposes.
     */
    timeout_ms: z.number().int().positive().optional(),
});

const AbacConditionSchema = z.object({
    effect: z.enum(['allow', 'deny']).default('deny'),
    reason: z.string(),
    match:  z.unknown(),
});

const ToolPolicySchema = z.object({
    allowed_roles: z.array(z.string()),
    conditions:    z.array(AbacConditionSchema).optional(),
});

const AuditConfigSchema = z.object({
    enabled: z.boolean().default(false),
    path:    z.string().optional(),   // override del path del log NDJSON
});

const VaultVisibilitySchema = z.object({
    default_roles: z.array(z.string()).default(['*']),
    paths:         z.record(z.array(z.string())).default({}),
});

const AccessControlSchema = z.object({
    enforce:          z.boolean().default(false),
    default_deny:     z.boolean().default(false),
    audit:            AuditConfigSchema.optional(),
    vault_visibility: VaultVisibilitySchema.optional(),
    tools:            z.record(ToolPolicySchema).default({}),
});

// ── Modo proactivo (pulso) — ver proposals/director-proactivo.md ─────────────

const PlaybookSchema = z.object({
    /** Cadencia: '15m', '4h', etc. 'off' desactiva el playbook. */
    every:  z.string().default('off'),
    prompt: z.string(),
    /**
     * Override de la allowlist global para este playbook (nombres cortos).
     * El pulso usa allowlist, no blocklist: una tool que no está acá (ni en
     * proactive.allowed_tools) directamente no se registra en el engine del
     * turno — el LLM no la ve.
     */
    allowed_tools: z.array(z.string()).optional(),
});

const ProactiveSchema = z.object({
    enabled: z.boolean().default(false),
    /**
     * En dev (sin ABAC_PUBLIC_KEY) todo corre como ADMIN_PRINCIPAL — el pulso
     * solo se habilita ahí con este flag explícito, para que nadie lo deje
     * activo por accidente sabiendo que corre como admin.
     */
    allow_dev:   z.boolean().default(false),
    quiet_hours: z.object({ from: z.string(), to: z.string() }).optional(),
    /** Presupuesto LLM por pulso — mucho menor que el del chat (20). */
    max_iterations: z.number().int().positive().default(6),
    /** Horas sin re-activación (reconexión del usuario) tras las cuales el pulso se pausa. */
    subscription_ttl_hours: z.number().positive().default(72),
    /** Ventana en la que un digest con el mismo contenido no se re-publica. */
    repeat_cooldown_hours: z.number().positive().default(12),
    /** Allowlist global de tools (nombres cortos) para turnos de pulso. */
    allowed_tools: z.array(z.string()).default([]),
    /** Playbooks por rol del principal; 'default' aplica a roles sin playbook propio. */
    playbooks: z.record(PlaybookSchema).default({}),
});

export const DirectorConfigSchema = z.object({
    director: z.object({
        name:           z.string().default('Director'),
        provider:       z.string().default('deepseek'),
        ws_port:        z.number().default(3500),
        max_iterations: z.number().default(20),
    }),
    providers:      z.record(ProviderSchema).default({}),
    agents:         z.array(AgentSchema).default([]),
    access_control: AccessControlSchema.optional(),
    proactive:      ProactiveSchema.optional(),
});

export type DirectorConfig        = z.infer<typeof DirectorConfigSchema>;
export type AgentEntry            = z.infer<typeof AgentSchema>;
export type AccessControlConfig   = z.infer<typeof AccessControlSchema>;
export type VaultVisibilityConfig = z.infer<typeof VaultVisibilitySchema>;
export type ProactiveConfig       = z.infer<typeof ProactiveSchema>;
export type PlaybookConfig        = z.infer<typeof PlaybookSchema>;

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
