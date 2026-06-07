import * as readline from 'readline';
import { CallbackTransport } from '@backendkit-labs/agent-core';
import { createEngine } from './engine';

const transport = new CallbackTransport((event) => {
    if (event.type === 'token')        process.stdout.write(event.content);
    if (event.type === 'tool_call')    console.log(`\n⚙  ${event.name}`);
    if (event.type === 'agent_switch') console.log(`\n→ ${event.to_name ?? event.to}`);
    if (event.type === 'block_end')    console.log();
    if (event.type === 'error')        console.error(`\nError: ${event.message}`);
});

const engine = createEngine(transport);

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function prompt() {
    rl.question('\n> ', async (input) => {
        const trimmed = input.trim();
        if (!trimmed || trimmed === '/exit') { rl.close(); return; }
        await engine.run(trimmed);
        prompt();
    });
}

console.log('Agent ready. Type your request or /exit to quit.\n');
prompt();
