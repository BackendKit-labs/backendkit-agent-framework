import { ProceduralMemory } from '../ProceduralMemory';

describe('ProceduralMemory', () => {
    let mem: ProceduralMemory;
    beforeEach(() => { mem = new ProceduralMemory(); });

    it('count starts at 0', () => {
        expect(mem.count()).toBe(0);
    });

    it('learnPattern stores a new pattern', () => {
        mem.learnPattern('database timeout', 'increase connection pool', 'success');
        expect(mem.count()).toBe(1);
    });

    it('learnPattern deduplicates and increments occurrences', () => {
        mem.learnPattern('ci fails', 'run docker compose up', 'success');
        mem.learnPattern('ci fails', 'run docker compose up', 'success');
        expect(mem.count()).toBe(1);
        const patterns = mem.getRelevantPatterns('ci fails integration');
        expect(patterns[0].occurrences).toBe(2);
    });

    it('different outcome creates separate pattern', () => {
        mem.learnPattern('timeout', 'increase pool', 'success');
        mem.learnPattern('timeout', 'increase pool', 'failure');
        expect(mem.count()).toBe(2);
    });

    it('getRelevantPatterns returns matching patterns by keyword', () => {
        mem.learnPattern('deploy to production', 'run smoke tests first', 'success');
        mem.learnPattern('database migration', 'backup before migrate', 'success');
        const results = mem.getRelevantPatterns('deploy');
        expect(results.length).toBeGreaterThan(0);
        expect(results[0].trigger).toContain('deploy');
    });

    it('getRelevantPatterns returns empty for no match', () => {
        mem.learnPattern('authentication', 'use JWT', 'success');
        expect(mem.getRelevantPatterns('quantum')).toHaveLength(0);
    });

    it('buildContextBlock returns empty string with no matching patterns', () => {
        mem.learnPattern('unrelated', 'action', 'success');
        expect(mem.buildContextBlock('no match here')).toBe('');
    });

    it('buildContextBlock includes successes and failures', () => {
        mem.learnPattern('deploy timeout', 'increase timeout value', 'success');
        mem.learnPattern('deploy timeout', 'restart without restart', 'failure');
        const block = mem.buildContextBlock('deploy');
        expect(block).toContain('What works');
        expect(block).toContain('What to avoid');
        expect(block).toContain('increase timeout value');
    });

    it('patterns have correct outcome types', () => {
        mem.learnPattern('test flaky', 'retry test', 'success');
        const [pattern] = mem.getRelevantPatterns('flaky test');
        expect(pattern.outcome).toBe('success');
        expect(pattern.lastSeen).toBeInstanceOf(Date);
    });
});
