import type { Transport } from '@backendkit-labs/agent-core';
import { parseFlow } from '../../flow/FlowLoader';
import { FlowRunner, interpolate } from '../../flow/FlowRunner';
import { ComplianceGate } from '../../flow/ComplianceGate';
import type { FlowTransition } from '../../flow/types';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTransport(): Transport {
    return { emit: jest.fn(), onInput: jest.fn(() => () => {}), close: jest.fn() };
}

const THREE_STEP_FLOW = parseFlow(`
flow: onboarding
trigger: { type: manual }
steps:
  - id: ficha
    agent: rrhh
    prompt: "Prepara la ficha de {{payload.nombre}}"
  - id: bienvenida
    agent: onboarding
    after: [ficha]
    prompt: "Email de bienvenida"
  - id: preliquidacion
    agent: nomina
    after: [ficha]
    prompt: "Preliquidación de {{payload.nombre}}"
compensation:
  - on: preliquidacion.failed
    agent: nomina
    prompt: "Revierte la preliquidación de {{payload.nombre}}"
`);

// ── interpolate ───────────────────────────────────────────────────────────────

describe('interpolate', () => {
    it('replaces {{payload}} with the full payload as JSON', () => {
        expect(interpolate('Datos: {{payload}}', { a: 1 })).toBe('Datos: {"a":1}');
    });

    it('replaces {{payload}} with the raw string when payload is a string', () => {
        expect(interpolate('Datos: {{payload}}', 'hola')).toBe('Datos: hola');
    });

    it('resolves nested paths', () => {
        expect(interpolate('Hola {{payload.empleado.nombre}}', { empleado: { nombre: 'Juan' } }))
            .toBe('Hola Juan');
    });

    it('renders null for missing paths', () => {
        expect(interpolate('{{payload.no.existe}}', { a: 1 })).toBe('null');
    });

    it('renders null when there is no payload', () => {
        expect(interpolate('{{payload}}', undefined)).toBe('null');
    });

    it('supports whitespace inside braces and multiple occurrences', () => {
        expect(interpolate('{{ payload.a }} y {{payload.b}}', { a: 'x', b: 'y' })).toBe('x y y');
    });

    it('leaves non-payload templates untouched', () => {
        expect(interpolate('hola {{otro}}', { a: 1 })).toBe('hola {{otro}}');
    });
});

// ── FlowRunner: execution ─────────────────────────────────────────────────────

describe('FlowRunner — execution', () => {
    it('runs a 3-step DAG defined only in YAML end-to-end (criterio de salida fase 1)', async () => {
        const calls: Array<{ agentId: string; input: string; stepId?: string }> = [];
        const runner = new FlowRunner(THREE_STEP_FLOW, {
            payload: { nombre: 'Juan' },
            transport: makeTransport(),
            runAgent: async (agentId, input, _ctx, stepId) => {
                calls.push({ agentId, input, stepId });
                return { content: `done by ${agentId}` };
            },
        });

        const result = await runner.run();

        expect(result.status).toBe('completed');
        expect(Object.keys(result.steps)).toHaveLength(3);
        expect(result.steps['ficha'].status).toBe('completed');
        expect(result.steps['bienvenida'].status).toBe('completed');
        expect(result.steps['preliquidacion'].status).toBe('completed');
        expect(result.compensations).toEqual([]);
    });

    it('interpolates the payload into step prompts', async () => {
        const inputs: string[] = [];
        const runner = new FlowRunner(THREE_STEP_FLOW, {
            payload: { nombre: 'Juan' },
            transport: makeTransport(),
            runAgent: async (_a, input) => { inputs.push(input); return { content: 'ok' }; },
        });
        await runner.run();
        expect(inputs).toContain('Prepara la ficha de Juan');
        expect(inputs).toContain('Preliquidación de Juan');
    });

    it('runs the ficha step before its dependents', async () => {
        const order: string[] = [];
        const runner = new FlowRunner(THREE_STEP_FLOW, {
            transport: makeTransport(),
            runAgent: async (_a, _i, _c, stepId) => { order.push(stepId!); return { content: 'ok' }; },
        });
        await runner.run();
        expect(order[0]).toBe('ficha');
        expect(order.slice(1).sort()).toEqual(['bienvenida', 'preliquidacion']);
    });

    it('passes dependency outputs as context', async () => {
        const contexts: Record<string, string | undefined> = {};
        const runner = new FlowRunner(THREE_STEP_FLOW, {
            transport: makeTransport(),
            runAgent: async (_a, _i, context, stepId) => {
                contexts[stepId!] = context;
                return { content: `output-of-${stepId}` };
            },
        });
        await runner.run();
        expect(contexts['ficha']).toBeUndefined();
        expect(contexts['bienvenida']).toContain('output-of-ficha');
    });
});

// ── FlowRunner: transitions (append-only log) ─────────────────────────────────

describe('FlowRunner — transition log', () => {
    it('records started and completed for every executed step', async () => {
        const runner = new FlowRunner(THREE_STEP_FLOW, {
            transport: makeTransport(),
            runAgent: async () => ({ content: 'ok' }),
        });
        const result = await runner.run();

        for (const stepId of ['ficha', 'bienvenida', 'preliquidacion']) {
            const events = result.transitions.filter(t => t.stepId === stepId).map(t => t.event);
            expect(events).toContain('started');
            expect(events).toContain('completed');
        }
        expect(result.transitions.every(t => typeof t.at === 'string' && t.at.length > 0)).toBe(true);
    });

    it('notifies the onTransition observer in order', async () => {
        const seen: FlowTransition[] = [];
        const runner = new FlowRunner(THREE_STEP_FLOW, {
            transport: makeTransport(),
            runAgent: async () => ({ content: 'ok' }),
            onTransition: t => seen.push(t),
        });
        const result = await runner.run();
        expect(seen).toEqual(result.transitions);
    });

    it('records failed with the error detail', async () => {
        const runner = new FlowRunner(THREE_STEP_FLOW, {
            transport: makeTransport(),
            runAgent: async (_a, _i, _c, stepId) => {
                if (stepId === 'ficha') throw new Error('odoo caído');
                return { content: 'ok' };
            },
        });
        const result = await runner.run();
        const failed = result.transitions.find(t => t.event === 'failed');
        expect(failed?.stepId).toBe('ficha');
        expect(failed?.detail).toBe('odoo caído');
    });

    it('records skipped for steps blocked by a failed dependency', async () => {
        const runner = new FlowRunner(THREE_STEP_FLOW, {
            transport: makeTransport(),
            runAgent: async (_a, _i, _c, stepId) => {
                if (stepId === 'ficha') throw new Error('boom');
                return { content: 'ok' };
            },
        });
        const result = await runner.run();
        const skipped = result.transitions.filter(t => t.event === 'skipped').map(t => t.stepId);
        expect(skipped.sort()).toEqual(['bienvenida', 'preliquidacion']);
        expect(result.status).toBe('failed');
    });
});

// ── FlowRunner: human approval gates ──────────────────────────────────────────

describe('FlowRunner — approval gates', () => {
    const APPROVAL_FLOW = parseFlow(`
flow: con-aprobacion
trigger: { type: manual }
steps:
  - id: trabajo
    agent: rrhh
    prompt: "Hace el trabajo"
  - id: confirmar
    agent: nomina
    after: [trabajo]
    prompt: "Confirma el pago"
    gate:
      approval: human
      criteria: ["Pago dentro del presupuesto"]
      evaluator: auditor
`);

    it('invokes onApprovalRequired with the flow step including its gate', async () => {
        const approvals: string[] = [];
        const runner = new FlowRunner(APPROVAL_FLOW, {
            transport: makeTransport(),
            runAgent: async () => ({ content: 'ok' }),
            onApprovalRequired: async (step) => {
                approvals.push(step.id);
                expect(step.gate?.criteria).toEqual(['Pago dentro del presupuesto']);
                expect(step.gate?.evaluator).toBe('auditor');
                return true;
            },
        });
        const result = await runner.run();
        expect(approvals).toEqual(['confirmar']);
        expect(result.status).toBe('completed');
    });

    it('rejection marks the step rejected and the flow rejected', async () => {
        const runner = new FlowRunner(APPROVAL_FLOW, {
            transport: makeTransport(),
            runAgent: async () => ({ content: 'ok' }),
            onApprovalRequired: async () => false,
        });
        const result = await runner.run();
        expect(result.steps['confirmar'].status).toBe('rejected');
        expect(result.status).toBe('rejected');
        const events = result.transitions.filter(t => t.stepId === 'confirmar').map(t => t.event);
        expect(events).toContain('approval_requested');
        expect(events).toContain('rejected');
    });

    it('auto-approves when no onApprovalRequired is provided', async () => {
        const runner = new FlowRunner(APPROVAL_FLOW, {
            transport: makeTransport(),
            runAgent: async () => ({ content: 'ok' }),
        });
        const result = await runner.run();
        expect(result.status).toBe('completed');
    });
});

// ── FlowRunner: compensation ──────────────────────────────────────────────────

describe('FlowRunner — compensation', () => {
    it('runs the matching compensation when its step fails', async () => {
        const compensationCalls: Array<{ agentId: string; input: string; context?: string }> = [];
        const runner = new FlowRunner(THREE_STEP_FLOW, {
            payload: { nombre: 'Juan' },
            transport: makeTransport(),
            runAgent: async (agentId, input, context, stepId) => {
                if (stepId === 'preliquidacion') throw new Error('monto inválido');
                if (stepId === 'preliquidacion:compensation') {
                    compensationCalls.push({ agentId, input, context });
                }
                return { content: 'ok' };
            },
        });

        const result = await runner.run();

        expect(result.compensations).toHaveLength(1);
        expect(result.compensations[0]).toMatchObject({ on: 'preliquidacion.failed', agent: 'nomina', status: 'completed' });
        expect(compensationCalls[0].input).toBe('Revierte la preliquidación de Juan');
        expect(compensationCalls[0].context).toContain('monto inválido');

        const events = result.transitions.filter(t => t.stepId === 'preliquidacion').map(t => t.event);
        expect(events).toContain('compensation_started');
        expect(events).toContain('compensation_completed');
    });

    it('does not run compensation when the step succeeds', async () => {
        const runner = new FlowRunner(THREE_STEP_FLOW, {
            transport: makeTransport(),
            runAgent: async () => ({ content: 'ok' }),
        });
        const result = await runner.run();
        expect(result.compensations).toEqual([]);
    });

    it('records compensation_failed when the compensating agent also fails', async () => {
        const runner = new FlowRunner(THREE_STEP_FLOW, {
            transport: makeTransport(),
            runAgent: async (_a, _i, _c, stepId) => {
                if (stepId === 'preliquidacion') throw new Error('fallo original');
                if (stepId === 'preliquidacion:compensation') throw new Error('compensación falló');
                return { content: 'ok' };
            },
        });
        const result = await runner.run();
        expect(result.compensations[0].status).toBe('failed');
        expect(result.compensations[0].error).toBe('compensación falló');
        expect(result.transitions.some(t => t.event === 'compensation_failed')).toBe(true);
    });

    it('does not run compensation for skipped steps', async () => {
        // ficha fails → preliquidacion is skipped (not failed) → no compensation
        const runner = new FlowRunner(THREE_STEP_FLOW, {
            transport: makeTransport(),
            runAgent: async (_a, _i, _c, stepId) => {
                if (stepId === 'ficha') throw new Error('boom');
                return { content: 'ok' };
            },
        });
        const result = await runner.run();
        expect(result.steps['preliquidacion'].status).toBe('skipped');
        expect(result.compensations).toEqual([]);
    });
});

// ── FlowRunner: compliance gates ──────────────────────────────────────────────

describe('FlowRunner — compliance gates', () => {
    const GATE_FLOW = parseFlow(`
flow: con-gate
trigger: { type: manual }
steps:
  - id: ejecutar
    agent: rrhh
    prompt: "Ejecuta la tarea"
    gate:
      criteria:
        - "Resultado documentado"
        - "Sin errores en Odoo"
      evaluator: auditor
      evidence: required
  - id: siguiente
    agent: onboarding
    after: [ejecutar]
    prompt: "Paso siguiente"
`);

    it('calls onGateRequired after the step executes successfully', async () => {
        const gateCalls: Array<{ stepId: string; output: string }> = [];

        const runner = new FlowRunner(GATE_FLOW, {
            transport: makeTransport(),
            runAgent: async () => ({ content: 'output del paso' }),
            onGateRequired: async (gate, step, output) => {
                gateCalls.push({ stepId: step.id, output });
                gate.evaluateCriterion(0, 'auditor', true, 'ref-1');
                gate.evaluateCriterion(1, 'auditor', true, 'ref-2');
            },
        });

        const result = await runner.run();
        expect(gateCalls).toHaveLength(1);
        expect(gateCalls[0].stepId).toBe('ejecutar');
        expect(gateCalls[0].output).toBe('output del paso');
        expect(result.status).toBe('completed');
    });

    it('records gate_evaluation_started and gate_passed transitions', async () => {
        const runner = new FlowRunner(GATE_FLOW, {
            transport: makeTransport(),
            runAgent: async () => ({ content: 'ok' }),
            onGateRequired: async (gate) => {
                gate.evaluateCriterion(0, 'auditor', true, 'ev');
                gate.evaluateCriterion(1, 'auditor', true, 'ev');
            },
        });
        const result = await runner.run();
        const events = result.transitions.filter(t => t.stepId === 'ejecutar').map(t => t.event);
        expect(events).toContain('gate_evaluation_started');
        expect(events).toContain('gate_passed');
    });

    it('fails the step when onGateRequired leaves the gate in pending state', async () => {
        const runner = new FlowRunner(GATE_FLOW, {
            transport: makeTransport(),
            runAgent: async () => ({ content: 'ok' }),
            onGateRequired: async (_gate) => {
                // only evaluates 1 of 2 criteria → verdict stays pending
                _gate.evaluateCriterion(0, 'auditor', true, 'ev');
            },
        });
        const result = await runner.run();
        expect(result.steps['ejecutar'].status).toBe('failed');
        expect(result.status).toBe('failed');
        const events = result.transitions.filter(t => t.stepId === 'ejecutar').map(t => t.event);
        expect(events).toContain('gate_failed');
    });

    it('fails the step when evaluator rejects the gate', async () => {
        const runner = new FlowRunner(GATE_FLOW, {
            transport: makeTransport(),
            runAgent: async () => ({ content: 'ok' }),
            onGateRequired: async (gate) => {
                gate.reject('auditor', 'output incompleto');
            },
        });
        const result = await runner.run();
        expect(result.steps['ejecutar'].status).toBe('failed');
    });

    it('fails closed when the gate declares criteria and onGateRequired is not provided', async () => {
        const runner = new FlowRunner(GATE_FLOW, {
            transport: makeTransport(),
            runAgent: async () => ({ content: 'ok' }),
            // no onGateRequired
        });
        const result = await runner.run();
        expect(result.status).not.toBe('completed');
        expect(result.transitions.some(t => t.event === 'gate_failed' && t.stepId === 'ejecutar')).toBe(true);
    });

    it('fails closed when the gate has criteria but the flow names no evaluator', async () => {
        const flow = parseFlow(`
flow: sin-evaluador
trigger: { type: manual }
steps:
  - id: a
    agent: rrhh
    prompt: x
    gate:
      criteria: ["Resultado documentado"]
`);
        const runner = new FlowRunner(flow, {
            transport: makeTransport(),
            runAgent: async () => ({ content: 'ok' }),
            onGateRequired: async () => { throw new Error('must not be reached'); },
        });
        const result = await runner.run();
        expect(result.status).not.toBe('completed');
    });

    it('allowUnevaluatedGates lets the step through (transitional escape hatch)', async () => {
        const runner = new FlowRunner(GATE_FLOW, {
            transport: makeTransport(),
            runAgent: async () => ({ content: 'ok' }),
            allowUnevaluatedGates: true,
        });
        const result = await runner.run();
        expect(result.status).toBe('completed');
    });

    it('skips onGateRequired for steps without gate criteria', async () => {
        const gateCalls: string[] = [];
        const runner = new FlowRunner(GATE_FLOW, {
            transport: makeTransport(),
            runAgent: async () => ({ content: 'ok' }),
            onGateRequired: async (_gate, step) => {
                gateCalls.push(step.id);
                _gate.evaluateCriterion(0, 'auditor', true, 'ev');
                _gate.evaluateCriterion(1, 'auditor', true, 'ev');
            },
        });
        await runner.run();
        // Only 'ejecutar' has gate criteria; 'siguiente' does not
        expect(gateCalls).toEqual(['ejecutar']);
    });
});
