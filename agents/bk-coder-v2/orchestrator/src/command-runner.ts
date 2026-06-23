import * as cp   from 'node:child_process';
import * as fs   from 'node:fs';
import * as path from 'node:path';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CommandResult {
    command:    string;
    exitCode:   number;
    stdout:     string;
    stderr:     string;
    durationMs: number;
    success:    boolean;
}

export interface ProjectStack {
    name:    string;             // 'node' | 'go' | 'python' | 'rust' | 'unknown'
    install?: string;            // optional dependency install command
    build?:   string;            // compile step (may not exist for interpreted langs)
    test:     string;            // test runner command
    lint?:    string;            // optional linter
}

export interface ExecutionReport {
    stack:    string;
    build?:   CommandResult;
    test?:    CommandResult;
    passed:   boolean;           // false if any required step failed
    summary:  string;            // human-readable summary for QA prompt
}

// ── Stack detection ───────────────────────────────────────────────────────────
//
// Commands come from this table, NOT from the LLM — avoids arbitrary command
// execution. The LLM writes files; we decide what to run based on what we find.

const STACKS: Record<string, ProjectStack> = {
    node_ts: {
        name:    'node+typescript',
        build:   'npx tsc --noEmit',
        test:    'npm test',
    },
    node_js: {
        name:    'node',
        test:    'npm test',
    },
    go: {
        name:    'go',
        build:   'go build ./...',
        test:    'go test ./...',
        lint:    'go vet ./...',
    },
    python: {
        name:    'python',
        test:    'python -m pytest --tb=short -q',
    },
    rust: {
        name:    'rust',
        build:   'cargo build',
        test:    'cargo test',
    },
    deno: {
        name:    'deno',
        test:    'deno test',
    },
};

function hasFile(root: string, ...candidates: string[]): boolean {
    return candidates.some(f => fs.existsSync(path.join(root, f)));
}

function readJsonField(root: string, file: string, field: string): unknown {
    try {
        const obj = JSON.parse(fs.readFileSync(path.join(root, file), 'utf-8')) as Record<string, unknown>;
        return obj[field];
    } catch { return undefined; }
}

export function detectStack(projectRoot: string): ProjectStack {
    // Rust
    if (hasFile(projectRoot, 'Cargo.toml')) return STACKS.rust!;

    // Go
    if (hasFile(projectRoot, 'go.mod')) return STACKS.go!;

    // Deno
    if (hasFile(projectRoot, 'deno.json', 'deno.jsonc')) return STACKS.deno!;

    // Python
    if (hasFile(projectRoot, 'pyproject.toml', 'setup.py', 'requirements.txt', 'pytest.ini')) {
        return STACKS.python!;
    }

    // Node — TypeScript or plain JS
    if (hasFile(projectRoot, 'package.json')) {
        const scripts = readJsonField(projectRoot, 'package.json', 'scripts') as Record<string, string> | undefined;
        const hasBuildScript = scripts && 'build' in scripts;
        const hasTestScript  = scripts && 'test'  in scripts && !scripts['test'].includes('no test');

        // Prefer tsc --noEmit for type-checking when tsconfig exists
        const hasTsConfig = hasFile(projectRoot, 'tsconfig.json');
        const buildCmd    = hasTsConfig ? 'npx tsc --noEmit' : (hasBuildScript ? 'npm run build' : undefined);
        const testCmd     = hasTestScript ? 'npm test' : 'npm test';   // npm test fails gracefully if no test script

        return { name: hasTsConfig ? 'node+typescript' : 'node', build: buildCmd, test: testCmd };
    }

    return { name: 'unknown', test: 'echo "No test runner detected"' };
}

// ── Command execution ─────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 120_000;   // 2 minutes
const MAX_OUTPUT_CHARS   = 8_000;     // per stream

export function runCommand(
    command:    string,
    cwd:        string,
    timeoutMs:  number = DEFAULT_TIMEOUT_MS,
): Promise<CommandResult> {
    return new Promise(resolve => {
        const start = Date.now();

        const child = cp.exec(command, { cwd, timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
            const durationMs = Date.now() - start;
            const exitCode   = err ? (err.code as number ?? 1) : 0;
            resolve({
                command,
                exitCode,
                stdout: stdout.slice(0, MAX_OUTPUT_CHARS),
                stderr: stderr.slice(0, MAX_OUTPUT_CHARS),
                durationMs,
                success: exitCode === 0,
            });
        });

        // Kill on timeout (child_process.exec timeout only sends SIGTERM)
        setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* already done */ } }, timeoutMs + 1000);
    });
}

// ── Run build + test and produce a report ─────────────────────────────────────

export async function runProjectChecks(
    projectRoot: string,
    onProgress?: (msg: string) => void,
): Promise<ExecutionReport> {
    const stack = detectStack(projectRoot);
    const log   = (msg: string) => onProgress?.(`  ${msg}`);

    log(`🔍 Stack detectado: ${stack.name}`);

    let buildResult: CommandResult | undefined;
    let testResult:  CommandResult | undefined;

    // ── 1. Build / compile ────────────────────────────────────────────────────
    if (stack.build) {
        log(`🔨 Compilando: ${stack.build}`);
        buildResult = await runCommand(stack.build, projectRoot);
        if (buildResult.success) {
            log(`  ✓ build OK (${buildResult.durationMs}ms)`);
        } else {
            log(`  ✗ build FALLÓ (exit ${buildResult.exitCode})`);
            if (buildResult.stderr) log(`  ${buildResult.stderr.split('\n').slice(0, 5).join('\n  ')}`);
            // Build failure is fatal — no point running tests
            return finalize(stack.name, buildResult, undefined);
        }
    }

    // ── 2. Tests ──────────────────────────────────────────────────────────────
    log(`🧪 Tests: ${stack.test}`);
    testResult = await runCommand(stack.test, projectRoot);
    if (testResult.success) {
        log(`  ✓ tests OK (${testResult.durationMs}ms)`);
    } else {
        log(`  ✗ tests FALLARON (exit ${testResult.exitCode})`);
    }

    return finalize(stack.name, buildResult, testResult);
}

function finalize(
    stackName:   string,
    build?:      CommandResult,
    test?:       CommandResult,
): ExecutionReport {
    const passed = (build === undefined || build.success) && (test === undefined || test.success);

    const lines: string[] = [`Stack: ${stackName}`];
    if (build) {
        lines.push(build.success
            ? `Build: ✅ OK (${build.durationMs}ms)`
            : `Build: ❌ FALLÓ (exit ${build.exitCode})\n${trimOutput(build.stderr || build.stdout)}`);
    }
    if (test) {
        lines.push(test.success
            ? `Tests: ✅ OK (${test.durationMs}ms)`
            : `Tests: ❌ FALLARON (exit ${test.exitCode})\n${trimOutput(test.stdout + '\n' + test.stderr)}`);
    }
    if (passed) lines.push('\nResultado: ✅ PASS — el código compila y los tests pasan.');
    else        lines.push('\nResultado: ❌ FAIL — ver errores arriba para corregir.');

    return { stack: stackName, build, test, passed, summary: lines.join('\n') };
}

function trimOutput(s: string, maxLines = 30): string {
    const lines = s.trim().split('\n').filter(l => l.trim());
    if (lines.length <= maxLines) return lines.join('\n');
    return [...lines.slice(0, 15), `... (${lines.length - 20} líneas omitidas) ...`, ...lines.slice(-5)].join('\n');
}
