import { ContextManager } from '../ContextManager';
import { HistoryManager } from '../HistoryManager';
import type { LLMMessage } from '../../types';

const oneToOne = (m: LLMMessage) => (m.content?.length ?? 0);

function toolTurn(id: string, result: string): LLMMessage[] {
    return [
        { role: 'assistant', content: null, tool_calls: [{ id, type: 'function', function: { name: 'read', arguments: '{}' } }] },
        { role: 'tool', tool_call_id: id, content: result },
    ];
}

describe('ContextManager — one long turn (an agent tool loop)', () => {
    function loop(results: number, size: number, extra: Partial<ConstructorParameters<typeof ContextManager>[0]> = {}) {
        const history = new HistoryManager({});
        history.push({ role: 'user', content: 'do the big task' }); // the ONLY user turn
        for (let i = 0; i < results; i++) history.pushAll(toolTurn(`t${i}`, `r${i}:` + 'z'.repeat(size)));
        const cm = new ContextManager(
            { maxTokens: 5000, estimateTokens: oneToOne, keepRecentTurns: 2, toolResultMaxChars: 200, ...extra },
            { history, summarize: async () => 'SUMMARY', emit: () => undefined },
        );
        return { history, cm };
    }

    const toolContents = (h: HistoryManager) => h.getAll().filter(m => m.role === 'tool').map(m => m.content ?? '');

    it('cuts the bulky results of all but the newest tool calls inside the turn', async () => {
        const { history, cm } = loop(10, 1500); // ~15 000 chars in one turn, budget 5 000
        const report = await cm.compact();

        expect(report).not.toBeNull();
        expect(report!.truncatedToolResults).toBe(6); // 10 results, newest 4 protected
        const results = toolContents(history);
        expect(results).toHaveLength(10);
        expect(results.slice(0, 6).every(c => c.length < 400)).toBe(true);        // cut
        expect(results.slice(6).every(c => c.length > 1400)).toBe(true);          // newest 4 whole
        expect(report!.tokensAfter).toBeLessThan(report!.tokensBefore);
    });

    it('keepRecentToolResults changes how many stay whole', async () => {
        const { history, cm } = loop(10, 1500, { keepRecentToolResults: 2 });
        await cm.compact();
        const results = toolContents(history);
        expect(results.slice(0, 8).every(c => c.length < 400)).toBe(true);
        expect(results.slice(8).every(c => c.length > 1400)).toBe(true);
    });

    it('keeps every assistant tool_call paired with its result and the user turn intact', async () => {
        const { history, cm } = loop(8, 1500);
        await cm.compact();
        const msgs = history.getAll();
        expect(msgs[0]).toMatchObject({ role: 'user', content: 'do the big task' });
        const callIds = msgs.flatMap(m => m.tool_calls?.map(c => c.id) ?? []);
        const resultIds = msgs.filter(m => m.role === 'tool').map(m => m.tool_call_id);
        expect(resultIds).toEqual(callIds);
    });

    it('does nothing to a turn that is already under budget', async () => {
        const { history, cm } = loop(3, 100);
        expect(await cm.compact()).toBeNull();
        expect(toolContents(history).every(c => c.length > 90)).toBe(true);
    });

    it('does not truncate results that are already short', async () => {
        const { cm, history } = loop(40, 150); // 6 000 chars total, each result under toolResultMaxChars
        const report = await cm.compact();
        expect(report?.truncatedToolResults ?? 0).toBe(0);
        expect(toolContents(history).every(c => c.length > 140)).toBe(true);
    });
});
