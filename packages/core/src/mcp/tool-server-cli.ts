import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createToolServer, type ToolServerOptions } from './tool-server';
import { startToolServerHttp, type RunningToolServer, type ToolServerHttpOptions } from './tool-server-http';

/**
 * The `bk-mcp`-style command line every direct tool server ends up needing: stdio by default,
 * `--http --port <n> --host <h> --token <t>` for Streamable HTTP, `--help`. Logs go to stderr because in
 * stdio mode stdout is the protocol channel.
 */

export interface ToolServerCliArgs {
    mode: 'stdio' | 'http';
    port?: number;
    host?: string;
    token?: string;
    help: boolean;
    /** Flags that were not understood, so the caller can refuse them. */
    unknown: string[];
}

export interface ToolServerCliOptions {
    /** Default `process.argv.slice(2)`. */
    argv?: string[];
    /** Default `process.env`. */
    env?: Record<string, string | undefined>;
    /** Environment variable that provides the token when `--token` is absent. Default 'BK_MCP_TOKEN'. */
    tokenEnv?: string;
    /** Name shown in `--help`. Default 'bk-mcp'. */
    bin?: string;
    /** HTTP defaults the flags override. */
    http?: Omit<ToolServerHttpOptions, 'authToken'>;
    /** Where startup messages go. Default: stderr. */
    log?: (line: string) => void;
}

export interface RunningToolServerCli {
    mode: 'stdio' | 'http' | 'help';
    /** Present in HTTP mode. */
    url?: string;
    close(): Promise<void>;
}

const KNOWN_FLAGS = new Set(['--http', '--stdio', '--port', '--host', '--token', '--help', '-h']);
const VALUE_FLAGS = new Set(['--port', '--host', '--token']);

export function parseToolServerArgs(
    argv: string[],
    env: Record<string, string | undefined> = {},
    tokenEnv = 'BK_MCP_TOKEN',
): ToolServerCliArgs {
    const out: ToolServerCliArgs = { mode: 'stdio', help: false, unknown: [] };
    for (let i = 0; i < argv.length; i++) {
        const flag = argv[i];
        const value = VALUE_FLAGS.has(flag) ? argv[++i] : undefined;
        switch (flag) {
            case '--http': out.mode = 'http'; break;
            case '--stdio': out.mode = 'stdio'; break;
            case '--help': case '-h': out.help = true; break;
            case '--port': {
                const n = Number(value);
                if (!Number.isInteger(n) || n < 0 || n > 65535) throw new Error(`--port expects a number between 0 and 65535 (got ${String(value)})`);
                out.port = n; break;
            }
            case '--host':
                if (!value) throw new Error('--host expects a value');
                out.host = value; break;
            case '--token':
                if (!value) throw new Error('--token expects a value');
                out.token = value; break;
            default:
                if (!KNOWN_FLAGS.has(flag)) out.unknown.push(flag);
        }
    }
    if (out.token === undefined && env[tokenEnv]) out.token = env[tokenEnv];
    return out;
}

export function toolServerUsage(bin = 'bk-mcp', tokenEnv = 'BK_MCP_TOKEN', defaultPort = 3001): string {
    return [
        `${bin} — MCP tool server`,
        '',
        'Usage:',
        `  ${bin}                        stdio (default)`,
        `  ${bin} --http [--port ${defaultPort}]   Streamable HTTP, stateless`,
        `  ${bin} --help`,
        '',
        'Options:',
        '  --http              Serve over HTTP instead of stdio',
        `  --port <n>          HTTP port (default ${defaultPort})`,
        '  --host <host>       Interface to bind (default 127.0.0.1)',
        `  --token <token>     Bearer token for HTTP; required off loopback. Prefer ${tokenEnv}: a token on the command line is visible to other users (ps)`,
        '',
    ].join('\n');
}

/**
 * Parses the command line and starts the tool server in the requested mode. Resolves once it is serving;
 * in stdio mode the process stays alive while the client keeps the pipe open.
 *
 * @example
 * // bin/bk-mcp.ts
 * runToolServer({ name: 'p2p-agent', tools }).catch(err => { console.error(err.message); process.exit(1); });
 */
export async function runToolServer(
    tools: ToolServerOptions,
    cli: ToolServerCliOptions = {},
): Promise<RunningToolServerCli> {
    const log = cli.log ?? ((line: string) => process.stderr.write(`${line}\n`));
    const tokenEnv = cli.tokenEnv ?? 'BK_MCP_TOKEN';
    const args = parseToolServerArgs(cli.argv ?? process.argv.slice(2), cli.env ?? process.env, tokenEnv);
    const defaultPort = cli.http?.port ?? 3001;

    if (args.help) {
        log(toolServerUsage(cli.bin, tokenEnv, defaultPort));
        return { mode: 'help', close: async () => undefined };
    }
    if (args.unknown.length > 0) {
        throw new Error(`Unknown option(s): ${args.unknown.join(' ')}\n\n${toolServerUsage(cli.bin, tokenEnv, defaultPort)}`);
    }

    if (args.mode === 'http') {
        // The command line of a process is readable by other users of the machine (`ps`): the variable keeps the token out of it.
        if ((cli.argv ?? process.argv.slice(2)).includes('--token')) {
            log(`[${tools.name}] warning: --token puts the token where other users of this machine can read it (ps); set ${tokenEnv} instead`);
        }
        const running: RunningToolServer = await startToolServerHttp(tools, {
            ...cli.http,
            log,
            port: args.port ?? defaultPort,
            ...(args.host !== undefined ? { host: args.host } : {}),
            ...(args.token !== undefined ? { authToken: args.token } : {}),
        });
        return { mode: 'http', url: running.url, close: running.close };
    }

    const server = createToolServer(tools);
    const transport = new StdioServerTransport();
    await server.connect(transport);
    log(`[${tools.name}] MCP tool server on stdio (${tools.tools.length} tools)`);
    return { mode: 'stdio', close: () => server.close() };
}
