import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseVerdict } from '../phase-runner.js';

// ── parseVerdict ──────────────────────────────────────────────────────────────

describe('parseVerdict', () => {

    // ── Priority 1: structured VERDICT: line ─────────────────────────────────

    test('VERDICT: GO', () => {
        assert.equal(parseVerdict('VERDICT: GO'), 'GO');
    });

    test('VERDICT: NO_GO', () => {
        assert.equal(parseVerdict('VERDICT: NO_GO'), 'NO_GO');
    });

    test('VERDICT: CONDITIONAL', () => {
        assert.equal(parseVerdict('VERDICT: CONDITIONAL'), 'CONDITIONAL');
    });

    test('VERDICT line at end of long report', () => {
        const report = [
            '# QA Report',
            '**Veredicto:** ❌ NO GO',
            '| C1 | criterion | ✅ | evidence |',
            '',
            'VERDICT: GO',
        ].join('\n');
        // Structured line wins over markdown header
        assert.equal(parseVerdict(report), 'GO');
    });

    test('VERDICT line case insensitive', () => {
        assert.equal(parseVerdict('verdict: go'), 'GO');
        assert.equal(parseVerdict('verdict: no_go'), 'NO_GO');
    });

    test('VERDICT line with trailing whitespace', () => {
        assert.equal(parseVerdict('VERDICT: GO   \n'), 'GO');
    });

    // ── Priority 2: markdown header ───────────────────────────────────────────

    test('markdown header GO', () => {
        assert.equal(parseVerdict('**Veredicto:** ✅ GO'), 'GO');
    });

    test('markdown header NO GO', () => {
        assert.equal(parseVerdict('**Veredicto:** ❌ NO GO'), 'NO_GO');
    });

    test('markdown header CONDITIONAL', () => {
        assert.equal(parseVerdict('Verdict: ⚠️ CONDITIONAL'), 'CONDITIONAL');
    });

    test('markdown header NO_GO with underscore', () => {
        assert.equal(parseVerdict('**Veredicto:** NO_GO'), 'NO_GO');
    });

    test('markdown header Spanish CONDICIONAL', () => {
        assert.equal(parseVerdict('Veredicto: CONDICIONAL'), 'CONDITIONAL');
    });

    // ── Priority 3: emoji/keyword heuristics ─────────────────────────────────

    test('emoji ❌ fallback', () => {
        assert.equal(parseVerdict('El código tiene ❌ problemas graves'), 'NO_GO');
    });

    test('emoji ⚠️ fallback', () => {
        assert.equal(parseVerdict('⚠️ Hay observaciones menores'), 'CONDITIONAL');
    });

    test('keyword NO GO fallback', () => {
        assert.equal(parseVerdict('Resultado: NO GO — faltan tests'), 'NO_GO');
    });

    // ── Edge cases ────────────────────────────────────────────────────────────

    test('empty string defaults to GO', () => {
        assert.equal(parseVerdict(''), 'GO');
    });

    test('no verdict found defaults to GO', () => {
        assert.equal(parseVerdict('El código es correcto y está bien implementado.'), 'GO');
    });

    test('VERDICT overrides contradictory emoji', () => {
        // VERDICT: GO should win even if there are ❌ emojis elsewhere
        const report = '❌ Some issues found\nVERDICT: CONDITIONAL';
        assert.equal(parseVerdict(report), 'CONDITIONAL');
    });
});
