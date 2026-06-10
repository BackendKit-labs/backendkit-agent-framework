import { existsSync, unlinkSync, writeFileSync } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { HistoryManager, sanitizeMessages } from '../HistoryManager';
import type { LLMMessage } from '../../types';

const tmpPath = () => path.join(os.tmpdir(), `bk-hist-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);

// ── sanitizeMessages ──────────────────────────────────────────────────────────

describe('sanitizeMessages', () => {
    it('passes through a clean conversation unchanged', () => {
        const msgs: LLMMessage[] = [
            { role: 'user', content: 'hi' },
            { role: 'assistant', content: 'hello' },
        ];
        expect(sanitizeMessages(msgs)).toEqual(msgs);
    });

    it('drops orphaned tool result (no open chain)', () => {
        const msgs: LLMMessage[] = [
            { role: 'user', content: 'hi' },
            { role: 'tool', tool_call_id: 'tc1', content: 'result' } as LLMMessage,
        ];
        const out = sanitizeMessages(msgs);
        expect(out.every(m => m.role !== 'tool')).toBe(true);
    });

    it('strips trailing incomplete chain (abort before tool results)', () => {
        const msgs: LLMMessage[] = [
            { role: 'user', content: 'hi' },
            { role: 'assistant', content: null, tool_calls: [{ id: 'tc1', type: 'function', function: { name: 'f', arguments: '{}' } }] } as unknown as LLMMessage,
            // tc1 result missing → dangling chain
        ];
        const out = sanitizeMessages(msgs);
        expect(out.every(m => m.role !== 'assistant' || !m.tool_calls?.length)).toBe(true);
    });

    it('strips mid-history incomplete chain when followed by user message', () => {
        const msgs: LLMMessage[] = [
            { role: 'user', content: 'first' },
            { role: 'assistant', content: null, tool_calls: [
                { id: 'tc1', type: 'function', function: { name: 'f', arguments: '{}' } },
                { id: 'tc2', type: 'function', function: { name: 'g', arguments: '{}' } },
            ]} as unknown as LLMMessage,
            { role: 'tool', tool_call_id: 'tc1', content: 'r1' } as LLMMessage,
            // tc2 result missing — then a new user message arrives
            { role: 'user', content: 'second' },
        ];
        const out = sanitizeMessages(msgs);
        // The incomplete assistant+tool block should be stripped
        expect(out.some(m => m.role === 'assistant' && (m as LLMMessage & { tool_calls?: unknown[] }).tool_calls?.length)).toBe(false);
        expect(out.some(m => m.role === 'tool')).toBe(false);
        // Both user messages survive
        expect(out.filter(m => m.role === 'user')).toHaveLength(2);
    });

    it('preserves complete chain', () => {
        const msgs: LLMMessage[] = [
            { role: 'user', content: 'hi' },
            { role: 'assistant', content: null, tool_calls: [{ id: 'tc1', type: 'function', function: { name: 'f', arguments: '{}' } }] } as unknown as LLMMessage,
            { role: 'tool', tool_call_id: 'tc1', content: 'result' } as LLMMessage,
            { role: 'assistant', content: 'done' },
        ];
        expect(sanitizeMessages(msgs)).toEqual(msgs);
    });
});

// ── HistoryManager ────────────────────────────────────────────────────────────

describe('HistoryManager — in-memory operations', () => {
    it('starts empty', () => {
        const h = new HistoryManager({});
        expect(h.getAll()).toHaveLength(0);
    });

    it('push / pushAll / getAll', () => {
        const h = new HistoryManager({});
        h.push({ role: 'user', content: 'hello' });
        h.pushAll([
            { role: 'assistant', content: 'hi' },
            { role: 'user', content: 'bye' },
        ]);
        expect(h.getAll()).toHaveLength(3);
    });

    it('inject appends a user message', () => {
        const h = new HistoryManager({});
        h.inject('context update');
        expect(h.getAll()[0]).toEqual({ role: 'user', content: 'context update' });
    });

    it('clear resets messages', () => {
        const h = new HistoryManager({});
        h.push({ role: 'user', content: 'x' });
        h.clear();
        expect(h.getAll()).toHaveLength(0);
    });

    it('sanitized() returns clean copy', () => {
        const h = new HistoryManager({});
        h.push({ role: 'user', content: 'x' });
        h.push({ role: 'tool', tool_call_id: 'tc1', content: 'orphan' } as LLMMessage);
        const out = h.sanitized();
        expect(out.every(m => m.role !== 'tool')).toBe(true);
        // original unchanged
        expect(h.getAll()).toHaveLength(2);
    });

    it('trim() cuts oldest messages and returns dropped count', () => {
        const h = new HistoryManager({});
        for (let i = 0; i < 5; i++) {
            h.push({ role: 'user', content: `msg-${i}` });
            h.push({ role: 'assistant', content: `reply-${i}` });
        }
        const dropped = h.trim(4); // keep 4
        expect(dropped).toBeGreaterThan(0);
        expect(h.getAll().length).toBeLessThanOrEqual(4 + dropped); // cut at user boundary
    });

    it('trim() with max >= length does nothing', () => {
        const h = new HistoryManager({});
        h.push({ role: 'user', content: 'x' });
        const dropped = h.trim(100);
        expect(dropped).toBe(0);
        expect(h.getAll()).toHaveLength(1);
    });
});

describe('HistoryManager — persistence', () => {
    it('save() writes history to disk and load restores it', () => {
        const p = tmpPath();
        try {
            const h1 = new HistoryManager({ historyPath: p });
            h1.push({ role: 'user', content: 'hello' });
            h1.push({ role: 'assistant', content: 'world' });
            h1.save();
            expect(existsSync(p)).toBe(true);

            const h2 = new HistoryManager({ historyPath: p });
            const msgs = h2.getAll();
            expect(msgs.some(m => m.content === 'hello')).toBe(true);
            expect(msgs.some(m => m.content === 'world')).toBe(true);
        } finally {
            try { unlinkSync(p); } catch {}
        }
    });

    it('clear() writes empty array to disk', () => {
        const p = tmpPath();
        try {
            const h = new HistoryManager({ historyPath: p });
            h.push({ role: 'user', content: 'x' });
            h.save();
            h.clear();
            const h2 = new HistoryManager({ historyPath: p });
            expect(h2.getAll()).toHaveLength(0);
        } finally {
            try { unlinkSync(p); } catch {}
        }
    });

    it('save() respects maxContextMessages cap', () => {
        const p = tmpPath();
        try {
            const h = new HistoryManager({ historyPath: p, maxContextMessages: 2 });
            for (let i = 0; i < 5; i++) h.push({ role: 'user', content: `msg-${i}` });
            h.save();
            const h2 = new HistoryManager({ historyPath: p });
            expect(h2.getAll().length).toBeLessThanOrEqual(2);
        } finally {
            try { unlinkSync(p); } catch {}
        }
    });

    it('loads silently when historyPath does not exist', () => {
        const h = new HistoryManager({ historyPath: '/nonexistent/path/history.json' });
        expect(h.getAll()).toHaveLength(0);
    });

    it('loads silently when historyPath contains invalid JSON', () => {
        const p = tmpPath();
        try {
            writeFileSync(p, 'not-json');
            const h = new HistoryManager({ historyPath: p });
            expect(h.getAll()).toHaveLength(0);
        } finally {
            try { unlinkSync(p); } catch {}
        }
    });
});
