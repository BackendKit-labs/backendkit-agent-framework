import { SemanticMemory, DEFAULT_MAX_KNOWLEDGE } from '../SemanticMemory';
import { ProceduralMemory, DEFAULT_MAX_PATTERNS } from '../ProceduralMemory';
import { MemorySystem } from '../MemorySystem';

describe('SemanticMemory — entry cap', () => {
    it('keeps the newest maxKnowledge entries and drops the oldest', async () => {
        const mem = new SemanticMemory({}, { maxKnowledge: 3 });
        for (const w of ['alpha', 'bravo', 'charlie', 'delta', 'echo']) await mem.index(`note about ${w}`);
        expect(mem.count()).toBe(3);
        expect(await mem.search('alpha')).toEqual([]);          // oldest two gone
        expect(await mem.search('bravo')).toEqual([]);
        expect((await mem.search('echo')).map(k => k.content)).toEqual(['note about echo']);
    });

    it('has a default cap, and Infinity removes it', async () => {
        expect(DEFAULT_MAX_KNOWLEDGE).toBe(5_000);
        const open = new SemanticMemory({}, { maxKnowledge: Infinity });
        for (let i = 0; i < 20; i++) await open.index(`entry ${i}`);
        expect(open.count()).toBe(20);
    });

    it('a persisted store is capped too', async () => {
        const fs = await import('fs'); const os = await import('os'); const path = await import('path');
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sem-'));
        try {
            const file = path.join(dir, 'k.json');
            const mem = new SemanticMemory({ provider: 'json', path: file }, { maxKnowledge: 2 });
            for (let i = 0; i < 6; i++) await mem.index(`fact ${i}`);
            expect(new SemanticMemory({ provider: 'json', path: file }).count()).toBe(2);
        } finally { fs.rmSync(dir, { recursive: true, force: true }); }
    });
});

describe('ProceduralMemory — pattern cap', () => {
    it('drops the least confirmed pattern first, then the longest unseen', () => {
        const mem = new ProceduralMemory({}, { maxPatterns: 3 });
        mem.learnPattern('deploy to prod', 'run smoke tests', 'success');
        mem.learnPattern('deploy to prod', 'run smoke tests', 'success');     // confirmed twice
        mem.learnPattern('migrate database', 'take a backup', 'success');
        mem.learnPattern('migrate database', 'take a backup', 'success');     // confirmed twice
        mem.learnPattern('rename file', 'use git mv', 'success');             // once
        expect(mem.count()).toBe(3);
        mem.learnPattern('new unrelated thing', 'do something', 'failure');   // a fourth: the weakest goes
        expect(mem.count()).toBe(3);
        expect(mem.getRelevantPatterns('deploy to prod')).toHaveLength(1);
        expect(mem.getRelevantPatterns('migrate database')).toHaveLength(1);
        const gone = ['rename file', 'new unrelated thing'].map(t => mem.getRelevantPatterns(t).length);
        expect(gone.reduce((a, b) => a + b, 0)).toBe(1); // one of the two single-confirmation patterns survived
    });

    it('re-confirming an existing pattern never prunes', () => {
        const mem = new ProceduralMemory({}, { maxPatterns: 2 });
        mem.learnPattern('a thing', 'do x', 'success');
        mem.learnPattern('b thing', 'do y', 'success');
        for (let i = 0; i < 5; i++) mem.learnPattern('a thing', 'do x', 'success');
        expect(mem.count()).toBe(2);
    });

    it('has a default cap, and Infinity removes it', () => {
        expect(DEFAULT_MAX_PATTERNS).toBe(1_000);
        const open = new ProceduralMemory({}, { maxPatterns: Infinity });
        for (let i = 0; i < 30; i++) open.learnPattern(`trigger ${i}`, `action ${i}`, 'success');
        expect(open.count()).toBe(30);
    });
});

describe('MemorySystem passes retention to every store', () => {
    it('caps semantic and procedural through the shared retention config', async () => {
        const sys = new MemorySystem({ retention: { maxKnowledge: 2, maxPatterns: 2 } });
        for (let i = 0; i < 5; i++) await sys.semantic.index(`k${i}`);
        for (let i = 0; i < 5; i++) sys.procedural.learnPattern(`t${i} word`, `a${i}`, 'success');
        expect(sys.semantic.count()).toBe(2);
        expect(sys.procedural.count()).toBe(2);
    });
});
