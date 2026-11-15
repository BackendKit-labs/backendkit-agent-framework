import * as fs from 'fs';
import * as path from 'path';
import type { BkProjectInfo } from '../detector';
import { addPackageDependency, addPackageScript } from '../patcher';

interface ServerOptions {
    port: number;
    name: string;
}

function parseArgs(args: string[], defaultName: string): ServerOptions {
    let port = 3001;
    let name = defaultName;
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--port' && args[i + 1]) port = parseInt(args[++i]);
        if (args[i] === '--name' && args[i + 1]) name = args[++i];
    }
    return { port, name };
}

function generateServerTs(info: BkProjectInfo, opts: ServerOptions): string {
    return `import 'dotenv/config';
import { AgentMCPServer } from '@backendkit-labs/mcp-server';
import { CallbackTransport } from '@backendkit-labs/agent-core';
import { z } from 'zod';
import { ${info.engineFnName} } from './engine';

const server = new AgentMCPServer({
    name:    '${opts.name}',
    version: '1.0.0',
    port:    parseInt(process.env.MCP_PORT ?? '${opts.port}'),

    tools: [
        {
            name:        'agent_request',
            description: 'TODO: describe what requests this agent handles',
            schema: {
                request: z.string().describe('Natural-language request for the agent'),
            },
            buildPrompt: ({ request }: { request: string }) => request,
        },
    ],

    engineFactory: (transport: CallbackTransport) => ${info.engineFnName}(transport),
});

await server.start();
`;
}

export function addServer(info: BkProjectInfo, args: string[]): void {
    const opts = parseArgs(args, path.basename(info.cwd));

    if (fs.existsSync(info.serverFile)) {
        console.error(`\n✗  src/server.ts already exists. Remove it first to regenerate.\n`);
        process.exit(1);
    }

    fs.writeFileSync(info.serverFile, generateServerTs(info, opts));
    console.log(`\n✓  Created src/server.ts  (HTTP MCP on port ${opts.port})`);

    const added = addPackageDependency(info.pkgFile, '@backendkit-labs/mcp-server', '^0.19.2');
    addPackageDependency(info.pkgFile, 'zod', '^4.6.6');
    addPackageScript(info.pkgFile, 'server', 'ts-node src/server.ts');

    if (added) {
        console.log(`✓  package.json  (@backendkit-labs/mcp-server added)`);
    }
    console.log(`✓  package.json  (script "server" added)`);

    console.log(`
Next steps:
   npm install
   npm run server        # starts HTTP MCP on port ${opts.port}
`);
}
