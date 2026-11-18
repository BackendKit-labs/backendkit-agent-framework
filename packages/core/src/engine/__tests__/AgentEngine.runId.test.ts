/** The id of a run, shared by its result, its audit events and its spans (SPEC-0039 F1). */
import { createBaseEngine, type BaseEngineOptions } from '../createBaseEngine';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryAuditSink, HashChainAuditSink, verifyAuditChain } from '../../governance/audit';
import type { AgentProfile, ToolDefinition } from '../../types';
import type { Span } from '../../observability/types';
import { createMockTransport, createScriptedProvider, testAgent, type Turn } from '../../__tests__/helpers';

const tool = (name: string): ToolDefinition => ({ name, description: '', parameters: { type: 'object' }, readOnly: true, execute: async () => `${name} ran` });
const main: AgentProfile = { ...testAgent, id: 'main', allowedTools: ['look', 'put'], delegatesTo: ['helper'] };
const helper: AgentProfile = { ...testAgent, id: 'helper', name: 'Helper', allowedTools: ['look'], delegatesTo: [] };
const call = (...names: string[]): Turn => ({ tool_calls: names.map((name, i) => ({ id: `c${i}-${name}`, name, args: {} })) });

function build(script: Turn[], extra: Partial<BaseEngineOptions> = {}) {
    const { transport, events } = createMockTransport();
    const engine = createBaseEngine({
        providers: { mock: createScriptedProvider(script) }, defaultProvider: 'mock', agents: [main, helper], defaultAgent: main.id,
        tools: [tool('look'), tool('put')], transport, workingDir: process.cwd(), iterationMode: 'auto', ...extra,
    });
    return { engine, events };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('every run has an id, and what the run does carries it', () => {
    it('the result has a runId, every audit event of the run has the same one, and the next run has another', async () => {
        const audit = new MemoryAuditSink();
        const { engine } = build([call('look', 'put'), { content: 'one' }, call('look'), { content: 'two' }], { audit });
        const a = await engine.run('first');
        const b = await engine.run('second');
        expect(a.runId).toMatch(UUID);
        expect(b.runId).toMatch(UUID);
        expect(a.runId).not.toBe(b.runId);
        expect(audit.events.map(e => [e.tool, e.runId])).toEqual([['look', a.runId], ['put', a.runId], ['look', b.runId]]);
    });

    it('a run id of your own is used, for example the id of the flow run this turn belongs to', async () => {
        const audit = new MemoryAuditSink();
        const { engine } = build([call('look'), { content: 'done' }], { audit });
        const r = await engine.run('x', { runId: 'flow-run-42' });
        expect(r.runId).toBe('flow-run-42');
        expect(audit.events.every(e => e.runId === 'flow-run-42')).toBe(true);
    });

    it('a delegate belongs to the run of the agent that asked: one id for the whole turn', async () => {
        const audit = new MemoryAuditSink();
        const ask: Turn = { tool_calls: [{ id: 'a1', name: 'ask_agent', args: { agent_id: 'helper', question: 'look' } }] };
        const { engine } = build([ask, call('look'), { content: 'helper done' }, { content: 'done' }], { audit });
        const r = await engine.run('delegate');
        const ids = new Set(audit.events.map(e => e.runId));
        expect(audit.events.some(e => e.principal.agentId === 'helper')).toBe(true);
        expect([...ids]).toEqual([r.runId]);
    });

    it('the spans of the run carry it as the run_id tag, so a span and its audit events meet', async () => {
        const spans: Span[] = [];
        const audit = new MemoryAuditSink();
        const { engine } = build([call('look'), { content: 'done' }], { audit, observability: { tracing: { exporter: s => { spans.push(s); } } } });
        const r = await engine.run('x');
        expect(spans.length).toBeGreaterThan(0);
        expect(spans.map(s => s.name)).toEqual(expect.arrayContaining(['run', 'tool_call']));
        expect(spans.every(s => s.tags.run_id === r.runId)).toBe(true);
        expect(new Set(spans.map(s => s.traceId)).size).toBe(1);               // one trace, and from the audit event to its trace by the run id
        expect(audit.events[0].runId).toBe(spans[0].tags.run_id);
    });

    it('two runs trace with their own ids: nothing of the first leaks into the second', async () => {
        const spans: Span[] = [];
        const { engine } = build([{ content: 'a' }, { content: 'b' }], { observability: { tracing: { exporter: s => { spans.push(s); } } } });
        const a = await engine.run('1');
        const b = await engine.run('2');
        expect(spans.filter(s => s.tags.run_id === a.runId).length).toBeGreaterThan(0);
        expect(spans.filter(s => s.tags.run_id === b.runId).length).toBeGreaterThan(0);
        expect(spans.filter(s => s.tags.run_id === a.runId && s.traceId === spans.find(x => x.tags.run_id === b.runId)!.traceId)).toHaveLength(0);
    });

    it('the run id is part of the chained audit log: the chain verifies, and changing a run id breaks it', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'runid-chain-'));
        try {
            const path = join(dir, 'audit.ndjson');
            const { engine } = build([call('look'), { content: 'done' }], { audit: new HashChainAuditSink(path) });
            const r = await engine.run('x');
            expect(verifyAuditChain(path).ok).toBe(true);
            const text = readFileSync(path, 'utf8');
            expect(text).toContain(r.runId as string);
            writeFileSync(path, text.replace(r.runId as string, 'another-run'));
            expect(verifyAuditChain(path).ok).toBe(false);
        } finally { rmSync(dir, { recursive: true, force: true }); }
    });
});
