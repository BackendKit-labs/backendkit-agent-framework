import { appendFile, mkdir } from 'fs/promises';
import { dirname } from 'path';
import type {
    SandboxCaller, SandboxDecision, SandboxDenyCode, SandboxExecRequest, SandboxOutcome, SandboxPathRequest,
    SandboxPathVerdict, SandboxRunner, SandboxToolFacts,
} from '@backendkit-labs/agent-core';
import type { SandboxBackend } from './backends/types';
import { scrubEnv } from './env';
import { isInside, realPathOf } from './paths';
import type { SandboxPolicy } from './policy';
import { needsApproval, type ActionKind } from './presets';

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
     * Called when a line could not be written to `auditLog` (disk full, no permission, bad path). The call
     * itself is never affected. Default: one warning on stderr per service, so a dead audit trail is not silent.
     */
    onAuditError?: (error: unknown, line: string) => void;
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

export function createSandboxService(options: SandboxServiceOptions): SandboxService {
    const { policy, backends } = options;
    const listeners = new Set<DecisionListener>();
    // One chain, so lines reach the file in the order the decisions were taken.
    let auditChain: Promise<unknown> | undefined;
    let warned = false;
    const auditFailed = (error: unknown, line: string) => {
        if (options.onAuditError) { try { options.onAuditError(error, line); } catch { /* observer */ } return; }
        if (warned) return;
        warned = true;
        console.warn(`[sandbox] audit log "${options.auditLog}" is not being written: ${error instanceof Error ? error.message : String(error)}`);
    };

    const emit = (d: SandboxDecision) => {
        for (const l of listeners) { try { l(d); } catch { /* an observer must not affect the call */ } }
        if (options.auditLog) {
            const file = options.auditLog;
            const line = JSON.stringify({ ts: new Date(d.at).toISOString(), ...d }) + '\n';
            auditChain = (auditChain ?? mkdir(dirname(file), { recursive: true }).catch(() => undefined))
                .then(() => appendFile(file, line))
                .catch((error) => { auditFailed(error, line); });
        }
    };

    const base = (caller: SandboxCaller, tool: string) => ({ at: Date.now(), agentId: caller.agentId, sessionId: caller.sessionId, tool });

    /**
     * What a tool does, judged by what it declares, never by its name alone. A command tool is confined by the backend when it runs
     * (`run`). One the integrator named as writing only the agent's own state is `own-state`. Otherwise only a tool that declares
     * `readOnly: true` (and is not listed in `writeTools`) reads: one that is destructive, or declares nothing, has an effect.
     */
    const kindOf = (tool: string, facts: SandboxToolFacts | undefined): ActionKind | 'own-state' => {
        if (policy.commandTools().includes(tool)) return 'command';
        if (policy.ownStateTools().includes(tool)) return 'own-state';
        if (policy.writeTools().includes(tool)) return 'write';
        return facts?.readOnly === true && facts.destructive !== true ? 'read' : 'write';
    };

    return {
        policy,

        onDecision(listener) {
            listeners.add(listener);
            return () => { listeners.delete(listener); };
        },

        authorizeTool(caller, tool, facts) {
            const r = policy.resolve(caller, tool);
            if (r.mode === 'read-only' && kindOf(tool, facts) === 'write') {
                const why = policy.writeTools().includes(tool) ? 'writes'
                    : facts?.destructive === true ? 'has an effect (destructive)'
                    : 'does not declare readOnly, so it may have an effect';
                const reason = `tool "${tool}" ${why}, and the sandbox policy for agent "${caller.agentId}" is read-only`;
                emit({ ...base(caller, tool), mode: r.mode, network: r.network, outcome: 'SANDBOX_DENIED', reason });
                return { ok: false, code: 'SANDBOX_DENIED', reason };
            }
            return { ok: true };
        },

        approvalFor(caller, tool, facts) {
            const r = policy.resolve(caller, tool);
            const kind = kindOf(tool, facts);
            if (kind === 'own-state') return 'none';
            return needsApproval(r.approval, kind) ? 'ask' : 'none';
        },

        authorizePath(caller: SandboxCaller, req: SandboxPathRequest): SandboxPathVerdict {
            const r = policy.resolve(caller, req.tool);
            const deny = (reason: string): SandboxPathVerdict => {
                emit({ ...base(caller, req.tool), mode: r.mode, network: r.network, outcome: 'SANDBOX_DENIED', reason });
                return { ok: false, code: 'SANDBOX_DENIED', reason };
            };
            if (r.mode === 'danger-full-access') return { ok: true };
            if (req.access === 'write' && r.mode === 'read-only') {
                return deny(`"${req.path}" is not writable: the sandbox policy for agent "${caller.agentId}" is read-only`);
            }
            // Judge where the path really lands, and against roots that are themselves resolved (a root may be a link too).
            let real: string;
            let roots: string[];
            try {
                real = realPathOf(req.path);
                roots = [req.workspace, ...r.roots, ...(req.extraRoots ?? [])].map(root => realPathOf(root));
            } catch (err) {
                return deny(`cannot resolve "${req.path}": ${err instanceof Error ? err.message : String(err)}`);
            }
            if (!roots.some(root => isInside(root, real))) {
                return deny(`"${req.path}" resolves to "${real}", outside the allowed roots`);
            }
            if (req.access === 'write') emit({ ...base(caller, req.tool), mode: r.mode, network: r.network, outcome: 'allowed' });
            return { ok: true };
        },

        async run(caller: SandboxCaller, req: SandboxExecRequest): Promise<SandboxOutcome> {
            const r = policy.resolve(caller, req.tool);
            const refuse = (code: SandboxDenyCode, reason: string, backend?: string): SandboxOutcome => {
                emit({ ...base(caller, req.tool), mode: r.mode, network: r.network, backend, outcome: code, reason });
                return { ok: false, code, reason, mode: r.mode, network: r.network, ...(backend ? { backend } : {}) };
            };

            const workspace = req.workspace ?? req.cwd;
            // Judge where the cwd really lands (a link inside the workspace may point outside), against roots
            // that are themselves resolved, as authorizePath does.
            const realCwd = (() => { try { return realPathOf(req.cwd); } catch { return undefined; } })();
            const inside = (root: string) => { try { return realCwd !== undefined && isInside(realPathOf(root), realCwd); } catch { return false; } };
            if (r.mode !== 'danger-full-access' && ![workspace, ...r.roots].some(inside)) {
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
