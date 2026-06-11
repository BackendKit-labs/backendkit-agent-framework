import { retry } from '@backendkit-labs/retry';
import { LLMChatClient } from '../orchestration/intent-detector';
import { AgentProfile } from '../types';
import { getGitDiff } from '../shared/utils/git';
import { AuditFinding } from '../reflection/types';

const LLM_RETRY = {
    maxAttempts: 3,
    backoff: { type: 'exponential' as const, baseDelay: 500, maxDelay: 8_000, jitter: 'full' as const },
    retryIf: (e: { type: string; status?: number }) =>
        e.type === 'network' || (e.type === 'http' && (e.status ?? 0) >= 500),
    abortIf: (e: { type: string; status?: number }) =>
        e.type === 'http' && [401, 403].includes(e.status ?? 0),
};

export interface QAServiceOptions {
    client: LLMChatClient;
    /** Lazy getter — always returns the current base prompt. */
    basePrompt: () => string;
    /** Lazy getter — returns the current effective agent id. */
    effectiveAgentId?: () => string;
    allAgents?: AgentProfile[];
    noQA?: boolean;
    onQAReview?: (review: string) => void;
    /** Called after each QA evaluation so the caller can record routing outcomes. */
    onOutcome?: (agentId: string, approved: boolean) => void;
}

export interface QAReviewResult {
    approved: boolean;
    review: string;
}

const APPROVAL_PATTERNS = [
    // English
    'approved', 'lgtm', 'looks good', 'good to go', ':+1:',
    'no issues', 'looks correct', 'well implemented', 'ready to merge', 'ship it',
    // Spanish (fallback for mixed-language responses)
    'visto bueno', 'aprobado', 'aprueba', 'ok',
    'se ve bien', 'correcto', 'bien', 'buen trabajo',
    'no hay problemas', 'sin problemas', 'todo bien',
    'puede continuar', 'procede', 'listo para commit',
];

const REJECTION_PATTERNS = [
    // English
    'error', 'rework', 'edge cases', 'missing tests', 'needs changes',
    'requires changes', 'not approved', 'rejected', 'should fix',
    'needs improvement', 'missing error handling', 'incomplete',
    'incorrect',
    // Spanish (fallback for mixed-language responses)
    'problema', 'falta', 'incorrecto', 'mal',
    'debe corregir', 'necesita cambios', 'no apruebo',
    'rechazado', 'issues encontrados',
    'no esta bien', 'faltan tests',
    'casos borde', 'mejorable',
];

export class QAService {
    private opts: QAServiceOptions;

    constructor(opts: QAServiceOptions) {
        this.opts = opts;
    }

    countCodeLines(content: string): number {
        const blocks = content.match(/```[\s\S]*?```/g) ?? [];
        return blocks.reduce((total, block) => {
            const inner = block.split('\n').slice(1, -1);
            return total + inner.filter(l => l.trim()).length;
        }, 0);
    }

    async reviewResponse(workContent: string): Promise<string | null> {
        if (this.opts.noQA) return null;
        if (this.opts.effectiveAgentId?.() === 'qa-engineer') return null;
        if (this.countCodeLines(workContent) < 8) return null;

        const qaProfile = this.opts.allAgents?.find(a => a.id === 'qa-engineer');
        if (!qaProfile) return null;

        const systemPrompt = this.opts.basePrompt() + qaProfile.systemPromptAddition;
        const result = await retry(
            () => this.opts.client.chat(
                [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: `Review the following work and approve it, or point out quality issues, missing tests, or important edge cases:\n\n${workContent}` },
                ],
                undefined,
                0.2
            ),
            LLM_RETRY,
        );
        if (!result.ok) {
            const fallback = `(QA review unavailable: ${result.error.message}. Code accepted without QA review.)`;
            this.opts.onQAReview?.(fallback);
            return null;
        }
        return result.value.content ?? null;
    }

    async reviewPreCommit(stagedFiles: string[]): Promise<QAReviewResult> {
        if (this.opts.noQA) return { approved: true, review: '' };

        const gitDiff = getGitDiff();
        if (!gitDiff) return { approved: true, review: '' };

        const qaProfile = this.opts.allAgents?.find(a => a.id === 'qa-engineer');
        const systemPrompt = qaProfile?.systemPromptAddition
            ? this.opts.basePrompt() + qaProfile.systemPromptAddition
            : this.opts.basePrompt() + '\n\nYou are an expert QA engineer. You review code changes before committing.';

        const contextParts: string[] = [
            '## Staged changes (git diff)',
            '',
            '```diff',
            gitDiff.slice(0, 8000),
            gitDiff.length > 8000 ? '\n... (diff truncated)' : '',
            '```',
        ];

        if (stagedFiles.length > 0) {
            contextParts.push(
                '',
                '## Modified files',
                '',
                stagedFiles.map(f => `- ${f}`).join('\n'),
            );
        }

        const userMessage = [
            'The following changes are about to be committed. Review the code and determine whether it is ready to commit.',
            '',
            'You must:',
            '1. Verify the code is correct and follows good practices',
            '2. Detect quality, security, or performance issues',
            '3. Point out uncovered edge cases or missing tests',
            '',
            'Respond with APPROVED if the code is ready to commit, or REJECTED if there are issues to fix.',
            'If there are issues, specify exactly which files and lines need changes.',
            '',
            ...contextParts,
        ].join('\n');

        const result = await retry(
            () => this.opts.client.chat(
                [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userMessage },
                ],
                undefined,
                0.2
            ),
            LLM_RETRY,
        );
        if (!result.ok) {
            return {
                approved: true,
                review: `(QA unavailable: ${result.error.message}. Commit without QA review.)`,
            };
        }
        const review = result.value.content ?? '(QA could not generate a review)';
        const approved = this.evaluateReview(review);
        this.opts.onOutcome?.('qa-engineer', approved);
        return { approved, review };
    }

    async diagnoseTestFailure(testOutput: string): Promise<string> {
        const gitDiff = getGitDiff();
        const qaProfile = this.opts.allAgents?.find(a => a.id === 'qa-engineer');
        const systemPrompt = qaProfile?.systemPromptAddition
            ? this.opts.basePrompt() + qaProfile.systemPromptAddition
            : this.opts.basePrompt() + '\n\nYou are an expert QA engineer. You diagnose failing tests and propose solutions.';

        const contextParts: string[] = [
            '## Failing Tests',
            '',
            testOutput.slice(0, 4000),
            testOutput.length > 4000 ? '\n... (output truncated)' : '',
        ];

        if (gitDiff) {
            contextParts.push(
                '',
                '## Code diff to commit',
                '',
                '```diff',
                gitDiff.slice(0, 6000),
                gitDiff.length > 6000 ? '\n... (diff truncated)' : '',
                '```',
            );
        }

        const userMessage = [
            'Project tests failed while attempting to commit. Analyze the test output and code diff to:',
            '',
            '1. Identify the root cause of each failure',
            '2. Point out exactly which files and lines are causing the issues',
            '3. Suggest specific fixes (with code if applicable)',
            '4. Indicate whether the problem is in the code or in the tests themselves',
            '',
            ...contextParts,
        ].join('\n');

        const result = await retry(
            () => this.opts.client.chat(
                [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userMessage },
                ],
                undefined,
                0.2
            ),
            LLM_RETRY,
        );
        if (!result.ok) {
            return `(QA unavailable: ${result.error.message}. Fix the errors manually.)`;
        }
        const diagnosis = result.value.content ?? '(QA could not generate a diagnosis)';
        this.opts.onQAReview?.(`QA Diagnosis - Failing Tests\n\n${diagnosis}`);
        return diagnosis;
    }

    evaluateReview(review: string): boolean {
        const lower = review.toLowerCase();

        const hasApproval = APPROVAL_PATTERNS.some(p => lower.includes(p));
        const hasRejection = REJECTION_PATTERNS.some(p => lower.includes(p));

        if (hasApproval && !hasRejection) return true;
        if (hasRejection && !hasApproval) return false;

        const positiveLines = review.split('\n').filter(l =>
            APPROVAL_PATTERNS.some(p => l.toLowerCase().includes(p))
        ).length;
        const negativeLines = review.split('\n').filter(l =>
            REJECTION_PATTERNS.some(p => l.toLowerCase().includes(p))
        ).length;

        return positiveLines > negativeLines;
    }

    extractFindings(review: string): AuditFinding[] {
        const hallazgos: AuditFinding[] = [];
        const lines = review.split('\n');
        const lower = review.toLowerCase();

        const hasProblems = /(problem|error|missing|incorrect|edge.case|testing.gap|blocker|critical|should.fix|needs.changes|issue|fail|warning|incomplete|vulnerability)/i.test(lower);
        if (!hasProblems) return hallazgos;

        let idx = 0;
        for (const line of lines) {
            const trimmed = line.trim();
            if (
                (trimmed.startsWith('-') || trimmed.startsWith('*') || /^\d+[\.\)]\s/.test(trimmed)) &&
                /(problem|error|missing|incorrect|edge.case|testing|issue|blocker|critical|cover|fix|needs|should|fail|bug|warning|incomplete|vulnerability)/i.test(trimmed) &&
                trimmed.length > 10
            ) {
                const severidad: 'critical' | 'high' | 'medium' | 'low' =
                    /(blocker|critical|severe|security|vulnerability)/i.test(trimmed) ? 'critical' :
                        /(high|major|important)/i.test(trimmed) ? 'high' :
                            /(low|minor)/i.test(trimmed) ? 'low' :
                                'medium';

                hallazgos.push({
                    id: `QA-${Date.now().toString(36)}-${idx++}`,
                    dimension: 'Code Review',
                    hallazgo: trimmed.slice(0, 200),
                    severidad,
                    evidencia: `QA review line: "${trimmed.slice(0, 150)}"`,
                    recomendacion: 'Review and fix the issue flagged in the QA review',
                    agenteResponsable: 'qa-engineer',
                });
            }
        }

        if (hallazgos.length === 0 && hasProblems) {
            hallazgos.push({
                id: `QA-${Date.now().toString(36)}-0`,
                dimension: 'Code Review',
                hallazgo: 'The QA review flagged issues in the code',
                severidad: 'medium',
                evidencia: `Review text: "${review.slice(0, 300)}"`,
                recomendacion: 'Review the full QA feedback and make the necessary changes',
                agenteResponsable: 'qa-engineer',
            });
        }

        return hallazgos;
    }
}
