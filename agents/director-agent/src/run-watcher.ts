import type { ToolDefinition, MCPClientManager, ExecutionContext } from '@backendkit-labs/agent-core';

/**
 * Pushes a message to a principal's active WebSocket connection(s), independent
 * of any in-flight chat turn. Wired by ws-server.ts after building the manager.
 */
export type NotifyFn = (principalId: string, message: string) => void;

export interface WatchRunOptions {
    principalId: string;
    runId:       string;
    configPath?: string;
    /** 'orchestrator_run' | 'orchestrator_sdd' — which tool started this run. */
    label:       string;
    /** Brief task description, for a nicer notification header. */
    task?:       string;
}

const POLL_MS = 5_000;
const MAX_MS  = 30 * 60 * 1000;   // give up watching after 30 min — still runs, just stops pushing

// orchestrator_status's execute() ignores ctx (pure MCP passthrough) — this fake
// context exists only to satisfy the ToolDefinition signature for a direct call.
const FAKE_CTX = {
    agentId: 'run-watcher', sessionId: 'run-watcher',
    memory: {}, askAgent: async () => '',
} as unknown as ExecutionContext;

function formatDone(opts: WatchRunOptions, status: string, fullText: string): string {
    const icon = status === 'complete'      ? '✅'
               : status === 'waiting_gate'  ? '⏸️'
               : status === 'failed'        ? '❌'
               : 'ℹ️';
    const header = `${icon} El run \`${opts.runId}\`${opts.task ? ` (${opts.task.slice(0, 60)})` : ''} pasó a **${status}**.`;
    return `${header}\n\n${fullText.slice(0, 1500)}`;
}

/**
 * Watches background coder runs (orchestrator_run/orchestrator_sdd) started by
 * a chat turn and proactively pushes a notification when they leave "running" —
 * so the user doesn't have to keep asking "¿cómo va?" or the director doesn't
 * have to poll in a loop that blocks the conversation (see SOUL.md "Runs en
 * background").
 */
export class RunWatcher {
    private readonly watching = new Set<string>();
    private notify: NotifyFn = () => {};

    constructor(private readonly mcp: MCPClientManager) {}

    /** ws-server.ts calls this once at startup to wire the real push mechanism. */
    setNotifier(fn: NotifyFn): void {
        this.notify = fn;
    }

    private findStatusTool(): ToolDefinition | undefined {
        return this.mcp.getServerTools('coder').find(t => t.name.endsWith('__orchestrator_status'));
    }

    watch(opts: WatchRunOptions): void {
        const key = `${opts.principalId}:${opts.runId}`;
        if (this.watching.has(key)) return;

        const tool = this.findStatusTool();
        if (!tool) return;   // coder not connected — nothing to watch

        this.watching.add(key);
        const deadline = Date.now() + MAX_MS;

        const poll = async () => {
            try {
                const text = await tool.execute(
                    { config_path: opts.configPath, run_id: opts.runId, wait_seconds: 0 },
                    FAKE_CTX,
                );
                const status = /status:\s*\*\*(\w+)\*\*/.exec(text)?.[1];
                if (status && status !== 'running') {
                    this.watching.delete(key);
                    this.notify(opts.principalId, formatDone(opts, status, text));
                    return;
                }
            } catch {
                // transient MCP/process hiccup — keep polling, don't give up on one failure
            }

            if (Date.now() < deadline) {
                setTimeout(poll, POLL_MS);
            } else {
                this.watching.delete(key);
                this.notify(
                    opts.principalId,
                    `⏱️ Dejé de vigilar el run \`${opts.runId}\` después de 30 min — seguía "running". ` +
                    `Preguntame el estado cuando quieras, el run sigue corriendo igual.`,
                );
            }
        };

        setTimeout(poll, POLL_MS);
    }
}
