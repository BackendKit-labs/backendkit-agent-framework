import { spawn } from 'child_process';
import * as path from 'path';
import { defineTool, z } from '@backendkit-labs/agent-core';
import { resolveAndCheck } from './path-sandbox';

const MAX_OUTPUT = 20_000;

/**
 * Allowed base binaries. ALL binaries in a chained command (pipes, &&, ;)
 * must be present here — not just the first one.
 */
const COMMAND_ALLOWLIST = new Set([
    // Node / JS ecosystem
    'node', 'npm', 'npx', 'yarn', 'pnpm', 'bun', 'tsx', 'ts-node', 'tsc',
    // Test / lint / format
    'jest', 'vitest', 'mocha', 'c8', 'nyc', 'eslint', 'prettier', 'biome', 'stylelint',
    // Version control
    'git', 'gh',
    // Python
    'python', 'python3', 'pip', 'pip3', 'uv', 'poetry', 'pytest', 'ruff', 'mypy',
    // Go
    'go', 'golangci-lint',
    // Rust
    'cargo',
    // JVM
    'mvn', 'gradle', 'gradlew', 'java', 'javac', 'kotlin', 'kotlinc',
    // Shell utilities (safe subset)
    'echo', 'cat', 'ls', 'pwd', 'which', 'where', 'env', 'printenv',
    'head', 'tail', 'grep', 'find', 'wc', 'sort', 'uniq', 'diff', 'jq', 'yq',
    'mkdir', 'cp', 'mv', 'rm', 'touch', 'chmod',
    'sleep', 'timeout', 'date', 'xargs',
    // Windows equivalents and text utilities
    'dir', 'type', 'copy', 'move', 'del', 'rd', 'md', 'icacls', 'attrib',
    'findstr', 'fc', 'more', 'clip', 'xcopy', 'robocopy', 'set',
    // Containers / infra
    'docker', 'docker-compose', 'kubectl', 'helm',
    'terraform', 'pulumi', 'ansible', 'ansible-playbook',
    // Network
    'curl', 'wget',
    // Build
    'make', 'act',
]);

/** Extract the base binary name from a single command segment. */
function extractBin(command: string): string {
    // Strip leading env var assignments like KEY=val CMD ...
    const stripped = command.trim().replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)+/, '');
    const first = stripped.split(/[\s|;&<>]/)[0] ?? '';
    // Strip any path prefix (e.g. ./node_modules/.bin/jest → jest)
    return first.split('/').pop()?.split('\\').pop() ?? '';
}

/**
 * C1: Split a shell command at operator boundaries and return the binary of
 * each segment. Quoted strings are neutralized first so operators inside
 * quotes are not treated as delimiters.
 */
function extractAllBins(command: string): string[] {
    const noQuotes = command.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""');
    // Strip I/O redirects (e.g. 2>&1, >/dev/null, 2>file, >> file) before
    // splitting so that the target filename is never treated as a command binary.
    // \s* after >>? consumes optional whitespace before the filename/target.
    const noRedirects = noQuotes.replace(/[0-9]*>>?\s*(?:&[0-9]*|\S*)/g, '');
    const segments = noRedirects.split(/&&|\|\||[|;`\r\n]|\$\(|(?<!>)&(?!&)/).map(s => s.trim()).filter(Boolean);
    return segments.map(extractBin).filter(Boolean);
}

/**
 * Parse `cd <dir> && <rest>` pattern and return the target cwd + real command.
 * Handles both Unix (`cd dir && cmd`) and Windows (`cd /D dir && cmd`) forms.
 */
function parseCdAndCommand(command: string): { resolvedCd?: string; command: string } {
    const match = command.trim().match(/^cd(?:\s+\/D)?\s+([^\s&]+)\s*&&\s*(.+)$/i);
    if (match) {
        return { resolvedCd: match[1].trim(), command: match[2].trim() };
    }
    return { command };
}

/** A1: Windows binary-only remap — applied to the leading binary, never to args. */
const WIN_BIN_MAP: Record<string, string> = {
    pwd:   'echo %cd%',
    ls:    'dir',
    which: 'where',
    cat:   'type',
    touch: 'type nul >>',
};

/**
 * Docker sandbox: no network (unless BK_SANDBOX_NETWORK overrides), all caps
 * dropped, only the working directory mounted. The command runs via `sh -c`
 * inside the image (default node:22), so the image must ship the needed tools.
 */
function buildDockerArgs(name: string, baseDir: string, workDir: string, command: string): string[] {
    const rel = path.relative(baseDir, workDir).split(path.sep).join('/');
    return [
        'run', '--rm', '--name', name,
        '--network', process.env.BK_SANDBOX_NETWORK ?? 'none',
        '--cap-drop', 'ALL',
        '--security-opt', 'no-new-privileges',
        '--memory', process.env.BK_SANDBOX_MEMORY ?? '2g',
        '--pids-limit', '512',
        '-v', `${baseDir}:/workspace`,
        '-w', rel ? `/workspace/${rel}` : '/workspace',
        process.env.BK_SANDBOX_IMAGE ?? 'node:22',
        'sh', '-c', command,
    ];
}

export const runCommandTool = defineTool({
    name: 'run_command',
    description:
        'Execute a shell command in the working directory. ' +
        'Use the optional `cwd` parameter to run in a subdirectory instead of `cd dir && cmd`. ' +
        'Allowed binaries: npm, git, node, python, go, cargo, docker, kubectl, and common build/test/lint tools. ' +
        'Shell features (pipes, &&, redirects) are supported when ALL commands in the chain are on the allowlist.',
    input: z.object({
        command:    z.string().describe('Shell command to execute'),
        cwd:        z.string().optional().describe('Subdirectory to run in, relative to the working directory (e.g. "frontend", "packages/api")'),
        timeout_ms: z.number().int().min(1000).max(300_000).default(30_000).describe('Timeout in ms (default: 30 000)'),
    }),
    execute: async ({ command, cwd, timeout_ms }, ctx) => {
        const baseDir = ctx.workingDir ?? process.cwd();

        // Parse `cd dir && cmd` patterns transparently
        const { resolvedCd, command: realCommand } = parseCdAndCommand(command);
        const effectiveCdDir = resolvedCd ?? cwd;

        // C2: apply path sandbox to cwd — prevents running outside the working directory
        let workDir: string;
        if (effectiveCdDir) {
            try {
                workDir = resolveAndCheck(baseDir, effectiveCdDir);
            } catch (err) {
                return `Error: ${(err as Error).message}`;
            }
        } else {
            workDir = baseDir;
        }

        // A1: Windows binary normalization — only the leading binary, not args
        let effectiveCommand = realCommand;
        const bin = extractBin(effectiveCommand);

        if (process.platform === 'win32') {
            const envVarMatch = effectiveCommand.match(/^((?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*)/);
            const envVarPrefix = envVarMatch?.[0] ?? '';
            const afterEnvVars = effectiveCommand.slice(envVarPrefix.length);

            if (bin === 'sleep') {
                const seconds = afterEnvVars.slice(bin.length).trim().split(/\s+/)[0] ?? '1';
                effectiveCommand = `${envVarPrefix}timeout /t ${seconds} /nobreak >nul`;
            } else if (bin in WIN_BIN_MAP) {
                effectiveCommand = envVarPrefix + WIN_BIN_MAP[bin] + afterEnvVars.slice(bin.length);
            }
        }

        // C1: validate ALL binaries in the chain, not just the first
        const allBins = extractAllBins(effectiveCommand);
        const blockedBin = allBins.find(b => !COMMAND_ALLOWLIST.has(b));
        if (blockedBin) {
            return `Error: Command "${blockedBin}" is not in the allowed list. ` +
                   `Allowed: ${[...COMMAND_ALLOWLIST].join(', ')}`;
        }

        // C3: per-agent command blocklist — steers agents toward MCP tools
        const agentBlocked = ctx.blockedCommands ?? [];
        if (agentBlocked.length > 0) {
            const forbidden = allBins.find(b => agentBlocked.includes(b));
            if (forbidden) {
                return (
                    `Error: Command "${forbidden}" is not available for agent "${ctx.agentId}". ` +
                    `This agent uses MCP tools for this capability instead of running shell commands directly. ` +
                    `Use the appropriate MCP tool (e.g. pg_create, pg_run_sql) to accomplish this task.`
                );
            }
        }

        // Opt-in container isolation (BK_RUN_COMMAND_SANDBOX=docker). Fail closed:
        // if requested, never fall back to running on the host.
        const sandboxMode = (process.env.BK_RUN_COMMAND_SANDBOX ?? 'none').toLowerCase();
        if (sandboxMode !== 'none' && sandboxMode !== 'docker') {
            return `Error: invalid BK_RUN_COMMAND_SANDBOX "${sandboxMode}" (expected "none" or "docker")`;
        }
        const containerName = sandboxMode === 'docker'
            ? `bk-run-${process.pid}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
            : undefined;

        // Use async spawn — spawnSync blocks the entire main process thread,
        // which freezes Electron's IPC channel for the duration of the command.
        const output = await new Promise<string>((resolve) => {
            const chunks: string[] = [];
            let totalLen = 0;
            let timedOut = false;

            const proc = containerName
                ? spawn('docker', buildDockerArgs(containerName, baseDir, workDir, realCommand), { timeout: timeout_ms })
                : spawn(effectiveCommand, {
                    shell: true,
                    cwd:   workDir,
                    timeout: timeout_ms,
                });

            const collect = (data: Buffer) => {
                if (totalLen >= MAX_OUTPUT * 2) return;
                const s = data.toString('utf-8');
                chunks.push(s);
                totalLen += s.length;
            };

            proc.stdout.on('data', collect);
            proc.stderr.on('data', collect);

            const timer = setTimeout(() => {
                timedOut = true;
                proc.kill();
                if (containerName) spawn('docker', ['kill', containerName], { stdio: 'ignore' }).on('error', () => undefined);
                resolve(`Error: Command timed out after ${timeout_ms}ms`);
            }, timeout_ms);

            proc.on('error', (err) => {
                clearTimeout(timer);
                resolve(`Error: ${err.message}`);
            });

            proc.on('close', (code) => {
                if (timedOut) return;
                clearTimeout(timer);
                const raw = chunks.join('').trim();
                const truncated = raw.length > MAX_OUTPUT
                    ? raw.slice(0, MAX_OUTPUT) + `\n[truncated — ${raw.length} total chars]`
                    : raw;
                if (containerName && code !== 0) {
                    resolve(`Error: sandboxed command exited with status ${code}\n${truncated}`.trim());
                } else if (code !== 0 && !truncated) {
                    resolve(`Error: Command exited with status ${code}`);
                } else {
                    resolve(truncated || '(no output)');
                }
            });
        });

        return output;
    },
});
