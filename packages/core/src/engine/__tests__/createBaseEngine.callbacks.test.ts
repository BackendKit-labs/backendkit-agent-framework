import { createBaseEngine, type BaseEngineOptions } from '../createBaseEngine';
import type { IterationStats } from '../IterationManager';
import type { ToolDefinition } from '../../types';
import { createMockTransport, createScriptedProvider, testAgent } from '../../__tests__/helpers';

/**
 * SPEC-0001 §2 (P0): createCodingEngine passes onToolApproval / onIterationLimit / onStep to
 * createBaseEngine with conditional spreads, which TypeScript does not check for excess
 * properties. When createBaseEngine neither declared nor forwarded them, they were dropped
 * silently: no approval gate (a rejecting callback still let write_file run) and no iteration
 * callbacks. These tests guard the wiring at runtime.
 */

function tool(name: string, executed: string[]): ToolDefinition {
    return {
        name,
        description: name,
        parameters: { type: 'object', properties: {} },
        execute: async () => { executed.push(name); return 'ok'; },
    };
}

function buildEngine(
    script: Parameters<typeof createScriptedProvider>[0],
    tools: ToolDefinition[],
    extra: Partial<BaseEngineOptions>,
) {
    const { transport, events } = createMockTransport();
    const engine = createBaseEngine({
        providers: { mock: createScriptedProvider(script) },
        defaultProvider: 'mock',
        agents: [testAgent],
        defaultAgent: testAgent.id,
        tools,
        transport,
        workingDir: process.cwd(),
        noQA: true,
        ...extra,
    });
    return { engine, events };
}

describe('createBaseEngine — callbacks de AgentEngine reenviados (SPEC-0001 P0)', () => {
    it('onToolApproval se invoca antes de ejecutar una herramienta de escritura', async () => {
        const executed: string[] = [];
        const asked: string[] = [];
        const { engine } = buildEngine(
            [{ tool_calls: [{ id: 'c1', name: 'write_file', args: { path: 'a.txt' } }] }, { content: 'listo' }],
            [tool('write_file', executed)],
            { onToolApproval: async (name) => { asked.push(name); return 'approve'; } },
        );

        await engine.run('escribe un archivo');

        expect(asked).toEqual(['write_file']);
        expect(executed).toEqual(['write_file']);
    });

    it('un rechazo en onToolApproval impide ejecutar la herramienta', async () => {
        const executed: string[] = [];
        const { engine } = buildEngine(
            [{ tool_calls: [{ id: 'c1', name: 'write_file', args: { path: 'a.txt' } }] }, { content: 'listo' }],
            [tool('write_file', executed)],
            { onToolApproval: async () => 'reject' },
        );

        await engine.run('escribe un archivo');

        expect(executed).toEqual([]);
    });

    it('onIterationLimit se invoca al llegar a maxIterations en modo interactivo', async () => {
        const stats: IterationStats[] = [];
        const { engine } = buildEngine(
            [
                { tool_calls: [{ id: 'c1', name: 'noop', args: {} }] },
                { tool_calls: [{ id: 'c2', name: 'noop', args: {} }] },
                { content: 'fin' },
            ],
            [tool('noop', [])],
            { maxIterations: 1, onIterationLimit: async (s) => { stats.push(s); return false; } },
        );

        await engine.run('itera');

        expect(stats).toHaveLength(1);
        expect(stats[0].maxIterations).toBe(1);
    });

    it('onStep se invoca en modo step-by-step', async () => {
        const stats: IterationStats[] = [];
        const { engine } = buildEngine(
            [
                { tool_calls: [{ id: 'c1', name: 'noop', args: {} }] },
                { tool_calls: [{ id: 'c2', name: 'noop', args: {} }] },
                { content: 'fin' },
            ],
            [tool('noop', [])],
            { iterationMode: 'step-by-step', onStep: async (s) => { stats.push(s); return true; } },
        );

        await engine.run('itera');

        expect(stats.length).toBeGreaterThanOrEqual(1);
    });
});
