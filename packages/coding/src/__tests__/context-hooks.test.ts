import { codingContextHooks } from '../context-hooks';
import type { AgentProfile } from '@backendkit-labs/agent-core';

const profile = { id: 'backend' } as AgentProfile;
const ctx = {} as never;

describe('codingContextHooks', () => {
    it('adds the relative-paths rule when there is a working directory', async () => {
        const out = await codingContextHooks({ workingDir: '/repo' }).systemPrompt!(ctx, profile);
        expect(out).toContain('RELATIVE paths');
    });

    it("adds the running agent's session notes from the store", async () => {
        const store = { getAgentNotes: (id: string) => `notes of ${id}` } as never;
        const out = await codingContextHooks({ store }).systemPrompt!(ctx, profile);
        expect(out).toContain('## Agent Session Notes\nnotes of backend');
        expect(out).not.toContain('RELATIVE');
    });

    it('adds nothing without a working directory or notes', async () => {
        expect(await codingContextHooks({}).systemPrompt!(ctx, profile)).toBeUndefined();
    });
});
