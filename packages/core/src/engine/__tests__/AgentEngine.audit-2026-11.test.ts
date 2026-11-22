/** Fixes of the 2026-11 audit: what a person is shown, an approver that does not answer, arguments that are not an object, a timeout on a write. */
import { mkdtempSync, rmSync, writeFileSync, utimesSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import { createBaseEngine } from '../createBaseEngine';
import { FileApprovalStore } from '../../governance/approval-store';
import { MemoryAuditSink } from '../../governance/audit';
import { approverFromCallback, previewArgs } from '../../governance/approval';
import { combineDecisions } from '../../governance/policy';
import { WebhookServer } from '../../triggers/WebhookServer';
import type { Approver, ToolPolicy } from '../../governance/types';
import type { AgentProfile, ToolDefinition } from '../../types';
import { createMockTransport, createScriptedProvider, testAgent, type Turn } from '../../__tests__/helpers';

const main: AgentProfile = { ...testAgent, id: 'main', allowedTools: ['pay'], delegatesTo: [] };
const askAlways: ToolPolicy = { decide: () => ({ effect: 'ask', reason: 'always', accepts: ['human'] }) };

function build(script: Turn[], extra: Record<string, unknown> = {}, tool?: Partial<ToolDefinition>) {
    const paid: unknown[] = [];
    const audit = new MemoryAuditSink();
    const tools: ToolDefinition[] = [
        { name: 'pay', description: '', parameters: { type: 'object' }, execute: async (a) => { paid.push(a); return 'paid'; }, ...tool },
    ];
    const { transport, events } = createMockTransport();
    const engine = createBaseEngine({
        providers: { mock: createScriptedProvider(script) }, defaultProvider: 'mock', agents: [main], defaultAgent: 'main',
        tools, transport, workingDir: process.cwd(), iterationMode: 'auto', audit, policy: askAlways, ...extra,
    } as never);
    return { engine, paid, audit, events };
}

describe('previewArgs: a cut says it is cut', () => {
    it('short arguments pass whole', () => expect(previewArgs('{"a":1}')).toEqual({ text: '{"a":1}', truncated: false }));
    it('long ones are cut with how much is missing', () => {
        const p = previewArgs('x'.repeat(5000), 4000);
        expect(p.truncated).toBe(true);
        expect(p.text).toMatch(/1000 more characters NOT shown/);
    });
    it('a payment whose amount comes after 200 characters is still seen', () => {
        const json = JSON.stringify({ memo: 'a'.repeat(300), amount: 99999 });
        expect(previewArgs(json).text).toContain('"amount":99999');
    });
    it('the callback approver is shown that long preview, not 200 characters', async () => {
        let seen = '';
        const a = approverFromCallback(async (_n, _a, preview) => { seen = preview; return 'approve'; });
        const tool = { name: 'pay', description: '', parameters: {}, execute: async () => '' } as ToolDefinition;
        await a.request({
            id: 'r', principal: { agentId: 'main', chain: ['main'] } as never, subject: { kind: 'tool_call', call: { tool, args: { memo: 'a'.repeat(300), amount: 99999 } } },
            reason: 'r', createdAt: new Date().toISOString(),
        } as never);
        expect(seen).toContain('"amount":99999');
    });
});

describe('an approver that does not answer', () => {
    it('without a limit it would wait; with approverTimeoutMs the call is denied and the engine moves on', async () => {
        const never: Approver = { ref: { kind: 'human', id: 'ana' }, request: () => new Promise(() => undefined) };
        const { engine, paid, audit } = build([{ tool_calls: [{ id: 'c1', name: 'pay', args: { amount: 1 } }] }, { content: 'done' }], { approver: never, approverTimeoutMs: 50 });
        const result = await engine.run('pay');
        expect(paid).toEqual([]);
        expect(JSON.stringify(audit.events)).toMatch(/did not answer in 50ms/);
        expect(result.text).toBe('done');
    });
    it('an invalid timeout is refused at creation', () => {
        expect(() => build([], { approverTimeoutMs: 0 })).toThrow(/approverTimeoutMs/);
        expect(() => build([], { approverTimeoutMs: Number.NaN })).toThrow(/approverTimeoutMs/);
    });
});

describe('arguments that are valid JSON but not an object', () => {
    it.each([['[1,2]'], ['null'], ['42'], ['"x"']])('%s is denied before any policy sees it as {}', async (raw) => {
        const seen: unknown[] = [];
        const policy: ToolPolicy = { decide: (_p, call) => { seen.push(call.args); return { effect: 'allow' }; } };
        const { engine, paid } = build([{ tool_calls: [{ id: 'c1', name: 'pay', args: raw as never }] }, { content: 'ok' }], { policy });
        await engine.run('pay').catch(() => undefined);
        expect(paid).toEqual([]);
        expect(seen).toEqual([]);
    });
});

describe('a timeout on a tool that is not read-only', () => {
    it('tells the model it may still be running', async () => {
        const slow = (): Promise<string> => new Promise(res => setTimeout(() => res('late'), 400));
        const { engine, events } = build([{ tool_calls: [{ id: 'c1', name: 'pay', args: { a: 1 } }] }, { content: 'ok' }],
            { policy: { decide: () => ({ effect: 'allow' }) }, toolTimeoutMs: 30, toolTimeoutGraceMs: 10 }, { execute: slow });
        await engine.run('pay');
        expect(JSON.stringify(events)).toMatch(/TOOL_TIMEOUT.*may still be running/);
    });
});

describe('combineDecisions: no common approver kind is a deny, like no common role', () => {
    it('human-only and agent-only together', () => {
        const d = combineDecisions([
            { effect: 'ask', reason: 'a', accepts: ['human'] },
            { effect: 'ask', reason: 'b', accepts: ['agent'] },
        ]);
        expect(d.effect).toBe('deny');
    });
    it('compatible kinds still ask', () => {
        const d = combineDecisions([{ effect: 'ask', reason: 'a', accepts: ['human', 'agent'] }, { effect: 'ask', reason: 'b', accepts: ['human'] }]);
        expect(d).toMatchObject({ effect: 'ask', accepts: ['human'] });
    });
});

describe('FileApprovalStore', () => {
    let dir: string;
    beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'store-audit-')); });
    afterEach(() => rmSync(dir, { recursive: true, force: true }));

    it('a corrupt file is an error that says so, not "does not exist"; list skips it', async () => {
        const store = new FileApprovalStore(dir);
        const req = (id: string) => ({ id, principal: { agentId: 'a', chain: ['a'] }, subject: { kind: 'summary', summary: 's' }, reason: 'r', createdAt: new Date().toISOString() }) as never;
        await store.put(req('good'));
        writeFileSync(join(dir, 'bad.request.json'), '{not json');
        await expect(store.get('bad')).rejects.toThrow(/corrupt/);
        await expect(store.get('missing')).resolves.toBeUndefined();
        expect((await store.list()).map(a => a.id)).toEqual(['good']);
    });

    it('temporary files older than an hour are swept, recent ones stay', async () => {
        const old = join(dir, '.x.request.json.1.aaaa.tmp');
        const fresh = join(dir, '.y.request.json.1.bbbb.tmp');
        writeFileSync(old, ''); writeFileSync(fresh, '');
        const past = new Date(Date.now() - 2 * 3600_000);
        utimesSync(old, past, past);
        await new FileApprovalStore(dir).put({ id: 'n', principal: { agentId: 'a', chain: ['a'] }, subject: { kind: 'summary', summary: 's' }, reason: 'r', createdAt: new Date().toISOString() } as never);
        const names = readdirSync(dir);
        expect(names).not.toContain('.x.request.json.1.aaaa.tmp');
        expect(names).toContain('.y.request.json.1.bbbb.tmp');
    });
});

describe('WebhookServer', () => {
    const post = (port: number, path: string): Promise<number> => new Promise((resolve, reject) => {
        const req = http.request({ host: '127.0.0.1', port, path, method: 'POST' }, res => { res.resume(); resolve(res.statusCode ?? 0); });
        req.on('error', reject); req.end('{}');
    });

    it('a route matches with a query string, and an async handler that rejects does not crash the process', async () => {
        const server = new WebhookServer(0, { host: '127.0.0.1' });
        const errors = jest.spyOn(console, 'error').mockImplementation(() => undefined);
        let called = 0;
        server.register('/hook', async () => { called++; throw new Error('boom'); }, undefined, { allowUnsigned: true });
        await server.start();
        const port = ((server as unknown as { server: http.Server }).server.address() as { port: number }).port;
        expect(await post(port, '/hook?x=1')).toBe(202);
        await new Promise(r => setTimeout(r, 30));
        expect(called).toBe(1);
        expect(errors).toHaveBeenCalled();
        await server.stop();
        errors.mockRestore();
    });
});
