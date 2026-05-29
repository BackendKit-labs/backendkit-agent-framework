import { workflow, agent } from '../WorkflowBuilder';

describe('WorkflowBuilder', () => {
    it('build returns name and steps', () => {
        const def = workflow('my-flow')
            .step('a', agent('agent-1'), { input: 'Do A' })
            .step('b', agent('agent-2'), { input: 'Do B' })
            .build();
        expect(def.name).toBe('my-flow');
        expect(def.steps).toHaveLength(2);
    });

    it('step stores agentId, input, and defaults', () => {
        const def = workflow('w').step('s1', agent('ag'), { input: 'hi' }).build();
        const [step] = def.steps;
        expect(step.id).toBe('s1');
        expect(step.agentId).toBe('ag');
        expect(step.input).toBe('hi');
        expect(step.dependsOn).toEqual([]);
        expect(step.requireApproval).toBe(false);
    });

    it('step stores dependsOn and requireApproval', () => {
        const def = workflow('w')
            .step('a', agent('ag'), { input: 'A' })
            .step('b', agent('ag'), { input: 'B', dependsOn: ['a'], requireApproval: true })
            .build();
        expect(def.steps[1].dependsOn).toEqual(['a']);
        expect(def.steps[1].requireApproval).toBe(true);
    });

    it('duplicate step id throws on .step()', () => {
        expect(() =>
            workflow('w')
                .step('dup', agent('ag'), { input: 'X' })
                .step('dup', agent('ag'), { input: 'Y' })
        ).toThrow(/duplicate step id/);
    });

    it('unknown dependency throws on .build()', () => {
        expect(() =>
            workflow('w')
                .step('a', agent('ag'), { input: 'A', dependsOn: ['missing'] })
                .build()
        ).toThrow(/unknown step/);
    });

    it('cycle detection throws on .build()', () => {
        expect(() =>
            workflow('cyclic')
                .step('a', agent('ag'), { input: 'A', dependsOn: ['b'] })
                .step('b', agent('ag'), { input: 'B', dependsOn: ['a'] })
                .build()
        ).toThrow(/cycle/);
    });

    it('three-step cycle detected', () => {
        expect(() =>
            workflow('tri')
                .step('a', agent('ag'), { input: 'A', dependsOn: ['c'] })
                .step('b', agent('ag'), { input: 'B', dependsOn: ['a'] })
                .step('c', agent('ag'), { input: 'C', dependsOn: ['b'] })
                .build()
        ).toThrow(/cycle/);
    });

    it('empty workflow builds without error', () => {
        const def = workflow('empty').build();
        expect(def.steps).toHaveLength(0);
    });
});
