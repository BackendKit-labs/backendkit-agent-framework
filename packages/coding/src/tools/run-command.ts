import { execSync } from 'child_process';
import type { ToolDefinition, ExecutionContext } from '@bk/agent-core';

const BLOCKED = ['rm -rf /', 'format', 'del /f /s /q c:\\'];
const MAX_OUTPUT = 20_000;

export const runCommandTool: ToolDefinition = {
    name: 'run_command',
    description: 'Execute a shell command in the working directory. Use for builds, tests, package installs, git operations.',
    parameters: {
        type: 'object',
        properties: {
            command: { type: 'string', description: 'Command to execute' },
            timeout_ms: { type: 'number', description: 'Timeout in milliseconds (default: 30000)' },
        },
        required: ['command'],
    },
    async execute(args: unknown, ctx: ExecutionContext) {
        const { command, timeout_ms = 30_000 } = args as { command: string; timeout_ms?: number };

        for (const blocked of BLOCKED) {
            if (command.toLowerCase().includes(blocked)) {
                throw new Error(`Command blocked for safety: "${blocked}"`);
            }
        }

        try {
            const output = execSync(command, {
                cwd: ctx.workingDir,
                timeout: timeout_ms,
                encoding: 'utf-8',
                stdio: ['pipe', 'pipe', 'pipe'],
            });
            const result = output.trim();
            return result.length > MAX_OUTPUT
                ? result.slice(0, MAX_OUTPUT) + `\n[truncated — ${result.length} total chars]`
                : result || '(no output)';
        } catch (err: any) {
            const msg = (err.stdout ?? '') + (err.stderr ?? '') || err.message;
            throw new Error(msg.slice(0, 2000));
        }
    },
};
