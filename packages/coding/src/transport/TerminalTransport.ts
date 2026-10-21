import * as readline from 'readline';
import { marked } from 'marked';
import { markedTerminal } from 'marked-terminal';
import type { AgentEvent } from '@backendkit-labs/agent-core';
import type { Transport, Unsubscribe } from '@backendkit-labs/agent-core';

// marked v15 changed MarkedExtension types — cast is safe, runtime is compatible
// eslint-disable-next-line @typescript-eslint/no-explicit-any
marked.use(markedTerminal() as any);

// ANSI helpers
const RESET  = '\x1b[0m';
const DIM    = '\x1b[2m';
const BOLD   = '\x1b[1m';
const CYAN   = '\x1b[36m';
const YELLOW = '\x1b[33m';
const GREEN  = '\x1b[32m';
const RED    = '\x1b[31m';
const GRAY   = '\x1b[90m';

function hr(char = '─', width = 72): string {
    return GRAY + char.repeat(width) + RESET;
}

function agentHeader(icon: string, name: string): string {
    const label = `${BOLD}${icon}  ${name}${RESET}`;
    return `\n${hr('─')} ${label}\n`;
}

function toolLine(name: string, preview: string): string {
    const truncated = preview.length > 60 ? preview.slice(0, 57) + '…' : preview;
    return `${GRAY}● ${CYAN}${name}${GRAY}(${RESET}${truncated}${GRAY})${RESET}`;
}

/**
 * Terminal transport that renders agent responses as formatted Markdown.
 *
 * Instead of streaming raw tokens mid-tool-call (which produces fragmented text),
 * this transport:
 *   1. Accumulates tokens per agent block silently
 *   2. Shows tool calls as compact single-line indicators
 *   3. Renders the final buffered text as Markdown on block_end
 *
 * Pass to createCodingEngine({ transport: new TerminalTransport() }).
 */
export class TerminalTransport implements Transport {
    private rl: readline.Interface | null = null;

    // token buffers per active agent block
    private readonly buffers = new Map<string, string>();

    // track whether any tool calls fired in a block (for blank-line spacing)
    private readonly hadTools = new Map<string, boolean>();

    emit(event: AgentEvent): void {
        switch (event.type) {
            case 'block_start': {
                const id   = event.agent_id ?? 'unknown';
                const icon = event.agent_icon ?? '◆';
                const name = event.agent_name ?? id;
                this.buffers.set(id, '');
                this.hadTools.set(id, false);
                process.stdout.write(agentHeader(icon, name));
                break;
            }

            case 'token': {
                // Accumulate silently — no streaming to terminal
                const id = event.agent_id ?? 'unknown';
                this.buffers.set(id, (this.buffers.get(id) ?? '') + event.content);
                break;
            }

            case 'tool_call': {
                // Single-line compact indicator
                const args = event.args_preview ?? '';
                process.stdout.write(toolLine(event.name, args) + '\n');
                // Mark the currently active block as having had tool calls
                for (const [id] of this.buffers) {
                    this.hadTools.set(id, true);
                }
                break;
            }

            case 'block_end': {
                const id  = event.agent_id ?? 'unknown';
                const buf = (this.buffers.get(id) ?? '').trim();
                this.buffers.delete(id);
                this.hadTools.delete(id);

                if (buf) {
                    if (this.hadTools.get(id)) process.stdout.write('\n');
                    const rendered = marked.parse(buf) as string;
                    process.stdout.write(rendered);
                }
                process.stdout.write(hr('─') + '\n');
                break;
            }

            case 'system': {
                const prefix = event.level === 'error' ? `${RED}[error]${RESET}`
                             : event.level === 'warn'  ? `${YELLOW}[warn]${RESET}`
                             : `${GRAY}[info]${RESET}`;
                process.stderr.write(`${prefix} ${event.text}\n`);
                break;
            }

            case 'budget_exceeded': {
                const u = event.usage;
                process.stderr.write(
                    `${RED}[budget]${RESET} ${u.budgetExceeded} exceeded: run $${u.runCostUsd.toFixed(4)}, day $${u.dayCostUsd.toFixed(4)}. Run stopped.\n`
                );
                break;
            }

            case 'error': {
                process.stderr.write(`${RED}Error: ${event.message}${RESET}\n`);
                break;
            }

            case 'metrics': {
                const cost = event.cost_usd != null
                    ? ` · $${event.cost_usd.toFixed(4)}`
                    : '';
                const cache = event.cache_read_tokens || event.cache_write_tokens
                    ? ` · cache r${event.cache_read_tokens ?? 0} w${event.cache_write_tokens ?? 0}`
                    : '';
                process.stderr.write(
                    `${GRAY}↑ ${event.input_tokens} ↓ ${event.output_tokens}${cache}${cost}${RESET}\n`
                );
                break;
            }

            case 'compacting': {
                if (event.phase === 'start') {
                    process.stderr.write(`${DIM}[compacting] ${event.label}…${RESET}\n`);
                }
                break;
            }

            case 'tool_result':
            case 'agent_switch':
            case 'thinking':
            case 'ready':
            case 'done':
                // intentionally silent
                break;

            default:
                break;
        }
    }

    onInput(handler: (input: string) => void): Unsubscribe {
        if (!this.rl) {
            this.rl = readline.createInterface({ input: process.stdin });
        }
        const listener = (line: string) => {
            const trimmed = line.trim();
            if (trimmed) handler(trimmed);
        };
        this.rl.on('line', listener);
        return () => { this.rl?.off('line', listener); };
    }

    close(): void {
        this.rl?.close();
        this.rl = null;
        this.buffers.clear();
        this.hadTools.clear();
    }
}
