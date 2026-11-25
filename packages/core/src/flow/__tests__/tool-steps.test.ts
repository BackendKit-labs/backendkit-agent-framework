import { runFlow } from '../run';
import type { StepExecutor, StepInput } from '../run';
import { MemoryRunJournal } from '../journal';
import { interpolateArgs } from '../interpolate';
import { FlowDefinitionSchema } from '../types';
import { validateFlow, parseFlow } from '../loader';

/**
 * SPEC-0046 F1: a step can be a call to a tool, with structured arguments and a structured result. It is the `tool` step SPEC-0023 D2 accepted and nobody built.
 * Everything here is additive: a flow with no `kind` is the flow of before.
 */

const agentStep = (id: string, after: string[] = []) => ({ id, agent: `agent-${id}`, prompt: `Do ${id}`, after });
const toolStep = (id: string, tool: { name: string; args?: Record<string, unknown> }, after: string[] = []) =>
    ({ id, agent: 'ledger', kind: 'tool' as const, prompt: `Call ${tool.name}`, tool, after });
const flowOf = (steps: unknown[]) => FlowDefinitionSchema.parse({ flow: 't', trigger: { type: 'manual' }, steps });

describe('a flow with no tool step is the flow of before', () => {
    it('parses with no kind and no tool: nothing is added to what was written', () => {
        const def = flowOf([agentStep('a'), agentStep('b', ['a'])]);
        for (const s of def.steps) {
            expect('kind' in s).toBe(false);
            expect('tool' in s).toBe(false);
        }
        expect(validateFlow(def)).toEqual([]);
    });

    it('an agent step gets no tool and no outputs from the engine', async () => {
        const seen: StepInput[] = [];
        const executor: StepExecutor = { run: async (_s, i) => { seen.push(i); return { content: 'ok' }; } };
        await runFlow(flowOf([agentStep('a'), agentStep('b', ['a'])]), { executor });
        for (const i of seen) {
            expect('tool' in i).toBe(false);
            expect('outputs' in i).toBe(false);
        }
    });
});

describe('validation', () => {
    it('a tool step needs its tool, and a tool call needs kind "tool"', () => {
        const noTool = flowOf([{ id: 'a', agent: 'x', prompt: 'p', kind: 'tool' }]);
        expect(validateFlow(noTool).join(' ')).toMatch(/kind "tool" requires a tool/);
        const noKind = flowOf([{ id: 'a', agent: 'x', prompt: 'p', tool: { name: 't' } }]);
        expect(validateFlow(noKind).join(' ')).toMatch(/needs kind "tool"/);
    });

    it('a well-formed tool step validates, from YAML too', () => {
        const def = parseFlow(`
flow: close
trigger: { type: cron, schedule: "0 7 * * 1-5" }
steps:
  - id: tension
    agent: treasury
    kind: tool
    prompt: Detect cash tension
    tool: { name: detectar_tension, args: { horizonteDias: "{{payload.days}}" } }
`);
        expect(def.steps[0]).toMatchObject({ kind: 'tool', tool: { name: 'detectar_tension' } });
    });

    it('an unknown kind is refused', () => {
        expect(() => flowOf([{ id: 'a', agent: 'x', prompt: 'p', kind: 'gate' }])).toThrow();
    });
});

describe('the call the executor receives', () => {
    it('has its arguments resolved from the payload: a whole reference keeps its type, a longer text is interpolated', async () => {
        const seen: Record<string, StepInput> = {};
        const executor: StepExecutor = { run: async (s, i) => { seen[s.id] = i; return { content: '{}' }; } };
        await runFlow(flowOf([toolStep('pay', { name: 'ejecutar_pago', args: {
            importe: '{{payload.amount}}', cuenta: 'cuenta-{{payload.account}}', nested: { lista: ['{{payload.ids}}', 7], flag: true }, missing: '{{payload.nope}}',
        } })]), { executor, payload: { amount: 1500, account: 'A1', ids: [1, 2] } });
        expect(seen.pay!.tool).toEqual({
            name: 'ejecutar_pago',
            args: { importe: 1500, cuenta: 'cuenta-A1', nested: { lista: [[1, 2], 7], flag: true }, missing: null },
        });
    });

    it('is an empty argument list when the step gave none', async () => {
        let call: StepInput['tool'];
        await runFlow(flowOf([toolStep('a', { name: 'cola_excepciones' })]), { executor: { run: async (_s, i) => { call = i.tool; return { content: '{}' }; } } });
        expect(call).toEqual({ name: 'cola_excepciones', args: {} });
    });
});

describe('the structured result', () => {
    it('data with no text becomes the text, and reaches the steps that wait for it as data, not as text', async () => {
        const seen: Record<string, StepInput> = {};
        const executor: StepExecutor = {
            run: async (s, i) => { seen[s.id] = i; return s.id === 'a' ? { content: '', data: { ok: true, valor: { nivel: 3 } } } : { content: 'done' }; },
        };
        const r = await runFlow(flowOf([toolStep('a', { name: 'detectar_tension' }), toolStep('b', { name: 'proponer_pago' }, ['a'])]), { executor });
        expect(r.status).toBe('completed');
        expect(r.steps.a.content).toBe('{"ok":true,"valor":{"nivel":3}}');
        expect(seen.b!.outputs).toEqual({ a: { ok: true, valor: { nivel: 3 } } });
        expect(seen.b!.context).toContain('{"ok":true,"valor":{"nivel":3}}');   // the text channel is the one of before
    });

    it('text the executor wrote is never replaced by the data', async () => {
        const executor: StepExecutor = { run: async () => ({ content: 'mine', data: { x: 1 } }) };
        const r = await runFlow(flowOf([toolStep('a', { name: 't' })]), { executor });
        expect(r.steps.a.content).toBe('mine');
    });

    it('a step that waits for a step with no data gets no `outputs` for it', async () => {
        let outputs: StepInput['outputs'] = { sentinel: 1 };
        const executor: StepExecutor = { run: async (s, i) => { if (s.id === 'b') outputs = i.outputs; return { content: 'text only' }; } };
        await runFlow(flowOf([toolStep('a', { name: 't' }), toolStep('b', { name: 'u' }, ['a'])]), { executor });
        expect(outputs).toBeUndefined();
    });
});

describe('a resume', () => {
    it('does not run the finished tool step again, and the next one gets its data back from the journal', async () => {
        const journal = new MemoryRunJournal();
        const calls: string[] = [];
        let failB = true;
        const executor: StepExecutor = {
            run: async (s, i) => {
                calls.push(s.id);
                if (s.id === 'a') return { content: '', data: { valor: { id: 'P-1' } } };
                if (failB) { failB = false; throw new Error('the agent was down'); }
                return { content: JSON.stringify({ got: i.outputs }) };
            },
        };
        const def = flowOf([toolStep('a', { name: 'proponer_pago' }), toolStep('b', { name: 'aprobar_propuesta_pago' }, ['a'])]);
        const first = await runFlow(def, { executor, journal, runId: 'run-1' });
        expect(first.status).toBe('failed');
        expect(calls).toEqual(['a', 'b']);

        const second = await runFlow(def, { executor, journal, runId: 'run-1' });
        expect(second.status).toBe('completed');
        expect(calls).toEqual(['a', 'b', 'b']);                                    // `a` was done: it did not run again
        expect(JSON.parse(second.steps.b.content)).toEqual({ got: { a: { valor: { id: 'P-1' } } } });   // its data came back from the text in the journal
    });
});

describe('interpolateArgs', () => {
    it('leaves what is not text as it is, at any depth', () => {
        expect(interpolateArgs({ a: 1, b: [true, null, { c: 'x' }] }, {})).toEqual({ a: 1, b: [true, null, { c: 'x' }] });
    });
    it('a whole reference to the payload is the payload', () => {
        expect(interpolateArgs('{{payload}}', { k: 1 })).toEqual({ k: 1 });
    });
});
