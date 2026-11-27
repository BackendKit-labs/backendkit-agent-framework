/** Audit 2026-11-26, D-02: context files go into the system prompt with a cap, and the cut is said. */
import { CONTEXT_LIMITS, capContext } from '../limits';
import { formatPipelineForPrompt } from '../pipeline';

describe('context files are capped (D-02)', () => {
    it('capContext keeps short text and says how much it left out of long text', () => {
        expect(capContext('short', 10)).toBe('short');
        const out = capContext('x'.repeat(25), 10);
        expect(out.startsWith('x'.repeat(10))).toBe(true);
        expect(out).toMatch(/15 more characters not loaded/);
    });

    it('a huge session log and AGENT.md do not reach the prompt whole', () => {
        const huge = 'line\n'.repeat(200_000);   // ~1 MB
        const sections = formatPipelineForPrompt({
            instructions: { agentMd: huge, userMd: '' },
            project: { content: '' },
            session: { content: huge },
            lessons: { memo: '' },
        } as never);
        const total = sections.join('').length;
        expect(total).toBeLessThan(CONTEXT_LIMITS.agentMd + CONTEXT_LIMITS.session + 2_000);
        expect(sections.join('')).toMatch(/more characters not loaded/);
    });
});
