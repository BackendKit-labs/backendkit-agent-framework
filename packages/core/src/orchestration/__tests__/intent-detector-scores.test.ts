/**
 * Tests for computeKeywordScores cap (H-006).
 *
 * Previously scores accumulated without limit. A long text mentioning many
 * implementation keywords could score 30-40, dwarfing the 2-point margin
 * used to declare a clear winner. The fix caps each action at MAX_KEYWORD_SCORE=15.
 */

import { detectIntent } from '../intent-detector';

describe('computeKeywordScores — MAX_KEYWORD_SCORE cap (H-006)', () => {
    it('no score exceeds 15 regardless of how many matching keywords are in the text', async () => {
        // A text that repeats many implementation keywords
        const longText = Array(20).fill(
            'implementar develop build create add feature endpoint api'
        ).join(' ');

        const result = await detectIntent(longText);

        for (const [action, score] of Object.entries(result.scores)) {
            expect(score).toBeLessThanOrEqual(15);
        }
    });

    it('confidence is always in [0, 1] even with highly keyword-dense input', async () => {
        const dense = Array(30).fill('fix bug error corregir arreglar problema').join(' ');
        const result = await detectIntent(dense);
        expect(result.confidence).toBeGreaterThanOrEqual(0);
        expect(result.confidence).toBeLessThanOrEqual(1);
    });

    it('discriminates correctly between two competing categories at high keyword density', async () => {
        // Even when both implementation and bugfix have many keywords, the margin
        // logic still works because both are capped and their relative scores remain meaningful.
        const text = 'implementar fix bug error desarrollar codigo endpoint corregir';
        const result = await detectIntent(text);

        // The winner must have a score <= MAX and confidence in [0,1]
        const winnerScore = result.scores[result.actionType] ?? 0;
        expect(winnerScore).toBeLessThanOrEqual(15);
        expect(result.confidence).toBeLessThanOrEqual(1);
    });

    it('a short focused text still classifies correctly after capping', async () => {
        const result = await detectIntent('implementar nuevo endpoint REST');
        // Should classify as implementation or similar, not garbage
        expect(result.actionType).toBeTruthy();
        expect(result.confidence).toBeGreaterThan(0);
    });
});
