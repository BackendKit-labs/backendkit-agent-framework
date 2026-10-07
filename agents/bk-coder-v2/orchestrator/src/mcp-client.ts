import { Client }               from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import * as path                from 'node:path';
import type { AgentConfig }     from './config.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface McpToolResult {
    text:    string;
    success: boolean;
}

// ── Env expansion ─────────────────────────────────────────────────────────────

function expandEnv(env: Record<string, string>): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(env)) {
        out[k] = v.replace(/\$\{(\w+)\}/g, (_, key: string) => process.env[key] ?? '');
    }
    return out;
}

// ── Retry policy ──────────────────────────────────────────────────────────────
//
// Only retries FAST failures (spawn/connect hiccups, protocol errors before
// real agent work started) — never a failure that arrives after real time was
// spent, since by then the agent may have already written files, and a blind
// retry would re-run the whole agentic loop from scratch on top of that partial
// work instead of recovering from it. A slow failure (real timeout, or an error
// after meaningful elapsed time) surfaces immediately so the SDD gate can react
// (NO_GO) instead of silently doubling the wait.

const MAX_ATTEMPTS       = 3;
const RETRY_BASE_DELAY_MS = 2_000;
const FAST_FAILURE_MS     = 30_000;   // failures under this elapsed time are treated as transient

function sleep(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms));
}

// ── Core call ─────────────────────────────────────────────────────────────────

/**
 * Spawns the specialist MCP server defined in agentCfg.transport,
 * calls `toolName` with `toolArgs`, waits for the response, then
 * closes the process. The server runs the full agent loop internally
 * (reads files, writes files, runs commands) and returns a summary.
 *
 * Falls back gracefully: if the transport is not set or the process
 * fails to start, throws so the caller can fall back to inline mode.
 *
 * Retries up to MAX_ATTEMPTS times, but only on fast failures (see policy
 * above) — a fresh process + connection is spawned on each attempt.
 */
export async function callMcpTool(
    agentCfg:   AgentConfig,
    toolName:   string,
    toolArgs:   Record<string, unknown>,
    configDir:  string,
    onProgress: (msg: string) => void,
    timeoutMs   = 600_000,             // 10 min — agent may run build/tests
): Promise<string> {
    let lastErr: unknown;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        const attemptStart = Date.now();
        try {
            return await callMcpToolOnce(agentCfg, toolName, toolArgs, configDir, onProgress, timeoutMs);
        } catch (err) {
            lastErr = err;
            const elapsed = Date.now() - attemptStart;
            const isFast  = elapsed < FAST_FAILURE_MS;

            if (!isFast || attempt >= MAX_ATTEMPTS) throw err;

            const delay = RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
            onProgress(
                `  ⚠ [${agentCfg.id}] intento ${attempt}/${MAX_ATTEMPTS} falló en ${(elapsed / 1000).toFixed(1)}s ` +
                `(${err instanceof Error ? err.message : String(err)}) — reintentando en ${delay / 1000}s...`,
            );
            await sleep(delay);
        }
    }

    throw lastErr;
}

async function callMcpToolOnce(
    agentCfg:   AgentConfig,
    toolName:   string,
    toolArgs:   Record<string, unknown>,
    configDir:  string,
    onProgress: (msg: string) => void,
    timeoutMs:  number,
): Promise<string> {
    if (!agentCfg.transport || agentCfg.transport.type !== 'stdio') {
        throw new Error(`Agent ${agentCfg.id}: no stdio transport configured`);
    }

    const t = agentCfg.transport;

    // Resolve relative args against the orchestrator config directory
    const resolvedArgs = t.args.map(a =>
        a.startsWith('.') ? path.resolve(configDir, a) : a,
    );

    const env: Record<string, string> = {
        ...Object.fromEntries(
            Object.entries(process.env).filter(([, v]) => v !== undefined) as [string, string][],
        ),
        ...expandEnv(t.env ?? {}),
    };

    // Pass projectRoot so the MCP server can chdir() to it.
    // This allows agent-coding's path-sandbox to read/write the project files.
    if (typeof toolArgs['projectRoot'] === 'string') {
        env['PROJECT_ROOT'] = toolArgs['projectRoot'];
    }

    // Pass the agent's soul file (system_prompt, loaded from orchestrator.yaml's soul_file) so the
    // spawned process can inject it as an always-active skill. Base64 avoids multi-line env issues.
    // Without this, souls/*.md has zero effect on MCP-mode agents (they never read this config).
    if (agentCfg.system_prompt) {
        env['AGENT_SOUL_B64'] = Buffer.from(agentCfg.system_prompt, 'utf-8').toString('base64');
    }

    onProgress(`  🔌 [${agentCfg.id}] iniciando proceso MCP (${path.basename(resolvedArgs[0] ?? t.command)})...`);

    const transport = new StdioClientTransport({
        command: t.command,
        args:    resolvedArgs,
        env,
        stderr:  'pipe',   // capture stderr so it doesn't pollute our output
    });

    const client = new Client(
        { name: 'orchestrator-coder-v2', version: '1.0.0' },
        { capabilities: {} },
    );

    const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`MCP tool timeout after ${timeoutMs / 1000}s`)), timeoutMs),
    );

    try {
        await Promise.race([client.connect(transport), timeout]);

        onProgress(`  → [${agentCfg.id}] llamando ${toolName}...`);

        const raw = await Promise.race([
            client.callTool(
                { name: toolName, arguments: toolArgs },
                undefined,
                { timeout: timeoutMs },   // pass timeout to the SDK request
            ),
            timeout,
        ]) as { content?: Array<{ type: string; text?: string }> };

        // Extract text content from MCP response
        const texts = (raw.content ?? [])
            .filter(c => c.type === 'text' && c.text)
            .map(c => c.text!);

        return texts.join('\n') || '(sin respuesta de texto)';

    } finally {
        await client.close().catch(() => { /* ignore close errors */ });
    }
}
