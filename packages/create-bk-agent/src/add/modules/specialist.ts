import * as fs from 'fs';
import * as path from 'path';
import type { BkProjectInfo } from '../detector';
import { addImportLine, insertAfterPattern } from '../patcher';
import { assertValidName } from '../names';

function toConstName(name: string): string {
    return name.replace(/-/g, '_').toUpperCase() + '_PROFILE';
}

function toDisplayName(name: string): string {
    return name.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function generateSpecialistTs(name: string): string {
    const constName = toConstName(name);
    return `import type { AgentProfile } from '@backendkit-labs/agent-core';

// TODO: Rename this file and export to match your domain
export const ${constName}: AgentProfile = {
    id: '${name}',
    name: '${toDisplayName(name)}',
    icon: '🔧',
    description: 'TODO: describe what this specialist does',
    delegatesTo: [],
    allowedTools: [
        // TODO: list the tool names this agent can use
    ],
    systemPrompt: \`You are a specialist in TODO: <your domain area>.

Use the available tools to complete the task delegated to you.
Be precise and report results clearly.\`,
};
`;
}

export function addSpecialist(info: BkProjectInfo, args: string[]): void {
    const name = args[0];
    if (!name) {
        console.error('\n✗  Usage: add specialist <name>\n');
        process.exit(1);
    }

    assertValidName('specialist name', name);
    const agentFile = path.join(info.cwd, 'src', 'agents', `${name}.ts`);
    if (fs.existsSync(agentFile)) {
        console.error(`\n✗  src/agents/${name}.ts already exists.\n`);
        process.exit(1);
    }

    fs.writeFileSync(agentFile, generateSpecialistTs(name));
    console.log(`\n✓  Created src/agents/${name}.ts`);

    if (fs.existsSync(info.engineFile)) {
        const constName = toConstName(name);

        addImportLine(info.engineFile, `import { ${constName} } from './agents/${name}';`);

        // Primary: insert after TODO comment; fallback: after last .register( call
        const inserted =
            insertAfterPattern(info.engineFile, /\/\/ TODO: register more specialists/, `    agents.register(${constName});`) ||
            insertAfterPattern(info.engineFile, /agents\.register\(/, `    agents.register(${constName});`);

        if (inserted) {
            console.log(`✓  Patched src/engine.ts  (agents.register(${constName}))`);
        } else {
            console.log(`⚠  Could not auto-patch engine.ts — add manually: agents.register(${constName})`);
        }

        const orchestratorFile = path.join(info.cwd, 'src', 'agents', 'orchestrator.ts');
        if (fs.existsSync(orchestratorFile)) {
            console.log(`\n  Reminder: add '${name}' to orchestrator.ts delegatesTo[] and update the systemPrompt.`);
        }
    }

    console.log(`\nNext steps:\n   Implement src/agents/${name}.ts\n   npm run dev\n`);
}
