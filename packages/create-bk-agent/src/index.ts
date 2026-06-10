import * as path from 'path';
import * as fs from 'fs';
import { askQuestions } from './prompts';
import { scaffold, installDeps } from './scaffold';
import { runAdd } from './add/index';
import type { UserChoices } from './prompts';

// Read version from package.json so it always matches the published version
const FRAMEWORK_VERSION: string = (() => {
    try {
        const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf-8'));
        return pkg.version ?? '0.16.0';
    } catch {
        return '0.16.0';
    }
})();

// ── Human-readable label for the scaffold banner ──────────────────────────────

function describeChoices(choices: UserChoices): string {
    const arch: Record<string, string> = {
        'multi-agent': 'Multi-agent',
        single:        'Single-agent',
        coding:        'Coding assistant',
        autonomous:    'Autonomous daemon',
        minimal:       'Minimal / embedded',
        enterprise:    'Enterprise (local LLM + RAG)',
    };
    const deploy: Record<string, string> = {
        repl:       'Terminal REPL',
        'mcp-http': 'MCP Server (HTTP)',
        'mcp-stdio':'MCP Server (stdio)',
        hybrid:     'REPL + MCP Server',
        library:    'Library',
    };

    const archLabel = arch[choices.architecture] ?? choices.architecture;
    if (!choices.deployMode) return archLabel;
    return `${archLabel} — ${deploy[choices.deployMode] ?? choices.deployMode}`;
}

// ── Next steps after scaffold ─────────────────────────────────────────────────

function buildNextSteps(choices: UserChoices): string[] {
    const { architecture: arch, deployMode: mode } = choices;

    // Self-contained architectures
    if (arch === 'coding')     return ['Edit AGENT.md to describe your project', 'npm run dev'];
    if (arch === 'autonomous') return ['Configure triggers in src/index.ts', 'npm run dev'];
    if (arch === 'minimal')    return ['Implement your LLM provider in src/index.ts', 'npm run dev'];

    // Enterprise — local LLM + RAG
    if (arch === 'enterprise') {
        return [
            'Make sure Ollama is running:  ollama serve',
            'Pull required models:         ollama pull llama3.2 && ollama pull nomic-embed-text',
            'Review your vault path in .env (VAULT_PATH)',
            'Customize agents in src/agents/ for your business domain',
            mode === 'repl' ? 'npm run dev' : 'npm run server',
        ];
    }

    // Layered architectures (multi-agent, single) — vary by deploy mode
    const domainSteps =
        arch === 'multi-agent'
            ? ['Rename agents/ and tools/ to match your domain', 'Implement tools in src/tools/']
            : ['Implement tools in src/tools/'];

    if (mode === 'repl')       return [...domainSteps, 'npm run dev'];
    if (mode === 'mcp-http')   return [...domainSteps, 'npm run server   # starts HTTP MCP on port 3001'];
    if (mode === 'mcp-stdio')  return [...domainSteps, 'npm run build', 'node dist/server.js'];
    if (mode === 'hybrid')     return [...domainSteps, 'npm run dev', '# in another terminal:', 'npm run server'];
    if (mode === 'library')    return [...domainSteps, '# import { createEngine } from \'./src/engine\' in your app'];

    return ['npm run dev'];
}

// ── Main ──────────────────────────────────────────────────────────────────────

export async function main(argv: string[]): Promise<void> {
    if (argv[2] === 'add') {
        runAdd(argv.slice(3), process.cwd());
        return;
    }

    const projectArg = argv[2];

    console.log(`\n✨  create-bk-agent  v${FRAMEWORK_VERSION}\n`);

    const defaultName = projectArg ?? 'my-agent';
    const choices = await askQuestions(defaultName);

    if (!choices) {
        console.log('\nCancelled.');
        process.exit(0);
    }

    const targetDir = path.resolve(process.cwd(), choices.projectName);

    if (fs.existsSync(targetDir)) {
        console.error(`\n✗  Directory already exists: ${targetDir}`);
        process.exit(1);
    }

    console.log(`\nCreating ${describeChoices(choices)} agent in ./${choices.projectName} ...`);

    try {
        scaffold(choices, targetDir);
    } catch (err) {
        console.error(`\n✗  ${(err as Error).message}`);
        process.exit(1);
    }

    console.log('Installing dependencies...\n');
    installDeps(targetDir);

    const steps = buildNextSteps(choices);

    console.log(`
✅  Done! Your agent is ready.

   cd ${choices.projectName}
   cp .env.example .env      # add your API key
${steps.map(s => `   ${s}`).join('\n')}

Documentation: https://github.com/BackendKit-labs/backendkit-agent-framework
`);
}
