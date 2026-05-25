import type { AgentEvent } from '@bk/agent-core';

// ── ANSI colors ───────────────────────────────────────────────────────────────
const c = {
    reset:   '\x1b[0m',
    bold:    '\x1b[1m',
    dim:     '\x1b[2m',
    green:   '\x1b[32m',
    cyan:    '\x1b[36m',
    yellow:  '\x1b[33m',
    red:     '\x1b[31m',
    magenta: '\x1b[35m',
    blue:    '\x1b[34m',
    gray:    '\x1b[90m',
};

const col = (color: string, text: string) => `${color}${text}${c.reset}`;

// ── State ─────────────────────────────────────────────────────────────────────
let currentAgent = '';
let isStreaming   = false;
let streamBuffer  = '';

function flushStream(): void {
    if (streamBuffer) {
        process.stdout.write('\n');
        streamBuffer = '';
    }
    isStreaming = false;
}

// ── Event renderer ────────────────────────────────────────────────────────────
export function renderEvent(event: AgentEvent): void {
    switch (event.type) {

        case 'ready':
            console.log(col(c.gray, '\n  system ready\n'));
            break;

        case 'block_start':
            flushStream();
            currentAgent = event.agent_name ?? event.agent_id;
            const icon   = event.agent_icon ?? '◆';
            console.log(`\n${col(c.bold + c.cyan, `  ${icon}  ${currentAgent}`)}`);
            console.log(col(c.gray, '  ' + '─'.repeat(50)));
            break;

        case 'block_end':
            flushStream();
            console.log(col(c.gray, '  ' + '─'.repeat(50)));
            break;

        case 'agent_switch':
            flushStream();
            const from = event.from === 'orchestrator' ? 'orchestrator' : event.from;
            const to   = event.to_name ?? event.to;
            console.log(col(c.gray, `\n  ${from} → ${col(c.cyan, to)}`));
            break;

        case 'token':
            if (!isStreaming) {
                process.stdout.write('  ');
                isStreaming = true;
            }
            streamBuffer += event.content;
            process.stdout.write(event.content);
            break;

        case 'tool_call':
            flushStream();
            const preview = event.args_preview ? col(c.gray, `  ${event.args_preview.slice(0, 60)}`) : '';
            console.log(`  ${col(c.yellow, '◌')} ${col(c.dim, event.name)}${preview}`);
            break;

        case 'tool_result':
            const resultIcon = event.success
                ? col(c.green, '◈')
                : col(c.red, '✗');
            const resultText = event.preview
                ? col(c.gray, `  ${event.preview.slice(0, 80)}`)
                : '';
            console.log(`  ${resultIcon} ${col(c.dim, event.name)}${resultText}`);
            break;

        case 'thinking':
            console.log(`  ${col(c.gray, `… ${event.label}`)}`);
            break;

        case 'metrics':
            const cost = event.cost_usd !== undefined
                ? `  $${event.cost_usd.toFixed(4)}`
                : '';
            console.log(col(c.gray, `\n  ↑${event.input_tokens.toLocaleString()} ↓${event.output_tokens.toLocaleString()} tokens${cost}`));
            break;

        case 'done':
            flushStream();
            console.log(col(c.green, '\n  ✓ done\n'));
            break;

        case 'error':
            flushStream();
            console.log(`\n  ${col(c.red, '✗ error:')} ${event.message}\n`);
            break;

        case 'system':
            if (event.level === 'info') break;
            const levelColor = event.level === 'error' ? c.red : c.yellow;
            console.log(`  ${col(levelColor, `⚠ ${event.text}`)}`);
            break;
    }
}
