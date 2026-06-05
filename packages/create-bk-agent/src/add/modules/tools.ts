import * as fs from 'fs';
import * as path from 'path';
import type { BkProjectInfo } from '../detector';
import { addImportLine, insertAfterPattern } from '../patcher';

function toCamelCase(name: string): string {
    return name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

function generateToolsTs(domain: string): string {
    const fn = toCamelCase(domain);
    return `import { defineTool, z } from '@backendkit-labs/agent-core';

// TODO: replace with real ${domain} SDK/API calls

export const ${fn}Action = defineTool({
    name: '${domain}_action',
    description: 'TODO: describe what this tool does',
    input: z.object({
        target: z.string().describe('Target to act on'),
        // TODO: add more parameters
    }),
    execute: async ({ target }) => {
        // TODO: implement
        return \`${domain} action on: \${target}\`;
    },
});

export const ${fn}Query = defineTool({
    name: '${domain}_query',
    description: 'TODO: describe what this query returns',
    input: z.object({
        filter: z.string().optional().describe('Optional filter'),
    }),
    execute: async ({ filter }) => {
        // TODO: implement
        return JSON.stringify({ results: [], filter });
    },
});
`;
}

export function addTools(info: BkProjectInfo, args: string[]): void {
    const domain = args[0];
    if (!domain) {
        console.error('\n✗  Usage: add tools <domain>\n');
        process.exit(1);
    }

    const toolsFile = path.join(info.cwd, 'src', 'tools', `${domain}-tools.ts`);
    if (fs.existsSync(toolsFile)) {
        console.error(`\n✗  src/tools/${domain}-tools.ts already exists.\n`);
        process.exit(1);
    }

    fs.mkdirSync(path.dirname(toolsFile), { recursive: true });
    fs.writeFileSync(toolsFile, generateToolsTs(domain));
    console.log(`\n✓  Created src/tools/${domain}-tools.ts`);

    if (fs.existsSync(info.engineFile)) {
        const fn = toCamelCase(domain);

        addImportLine(
            info.engineFile,
            `import { ${fn}Action, ${fn}Query } from './tools/${domain}-tools';`,
        );

        const inserted =
            insertAfterPattern(info.engineFile, /\/\/ TODO: register more tools/, `    tools.register(${fn}Action).register(${fn}Query);`) ||
            insertAfterPattern(info.engineFile, /tools\.register\(/, `    tools.register(${fn}Action).register(${fn}Query);`);

        if (inserted) {
            console.log(`✓  Patched src/engine.ts  (tools.register(${fn}Action, ${fn}Query))`);
        } else {
            console.log(`⚠  Could not auto-patch engine.ts — add manually: tools.register(${fn}Action).register(${fn}Query)`);
        }
    }

    console.log(`\nNext steps:\n   Implement src/tools/${domain}-tools.ts\n   npm run dev\n`);
}
