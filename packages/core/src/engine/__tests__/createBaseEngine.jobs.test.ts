import { createBaseEngine, type BaseEngineOptions } from '../createBaseEngine';
import type { LLMMessage, LLMProvider, ToolDefinition } from '../../types';
import { createMockTransport, createScriptedProvider, testAgent } from '../../__tests__/helpers';

const jobAgent = { ...testAgent, allowedTools: ['start_job', 'job_output', 'job_list', 'job_kill'] };

/** A tool that starts a background job which finishes when `release()` is called. */
function jobStarter(state: { release?: () => void; signalAborted?: boolean }): ToolDefinition {
    return {
        name: 'start_job',
        description: 'starts a job',
        parameters: { type: 'object', properties: {} },
        execute: async (_args, ctx) => {
            const info = ctx.jobs!.start({
                kind: 'bash', owner: ctx.agentId,
                run: (signal, append) => new Promise<string>(resolve => {
                    append('working…');
                    state.release = () => { append(' done!'); resolve('exit 0'); };
                    signal.addEventListener('abort', () => { state.signalAborted = true; resolve('aborted'); });
                }),
            });
            return `started ${info.id}`;
        },
    };
}

function build(provider: LLMProvider, extra: Partial<BaseEngineOptions>, tools: ToolDefinition[] = []) {
    const { transport, events } = createMockTransport();
    const engine = createBaseEngine({
        providers: { mock: provider }, defaultProvider: 'mock',
        agents: [jobAgent], defaultAgent: jobAgent.id, tools, transport,
        workingDir: process.cwd(), noQA: true, ...extra,
    });
    return { engine, events };
}

function recording(script: Parameters<typeof createScriptedProvider>[0]) {
    const inner = createScriptedProvider(script);
    const seen: LLMMessage[][] = [];
    const provider: LLMProvider = { chat: (m, t, cb, o) => { seen.push(m); return inner.chat(m, t, cb, o); } };
    return { provider, seen };
}

describe('createBaseEngine — background jobs', () => {
    it('without `jobs` no job tools exist and ctx.jobs is absent', async () => {
        const seenTools: string[] = [];
        const provider: LLMProvider = { chat: async (_m, t, cb) => { seenTools.push(...t.map(x => x.name)); cb.onDone({ role: 'assistant', content: 'ok' }); } };
        const { engine } = build(provider, {});
        await engine.run('hi');
        expect(seenTools.filter(n => n.startsWith('job_'))).toEqual([]);
    });

    it('with `jobs` the job tools are offered to agents that allow them', async () => {
        const seenTools: string[] = [];
        const provider: LLMProvider = { chat: async (_m, t, cb) => { seenTools.push(...t.map(x => x.name)); cb.onDone({ role: 'assistant', content: 'ok' }); } };
        const { engine } = build(provider, { jobs: true });
        await engine.run('hi');
        expect(seenTools).toEqual(expect.arrayContaining(['job_output', 'job_list', 'job_kill']));
    });

    it('start → job_output → finished notice once, in the next run', async () => {
        const state: { release?: () => void } = {};
        const { provider, seen } = recording([
            { tool_calls: [{ id: 'c1', name: 'start_job', args: {} }] },
            { tool_calls: [{ id: 'c2', name: 'job_output', args: { id: 'bash-1' } }] },
            { content: 'started it' },
            { content: 'noted' },
            { content: 'again' },
        ]);
        const { engine } = build(provider, { jobs: true }, [jobStarter(state)]);
        await engine.run('start');

        const outputResult = seen[2].filter(m => m.role === 'tool').pop()!.content!;
        expect(outputResult).toContain('bash-1 running');
        expect(outputResult).toContain('working…');

        state.release!();
        await new Promise(r => setImmediate(r));
        await engine.run('anything new?');
        const lastNotices = JSON.stringify(seen[3]);
        expect(lastNotices).toContain('[Background job bash-1 finished (done). Use job_output to read it.]');

        await engine.run('and now');
        const count = (JSON.stringify(seen[4]).match(/Background job bash-1 finished/g) ?? []).length;
        expect(count).toBe(1);                                  // not announced twice
    });

    it('job_output on an unknown id answers not found', async () => {
        const { provider, seen } = recording([
            { tool_calls: [{ id: 'c1', name: 'job_output', args: { id: 'bash-9' } }] },
            { content: 'ok' },
        ]);
        const { engine } = build(provider, { jobs: true });
        await engine.run('x');
        expect(seen[1].filter(m => m.role === 'tool').pop()!.content).toBe('Error: job bash-9 not found');
    });

    it('job_kill cancels a running job', async () => {
        const state: { signalAborted?: boolean } = {};
        const { provider } = recording([
            { tool_calls: [{ id: 'c1', name: 'start_job', args: {} }] },
            { tool_calls: [{ id: 'c2', name: 'job_kill', args: { id: 'bash-1' } }] },
            { content: 'killed' },
        ]);
        const { engine } = build(provider, { jobs: true }, [jobStarter(state)]);
        await engine.run('go');
        expect(state.signalAborted).toBe(true);
    });

    it('engine.abort() cancels live jobs', async () => {
        const state: { signalAborted?: boolean } = {};
        const { provider } = recording([
            { tool_calls: [{ id: 'c1', name: 'start_job', args: {} }] },
            { content: 'started' },
        ]);
        const { engine } = build(provider, { jobs: true }, [jobStarter(state)]);
        await engine.run('go');
        engine.abort();
        await new Promise(r => setTimeout(r, 20));
        expect(state.signalAborted).toBe(true);
    });
});
