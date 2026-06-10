import { QAService } from '../qa-service';
import type { QAServiceOptions } from '../qa-service';

function makeService(overrides: Partial<QAServiceOptions> = {}): QAService {
    return new QAService({
        client: { chat: jest.fn() } as never,
        basePrompt: () => 'You are a QA engineer.',
        ...overrides,
    });
}

// ── countCodeLines ────────────────────────────────────────────────────────────

describe('QAService.countCodeLines', () => {
    it('returns 0 for plain text with no code blocks', () => {
        const svc = makeService();
        expect(svc.countCodeLines('Hello, this is just text.')).toBe(0);
    });

    it('counts non-empty lines inside a fenced code block', () => {
        const svc = makeService();
        const content = '```ts\nconst a = 1;\nconst b = 2;\n\nconst c = 3;\n```';
        expect(svc.countCodeLines(content)).toBe(3); // blank line not counted
    });

    it('sums lines across multiple code blocks', () => {
        const svc = makeService();
        const content = [
            '```ts',
            'const a = 1;',
            'const b = 2;',
            '```',
            'Some text.',
            '```ts',
            'function foo() {}',
            '```',
        ].join('\n');
        expect(svc.countCodeLines(content)).toBe(3);
    });

    it('returns 0 for an empty code block', () => {
        const svc = makeService();
        expect(svc.countCodeLines('```ts\n```')).toBe(0);
    });

    it('ignores the language tag line', () => {
        const svc = makeService();
        const content = '```typescript\nconst x = 42;\n```';
        expect(svc.countCodeLines(content)).toBe(1);
    });
});

// ── evaluateReview ────────────────────────────────────────────────────────────

describe('QAService.evaluateReview', () => {
    it('returns true when only approval patterns are present', () => {
        const svc = makeService();
        expect(svc.evaluateReview('Se ve bien, aprobado, listo para commit.')).toBe(true);
    });

    it('returns false when only rejection patterns are present', () => {
        const svc = makeService();
        expect(svc.evaluateReview('Hay un problema con la implementación, debe corregir.')).toBe(false);
    });

    it('returns false when both patterns are present but rejection lines dominate', () => {
        const svc = makeService();
        const review = [
            'Hay varios problemas en el código.',
            'Error en la línea 10.',
            'Debe corregir el manejo de errores.',
            'En general se ve bien.',
        ].join('\n');
        expect(svc.evaluateReview(review)).toBe(false);
    });

    it('returns true when both patterns are present but approval lines dominate', () => {
        const svc = makeService();
        const review = [
            'Se ve bien, buen trabajo.',
            'Aprobado para commit.',
            'Listo para continuar.',
            'Un edge case menor podría mejorarse.',
        ].join('\n');
        expect(svc.evaluateReview(review)).toBe(true);
    });

    it('returns true when "lgtm" appears', () => {
        const svc = makeService();
        expect(svc.evaluateReview('LGTM, looks good to me.')).toBe(true);
    });

    it('returns false when "rework" appears', () => {
        const svc = makeService();
        expect(svc.evaluateReview('Rework needed, the code has issues.')).toBe(false);
    });

    it('returns false when "faltan tests" appears', () => {
        const svc = makeService();
        expect(svc.evaluateReview('El código funciona pero faltan tests para los edge cases.')).toBe(false);
    });

    it('returns true for "good to go"', () => {
        const svc = makeService();
        expect(svc.evaluateReview('Looks good. Good to go.')).toBe(true);
    });

    it('returns false for "no apruebo"', () => {
        const svc = makeService();
        expect(svc.evaluateReview('No apruebo este cambio hasta que se corrijan los errores.')).toBe(false);
    });

    it('falls back to line-count tiebreaker when counts are equal', () => {
        // Both patterns on separate lines → equal count → falls through to positiveLines > negativeLines
        // With exactly 1 approval line and 1 rejection line → not positive > negative → returns false
        const svc = makeService();
        const review = 'Se ve bien.\nHay un problema.';
        // positiveLines = 1, negativeLines = 1 → 1 > 1 is false
        expect(svc.evaluateReview(review)).toBe(false);
    });
});

// ── extractFindings ───────────────────────────────────────────────────────────

describe('QAService.extractFindings', () => {
    it('returns empty array when no problem keywords present', () => {
        const svc = makeService();
        const findings = svc.extractFindings('Se ve bien, aprobado, listo para commit.');
        expect(findings).toHaveLength(0);
    });

    it('extracts bullet-point findings from a review with problems', () => {
        const svc = makeService();
        const review = [
            'El código tiene algunos problemas:',
            '- Error en el manejo de excepciones en línea 42',
            '- Falta testing del caso borde cuando el array está vacío',
        ].join('\n');
        const findings = svc.extractFindings(review);
        expect(findings.length).toBeGreaterThanOrEqual(1);
        expect(findings.every(f => f.dimension === 'Code Review')).toBe(true);
        expect(findings.every(f => typeof f.id === 'string' && f.id.startsWith('QA-'))).toBe(true);
    });

    it('detects numbered-list findings', () => {
        const svc = makeService();
        const review = [
            'Problemas encontrados:',
            '1. Debe corregir el manejo de errores.',
            '2. Falta cubrir el edge case del input vacío.',
        ].join('\n');
        const findings = svc.extractFindings(review);
        expect(findings.length).toBeGreaterThanOrEqual(1);
    });

    it('classifies "bloqueante" as critical severity', () => {
        const svc = makeService();
        const review = 'Problemas:\n- Bloqueante: error crítico en la autenticación que debe corregirse.';
        const findings = svc.extractFindings(review);
        const critical = findings.find(f => f.severidad === 'critical');
        expect(critical).toBeDefined();
    });

    it('classifies "mejorable" as low severity', () => {
        const svc = makeService();
        const review = 'Hay problemas:\n- Mejorable: el nombre de la variable podría ser más descriptivo.';
        const findings = svc.extractFindings(review);
        const low = findings.find(f => f.severidad === 'low');
        expect(low).toBeDefined();
    });

    it('adds a fallback single finding when problems exist but no list items match', () => {
        const svc = makeService();
        const review = 'Hay problemas con el código pero no están listados en formato bullet.';
        const findings = svc.extractFindings(review);
        expect(findings).toHaveLength(1);
        expect(findings[0].hallazgo).toBe('The QA review flagged issues in the code');
    });

    it('each finding has all required fields', () => {
        const svc = makeService();
        const review = 'Hay un problema:\n- Error: falta validación de entrada, debe corregir.';
        const findings = svc.extractFindings(review);
        for (const f of findings) {
            expect(typeof f.id).toBe('string');
            expect(typeof f.dimension).toBe('string');
            expect(typeof f.hallazgo).toBe('string');
            expect(['critical', 'high', 'medium', 'low']).toContain(f.severidad);
            expect(typeof f.evidencia).toBe('string');
            expect(typeof f.recomendacion).toBe('string');
            expect(f.agenteResponsable).toBe('qa-engineer');
        }
    });
});
