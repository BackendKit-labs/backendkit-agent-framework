import { tokenize, keywordScore, cosine } from '../scoring';

describe('tokenize', () => {
    it('lowercases and splits on non-word chars', () => {
        expect(tokenize('Hello World')).toEqual(['hello', 'world']);
    });

    it('filters tokens shorter than 3 chars', () => {
        expect(tokenize('a bb ccc dddd')).toEqual(['ccc', 'dddd']);
    });

    it('handles empty string', () => {
        expect(tokenize('')).toEqual([]);
    });
});

describe('keywordScore', () => {
    it('returns 1.0 when all query terms appear in doc', () => {
        expect(keywordScore('deploy error', 'deploy failed with error')).toBe(1.0);
    });

    it('returns 0 when no query terms match', () => {
        expect(keywordScore('database timeout', 'unrelated topic')).toBe(0);
    });

    it('returns partial score for partial match', () => {
        const score = keywordScore('login auth error', 'login failed');
        expect(score).toBeGreaterThan(0);
        expect(score).toBeLessThan(1);
    });

    it('returns 0 for empty query', () => {
        expect(keywordScore('', 'anything')).toBe(0);
    });

    it('is case-insensitive', () => {
        expect(keywordScore('Deploy Error', 'deploy error occurred')).toBe(1.0);
    });
});

describe('cosine', () => {
    it('returns 1 for identical vectors', () => {
        expect(cosine([1, 0, 1], [1, 0, 1])).toBeCloseTo(1.0);
    });

    it('returns 0 for orthogonal vectors', () => {
        expect(cosine([1, 0], [0, 1])).toBeCloseTo(0);
    });

    it('returns 0 for zero vectors', () => {
        expect(cosine([0, 0], [0, 0])).toBe(0);
    });

    it('handles vectors of different effective lengths via padding', () => {
        const score = cosine([1, 2, 3], [1, 2, 3]);
        expect(score).toBeCloseTo(1.0);
    });

    it('similarity decreases with angle', () => {
        const close = cosine([1, 0.1], [1, 0.2]);
        const far   = cosine([1, 0],   [0, 1]);
        expect(close).toBeGreaterThan(far);
    });
});
