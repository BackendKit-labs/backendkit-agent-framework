import { detectProject } from './detector';
import { addServer }     from './modules/server';
import { addSpecialist } from './modules/specialist';
import { addTools }      from './modules/tools';
import { addMcpClient }  from './modules/mcp-client';
import { addPlugin }     from './modules/plugin';
import { addKnowledge }  from './modules/knowledge';
import { addTesting }    from './modules/testing';

const HELP = `
Usage: npx create-bk-agent add <module> [options]

Modules:
  server                Add an HTTP MCP server (src/server.ts)
    --port <n>            Port to listen on  (default: 3001)
    --name <s>            MCP server name    (default: project directory name)

  specialist <name>     Add a new specialist agent to a multi-agent project
                        (creates src/agents/<name>.ts and patches engine.ts)

  tools <domain>        Add a tool file for a new domain
                        (creates src/tools/<domain>-tools.ts and patches engine.ts)

  knowledge <path>      Add a folder or vault to the RAG knowledge base (enterprise agents)
    --vault <path>        Register an entirely new Obsidian vault (instead of a subfolder)

  mcp-client <url>      Add a remote MCP server to the engine
    --name <s>            Name for the mcpServers entry (default: last URL segment)

  plugin <name>         Install a backendkit agent as a stdio MCP plugin
                        Available: docker, k8s

  testing               Set up tests that need no API key: agent-testkit + jest,
                        a jest.config.js, a "test" script and an example test

Examples:
  npx create-bk-agent add server --port 4000
  npx create-bk-agent add specialist data-analyst
  npx create-bk-agent add tools github
  npx create-bk-agent add knowledge ./docs
  npx create-bk-agent add knowledge "04-Recursos/Backend"
  npx create-bk-agent add knowledge --vault "C:/Company/HR-Vault"
  npx create-bk-agent add mcp-client http://localhost:3001/mcp --name billing
  npx create-bk-agent add plugin docker
  npx create-bk-agent add plugin k8s
  npx create-bk-agent add testing
`;

export function runAdd(args: string[], cwd: string): void {
    const [module, ...rest] = args;

    if (!module || module === '--help' || module === '-h') {
        console.log(HELP);
        process.exit(0);
    }

    const info = detectProject(cwd);
    if (!info) {
        console.error(
            '\n✗  No bk-agent project detected in the current directory.\n' +
            '   Make sure you are inside a project created with npx create-bk-agent.\n',
        );
        process.exit(1);
    }

    switch (module) {
        case 'server':
            addServer(info, rest);
            break;

        case 'specialist':
            if (info.architecture !== 'multi-agent') {
                console.error(
                    `\n⚠  "add specialist" is designed for multi-agent projects.\n` +
                    `   Detected architecture: ${info.architecture}.\n` +
                    `   Proceeding anyway — verify engine.ts manually.\n`,
                );
            }
            addSpecialist(info, rest);
            break;

        case 'tools':
            addTools(info, rest);
            break;

        case 'mcp-client':
            addMcpClient(info, rest);
            break;

        case 'plugin':
            addPlugin(info, rest);
            break;

        case 'knowledge':
            addKnowledge(info, rest);
            break;

        case 'testing':
            addTesting(info, rest);
            break;

        default:
            console.error(`\n✗  Unknown module: "${module}"\n`);
            console.log(HELP);
            process.exit(1);
    }
}
