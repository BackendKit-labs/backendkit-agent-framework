import * as readline from 'readline';
import { CallbackTransport } from '@backendkit-labs/agent-core';
import { createGitEngine } from './engine';

const transport = new CallbackTransport((event) => {
    if (event.type === 'token')        process.stdout.write(event.content);
    if (event.type === 'tool_call')    console.log(`\n⚙  ${event.name}(${(event.args_preview ?? '').slice(0, 60)})`);
    if (event.type === 'tool_result')  console.log(`   ${event.success ? '✓' : '✗'} ${(event.preview ?? '').split('\n')[0]?.slice(0, 80)}`);
    if (event.type === 'agent_switch') console.log(`\n→ ${event.to_icon ?? ''} ${event.to_name ?? event.to}`);
    if (event.type === 'block_end')    console.log();
    if (event.type === 'error')        console.error(`\nError: ${event.message}`);
});

const engine = createGitEngine(transport);

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function prompt() {
    rl.question('\n⎇  ', async (input) => {
        const trimmed = input.trim();
        if (!trimmed || trimmed === '/exit') { rl.close(); return; }
        await engine.run(trimmed);
        prompt();
    });
}

console.log(`
⎇  git-agent — 5 specialists ready
   committer · brancher · merger · inspector · recovery

   Examples:
   > show me the last 10 commits
   > create branch feat/user-auth
   > commit all staged changes with message "fix: null pointer in login"
   > I accidentally reset --hard, help me recover
   > merge feature/payments into main without fast-forward

Type /exit to quit.
`);
prompt();
