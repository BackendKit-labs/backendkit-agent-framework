"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runCommandTool = void 0;
const child_process_1 = require("child_process");
const BLOCKED = ['rm -rf /', 'format', 'del /f /s /q c:\\'];
const MAX_OUTPUT = 20_000;
exports.runCommandTool = {
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
    async execute(args, ctx) {
        const { command, timeout_ms = 30_000 } = args;
        for (const blocked of BLOCKED) {
            if (command.toLowerCase().includes(blocked)) {
                throw new Error(`Command blocked for safety: "${blocked}"`);
            }
        }
        try {
            const output = (0, child_process_1.execSync)(command, {
                cwd: ctx.workingDir,
                timeout: timeout_ms,
                encoding: 'utf-8',
                stdio: ['pipe', 'pipe', 'pipe'],
            });
            const result = output.trim();
            return result.length > MAX_OUTPUT
                ? result.slice(0, MAX_OUTPUT) + `\n[truncated — ${result.length} total chars]`
                : result || '(no output)';
        }
        catch (err) {
            const msg = (err.stdout ?? '') + (err.stderr ?? '') || err.message;
            throw new Error(msg.slice(0, 2000));
        }
    },
};
//# sourceMappingURL=run-command.js.map