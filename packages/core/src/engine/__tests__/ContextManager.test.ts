import { ContextManager, extractSummary, SUMMARY_OPEN } from '../ContextManager';
import type { ContextOptions } from '../ContextManager';
import { HistoryManager, sanitizeMessages } from '../HistoryManager';
import type { LLMMessage } from '../../types';

// 1 char = 1 token keeps the arithmetic obvious in tests.
const oneToOne = (m: LLMMessage) => (m.content?.length ?? 0);

function user(text: string): LLMMessage { return { role: 'user', content: text }; }
function assistant(text: string): LLMMessage { return { role: 'assistant', content: text }; }
function toolTurn(id: string, result: string): LLMMessage[] {
    return [
        { role: 'assistant', content: null, tool_calls: [{ id, type: 'function', function: { name: 'read', arguments: '{}' } }] },
        { role: 'tool', tool_call_id: id, content: result },
    ];
}

function setup(opts: Partial<ContextOptions>, summarize?: (t: string, p?: string) => Promise<string>) {
    const history = new HistoryManager({});
    const events: unknown[] = [];
    const summarizeFn = jest.fn(summarize ?? (async () => 'SUMMARY'));
    const cm = new ContextManager(
        { maxTokens: 1000, estimateTokens: oneToOne, keepRecentTurns: 2, ...opts },
        { history, summarize: summarizeFn, emit: (e) => events.push(e) },
    );
    return { history, cm, events, summarizeFn };
}

function fill(history: HistoryManager, turns: number, size = 100): void {
    for (let i = 0; i < turns; i++) {
        history.push(user(`q${i}-` + 'x'.repeat(size)));
        history.push(assistant(`a${i}-` + 'y'.repeat(size)));
    }
}

describe('ContextManager', () => {
    it('does nothing under the threshold', async () => {
        const { history, cm, summarizeFn } = setup({});
        fill(history, 2);
        expect(await cm.compact()).toBeNull();
        expect(summarizeFn).not.toHaveBeenCalled();
        expect(history.getAll()).toHaveLength(4);
    });

    it('truncates old tool results before summarizing anything', async () => {
        const { history, cm, summarizeFn } = setup({ maxTokens: 3000, toolResultMaxChars: 200, keepRecentTurns: 1 });
        history.push(user('old'));
        history.pushAll(toolTurn('t1', 'z'.repeat(4000)));
        history.push(assistant('done'));
        history.push(user('recent'));
        history.push(assistant('ok'));

        const report = await cm.compact();
        expect(report?.truncatedToolResults).toBe(1);
        expect(summarizeFn).not.toHaveBeenCalled();
        const tool = history.getAll().find(m => m.role === 'tool')!;
        expect(tool.content!.length).toBeLessThan(400);
        expect(tool.content).toContain('truncated by context manager');
    });

    it('never truncates tool results inside the recent turns', async () => {
        const { history, cm } = setup({ maxTokens: 3000, toolResultMaxChars: 200, keepRecentTurns: 1 });
        history.push(user('only turn'));
        history.pushAll(toolTurn('t1', 'z'.repeat(4000)));
        history.push(assistant('done'));
        await cm.compact();
        expect(history.getAll().find(m => m.role === 'tool')!.content).toHaveLength(4000);
    });

    it('summarizes the oldest turns and keeps the recent ones intact', async () => {
        const { history, cm, summarizeFn, events } = setup({});
        fill(history, 8);
        const report = await cm.compact();

        expect(summarizeFn).toHaveBeenCalledTimes(1);
        expect(report!.summarizedMessages).toBeGreaterThan(0);
        const msgs = history.getAll();
        expect(extractSummary(msgs[0])).toBe('SUMMARY');
        expect(msgs[0].content).toContain('q6-');            // merged into the first kept user turn
        expect(msgs.filter(m => m.role === 'user')).toHaveLength(2);
        expect(msgs.some(m => m.content?.startsWith('q7-'))).toBe(true);
        expect(cm.tokens(msgs)).toBeLessThanOrEqual(1000);
        expect(events).toContainEqual(expect.objectContaining({ type: 'compacting', phase: 'start' }));
        expect(events).toContainEqual(expect.objectContaining({ type: 'compacting', phase: 'done' }));
    });

    it('never leaves an orphaned tool_call / tool result pair', async () => {
        const { history, cm } = setup({ maxTokens: 800 });
        for (let i = 0; i < 6; i++) {
            history.push(user(`q${i}`));
            history.pushAll(toolTurn(`t${i}`, 'r'.repeat(150)));
            history.push(assistant('a'.repeat(100)));
        }
        await cm.compact();
        const msgs = history.getAll();
        expect(sanitizeMessages(msgs)).toEqual(msgs);
        expect(msgs[0].role).toBe('user');
    });

    it('extends the previous summary instead of nesting a new one', async () => {
        const seen: Array<string | undefined> = [];
        const { history, cm } = setup({}, async (_t, previous) => { seen.push(previous); return previous ? 'SECOND' : 'FIRST'; });
        fill(history, 8);
        await cm.compact();
        fill(history, 8);
        await cm.compact();

        expect(seen).toEqual([undefined, 'FIRST']);
        const first = history.getAll()[0];
        expect(extractSummary(first)).toBe('SECOND');
        expect((first.content!.match(new RegExp(SUMMARY_OPEN, 'g')) ?? [])).toHaveLength(1);
    });

    it('falls back to dropping when the summarizer fails', async () => {
        const { history, cm, events } = setup({}, async () => { throw new Error('boom'); });
        fill(history, 8);
        const report = await cm.compact();

        expect(report!.droppedMessages).toBeGreaterThan(0);
        expect(report!.summarizedMessages).toBe(0);
        expect(history.getAll().some(m => extractSummary(m) !== undefined)).toBe(false);
        expect(cm.tokens(history.getAll())).toBeLessThanOrEqual(1000);
        expect(events).toContainEqual(expect.objectContaining({ type: 'compacting', phase: 'fail' }));
    });

    it('strategy "drop" never calls the summarizer', async () => {
        const { history, cm, summarizeFn } = setup({ strategy: 'drop' });
        fill(history, 8);
        const report = await cm.compact();
        expect(summarizeFn).not.toHaveBeenCalled();
        expect(report!.droppedMessages).toBeGreaterThan(0);
    });

    it('warns when the recent turns alone exceed the budget', async () => {
        const { history, cm, events } = setup({ maxTokens: 100, keepRecentTurns: 2 });
        fill(history, 3, 200);
        await cm.compact();
        expect(events).toContainEqual(expect.objectContaining({ type: 'system', level: 'warn' }));
    });

    it('calibrates the estimate against real provider usage, within bounds', () => {
        const { cm } = setup({});
        expect(cm.calibration).toBe(1);
        cm.observeUsage(2000, 1000);
        expect(cm.calibration).toBeGreaterThan(1);
        for (let i = 0; i < 20; i++) cm.observeUsage(1_000_000, 1000);
        expect(cm.calibration).toBeLessThanOrEqual(2.5);
        for (let i = 0; i < 40; i++) cm.observeUsage(1, 1000);
        expect(cm.calibration).toBeGreaterThanOrEqual(0.5);
        cm.observeUsage(0, 1000);
        cm.observeUsage(100, 0);
    });
});
