import { mkdtempSync, readFileSync, existsSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createBaseEngine, type AgentEvent, type LLMProvider, type SandboxRunner } from '@backendkit-labs/agent-core';
import type { SandboxService } from '@backendkit-labs/agent-sandbox';
import { buildCodingSandbox, CODING_WRITE_TOOLS, readFileTool, writeFileTool, runCommandTool, CODING_TOOLS } from '../index';

const caller = { agentId: 'coder', sessionId: 's1' };

describe('buildCodingSandbox', () => {
    it('hands a ready-made runner back untouched', () => {
        const runner: SandboxRunner = { run: async () => { throw new Error('unused'); } };
        expect(buildCodingSandbox(runner)).toBe(runner);
    });

    it('knows which coding tools write, so read-only refuses exactly those', () => {
        expect([...CODING_WRITE_TOOLS]).toEqual(['write_file', 'edit_file']);
        const sandbox = buildCodingSandbox({ preset: 'read-only' });
        expect(sandbox.authorizeTool!(caller, 'write_file')).toMatchObject({ ok: false, code: 'SANDBOX_DENIED' });
        expect(sandbox.authorizeTool!(caller, 'edit_file')).toMatchObject({ ok: false, code: 'SANDBOX_DENIED' });
        for (const t of ['read_file', 'list_directory', 'search_files', 'run_command', 'save_audit', 'update_session']) {
            expect(sandbox.authorizeTool!(caller, t)).toEqual({ ok: true });
        }
        // every writing tool of the set is covered, nothing else is
        const names = CODING_TOOLS.map(t => t.name);
        expect(CODING_WRITE_TOOLS.every(n => names.includes(n))).toBe(true);
    });

    it('the preset decides what asks: ask = writes and commands, auto-edit = commands, full and read-only = nothing', () => {
        const asks = (preset: 'ask' | 'auto-edit' | 'read-only' | 'full') => {
            const s = buildCodingSandbox({ preset });
            return ['write_file', 'run_command', 'read_file'].map(t => s.approvalFor!(caller, t));
        };
        expect(asks('ask')).toEqual(['ask', 'ask', 'none']);
        expect(asks('auto-edit')).toEqual(['none', 'ask', 'none']);
        expect(asks('read-only')).toEqual(['none', 'none', 'none']);
        expect(asks('full')).toEqual(['none', 'none', 'none']);
    });

    it('defaults to the ask preset', () => {
        expect(buildCodingSandbox({}).approvalFor!(caller, 'run_command')).toBe('ask');
    });

    it('policy overrides are merged over the defaults, and the policy can be read and changed at runtime', () => {
        const sandbox = buildCodingSandbox({ preset: 'read-only', policy: { rules: [{ agentId: 'builder', mode: 'workspace-write' }] } }) as SandboxService;
        expect(sandbox.policy.snapshot()).toMatchObject({ preset: 'read-only', writeTools: ['write_file', 'edit_file'], rules: [{ agentId: 'builder' }] });
        sandbox.policy.set({ preset: 'full' });
        expect(sandbox.authorizeTool!(caller, 'write_file')).toEqual({ ok: true });
    });

    it('with docker down and only docker allowed, a command is refused rather than run on the host', async () => {
        const sandbox = buildCodingSandbox({ preset: 'ask', backends: ['docker'], docker: { probe: async () => false } });
        const out = await sandbox.run(caller, { tool: 'run_command', command: 'echo hi', cwd: process.cwd() });
        expect(out).toMatchObject({ ok: false, code: 'SANDBOX_UNAVAILABLE' });
    });

    it('the default backends are docker then the host, and the host is only used for full access', async () => {
        const down = { probe: async () => false };
        const ask = buildCodingSandbox({ preset: 'ask', docker: down });
        expect(await ask.run(caller, { tool: 'run_command', command: 'echo hi', cwd: process.cwd() })).toMatchObject({ ok: false, code: 'SANDBOX_UNAVAILABLE' });
        const full = buildCodingSandbox({ preset: 'full', docker: down });
        const out = await full.run(caller, { tool: 'run_command', command: 'echo hi', cwd: process.cwd(), timeoutMs: 15_000 });
        expect(out).toMatchObject({ ok: true, backend: 'none' });
    }, 30_000);
});

describe('an engine with the coding tools in read-only', () => {
    let dir: string;
    beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'bk-ro-')); });
    afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

    /** Calls the given tools one after another, then answers. */
    function scripted(calls: Array<{ name: string; args: Record<string, unknown> }>): LLMProvider {
        let i = 0;
        return {
            async chat(_m, _t, cb) {
                const c = calls[i++];
                if (!c) { cb.onChunk?.('done'); cb.onDone({ role: 'assistant', content: 'done' }); return; }
                const id = `c${i}`;
                cb.onToolCall?.(c.name, JSON.stringify(c.args), id);
                cb.onDone({ role: 'assistant', content: null, tool_calls: [{ id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) } }] });
            },
        };
    }

    it('reads work, writes are refused (nothing is created), and the run is reported to the transport', async () => {
        writeFileSync(join(dir, 'a.txt'), 'original');
        const events: AgentEvent[] = [];
        const sandbox = buildCodingSandbox({ preset: 'read-only', backends: ['docker'], docker: { probe: async () => false } });
        const engine = createBaseEngine({
            providers: { mock: scripted([
                { name: 'read_file', args: { path: 'a.txt' } },
                { name: 'write_file', args: { path: 'b.txt', content: 'new' } },
                { name: 'write_file', args: { path: 'a.txt', content: 'changed' } },
                { name: 'run_command', args: { command: 'echo hi' } },
            ]) },
            defaultProvider: 'mock', tools: [readFileTool, writeFileTool, runCommandTool],
            agents: [{ id: 'reviewer', name: 'Reviewer', icon: 'r', description: 'read only', systemPrompt: 'x', allowedTools: ['read_file', 'write_file', 'run_command'], delegatesTo: [] }],
            defaultAgent: 'reviewer', transport: { emit: e => events.push(e), onInput: () => () => undefined, close: () => undefined },
            workingDir: dir, noQA: true, iterationMode: 'auto', sandbox,
        });
        await engine.run('review');

        const results = events.filter((e): e is Extract<AgentEvent, { type: 'tool_result' }> => e.type === 'tool_result');
        // run_command reports its errors as text starting with "Error:" (its convention), not by throwing.
        expect(results.map(r => [r.name, r.success])).toEqual([['read_file', true], ['write_file', false], ['write_file', false], ['run_command', true]]);
        expect(results[1].preview).toContain('SANDBOX_DENIED');
        expect(results[3].preview).toContain('SANDBOX_UNAVAILABLE');
        expect(existsSync(join(dir, 'b.txt'))).toBe(false);
        expect(readFileSync(join(dir, 'a.txt'), 'utf8')).toBe('original');
        const decisions = events.filter(e => e.type === 'sandbox');
        expect(decisions.map(d => d.type === 'sandbox' && d.outcome)).toEqual(['SANDBOX_DENIED', 'SANDBOX_DENIED', 'SANDBOX_UNAVAILABLE']);
        expect(engine.sandbox).toBe(sandbox);
    }, 30_000);
});
