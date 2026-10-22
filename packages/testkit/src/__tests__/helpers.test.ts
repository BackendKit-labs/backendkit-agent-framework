import { mkdtempSync, rmSync, writeFileSync, unlinkSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scriptedProvider, mockTransport, world, type Turn } from '../index';
import type { LLMMessage } from '@backendkit-labs/agent-core';

async function run(provider: ReturnType<typeof scriptedProvider>, messages: LLMMessage[] = [{ role: 'user', content: 'hi' }]) {
    const seen = { text: '', done: undefined as LLMMessage | undefined, tools: [] as string[], metrics: undefined as [number, number] | undefined };
    await provider.chat(messages, [], {
        onChunk: d => { seen.text += d; },
        onToolCall: (name, args) => { seen.tools.push(`${name}${args}`); },
        onDone: m => { seen.done = m; },
        onError: () => undefined,
        onMetrics: (i, o) => { seen.metrics = [i, o]; },
    });
    return seen;
}

describe('scriptedProvider', () => {
    it('plays the turns in order: text, then a tool call, then the exhausted fallback', async () => {
        const turns: Turn[] = [
            { content: 'first', metrics: { inputTokens: 3, outputTokens: 1 } },
            { tool_calls: [{ id: 'c1', name: 'lookup', args: { q: 'x' } }] },
        ];
        const p = scriptedProvider(turns);
        const a = await run(p);
        expect(a.text).toBe('first');
        expect(a.metrics).toEqual([3, 1]);
        const b = await run(p);
        expect(b.tools).toEqual(['lookup{"q":"x"}']);
        expect(b.done?.tool_calls?.[0]).toMatchObject({ id: 'c1', type: 'function', function: { name: 'lookup', arguments: '{"q":"x"}' } });
        expect((await run(p)).text).toBe('[script exhausted]');
    });

    it('can be given another fallback and records the messages of every call', async () => {
        const p = scriptedProvider([], { exhausted: { content: 'always this' } });
        await run(p, [{ role: 'user', content: 'one' }]);
        await run(p, [{ role: 'user', content: 'two' }]);
        expect(p.calls.map(c => c[0].content)).toEqual(['one', 'two']);
        expect((await run(p)).text).toBe('always this');
    });
});

describe('mockTransport', () => {
    it('records events and answers queries about them', () => {
        const t = mockTransport();
        t.transport.emit({ type: 'token', content: 'Hel', agent_id: 'a' });
        t.transport.emit({ type: 'token', content: 'lo', agent_id: 'a' });
        t.transport.emit({ type: 'error', message: 'boom' });
        expect(t.events).toHaveLength(3);
        expect(t.text()).toBe('Hello');
        expect(t.eventsOf('error')).toEqual([{ type: 'error', message: 'boom' }]);
        expect(t.eventsOf('tool_call')).toEqual([]);
        t.clear();
        expect(t.events).toHaveLength(0);
        expect(typeof t.transport.onInput(() => undefined)).toBe('function');
        expect(() => t.transport.close()).not.toThrow();
    });
});

describe('world', () => {
    let dir: string;
    beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'bk-world-')); });
    afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

    it('fileEquals checks content exactly, or through a predicate, and fails on a missing file', () => {
        const f = join(dir, 'a.txt');
        writeFileSync(f, 'hello');
        expect(() => world.fileEquals(f, 'hello')).not.toThrow();
        expect(() => world.fileEquals(f, c => c.startsWith('he'))).not.toThrow();
        expect(() => world.fileEquals(f, 'other')).toThrow(/unexpected content/);
        expect(() => world.fileEquals(f, () => false)).toThrow(/unexpected content/);
        expect(() => world.fileEquals(join(dir, 'missing.txt'), 'x')).toThrow(/does not exist/);
        writeFileSync(f, 'x'.repeat(500));
        expect(() => world.fileEquals(f, 'nope')).toThrow(/…/);                    // long content is shortened in the message
    });

    it('untouched notices modified, created and removed files, and passes when nothing changed', () => {
        const kept = join(dir, 'kept.txt'), edited = join(dir, 'edited.txt'), created = join(dir, 'created.txt');
        writeFileSync(kept, 'k'); writeFileSync(edited, 'e');
        const guard = world.untouched([kept, edited, created, dir]);
        expect(() => guard.verify()).not.toThrow();

        writeFileSync(edited, 'changed');
        expect(() => guard.verify()).toThrow(/edited\.txt/);
        writeFileSync(edited, 'e');
        expect(() => guard.verify()).not.toThrow();

        writeFileSync(created, 'new');
        expect(() => guard.verify()).toThrow(/created\.txt/);
        unlinkSync(created);

        unlinkSync(kept);
        expect(() => guard.verify()).toThrow(/kept\.txt/);
    });

    it('processGone waits for a process to exit and fails if it keeps running', async () => {
        const child = spawn(process.execPath, ['-e', 'setTimeout(()=>{},60000)'], { stdio: 'ignore' });
        const pid = child.pid!;
        await expect(world.processGone(pid, { timeoutMs: 150 })).rejects.toThrow(/still running/);
        child.kill();
        await expect(world.processGone(pid, { timeoutMs: 5000 })).resolves.toBeUndefined();
    });
});
