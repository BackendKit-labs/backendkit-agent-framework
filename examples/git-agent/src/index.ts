import * as readline from 'readline';
import { CallbackTransport, StructuredOutputError } from '@backendkit-labs/agent-core';
import { createGitEngine } from './engine';
import { repoReport } from './report';

let inputTokens = 0;
let outputTokens = 0;

const transport = new CallbackTransport((event) => {
    if (event.type === 'token')        process.stdout.write(event.content);
    if (event.type === 'tool_call')    console.log(`\n⚙  ${event.name}(${(event.args_preview ?? '').slice(0, 60)})`);
    if (event.type === 'tool_result')  console.log(`   ${event.success ? '✓' : '✗'} ${(event.preview ?? '').split('\n')[0]?.slice(0, 80)}`);
    if (event.type === 'agent_switch') console.log(`\n→ ${event.to_icon ?? ''} ${event.to_name ?? event.to}`);
    if (event.type === 'block_end')    console.log();
    if (event.type === 'error')        console.error(`\nError: ${event.message}`);
    // Usage, framework warnings (missing prices…) and the budget cap used to be invisible here.
    if (event.type === 'metrics')      { inputTokens += event.input_tokens; outputTokens += event.output_tokens; }
    if (event.type === 'system')       console.warn(`[${event.level}] ${event.text}`);
    if (event.type === 'budget_exceeded') {
        console.error(`\n⛔ Budget exceeded (${event.usage.budgetExceeded}): $${event.usage.runCostUsd.toFixed(4)} — run stopped.`);
    }
});

const engine = createGitEngine(transport);

function usageLine(): string {
    const cost = engine.observability?.getRunCost() ?? 0;
    return `   ↑ ${inputTokens} ↓ ${outputTokens} tokens${cost > 0 ? ` · $${cost.toFixed(4)}` : ''}`;
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

async function handle(input: string): Promise<void> {
    if (input.startsWith('/report')) {
        const cwd = input.slice('/report'.length).trim() || process.cwd();
        try {
            console.log(JSON.stringify(await repoReport(engine, cwd), null, 2));
        } catch (err) {
            if (err instanceof StructuredOutputError) console.error(`The model never produced a valid report. Last answer: ${err.raw.slice(0, 200)}`);
            else console.error(`Error: ${(err as Error).message}`);
        }
        return;
    }
    inputTokens = 0;
    outputTokens = 0;
    await engine.run(input);
    if (inputTokens + outputTokens > 0) console.log(usageLine());
}

function prompt() {
    rl.question('\n⎇  ', async (input) => {
        const trimmed = input.trim();
        if (!trimmed || trimmed === '/exit') { rl.close(); return; }
        await handle(trimmed);
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
   > /report [path]     typed repository health report

Type /exit to quit.
`);
prompt();
