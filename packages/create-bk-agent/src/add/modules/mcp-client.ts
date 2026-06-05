import * as fs from 'fs';
import type { BkProjectInfo } from '../detector';
import { addMcpServerEntry } from '../patcher';

export function addMcpClient(info: BkProjectInfo, args: string[]): void {
    const url = args[0];
    if (!url) {
        console.error('\n✗  Usage: add mcp-client <url> [--name <name>]\n');
        process.exit(1);
    }

    let name = url.split('/').filter(Boolean).pop() ?? 'remote-agent';
    for (let i = 1; i < args.length; i++) {
        if (args[i] === '--name' && args[i + 1]) { name = args[++i]; break; }
    }

    if (!fs.existsSync(info.engineFile)) {
        console.error('\n✗  src/engine.ts not found.\n');
        process.exit(1);
    }

    const ok = addMcpServerEntry(info.engineFile, name, url);

    if (ok) {
        console.log(`\n✓  Patched src/engine.ts  (mcpServers: { name: '${name}', url: '${url}' })`);
        console.log(`\nNext steps:\n   npm run dev\n`);
    } else {
        console.error('\n✗  Could not locate AgentEngine constructor to inject mcpServers.\n');
        process.exit(1);
    }
}
