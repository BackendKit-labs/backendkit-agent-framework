import { appendFile, mkdir } from 'fs/promises';
import { dirname, resolve as resolvePath } from 'path';
import type {
    SandboxCaller, SandboxDecision, SandboxDenyCode, SandboxExecRequest, SandboxOutcome, SandboxRunner,
} from '@backendkit-labs/agent-core';
import type { SandboxBackend } from './backends/types';
import { scrubEnv } from './env';
import type { SandboxPolicy } from './policy';
import { needsApproval } from './presets';

export type DecisionListener = (decision: SandboxDecision) => void;

export interface SandboxServiceOptions {
    policy: SandboxPolicy;
    /** Tried in order; the first that can ENFORCE the required mode (and is available) runs the call. */
    backends: SandboxBackend[];
    /** Environment the confined process starts from, before scrubbing. Default `process.env`. */
    baseEnv?: Record<string, string | undefined>;
    /** Appends every decision as one JSON line to this file. */
    auditLog?: string;
    /**
     * Hand the command a scrubbed environment (credential-looking variables removed). Default true.
     * Only the legacy `BK_RUN_COMMAND_SANDBOX` path turns it off, to keep its old behaviour.
     */
    scrubEnvironment?: boolean;
}

export interface SandboxService extends SandboxRunner {
    readonly policy: SandboxPolicy;
    /** Called for every decision (allowed, denied, unavailable). A throwing listener never affects the call. */
    onDecision(listener: DecisionListener): () => void;
}

/** Normalised containment test; case-insensitive on Windows, separator-agnostic. */
function isInside(root: string, target: string): boolean {
    const norm = (p: string) => {
        const s = resolvePath(p).replace(/\\/g, '/');
        return process.platform === 'win32' ? s.toLowerCase() : s;
    };
    const r = norm(root);
    const t = norm(target);
    return t === r || t.startsWith(r.endsWith('/') ? r : r + '/');
}

export function createSandboxService(options: SandboxServiceOptions): SandboxService {
    const { policy, backends } = options;
    const listeners = new Set<DecisionListener>();
    // One chain, so lines reach the file in the order the decisions were taken.
    let auditChain: Promise<unknown> | undefined;

    const emit = (d: SandboxDecision) => {
        for (const l of listeners) { try { l(d); } catch { /* an observer must not affect the call */ } }
        if (options.auditLog) {
            const file = options.auditLog;
            const line = JSON.stringify({ ts: new Date(d.at).toISOString(), ...d }) + '\n';
            auditChain = (auditChain ?? mkdir(dirname(file), { recursive: true }).catch(() => undefined))
                .then(() => appendFile(file, line))
                .catch(() => undefined);
        }
    };

    const base = (caller: SandboxCaller, tool: string) => ({ at: Date.now(), agentId: caller.agentId, sessionId: caller.sessionId, tool });

    return {
        policy,

        onDecision(listener) {
            listeners.add(listener);
            return () => { listeners.delete(listener); };
        },

        authorizeTool(caller, tool) {
            const r = policy.resolve(caller, tool);
            if (r.mode === 'read-only' && policy.writeTools().includes(tool)) {
                const reason = `tool "${tool}" writes, and the sandbox policy for agent "${caller.agentId}" is read-only`;
                emit({ ...base(caller, tool), mode: r.mode, network: r.network, outcome: 'SANDBOX_DENIED', reason });
                return { ok: false, code: 'SANDBOX_DENIED', reason };
            }
            return { ok: true };
        },

        approvalFor(caller, tool) {
            const r = policy.resolve(caller, tool);
            const kind = policy.commandTools().includes(tool) ? 'command' : policy.writeTools().includes(tool) ? 'write' : 'read';
            return needsApproval(r.approval, kind) ? 'ask' : 'none';
        },

        async run(caller: SandboxCaller, req: SandboxExecRequest): Promise<SandboxOutcome> {
            const r = policy.resolve(caller, req.tool);
            const refuse = (code: SandboxDenyCode, reason: string, backend?: string): SandboxOutcome => {
                emit({ ...base(caller, req.tool), mode: r.mode, network: r.network, backend, outcome: code, reason });
                return { ok: false, code, reason, mode: r.mode, network: r.network, ...(backend ? { backend } : {}) };
            };

            const workspace = req.workspace ?? req.cwd;
            if (r.mode !== 'danger-full-access' && ![workspace, ...r.roots].some(root => isInside(root, req.cwd))) {
                return refuse('SANDBOX_DENIED', `working directory "${req.cwd}" is outside the allowed roots`);
            }

            // First backend that can really enforce the mode. Never "the host, because nothing else works".
            const skipped: string[] = [];
            let chosen: SandboxBackend | undefined;
            for (const b of backends) {
                if (!b.supports(r.mode, r.network)) { skipped.push(`${b.name}: cannot enforce ${r.mode} with network ${r.network}`); continue; }
                if (!(await b.available())) { skipped.push(`${b.name}: ${b.unavailableReason?.() ?? 'not available'}`); continue; }
                chosen = b;
                break;
            }
            if (!chosen) {
                return refuse('SANDBOX_UNAVAILABLE',
                    `cannot enforce ${r.mode} (network ${r.network}) on this host; nothing was run. ${skipped.join('; ') || 'no backends configured'}`);
            }

            let result;
            try {
                result = await chosen.exec({
                    command: req.command,
                    ...(req.hostCommand !== undefined ? { hostCommand: req.hostCommand } : {}),
                    cwd: req.cwd,
                    workspace,
                    mode: r.mode,
                    network: r.network,
                    env: options.scrubEnvironment === false
                        ? Object.fromEntries(Object.entries(options.baseEnv ?? process.env).filter((e): e is [string, string] => e[1] !== undefined))
                        : scrubEnv(options.baseEnv ?? process.env, r.env),
                    timeoutMs: req.timeoutMs,
                    signal: req.signal,
                    onOutput: req.onOutput,
                });
            } catch (err) {
                result = { exitCode: null, output: '', timedOut: false, aborted: false, error: err instanceof Error ? err.message : String(err) };
            }
            emit({ ...base(caller, req.tool), mode: r.mode, network: r.network, backend: chosen.name, outcome: 'allowed' });
            return { ok: true, result, mode: r.mode, network: r.network, backend: chosen.name };
        },
    };
}
