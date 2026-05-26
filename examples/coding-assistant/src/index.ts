import * as readline from 'readline';
import * as path from 'path';
import { createCodingEngineFromConfig, ConfigLoader, AgentLoader, InitWorkflow, CODING_AGENTS } from '@bk/agent-coding';
import type { AgentProfile } from '@bk/agent-core';
import { CallbackTransport } from '@bk/agent-core';
import { renderEvent } from './display';

// ── Config ────────────────────────────────────────────────────────────────────
const APP_NAME    = process.env.AGENT_APP_NAME ?? 'coding-assistant';
const loader      = new ConfigLoader(APP_NAME);
const config      = loader.load();
const AGENT_ID    = process.env.AGENT_ID    ?? 'general';
const WORKING_DIR = process.env.WORKING_DIR ?? process.cwd();

if (!config.defaultProvider) {
    console.error('Error: set at least one of DEEPSEEK_API_KEY, ANTHROPIC_API_KEY, OPENAI_API_KEY');
    console.error(`       or add providers to ${loader.configPath}`);
    process.exit(1);
}

// ── Banner ────────────────────────────────────────────────────────────────────
function printBanner(): void {
    const allAgents = AgentLoader.load({ appName: APP_NAME, cwd: WORKING_DIR, builtins: CODING_AGENTS });
    const agentList = allAgents.map((a: AgentProfile) => {
        const tag = a.source === 'project' ? '*' : a.source === 'global' ? '+' : '';
        return `${a.icon} ${a.id}${tag}`;
    }).join('  ');
    const dirs = AgentLoader.dirs(APP_NAME, WORKING_DIR);
    console.log('\n\x1b[1m\x1b[36m  bk-agent-coding\x1b[0m\x1b[2m  v0.1.0\x1b[0m');
    console.log(`\x1b[90m  app:      ${APP_NAME}  provider: ${config.defaultProvider}\x1b[0m`);
    console.log(`\x1b[90m  config:   ${loader.configPath}\x1b[0m`);
    console.log(`\x1b[90m  agent:    ${AGENT_ID}\x1b[0m`);
    console.log(`\x1b[90m  cwd:      ${WORKING_DIR}\x1b[0m`);
    console.log(`\x1b[90m  agents:   ${agentList}\x1b[0m`);
    console.log(`\x1b[90m  [+] global: ${dirs.global}  [*] project: ${dirs.project}\x1b[0m`);
    console.log('\x1b[90m\n  Commands: /init  /agent list | new <id> [--global] | <id>  /cwd <path>  /clear  /quit\x1b[0m\n');
}

// ── Engine factory ────────────────────────────────────────────────────────────
function makeEngine(agentId: string, cwd: string) {
    const transport = new CallbackTransport(renderEvent);
    const engine = createCodingEngineFromConfig({
        appName: APP_NAME,
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
                case 'agent': {
                    const [sub, ...subArgs] = arg ? arg.split(' ') : ['list'];

                    if (sub === 'list' || !sub) {
                        const all = AgentLoader.load({ appName: APP_NAME, cwd: currentCwd, builtins: CODING_AGENTS });
                        const bySource: Record<string, AgentProfile[]> = { project: [], global: [], builtin: [] };
                        for (const a of all) bySource[a.source ?? 'builtin'].push(a);
                        const fmt = (a: AgentProfile) => `${a.icon} ${a.id}`;
                        if (bySource.project.length) console.log(`  \x1b[1mproject\x1b[0m  ${bySource.project.map(fmt).join('  ')}`);
                        if (bySource.global.length)  console.log(`  \x1b[1mglobal \x1b[0m  ${bySource.global.map(fmt).join('  ')}`);
                        if (bySource.builtin.length) console.log(`  \x1b[1mbuiltin\x1b[0m  ${bySource.builtin.map(fmt).join('  ')}`);
                        const dirs = AgentLoader.dirs(APP_NAME, currentCwd);
                        console.log(`\x1b[90m  global:  ${dirs.global}\x1b[0m`);
                        console.log(`\x1b[90m  project: ${dirs.project}\x1b[0m`);

                    } else if (sub === 'new') {
                        const newId   = subArgs.find(s => !s.startsWith('--'));
                        const isGlobal = subArgs.includes('--global');
                        if (!newId) {
                            console.log('  Usage: /agent new <id> [--global]');
                        } else {
                            const scope = isGlobal ? 'global' : 'project';
                            AgentLoader.scaffold(newId, { appName: APP_NAME, cwd: currentCwd, scope });
                            const dirs = AgentLoader.dirs(APP_NAME, currentCwd);
                            const dir  = isGlobal ? dirs.global : dirs.project;
                            console.log(`\x1b[90m  created ${dir}\\${newId}.json\x1b[0m`);
                            console.log(`\x1b[90m          ${dir}\\${newId}.md\x1b[0m`);
                            console.log(`\x1b[90m  edit the .md to write the system prompt — restart to load\x1b[0m`);
                        }

                    } else {
                        const all = AgentLoader.load({ appName: APP_NAME, cwd: currentCwd, builtins: CODING_AGENTS });
                        if (!all.find((a: AgentProfile) => a.id === sub)) {
                            console.log(`  Unknown agent "${sub}". Run /agent list to see available agents.`);
                        } else {
                            currentAgent = sub;
                            ({ engine } = makeEngine(currentAgent, currentCwd));
                            console.log(`\x1b[90m  switched to ${sub}\x1b[0m`);
                        }
                    }
                    break;
                }

                case 'cwd':
                    if (!arg) {
                        console.log(`  cwd: ${currentCwd}`);
                    } else {
                        currentCwd = path.resolve(arg);
                        ({ engine } = makeEngine(currentAgent, currentCwd));
                        console.log(`\x1b[90m  cwd: ${currentCwd}\x1b[0m`);
                    }
                    break;

                case 'init': {
                    const mode = InitWorkflow.detectMode(currentCwd);
                    const modeLabel = { new: 'new project', existing: 'existing project', hybrid: 'hybrid' }[mode];
                    console.log(`\x1b[90m  /init — detected: ${modeLabel}\x1b[0m`);
                    if (mode === 'new') {
                        const hasPrompt = require('fs').existsSync(require('path').join(currentCwd, 'prompt.md'));
                        if (!hasPrompt) {
                            console.log(`\x1b[33m  No prompt.md found. Create one describing what you want to build, then run /init again.\x1b[0m`);
                            rl.prompt();
                            return;
                        }
                    }
                    const initPrompt = InitWorkflow.buildPrompt(currentCwd, mode);
                    const { engine: initEngine } = makeEngine('project-manager', currentCwd);
                    running = true;
                    rl.pause();
                    try {
                        await initEngine.run(initPrompt);
                    } catch (err) {
                        console.error(`\n  \x1b[31mInit error:\x1b[0m ${(err as Error).message}\n`);
                    } finally {
                        running = false;
                        rl.resume();
                        rl.prompt();
                    }
                    return;
                }

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
