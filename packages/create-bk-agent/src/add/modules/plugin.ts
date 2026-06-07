import * as fs from 'fs';
import { execSync } from 'child_process';
import type { BkProjectInfo } from '../detector';
import { addPackageDependency, addMcpStdioEntry } from '../patcher';

interface PluginDef {
    npm: string;
    tools: string[];
    envHint?: string;
}

const PLUGINS: Record<string, PluginDef> = {
    docker: {
        npm: '@backendkit-labs/docker-agent',
        tools: ['docker_execute', 'docker_deploy', 'docker_status'],
        envHint: 'Requires: OPENAI_API_KEY (or LLM_API_KEY) and Docker daemon running.',
    },
    k8s: {
        npm: '@backendkit-labs/k8s-agent',
        tools: ['k8s_execute', 'k8s_deploy', 'k8s_status'],
        envHint: 'Requires: OPENAI_API_KEY (or LLM_API_KEY) and kubectl configured.',
    },
};

export function addPlugin(info: BkProjectInfo, args: string[]): void {
    const pluginName = args[0];

    if (!pluginName) {
        console.log('\nUsage: npx create-bk-agent add plugin <name>\n');
        console.log('Available plugins:');
        for (const [name, def] of Object.entries(PLUGINS)) {
            console.log(`  ${name.padEnd(10)} ${def.npm}`);
        }
        console.log('');
        process.exit(0);
    }

    const plugin = PLUGINS[pluginName];
    if (!plugin) {
        console.error(`\n✗  Unknown plugin: "${pluginName}"`);
        console.error(`   Available: ${Object.keys(PLUGINS).join(', ')}\n`);
        process.exit(1);
    }

    if (!fs.existsSync(info.engineFile)) {
        console.error('\n✗  src/engine.ts not found.\n');
        process.exit(1);
    }

    console.log(`\n  Installing ${plugin.npm}...`);
    const added = addPackageDependency(info.pkgFile, plugin.npm, 'latest');
    if (added) {
        execSync('npm install', { cwd: info.cwd, stdio: 'inherit' });
    }

    console.log(`  Patching src/engine.ts...`);
    const ok = addMcpStdioEntry(info.engineFile, pluginName, plugin.npm);

    if (!ok) {
        console.error('\n✗  Could not locate AgentEngine constructor in src/engine.ts.\n');
        process.exit(1);
    }

    console.log(`\n  ✅ Plugin "${pluginName}" added.\n`);
    console.log(`     MCP tools exposed:`);
    for (const tool of plugin.tools) console.log(`       ${tool}`);
    if (plugin.envHint) console.log(`\n     ${plugin.envHint}`);
    console.log('');
}
