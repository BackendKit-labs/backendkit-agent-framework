import * as readline from 'readline';
import * as path from 'path';
import { createCodingEngineFromConfig, ConfigLoader, CODING_AGENTS } from '@bk/agent-coding';
import type { AgentProfile } from '@bk/agent-core';
import { CallbackTransport } from '@bk/agent-core';
import { renderEvent } from './display';

// ── Config ────────────────────────────────────────────────────────────────────
const config      = ConfigLoader.load();
const AGENT_ID    = process.env.AGENT_ID    ?? 'general';
const WORKING_DIR = process.env.WORKING_DIR ?? process.cwd();

if (!config.defaultProvider) {
    console.error('Error: set at least one of DEEPSEEK_API_KEY, ANTHROPIC_API_KEY, OPENAI_API_KEY');
    console.error(`       or add providers to ${ConfigLoader.configPath}`);
    process.exit(1);
}

// ── Banner ────────────────────────────────────────────────────────────────────
function printBanner(): void {
    const agents = CODING_AGENTS.map((a: AgentProfile) => `${a.icon} ${a.id}`).join('  ');
    console.log('\n\x1b[1m\x1b[36m  bk-agent-coding\x1b[0m\x1b[2m  v0.1.0\x1b[0m');
    console.log(`\x1b[90m  provider: ${config.defaultProvider}  config: ${ConfigLoader.configPath}\x1b[0m`);
    console.log(`\x1b[90m  agent:    ${AGENT_ID}\x1b[0m`);
    console.log(`\x1b[90m  cwd:      ${WORKING_DIR}\x1b[0m`);
    console.log(`\x1b[90m  agents:   ${agents}\x1b[0m`);
    console.log('\x1b[90m\n  Commands: /agent <id>  /cwd <path>  /clear  /quit\x1b[0m\n');
}

// ── Engine factory ────────────────────────────────────────────────────────────
function makeEngine(agentId: string, cwd: string) {
    const transport = new CallbackTransport(renderEvent);
    const engine = createCodingEngineFromConfig({
        defaultAgent: agentId,
        workingDir: cwd,
        transport,
    });
    return { engine, transport };
}

// ── REPL ──────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
    printBanner();

    let currentAgent = AGENT_ID;
    let currentCwd   = WORKING_DIR;
    let { engine }   = makeEngine(currentAgent, currentCwd);
    let running      = false;

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: '\x1b[32m❯\x1b[0m ',
    });

    rl.prompt();

    rl.on('line', async (line) => {
        const input = line.trim();
        if (!input) { rl.prompt(); return; }

        // ── Slash commands ────────────────────────────────────────────────────
        if (input.startsWith('/')) {
            const [cmd, ...rest] = input.slice(1).split(' ');
            const arg = rest.join(' ').trim();

            switch (cmd) {
                case 'agent':
                    if (!arg) {
                        console.log(`  Available: ${CODING_AGENTS.map((a: AgentProfile) => a.id).join(', ')}`);
                    } else if (!CODING_AGENTS.find((a: AgentProfile) => a.id === arg)) {
                        console.log(`  Unknown agent "${arg}"`);
                    } else {
                        currentAgent = arg;
                        ({ engine } = makeEngine(currentAgent, currentCwd));
                        console.log(`\x1b[90m  switched to ${arg}\x1b[0m`);
                    }
                    break;

                case 'cwd':
                    if (!arg) {
                        console.log(`  cwd: ${currentCwd}`);
                    } else {
                        currentCwd = path.resolve(arg);
                        ({ engine } = makeEngine(currentAgent, currentCwd));
                        console.log(`\x1b[90m  cwd: ${currentCwd}\x1b[0m`);
                    }
                    break;

                case 'clear':
                    ({ engine } = makeEngine(currentAgent, currentCwd));
                    console.clear();
                    printBanner();
                    break;

                case 'quit':
                case 'exit':
                case 'q':
                    console.log('\x1b[90m  bye\x1b[0m\n');
                    rl.close();
                    process.exit(0);
                    break;

                default:
                    console.log(`  Unknown command: /${cmd}`);
            }

            rl.prompt();
            return;
        }

        // ── Run agent ─────────────────────────────────────────────────────────
        if (running) {
            console.log('\x1b[90m  (busy — wait for current task to finish)\x1b[0m');
            return;
        }

        running = true;
        rl.pause();

        try {
            await engine.run(input);
        } catch (err) {
            console.error(`\n  \x1b[31mFatal:\x1b[0m ${(err as Error).message}\n`);
        } finally {
            running = false;
            rl.resume();
            rl.prompt();
        }
    });

    rl.on('close', () => process.exit(0));
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
