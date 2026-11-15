import * as path from 'path';
import { defineTool, z } from '@backendkit-labs/agent-core';
import { resolveAndCheck } from './path-sandbox';
import { legacySandbox } from './legacy-sandbox';
import { extractAllBins, extractBin } from './command-parser';
import { requiresInstallApproval } from './package-install';

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

export const runCommandTool = defineTool({
    name: 'run_command',
    readOnly: false,
    alwaysAsk: ({ command }) => requiresInstallApproval(command),
    description:
        'Execute a shell command in the working directory. ' +
        'Use the optional `cwd` parameter to run in a subdirectory instead of `cd dir && cmd`. ' +
        'Allowed binaries: npm, git, node, python, go, cargo, docker, kubectl, and common build/test/lint tools. ' +
        'Shell features (pipes, &&, redirects) are supported when ALL commands in the chain are on the allowlist. ' +
        'With `background: true` (when background jobs are enabled) the command starts as a job and returns its id at once: ' +
        'read it with job_output, stop it with job_kill; timeout_ms does not apply.',
    input: z.object({
        command:    z.string().describe('Shell command to execute'),
        cwd:        z.string().optional().describe('Subdirectory to run in, relative to the working directory (e.g. "frontend", "packages/api")'),
        timeout_ms: z.number().int().min(1000).max(300_000).default(30_000).describe('Timeout in ms (default: 30 000)'),
        background: z.boolean().optional().describe('Run as a background job (long-running servers, watchers, slow builds) and return its id immediately'),
    }),
    execute: async ({ command, cwd, timeout_ms, background }, ctx) => {
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

        // Everything below runs through a sandbox: the engine's, or the legacy BK_RUN_COMMAND_SANDBOX switch
        // translated to its equivalent policy. Fail closed in both: if confinement cannot be enforced, nothing runs.
        let runner = ctx.sandbox;
        if (!runner) {
            const legacy = legacySandbox();
            if ('error' in legacy) return legacy.error;
            runner = legacy.runner;
        }
        const caller = { agentId: ctx.agentId, sessionId: ctx.sessionId };
        // `command` is what a container runs; `hostCommand` has the Windows remap for the host shell.
        const request = { tool: 'run_command', command: realCommand, hostCommand: effectiveCommand, cwd: workDir, workspace: baseDir };

        if (background && ctx.jobs) {
            const info = ctx.jobs.start({
                kind: 'bash',
                owner: ctx.agentId,
                run: async (signal, append) => {
                    const out = await runner.run(caller, { ...request, signal, onOutput: append });
                    if (!out.ok) throw new Error(`${out.code}: ${out.reason}`);
                    if (out.result.error) throw new Error(out.result.error);
                    if (out.result.exitCode === 0) return 'exit 0';
                    throw new Error(`exit ${out.result.exitCode}`);
                },
            });
            return `Started background job ${info.id}. Read its output with job_output (id: "${info.id}"); stop it with job_kill.`;
        }

        const out = await runner.run(caller, { ...request, timeoutMs: timeout_ms, signal: ctx.signal });
        if (!out.ok) return `Error: ${out.code}: ${out.reason}`;
        const r = out.result;
        if (r.error) return `Error: ${r.error}`;
        if (r.aborted) return 'Error: Command aborted';
        if (r.timedOut) return `Error: Command timed out after ${timeout_ms}ms`;

        const raw = r.output.trim();
        const truncated = raw.length > MAX_OUTPUT
            ? raw.slice(0, MAX_OUTPUT) + `
[truncated — ${raw.length} total chars]`
            : raw;
        if (out.backend !== 'none' && r.exitCode !== 0) {
            return `Error: sandboxed command exited with status ${r.exitCode}
${truncated}`.trim();
        }
        if (r.exitCode !== 0 && !truncated) return `Error: Command exited with status ${r.exitCode}`;
        return truncated || '(no output)';
    },
});
