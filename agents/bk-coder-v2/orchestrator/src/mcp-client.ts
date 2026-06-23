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

// ── Core call ─────────────────────────────────────────────────────────────────

/**
 * Spawns the specialist MCP server defined in agentCfg.transport,
 * calls `toolName` with `toolArgs`, waits for the response, then
 * closes the process. The server runs the full agent loop internally
 * (reads files, writes files, runs commands) and returns a summary.
 *
 * Falls back gracefully: if the transport is not set or the process
 * fails to start, throws so the caller can fall back to inline mode.
 */
export async function callMcpTool(
    agentCfg:   AgentConfig,
    toolName:   string,
    toolArgs:   Record<string, unknown>,
    configDir:  string,
    onProgress: (msg: string) => void,
    timeoutMs   = 600_000,             // 10 min — agent may run build/tests
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
            client.callTool({ name: toolName, arguments: toolArgs }),
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
