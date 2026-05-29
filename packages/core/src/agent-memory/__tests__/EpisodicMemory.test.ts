import { EpisodicMemory } from '../EpisodicMemory';

describe('EpisodicMemory', () => {
    let mem: EpisodicMemory;
    beforeEach(() => { mem = new EpisodicMemory(); });

    it('remember returns an id', () => {
        const id = mem.remember('deploy failed');
        expect(typeof id).toBe('string');
        expect(id.length).toBeGreaterThan(0);
    });

    it('count increments on remember', () => {
        expect(mem.count()).toBe(0);
        mem.remember('first');
        mem.remember('second');
        expect(mem.count()).toBe(2);
    });

    it('recall returns relevant episodes for a keyword query', () => {
        mem.remember('deploy failed on production server');
        mem.remember('refactor the authentication module');
        const results = mem.recall('deploy production');
        expect(results.length).toBeGreaterThan(0);
        expect(results[0].content).toContain('deploy');
    });

    it('recall returns empty array when nothing matches', () => {
        mem.remember('unrelated content');
        expect(mem.recall('quantum teleportation')).toHaveLength(0);
    });

    it('recall respects limit', () => {
        for (let i = 0; i < 10; i++) mem.remember(`error number ${i}`);
        expect(mem.recall('error', 3)).toHaveLength(3);
    });

    it('recallByTag returns episodes with matching tag', () => {
        mem.remember('db timeout', ['database', 'error']);
        mem.remember('ui bug', ['frontend']);
        const results = mem.recallByTag('database');
        expect(results).toHaveLength(1);
        expect(results[0].tags).toContain('database');
    });

    it('recallByTag returns empty for unknown tag', () => {
        mem.remember('something', ['tag1']);
        expect(mem.recallByTag('unknown')).toHaveLength(0);
    });

    it('recallRecent returns newest episodes', () => {
        mem.remember('first');
        mem.remember('second');
        mem.remember('third');
        const recent = mem.recallRecent(2);
        expect(recent).toHaveLength(2);
        expect(recent[1].content).toBe('third');
    });

    it('episodes have createdAt date', () => {
        mem.remember('test');
        const [ep] = mem.recallRecent(1);
        expect(ep.createdAt).toBeInstanceOf(Date);
    });

    it('maxEpisodes prunes oldest when exceeded', () => {
        const limited = new EpisodicMemory({}, { maxEpisodes: 3 });
        for (let i = 0; i < 5; i++) limited.remember(`episode ${i}`);
        expect(limited.count()).toBe(3);
    });
});
