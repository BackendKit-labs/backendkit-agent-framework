import { spawnSync } from 'child_process';
import { defineTool, z } from '@bk/agent-core';

const MAX_OUTPUT = 20_000;

/**
 * Allowed base binaries. Shell features (pipes, redirects, &&) are still
 * permitted when the first binary is in this list.
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
    'echo', 'cat', 'ls', 'pwd', 'which', 'env', 'printenv',
    'head', 'tail', 'grep', 'find', 'wc', 'sort', 'uniq', 'diff', 'jq', 'yq',
    'mkdir', 'cp', 'mv', 'rm', 'touch', 'chmod',
    // Containers / infra
    'docker', 'docker-compose', 'kubectl', 'helm',
    'terraform', 'pulumi', 'ansible', 'ansible-playbook',
    // Network
    'curl', 'wget',
    // Build
    'make', 'act',
]);

/** Extract the base binary name from a shell command string. */
function extractBin(command: string): string {
    // Strip leading env var assignments like KEY=val CMD ...
    const stripped = command.trim().replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)+/, '');
    const first = stripped.split(/[\s|;&<>]/)[0] ?? '';
    // Strip any path prefix (e.g. ./node_modules/.bin/jest → jest)
    return first.split('/').pop()?.split('\\').pop() ?? '';
}

export const runCommandTool = defineTool({
    name: 'run_command',
    description:
        'Execute a shell command in the working directory. ' +
        'Allowed binaries: npm, git, node, python, go, cargo, docker, kubectl, and common build/test/lint tools. ' +
        'Shell features (pipes, &&, redirects) are supported when the leading command is on the allowlist.',
    input: z.object({
        command:    z.string().describe('Shell command to execute'),
        timeout_ms: z.number().int().min(1000).max(300_000).default(30_000).describe('Timeout in ms (default: 30 000)'),
    }),
    execute: async ({ command, timeout_ms }, ctx) => {
        const bin = extractBin(command);
        if (!COMMAND_ALLOWLIST.has(bin)) {
            return `Error: Command "${bin}" is not in the allowed list. ` +
                   `Allowed: ${[...COMMAND_ALLOWLIST].join(', ')}`;
        }

        const result = spawnSync(command, {
            shell: true,
            cwd:  ctx.workingDir,
            timeout: timeout_ms,
            encoding: 'utf-8',
            maxBuffer: MAX_OUTPUT * 2,
        });

        if (result.error) {
            const msg = result.error.message;
            return msg.includes('ETIMEDOUT') || msg.includes('timeout')
                ? `Error: Command timed out after ${timeout_ms}ms`
                : `Error: ${msg}`;
        }

        const output = ((result.stdout ?? '') + (result.stderr ?? '')).trim();
        if (result.status !== 0 && !output) {
            return `Error: Command exited with status ${result.status}`;
        }

        return output.length > MAX_OUTPUT
            ? output.slice(0, MAX_OUTPUT) + `\n[truncated — ${output.length} total chars]`
            : output || '(no output)';
    },
});
