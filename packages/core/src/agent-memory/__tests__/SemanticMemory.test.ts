import { SemanticMemory } from '../SemanticMemory';

describe('SemanticMemory — keyword mode (no embedFn)', () => {
    let mem: SemanticMemory;
    beforeEach(() => { mem = new SemanticMemory(); });

    it('index returns an id', async () => {
        const id = await mem.index('Circuit breaker prevents cascading failures');
        expect(typeof id).toBe('string');
    });

    it('count increments on index', async () => {
        expect(mem.count()).toBe(0);
        await mem.index('first entry');
        expect(mem.count()).toBe(1);
    });

    it('search returns matching entries', async () => {
        await mem.index('Circuit breaker prevents cascading failures');
        await mem.index('Retry with exponential backoff');
        const results = await mem.search('circuit breaker');
        expect(results.length).toBeGreaterThan(0);
        expect(results[0].content).toContain('Circuit breaker');
    });

    it('search returns empty for no match', async () => {
        await mem.index('database connection pool');
        expect(await mem.search('quantum computing')).toHaveLength(0);
    });

    it('search respects limit', async () => {
        for (let i = 0; i < 8; i++) await mem.index(`error pattern ${i}`);
        const results = await mem.search('error pattern', 3);
        expect(results).toHaveLength(3);
    });

    it('stores and retrieves metadata', async () => {
        await mem.index('use Hilt for DI in Android', { category: 'android', team: 'mobile' });
        const results = await mem.search('Hilt DI', 1);
        expect(results[0].metadata).toEqual({ category: 'android', team: 'mobile' });
    });
});

describe('SemanticMemory — vector mode (with embedFn)', () => {
    function makeEmbedFn(vocab: string[]): (text: string) => Promise<number[]> {
        return async (text) => {
            const lower = text.toLowerCase();
            return vocab.map(w => (lower.includes(w) ? 1 : 0));
        };
    }

    it('uses cosine similarity when embedFn provided', async () => {
        const vocab = ['deploy', 'database', 'auth', 'circuit'];
        const mem = new SemanticMemory({ embedFn: makeEmbedFn(vocab) });
        await mem.index('deploy to production');
        await mem.index('database connection');
        await mem.index('auth token expired');
        const results = await mem.search('deploy', 1);
        expect(results[0].content).toContain('deploy');
    });
});
