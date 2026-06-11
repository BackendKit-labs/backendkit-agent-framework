import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { ComplianceGate, ComplianceGateError } from '../../flow/ComplianceGate';
import type { ComplianceGateOptions } from '../../flow/ComplianceGate';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeGate(overrides: Partial<ComplianceGateOptions> = {}): ComplianceGate {
    return new ComplianceGate({
        stepId: 'preparar-ficha',
        flowId: 'onboarding-empleado',
        runId: 'run-test',
        executor: 'rrhh',
        criteria: ['Ficha creada en Odoo', 'Nota canónica escrita en /eventos', 'Legajo asignado'],
        evidenceMode: 'required',
        ...overrides,
    });
}

// ── Initial state ─────────────────────────────────────────────────────────────

describe('ComplianceGate — initial state', () => {
    it('starts with verdict pending', () => {
        const gate = makeGate();
        expect(gate.verdict).toBe('pending');
    });

    it('indexes criteria with auto-generated ids (c0, c1, c2)', () => {
        const gate = makeGate();
        const record = gate.getRecord();
        expect(record.criteria.map(c => c.id)).toEqual(['c0', 'c1', 'c2']);
        expect(record.criteria[0].description).toBe('Ficha creada en Odoo');
        expect(record.log).toEqual([]);
    });
});

// ── evaluateCriterion — happy path ────────────────────────────────────────────

describe('ComplianceGate — evaluateCriterion happy path', () => {
    it('marks all 3 criteria passed → verdict becomes passed', () => {
        const gate = makeGate();
        gate.evaluateCriterion(0, 'auditor', true, 'odoo://employees/42');
        gate.evaluateCriterion(1, 'auditor', true, 'vault://eventos/2026-01.md');
        gate.evaluateCriterion(2, 'auditor', true, 'odoo://employees/42#legajo');
        expect(gate.verdict).toBe('passed');
    });

    it('passes without evidence when evidenceMode is optional', () => {
        const gate = makeGate({ evidenceMode: 'optional' });
        gate.evaluateCriterion(0, 'auditor', true);
        gate.evaluateCriterion(1, 'auditor', true);
        gate.evaluateCriterion(2, 'auditor', true);
        expect(gate.verdict).toBe('passed');
    });

    it('appends a criterion_evaluated entry to the log for each pass', () => {
        const gate = makeGate();
        gate.evaluateCriterion(0, 'auditor', true, 'odoo://employees/42');
        const record = gate.getRecord();
        expect(record.log).toHaveLength(1);
        expect(record.log[0].event).toBe('criterion_evaluated');
        expect(record.log[0].criterionId).toBe('c0');
        expect(record.log[0].evaluatorId).toBe('auditor');
        expect(record.log[0].at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('appends a criterion_rejected entry when passed is false', () => {
        const gate = makeGate();
        gate.evaluateCriterion(0, 'auditor', false);
        const record = gate.getRecord();
        expect(record.log[0].event).toBe('criterion_rejected');
        expect(gate.verdict).toBe('failed');
    });

    it('records evaluatedBy and evaluatedAt on the criterion', () => {
        const gate = makeGate();
        gate.evaluateCriterion(0, 'auditor', true, 'evidence-ref');
        const record = gate.getRecord();
        expect(record.criteria[0].evaluatedBy).toBe('auditor');
        expect(record.criteria[0].evaluatedAt).toMatch(/^\d{4}-/);
        expect(record.criteria[0].evidence).toBe('evidence-ref');
    });
});

// ── evaluateCriterion — enforcement ───────────────────────────────────────────

describe('ComplianceGate — evaluateCriterion enforcement', () => {
    it('throws ComplianceGateError when evaluator equals executor', () => {
        const gate = makeGate();
        expect(() => gate.evaluateCriterion(0, 'rrhh', true, 'evidence'))
            .toThrow(ComplianceGateError);
        expect(() => gate.evaluateCriterion(0, 'rrhh', true, 'evidence'))
            .toThrow('self-evaluation is not allowed');
    });

    it('logs the self_evaluation_attempt BEFORE throwing', () => {
        const gate = makeGate();
        try { gate.evaluateCriterion(0, 'rrhh', true, 'evidence'); } catch { /* expected */ }
        const record = gate.getRecord();
        expect(record.log).toHaveLength(1);
        expect(record.log[0].event).toBe('self_evaluation_attempt');
        expect(gate.verdict).toBe('pending');
    });

    it('throws ComplianceGateError when evidence is missing and evidenceMode is required', () => {
        const gate = makeGate({ evidenceMode: 'required' });
        expect(() => gate.evaluateCriterion(0, 'auditor', true))
            .toThrow(ComplianceGateError);
        expect(() => gate.evaluateCriterion(0, 'auditor', true))
            .toThrow('requires evidence');
    });

    it('logs the missing_evidence_attempt BEFORE throwing', () => {
        const gate = makeGate({ evidenceMode: 'required' });
        try { gate.evaluateCriterion(0, 'auditor', true); } catch { /* expected */ }
        const record = gate.getRecord();
        expect(record.log).toHaveLength(1);
        expect(record.log[0].event).toBe('missing_evidence_attempt');
        expect(gate.verdict).toBe('pending');
    });

    it('throws ComplianceGateError for an out-of-range index', () => {
        const gate = makeGate();
        expect(() => gate.evaluateCriterion(99, 'auditor', true, 'e'))
            .toThrow(ComplianceGateError);
    });
});

// ── Verdict progression ───────────────────────────────────────────────────────

describe('ComplianceGate — verdict progression', () => {
    it('stays pending when only some criteria are evaluated', () => {
        const gate = makeGate();
        gate.evaluateCriterion(0, 'auditor', true, 'ev');
        gate.evaluateCriterion(1, 'auditor', true, 'ev');
        expect(gate.verdict).toBe('pending');
    });

    it('becomes failed immediately when any criterion fails', () => {
        const gate = makeGate();
        gate.evaluateCriterion(0, 'auditor', false);
        expect(gate.verdict).toBe('failed');
        gate.evaluateCriterion(1, 'auditor', true, 'ev');
        gate.evaluateCriterion(2, 'auditor', true, 'ev');
        expect(gate.verdict).toBe('failed');
    });

    it('recovers to passed when a previously-failed criterion is re-evaluated as passed', () => {
        const gate = makeGate({ evidenceMode: 'optional' });
        gate.evaluateCriterion(0, 'auditor', false);
        expect(gate.verdict).toBe('failed');
        gate.evaluateCriterion(0, 'auditor', true);
        gate.evaluateCriterion(1, 'auditor', true);
        gate.evaluateCriterion(2, 'auditor', true);
        expect(gate.verdict).toBe('passed');
    });
});

// ── reject ────────────────────────────────────────────────────────────────────

describe('ComplianceGate — reject', () => {
    it('immediately sets verdict to failed', () => {
        const gate = makeGate();
        gate.reject('auditor', 'datos inconsistentes');
        expect(gate.verdict).toBe('failed');
        const record = gate.getRecord();
        expect(record.log[0].event).toBe('gate_rejected');
        expect(record.log[0].detail).toBe('datos inconsistentes');
    });

    it('throws ComplianceGateError when the executor tries to self-reject', () => {
        const gate = makeGate();
        expect(() => gate.reject('rrhh')).toThrow(ComplianceGateError);
        const record = gate.getRecord();
        expect(record.log[0].event).toBe('self_evaluation_attempt');
        expect(gate.verdict).toBe('pending');
    });
});

// ── getRecord (immutability) ──────────────────────────────────────────────────

describe('ComplianceGate — getRecord', () => {
    it('returns a snapshot — mutating the returned object does not affect internal state', () => {
        const gate = makeGate();
        const snap1 = gate.getRecord();
        snap1.verdict = 'passed';
        snap1.criteria[0].passed = true;
        snap1.log.push({ at: 'x', event: 'gate_rejected' });
        expect(gate.verdict).toBe('pending');
        const snap2 = gate.getRecord();
        expect(snap2.criteria[0].passed).toBeUndefined();
        expect(snap2.log).toHaveLength(0);
    });
});

// ── persist ───────────────────────────────────────────────────────────────────

describe('ComplianceGate — persist', () => {
    let tmpDir: string;

    beforeEach(async () => {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gate-persist-'));
    });

    afterEach(async () => {
        await fs.rm(tmpDir, { recursive: true, force: true });
    });

    it('writes a Markdown file to the audit folder', async () => {
        const gate = makeGate();
        gate.evaluateCriterion(0, 'auditor', true, 'odoo://42');
        gate.evaluateCriterion(1, 'auditor', true, 'vault://ev');
        gate.evaluateCriterion(2, 'auditor', true, 'odoo://42#leg');

        const filePath = await gate.persist(tmpDir);
        const content = await fs.readFile(filePath, 'utf-8');

        expect(content).toContain('## Gate — preparar-ficha');
        expect(content).toContain('**passed**');
        expect(content).toContain('Ficha creada en Odoo');
        expect(content).toContain('auditor');
        expect(content).toContain('criterion_evaluated');
    });

    it('file is created under auditoria/{flowId}/{runId}/', async () => {
        const gate = makeGate();
        gate.reject('auditor', 'incomplete');
        const filePath = await gate.persist(tmpDir);
        expect(filePath).toContain(path.join('auditoria', 'onboarding-empleado', 'run-test'));
    });
});

// ── Criterio de salida fase 2 ─────────────────────────────────────────────────

describe('Fase 2 — criterio de salida', () => {
    it('gate with 3 criteria passes only when a different agent marks each one with evidence; self-eval attempt is logged; full record persisted', async () => {
        const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fase2-'));
        try {
            const gate = makeGate({ evidenceMode: 'required' });

            // Attempt self-evaluation — must fail and be logged
            expect(() => gate.evaluateCriterion(0, 'rrhh', true, 'ev'))
                .toThrow(ComplianceGateError);
            expect(gate.verdict).toBe('pending');

            // Legitimate evaluator marks all 3 criteria with evidence
            gate.evaluateCriterion(0, 'auditor', true, 'odoo://employees/42');
            gate.evaluateCriterion(1, 'auditor', true, 'vault://eventos/nota.md');
            gate.evaluateCriterion(2, 'auditor', true, 'odoo://employees/42#legajo');

            expect(gate.verdict).toBe('passed');

            // Persist — full record must be in the vault
            const filePath = await gate.persist(tmpDir);
            const content = await fs.readFile(filePath, 'utf-8');

            // All 3 criteria present
            expect(content).toContain('Ficha creada en Odoo');
            expect(content).toContain('Nota canónica escrita en /eventos');
            expect(content).toContain('Legajo asignado');

            // Self-eval attempt is in the audit log
            expect(content).toContain('self_evaluation_attempt');

            // Verdict is passed
            expect(content).toContain('**passed**');
        } finally {
            await fs.rm(tmpDir, { recursive: true, force: true });
        }
    });
});
