import { QAService } from '../qa-service';
import type { LLMChatClient } from '../../orchestration/intent-detector';

const svc = () => new QAService({ client: { chat: async () => ({ content: '' }) } as unknown as LLMChatClient, basePrompt: () => '' });

describe('QAService.evaluateReview — whole words, not substrings', () => {
    it.each([
        ['"broken" does not contain "ok"', 'The parser is broken for empty input.'],
        ['"incorrecto" does not contain "correcto"', 'El resultado es incorrecto.'],
        ['"también" does not contain "bien"', 'También hay un fallo en la validación.'],
        ['"normal" does not contain "mal"', 'Everything is normal except the missing tests.'],
    ])('%s', (_label, review) => {
        expect(svc().evaluateReview(review)).toBe(false);
    });

    it.each([
        'OK',
        'LGTM, ship it.',
        'Looks good. No issues.',
        'Todo bien, sin problemas.',
        'Aprobado :+1:',
    ])('approves %j', (review) => {
        expect(svc().evaluateReview(review)).toBe(true);
    });

    it('reads "not approved" as a rejection, not as "approved"', () => {
        expect(svc().evaluateReview('Not approved: fix the null check.')).toBe(false);
        expect(svc().evaluateReview('No apruebo este cambio.')).toBe(false);
    });

    it('accepts plurals of a rejection word', () => {
        expect(svc().evaluateReview('Found several errors and missing tests.')).toBe(false);
        expect(svc().evaluateReview('Hay errores en el manejo de casos borde.')).toBe(false);
    });

    it('"no hay problemas" is an approval, not an approval plus a rejection', () => {
        expect(svc().evaluateReview('No hay problemas, puede continuar.')).toBe(true);
    });

    it('a mixed review is decided by the lines', () => {
        const review = ['Error on line 10.', 'Incomplete error handling.', 'Overall it looks good.'].join('\n');
        expect(svc().evaluateReview(review)).toBe(false);
    });
});
