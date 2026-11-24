import { mkdtempSync, readdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { PassThrough } from 'stream';
import * as fsp from 'node:fs/promises';
import { FileApprovalStore } from '../approval-store';
import { agentApprover, consoleApprover } from '../approvers';
import type { ApprovalRequest } from '../types';

// `readdir` can be told to answer in the opposite order, as some file systems do (the store lists a folder; the folder gives no order of its own).
jest.mock('node:fs/promises', () => {
    const real = jest.requireActual('node:fs/promises');
    return { ...real, readdir: jest.fn((...args: unknown[]) => real.readdir(...args)) };
});

const request = (id: string, agentId = 'main'): ApprovalRequest => ({
    id,
    principal: { agentId, sessionId: 's', chain: [agentId] },
    subject: { kind: 'tool_call', call: { tool: { name: 'pay', description: '', parameters: { type: 'object' }, execute: async () => '' }, args: { amount: 5 } } },
    reason: 'payment',
    createdAt: new Date(Date.now() + Number(id.replace(/\D/g, '') || 0)).toISOString(),
});
const approve = (id = 'ana') => ({ decision: 'approve' as const, by: { kind: 'human' as const, id }, at: new Date().toISOString() });

describe('FileApprovalStore', () => {
    let dir: string;
    beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'approvals-')); });
    afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

    it('stores a pending request and survives a new instance (restart)', async () => {
        await new FileApprovalStore(dir).put(request('r1'));
        const item = await new FileApprovalStore(dir).get('r1');
        expect(item).toMatchObject({ id: 'r1', status: 'pending', principal: { agentId: 'main' } });
        // The tool travels as data: its name and parameters, not its function.
        expect((item!.subject as { call: { tool: { name: string; execute?: unknown } } }).call.tool).toMatchObject({ name: 'pay' });
        expect((item!.subject as { call: { tool: { execute?: unknown } } }).call.tool.execute).toBeUndefined();
    });

    it('lists oldest first, and requests made in the same millisecond come in a stable order (by id), whatever order the file system gives', async () => {
        const store = new FileApprovalStore(dir);
        const at = '2026-01-01T00:00:00.000Z';
        for (const id of ['r-c', 'r-a', 'r-b']) await store.put({ ...request(id), createdAt: at });
        await store.put({ ...request('r-old'), createdAt: '2025-12-31T23:59:59.000Z' });
        // A file system that lists in the opposite order, as ext4 can: the answer must not depend on it.
        const real = jest.requireActual('node:fs/promises');
        const readdir = fsp.readdir as unknown as jest.Mock;
        readdir.mockImplementation(async (...args: unknown[]) => (await real.readdir(...args)).reverse());
        try {
            expect((await store.list()).map(r => r.id)).toEqual(['r-old', 'r-a', 'r-b', 'r-c']);
            expect((await new FileApprovalStore(dir).list()).map(r => r.id)).toEqual(['r-old', 'r-a', 'r-b', 'r-c']);
        } finally { readdir.mockImplementation((...args: unknown[]) => real.readdir(...args)); }
    });

    it('accepts one decision per request and one execution per approval', async () => {
        const store = new FileApprovalStore(dir);
        await store.put(request('r1'));
        await expect(store.markExecuted('r1')).rejects.toThrow(/pending, not approved/);
        expect(await store.resolve('r1', approve())).toMatchObject({ status: 'approved' });
        await expect(store.resolve('r1', { ...approve(), decision: 'reject' })).rejects.toThrow(/already decided/);
        await expect(new FileApprovalStore(dir).resolve('r1', approve('other'))).rejects.toThrow(/already decided/);

        const [a, b] = await Promise.all([store.markExecuted('r1'), new FileApprovalStore(dir).markExecuted('r1')]);
        expect([a, b].sort()).toEqual([false, true]);
        expect(await store.markExecuted('r1')).toBe(false);
        expect((await store.get('r1'))!.status).toBe('executed');
        expect(readdirSync(dir).filter(f => f.endsWith('.tmp'))).toEqual([]);
    });

    it('refuses duplicate ids, unknown ids and ids that could leave the directory', async () => {
        const store = new FileApprovalStore(dir);
        await store.put(request('r1'));
        await expect(store.put(request('r1'))).rejects.toThrow(/already exists/);
        await expect(store.resolve('nope', approve())).rejects.toThrow(/does not exist/);
        await expect(store.get('../escape')).rejects.toThrow(/invalid approval id/);
    });

    it('lists by status and agent, oldest first', async () => {
        const store = new FileApprovalStore(dir);
        await store.put(request('r1', 'main'));
        await store.put(request('r2', 'helper'));
        await store.put(request('r3', 'main'));
        await store.resolve('r3', approve());
        expect((await store.list()).map(i => i.id)).toEqual(['r1', 'r2', 'r3']);
        expect((await store.list({ status: 'pending' })).map(i => i.id)).toEqual(['r1', 'r2']);
        expect((await store.list({ agentId: 'main', status: 'approved' })).map(i => i.id)).toEqual(['r3']);
        expect(await new FileApprovalStore(join(dir, 'missing')).list()).toEqual([]);
    });
});

describe('agentApprover and consoleApprover', () => {
    it('an agent answers APPROVE or REJECT and counts as kind agent', async () => {
        const asked: string[] = [];
        const yes = agentApprover(async (id, q) => { asked.push(`${id}:${q}`); return 'APPROVE: within budget'; }, 'qa');
        expect(await yes.request(request('r1'))).toMatchObject({ decision: 'approve', by: { kind: 'agent', id: 'qa', chain: ['qa'] }, reason: 'APPROVE: within budget' });
        expect(asked[0]).toMatch(/^qa:Agent "main" .* wants to call tool "pay"/);
        const no = agentApprover(async () => 'I would rather not.', 'qa');
        expect((await no.request(request('r1'))).decision).toBe('reject');
    });

    it('a person at a terminal approves only with y/yes', async () => {
        const answer = async (text: string) => {
            const input = new PassThrough(); const output = new PassThrough();
            const approver = consoleApprover({ id: 'ana', input, output });
            const pending = approver.request(request('r1'));
            input.end(`${text}\n`);
            return pending;
        };
        expect(await answer('y')).toMatchObject({ decision: 'approve', by: { kind: 'human', id: 'ana' } });
        expect((await answer('YES')).decision).toBe('approve');
        expect((await answer('')).decision).toBe('reject');
        expect((await answer('n')).decision).toBe('reject');
    });
});
