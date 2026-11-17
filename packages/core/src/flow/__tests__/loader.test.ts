import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { parseFlow, loadFlow, loadFlowsFromDir, FlowLoadError } from '../loader';

// ── Helpers ───────────────────────────────────────────────────────────────────

const VALID_FLOW = `
flow: onboarding-empleado
version: 1
trigger:
  type: queue
  queue: eventos.contratacion
steps:
  - id: preparar-ficha
    agent: rrhh
    prompt: "Prepara la ficha del empleado: {{payload}}"
    tools: [odoo_employee_create, search_knowledge]
    gate:
      criteria:
        - "Ficha creada en Odoo"
      evaluator: auditor
      evidence: required
  - id: bienvenida
    agent: onboarding
    after: [preparar-ficha]
    prompt: "Envía el email de bienvenida"
  - id: preliquidacion
    agent: nomina
    after: [preparar-ficha]
    prompt: "Prepara la preliquidación"
    gate:
      approval: human
compensation:
  - on: preliquidacion.failed
    agent: nomina
    prompt: "Revierte la preliquidación"
`;

function expectLoadError(yamlContent: string, issueFragment: string): void {
    try {
        parseFlow(yamlContent);
        fail('expected FlowLoadError');
    } catch (err) {
        expect(err).toBeInstanceOf(FlowLoadError);
        const issues = (err as FlowLoadError).issues.join('\n');
        expect(issues).toContain(issueFragment);
    }
}

// ── parseFlow: valid input ────────────────────────────────────────────────────

describe('parseFlow — valid flows', () => {
    it('parses a complete flow definition', () => {
        const def = parseFlow(VALID_FLOW);
        expect(def.flow).toBe('onboarding-empleado');
        expect(def.steps).toHaveLength(3);
        expect(def.compensation).toHaveLength(1);
    });

    it('applies defaults: version 1, empty after, optional evidence', () => {
        const def = parseFlow(`
flow: minimal
trigger: { type: manual }
steps:
  - id: solo
    agent: general
    prompt: "Haz algo"
    gate:
      criteria: ["criterio"]
      evaluator: auditor
`);
        expect(def.version).toBe(1);
        expect(def.steps[0].after).toEqual([]);
        expect(def.steps[0].gate?.evidence).toBe('optional');
        expect(def.steps[0].gate?.approval).toBe('none');
        expect(def.compensation).toEqual([]);
    });

    it('preserves gate metadata for later ComplianceGate enforcement', () => {
        const def = parseFlow(VALID_FLOW);
        const gate = def.steps[0].gate;
        expect(gate?.criteria).toEqual(['Ficha creada en Odoo']);
        expect(gate?.evaluator).toBe('auditor');
        expect(gate?.evidence).toBe('required');
    });

    it('parses parallel steps (same after) without errors', () => {
        const def = parseFlow(VALID_FLOW);
        expect(def.steps[1].after).toEqual(['preparar-ficha']);
        expect(def.steps[2].after).toEqual(['preparar-ficha']);
    });
});

// ── parseFlow: structural validation ──────────────────────────────────────────

describe('parseFlow — structural validation', () => {
    it('rejects YAML syntax errors', () => {
        expectLoadError('flow: [unclosed', 'YAML syntax error');
    });

    it('rejects a missing flow name', () => {
        expectLoadError(`
trigger: { type: manual }
steps:
  - { id: a, agent: x, prompt: p }
`, 'flow');
    });

    it('rejects an empty steps array', () => {
        expectLoadError(`
flow: empty
trigger: { type: manual }
steps: []
`, 'steps');
    });

    it('rejects a step without prompt', () => {
        expectLoadError(`
flow: noprompt
trigger: { type: manual }
steps:
  - { id: a, agent: x }
`, 'prompt');
    });

    it('rejects an invalid compensation selector', () => {
        expectLoadError(`
flow: badcomp
trigger: { type: manual }
steps:
  - { id: a, agent: x, prompt: p }
compensation:
  - { on: "a.exploded", agent: x, prompt: p }
`, 'must be "<stepId>.failed"');
    });
});

// ── parseFlow: semantic validation ────────────────────────────────────────────

describe('parseFlow — semantic validation', () => {
    it('rejects duplicate step ids', () => {
        expectLoadError(`
flow: dup
trigger: { type: manual }
steps:
  - { id: a, agent: x, prompt: p }
  - { id: a, agent: y, prompt: q }
`, 'duplicate step id "a"');
    });

    it('rejects unknown after references', () => {
        expectLoadError(`
flow: ghost
trigger: { type: manual }
steps:
  - { id: a, agent: x, prompt: p, after: [nope] }
`, 'unknown step "nope"');
    });

    it('rejects self-dependency', () => {
        expectLoadError(`
flow: selfdep
trigger: { type: manual }
steps:
  - { id: a, agent: x, prompt: p, after: [a] }
`, 'cannot depend on itself');
    });

    it('rejects dependency cycles', () => {
        expectLoadError(`
flow: cycle
trigger: { type: manual }
steps:
  - { id: a, agent: x, prompt: p, after: [b] }
  - { id: b, agent: y, prompt: q, after: [a] }
`, 'dependency cycle');
    });

    it('rejects gate evaluator equal to the executing agent (evaluador ≠ ejecutor)', () => {
        expectLoadError(`
flow: selfeval
trigger: { type: manual }
steps:
  - id: a
    agent: rrhh
    prompt: p
    gate:
      criteria: ["c"]
      evaluator: rrhh
`, 'must differ from the executing agent');
    });

    it('rejects compensation referencing an unknown step', () => {
        expectLoadError(`
flow: orphancomp
trigger: { type: manual }
steps:
  - { id: a, agent: x, prompt: p }
compensation:
  - { on: "ghost.failed", agent: x, prompt: p }
`, 'unknown step "ghost"');
    });
});

// ── parseFlow: trigger coherence ──────────────────────────────────────────────

describe('parseFlow — trigger coherence', () => {
    it('requires queue name for queue triggers', () => {
        expectLoadError(`
flow: q
trigger: { type: queue }
steps:
  - { id: a, agent: x, prompt: p }
`, 'requires a queue name');
    });

    it('requires path for webhook triggers', () => {
        expectLoadError(`
flow: w
trigger: { type: webhook }
steps:
  - { id: a, agent: x, prompt: p }
`, 'requires a path');
    });

    it('requires schedule for cron triggers', () => {
        expectLoadError(`
flow: c
trigger: { type: cron }
steps:
  - { id: a, agent: x, prompt: p }
`, 'requires a schedule');
    });

    it('accepts manual triggers with no extra fields', () => {
        const def = parseFlow(`
flow: m
trigger: { type: manual }
steps:
  - { id: a, agent: x, prompt: p }
`);
        expect(def.trigger.type).toBe('manual');
    });
});

// ── loadFlow / loadFlowsFromDir ───────────────────────────────────────────────

describe('loadFlow / loadFlowsFromDir', () => {
    let tmpDir: string;

    beforeEach(async () => {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'flow-loader-'));
    });

    afterEach(async () => {
        await fs.rm(tmpDir, { recursive: true, force: true });
    });

    it('loads a flow from a file', async () => {
        const file = path.join(tmpDir, 'onboarding.yaml');
        await fs.writeFile(file, VALID_FLOW, 'utf-8');
        const def = await loadFlow(file);
        expect(def.flow).toBe('onboarding-empleado');
    });

    it('loads all yaml files from a directory in sorted order', async () => {
        await fs.writeFile(path.join(tmpDir, 'b-second.yaml'), VALID_FLOW.replace('onboarding-empleado', 'flujo-b'), 'utf-8');
        await fs.writeFile(path.join(tmpDir, 'a-first.yml'), VALID_FLOW.replace('onboarding-empleado', 'flujo-a'), 'utf-8');
        await fs.writeFile(path.join(tmpDir, 'ignored.txt'), 'not yaml', 'utf-8');
        const flows = await loadFlowsFromDir(tmpDir);
        expect(flows.map(f => f.flow)).toEqual(['flujo-a', 'flujo-b']);
    });

    it('throws FlowLoadError for an invalid file in the directory', async () => {
        await fs.writeFile(path.join(tmpDir, 'bad.yaml'), 'flow: bad\ntrigger: { type: manual }\nsteps: []', 'utf-8');
        await expect(loadFlowsFromDir(tmpDir)).rejects.toThrow(FlowLoadError);
    });
});

describe('validateFlow (SPEC-0023): the semantic half, on a definition that was not loaded from YAML (a plan built by a planner)', () => {
    const base = { flow: 'f', version: 1, trigger: { type: 'manual' as const }, compensation: [] };
    const step = (id: string, after: string[] = []) => ({ id, agent: 'a', prompt: 'p', after });
    it('accepts a valid definition', async () => {
        const { validateFlow } = await import('../loader');
        expect(validateFlow({ ...base, steps: [step('a'), step('b', ['a'])] })).toEqual([]);
    });
    it('names a cycle, an unknown step and a step that waits for itself', async () => {
        const { validateFlow } = await import('../loader');
        expect(validateFlow({ ...base, steps: [step('a', ['b']), step('b', ['a'])] }).join('\n')).toMatch(/cycle/);
        expect(validateFlow({ ...base, steps: [step('a', ['zz'])] }).join('\n')).toMatch(/unknown step "zz"/);
        expect(validateFlow({ ...base, steps: [step('a', ['a'])] }).join('\n')).toMatch(/cannot depend on itself/);
    });
});
