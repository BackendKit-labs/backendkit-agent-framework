import * as path from 'path';
import * as fs from 'fs';
import { askQuestions } from './prompts';
import { scaffold, installDeps } from './scaffold';

const FRAMEWORK_VERSION = '0.14.0';

const NEXT_STEPS: Record<string, string[]> = {
    coding:        ['Edit AGENT.md to describe your project', 'npm run dev'],
    'domain-agent': ['Rename agents/ and tools/ to match your domain', 'Implement tools in src/tools/', 'npm run dev'],
    autonomous:    ['Configure triggers in src/index.ts', 'npm run dev (or npm start in production)'],
    'mcp-server':  ['Register tools in src/server.ts', 'npm run build && npx my-mcp-server'],
    minimal:       ['Implement your LLMProvider in src/index.ts', 'npm run dev'],
};

export async function main(argv: string[]): Promise<void> {
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

    console.log(`\nCreating ${choices.template} agent in ./${choices.projectName} ...`);

    try {
        scaffold(choices, targetDir);
    } catch (err) {
        console.error(`\n✗  ${(err as Error).message}`);
        process.exit(1);
    }

    console.log('Installing dependencies...\n');
    installDeps(targetDir);

    const steps = NEXT_STEPS[choices.template] ?? ['npm run dev'];

    console.log(`
✅  Done! Your agent is ready.

   cd ${choices.projectName}
   cp .env.example .env      # add your API key
${steps.map(s => `   ${s}`).join('\n')}

Documentation: https://github.com/BackendKit-labs/backendkit-agent-framework
`);
}
