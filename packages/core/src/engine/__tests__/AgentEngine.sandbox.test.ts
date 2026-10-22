import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createBaseEngine, type BaseEngineOptions } from '../createBaseEngine';
import type { SandboxCaller, SandboxDecision, SandboxRunner, ToolApprovalDecision, ToolDefinition } from '../../index';
import { createMockTransport, createScriptedProvider, testAgent } from '../../__tests__/helpers';

const agent = { ...testAgent, allowedTools: ['read_file', 'write_file', 'run_command'] };

/** A runner with the behaviour the engine relies on, and nothing real behind it. */
function fakeRunner(cfg: { deny?: string[]; ask?: Record<string, 'ask' | 'none'>; withApproval?: boolean } = {}) {
    const listeners = new Set<(d: SandboxDecision) => void>();
    const seen: Array<{ caller: SandboxCaller; tool: string }> = [];
    const decide = (caller: SandboxCaller, tool: string, outcome: SandboxDecision['outcome'], reason?: string) => {
        const d: SandboxDecision = { at: 1, agentId: caller.agentId, sessionId: caller.sessionId, tool, mode: 'read-only', network: 'none', outcome, reason };
        for (const l of listeners) l(d);
    };
    const runner: SandboxRunner = {
        run: async () => { throw new Error('not used here'); },
        authorizeTool(caller, tool) {
            seen.push({ caller, tool });
            if (cfg.deny?.includes(tool)) {
                const reason = `tool "${tool}" writes and the policy is read-only`;
                decide(caller, tool, 'SANDBOX_DENIED', reason);
                return { ok: false, code: 'SANDBOX_DENIED', reason };
            }
            return { ok: true };
        },
        onDecision(l) { listeners.add(l); return () => { listeners.delete(l); }; },
        ...(cfg.withApproval === false ? {} : { approvalFor: (_c: SandboxCaller, tool: string) => cfg.ask?.[tool] ?? 'none' }),
    };
    return { runner, seen };
}

function tool(name: string, ran: string[]): ToolDefinition {
    return {
        name, description: name, parameters: { type: 'object', properties: {} },
        execute: async (_args, ctx) => { ran.push(`${name}:${ctx.sandbox ? 'with-sandbox' : 'no-sandbox'}`); return `${name} done`; },
    };
}

function build(runner: SandboxRunner | undefined, script: Parameters<typeof createScriptedProvider>[0], extra: Partial<BaseEngineOptions> = {}) {
    const ran: string[] = [];
    const { transport, events } = createMockTransport();
    const engine = createBaseEngine({
        providers: { mock: createScriptedProvider(script) }, defaultProvider: 'mock',
        agents: [agent], defaultAgent: agent.id, tools: ['read_file', 'write_file', 'run_command'].map(n => tool(n, ran)),
        transport, workingDir: process.cwd(), noQA: true, iterationMode: 'auto',
        ...(runner ? { sandbox: runner } : {}), ...extra,
    });
    return { engine, events, ran };
}

const call = (id: string, name: string) => ({ tool_calls: [{ id, name, args: {} }] });
const toolResults = (events: ReturnType<typeof createMockTransport>['events']) => events.filter(e => e.type === 'tool_result');

describe('AgentEngine — sandbox', () => {
    it('gives tools ctx.sandbox, and only when one is configured', async () => {
        const withRunner = build(fakeRunner().runner, [call('1', 'read_file'), { content: 'ok' }]);
        await withRunner.engine.run('go');
        expect(withRunner.ran).toEqual(['read_file:with-sandbox']);

        const without = build(undefined, [call('1', 'read_file'), { content: 'ok' }]);
        await without.engine.run('go');
        expect(without.ran).toEqual(['read_file:no-sandbox']);
        expect(without.engine.sandbox).toBeUndefined();
    });

    it('exposes the running sandbox as engine.sandbox', () => {
        const { runner } = fakeRunner();
        expect(build(runner, []).engine.sandbox).toBe(runner);
    });

    it('a tool the policy refuses never runs, nobody is asked, and the model is told why', async () => {
        const asked: string[] = [];
        const { runner } = fakeRunner({ deny: ['write_file'], ask: { write_file: 'ask' } });
        const { engine, events, ran } = build(runner, [call('1', 'write_file'), { content: 'understood' }], {
            onToolApproval: async (name): Promise<ToolApprovalDecision> => { asked.push(name); return 'approve'; },
        });
        await engine.run('write something');

        expect(ran).toEqual([]);
        expect(asked).toEqual([]);
        const result = toolResults(events)[0];
        expect(result).toMatchObject({ name: 'write_file', success: false });
        expect(result.type === 'tool_result' && result.preview).toContain('SANDBOX_DENIED');
        expect(events.some(e => e.type === 'sandbox' && e.outcome === 'SANDBOX_DENIED' && e.tool === 'write_file' && e.agent_id === agent.id)).toBe(true);
    });

    it('other tools are unaffected by the refusal of one', async () => {
        const { runner } = fakeRunner({ deny: ['write_file'] });
        const { engine, ran } = build(runner, [call('1', 'read_file'), { content: 'ok' }]);
        await engine.run('read');
        expect(ran).toEqual(['read_file:with-sandbox']);
    });

    it('when the sandbox says ask, the approver decides; approved tools run, rejected ones do not', async () => {
        const asked: string[] = [];
        const { runner } = fakeRunner({ ask: { run_command: 'ask' } });
        const approve = build(runner, [call('1', 'run_command'), { content: 'ok' }], { onToolApproval: async (n) => { asked.push(n); return 'approve'; } });
        await approve.engine.run('go');
        expect(asked).toEqual(['run_command']);
        expect(approve.ran).toEqual(['run_command:with-sandbox']);

        const reject = build(runner, [call('1', 'run_command'), { content: 'ok' }], { onToolApproval: async () => 'reject' });
        await reject.engine.run('go');
        expect(reject.ran).toEqual([]);
        expect(toolResults(reject.events)[0]).toMatchObject({ success: false });
    });

    it('the sandbox policy REPLACES the built-in list: write_file does not ask when the policy says none, read_file asks when it says ask', async () => {
        const asked: string[] = [];
        const { runner } = fakeRunner({ ask: { read_file: 'ask', write_file: 'none' } });
        const { engine, ran } = build(runner, [call('1', 'write_file'), call('2', 'read_file'), { content: 'ok' }], {
            onToolApproval: async (n) => { asked.push(n); return 'approve'; },
        });
        await engine.run('go');
        expect(asked).toEqual(['read_file']);
        expect(ran).toEqual(['write_file:with-sandbox', 'read_file:with-sandbox']);
    });

    it('FAIL CLOSED: a tool that needs approval is refused when no approver is configured (an unattended flow)', async () => {
        const { runner } = fakeRunner({ ask: { run_command: 'ask' } });
        const { engine, events, ran } = build(runner, [call('1', 'run_command'), { content: 'ok' }]);   // no onToolApproval
        await engine.run('go');

        expect(ran).toEqual([]);
        const result = toolResults(events)[0];
        expect(result).toMatchObject({ name: 'run_command', success: false });
        expect(result.type === 'tool_result' && result.preview).toMatch(/SANDBOX_DENIED.*no approver/);
        expect(events.some(e => e.type === 'sandbox' && e.outcome === 'SANDBOX_DENIED' && /no approver/.test(e.reason ?? ''))).toBe(true);
    });

    it('tools the policy does not ask about still run with no approver', async () => {
        const { runner } = fakeRunner({ ask: { run_command: 'ask' } });
        const { engine, ran } = build(runner, [call('1', 'read_file'), { content: 'ok' }]);
        await engine.run('go');
        expect(ran).toEqual(['read_file:with-sandbox']);
    });

    it('a runner without approvalFor leaves the built-in approval list in charge', async () => {
        const asked: string[] = [];
        const { runner } = fakeRunner({ withApproval: false });
        const { engine } = build(runner, [call('1', 'write_file'), call('2', 'read_file'), { content: 'ok' }], {
            onToolApproval: async (n) => { asked.push(n); return 'approve'; },
        });
        await engine.run('go');
        expect(asked).toEqual(['write_file']);
    });

    it('approve_all stops the asking for the rest of the session, as before', async () => {
        const asked: string[] = [];
        const { runner } = fakeRunner({ ask: { run_command: 'ask' } });
        const { engine, ran } = build(runner, [call('1', 'run_command'), call('2', 'run_command'), { content: 'ok' }], {
            onToolApproval: async (n) => { asked.push(n); return 'approve_all'; },
        });
        await engine.run('go');
        expect(asked).toEqual(['run_command']);
        expect(ran).toHaveLength(2);
    });

    it('sandbox decisions reach the audit log', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'bk-sbx-audit-'));
        try {
            const file = join(dir, 'audit.ndjson');
            const { runner } = fakeRunner({ deny: ['write_file'] });
            const { engine } = build(runner, [call('1', 'write_file'), { content: 'ok' }], { auditLog: file });
            await engine.run('go');
            for (let i = 0; i < 40; i++) { try { if (readFileSync(file, 'utf8').includes('sandbox:write_file')) break; } catch { /* not yet */ } await new Promise(r => setTimeout(r, 25)); }
            const lines = readFileSync(file, 'utf8').trim().split('\n').map(l => JSON.parse(l));
            const entry = lines.find(l => l.tool === 'sandbox:write_file');
            expect(entry).toMatchObject({ agent: agent.id, success: false });
            expect(entry.input).toContain('SANDBOX_DENIED');
        } finally { rmSync(dir, { recursive: true, force: true }); }
    });
});
