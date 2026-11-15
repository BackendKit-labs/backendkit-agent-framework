import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
    AuditDispatcher, GENESIS_HASH, HashChainAuditSink, MemoryAuditSink, NdjsonAuditSink,
    verifyAuditChain, verifyAuditSegment, type ChainedAuditEntry,
} from '../audit';
import type { AuditEvent } from '../types';

const event = (tool: string, decision: AuditEvent['decision'] = 'allow'): AuditEvent => ({
    at: '2026-11-14T00:00:00.000Z',
    principal: { agentId: 'a', sessionId: 's', chain: ['a'] },
    tool, argsHash: 'h'.repeat(64), decision, durationMs: 1,
});

describe('MemoryAuditSink and NdjsonAuditSink', () => {
    let dir: string;
    beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'audit-')); });
    afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

    it('memory keeps events in order', () => {
        const sink = new MemoryAuditSink();
        sink.write(event('x')); sink.write(event('y'));
        expect(sink.events.map(e => e.tool)).toEqual(['x', 'y']);
    });

    it('ndjson appends one line per event and creates the directory', async () => {
        const path = join(dir, 'nested', 'audit.ndjson');
        const sink = new NdjsonAuditSink(path);
        await sink.write(event('x'));
        await sink.write(event('y', 'deny'));
        const lines = readFileSync(path, 'utf8').trim().split('\n').map(l => JSON.parse(l) as AuditEvent);
        expect(lines.map(l => [l.tool, l.decision])).toEqual([['x', 'allow'], ['y', 'deny']]);
    });
});

describe('HashChainAuditSink', () => {
    let dir: string;
    let path: string;
    beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'chain-')); path = join(dir, 'audit.log'); });
    afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

    const lines = () => readFileSync(path, 'utf8').trim().split('\n');

    it('chains entries and verifies; reopening continues the chain', () => {
        const sink = new HashChainAuditSink(path);
        sink.write(event('x')); sink.write(event('y'));
        expect(sink.count).toBe(2);
        const check = verifyAuditChain(path);
        expect(check).toEqual({ ok: true, entries: 2, head: sink.head });

        const again = new HashChainAuditSink(path);
        again.write(event('z'));
        expect(verifyAuditChain(path)).toMatchObject({ ok: true, entries: 3 });
        expect((JSON.parse(lines()[0]) as ChainedAuditEntry).prevHash).toBe(GENESIS_HASH);
    });

    it('detects an edited, removed or reordered entry', () => {
        const sink = new HashChainAuditSink(path);
        sink.write(event('x')); sink.write(event('y')); sink.write(event('z'));
        const original = lines();

        const edited = JSON.parse(original[1]) as ChainedAuditEntry;
        edited.event.decision = 'deny';
        writeFileSync(path, [original[0], JSON.stringify(edited), original[2]].join('\n') + '\n');
        expect(verifyAuditChain(path)).toMatchObject({ ok: false, brokenAt: 2 });

        writeFileSync(path, [original[0], original[2]].join('\n') + '\n');
        expect(verifyAuditChain(path)).toMatchObject({ ok: false, brokenAt: 2 });

        writeFileSync(path, [original[1], original[0], original[2]].join('\n') + '\n');
        expect(verifyAuditChain(path)).toMatchObject({ ok: false, brokenAt: 1 });
    });

    it('refuses to extend a broken log', () => {
        writeFileSync(path, '{"not":"an entry"}\n');
        expect(() => new HashChainAuditSink(path)).toThrow(/not intact at entry 1/);
    });

    it('with a secret, a log rewritten without it does not verify', () => {
        const keyed = new HashChainAuditSink(path, { secret: 'k1' });
        keyed.write(event('x'));
        expect(verifyAuditChain(path, { secret: 'k1' })).toMatchObject({ ok: true, entries: 1 });
        expect(verifyAuditChain(path, { secret: 'other' })).toMatchObject({ ok: false, brokenAt: 1 });

        // Rewrite from scratch with recomputed hashes but no secret: the plain chain is valid, the keyed check is not.
        rmSync(path);
        new HashChainAuditSink(path).write(event('forged'));
        expect(verifyAuditChain(path)).toMatchObject({ ok: true });
        expect(verifyAuditChain(path, { secret: 'k1' })).toMatchObject({ ok: false, brokenAt: 1 });
    });

    it('verifies a segment that continues a known head', () => {
        const sink = new HashChainAuditSink(path);
        sink.write(event('x'));
        const head = { seq: sink.count, hash: sink.head };
        sink.write(event('y')); sink.write(event('z'));
        const batch = lines().slice(1).map(l => JSON.parse(l) as ChainedAuditEntry);
        expect(verifyAuditSegment(batch, head)).toMatchObject({ ok: true, count: 2, last: { seq: 3, hash: sink.head } });
        expect(verifyAuditSegment(batch.slice(1), head)).toMatchObject({ ok: false, at: 2 });
    });
});

describe('AuditDispatcher', () => {
    it('writes to every sink in call order, and a failing sink does not stop the others', async () => {
        const order: string[] = [];
        const errors: unknown[] = [];
        const slow = { write: async (e: AuditEvent) => { await new Promise(r => setTimeout(r, e.tool === 'first' ? 20 : 0)); order.push(`slow:${e.tool}`); } };
        const broken = { write: () => { throw new Error('disk full'); } };
        const memory = new MemoryAuditSink();
        const d = new AuditDispatcher([slow, broken, memory], err => errors.push(err));
        await Promise.all([d.write(event('first')), d.write(event('second'))]);
        expect(order).toEqual(['slow:first', 'slow:second']);
        expect(memory.events.map(e => e.tool)).toEqual(['first', 'second']);
        expect(errors).toHaveLength(2);
    });

    it('is disabled without sinks', () => {
        expect(new AuditDispatcher(undefined, () => undefined).enabled).toBe(false);
    });
});
