import { z } from '@backendkit-labs/agent-core';
import type { GitEngine } from './engine';
import { git } from './tools/git-tools';

/** Typed result of `/report`: the model fills it in, zod validates it, no JSON scraping. */
export const RepoReport = z.object({
    summary: z.string().describe('Two sentences on the state and recent activity of the repository'),
    health: z.enum(['clean', 'needs-attention', 'risky']),
    uncommittedChanges: z.number().int().min(0).describe('Number of files with uncommitted changes'),
    branches: z.array(z.object({
        name: z.string(),
        role: z.enum(['main', 'feature', 'fix', 'release', 'other']),
    })),
    suggestions: z.array(z.string()).max(5).describe('Concrete next steps, most important first'),
});
export type RepoReport = z.infer<typeof RepoReport>;

/**
 * Collects the facts with the git helpers directly (`engine.generateObject` runs no tools), then asks
 * the model for a validated report. One corrective retry is built in; a persistent mismatch raises
 * `StructuredOutputError`.
 */
export async function repoReport(engine: GitEngine, cwd: string): Promise<RepoReport> {
    const facts = [
        `## git status --short\n${git('status --short', cwd)}`,
        `## git branch -a\n${git('branch -a', cwd)}`,
        `## git log --oneline -15\n${git('log --oneline -15', cwd)}`,
    ].join('\n\n');

    return engine.generateObject(
        `Assess the health of this git repository from the facts below.\n\n${facts}`,
        RepoReport,
        { name: 'repo_report', agentId: 'inspector' },
    );
}
