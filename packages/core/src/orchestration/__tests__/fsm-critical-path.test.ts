/**
 * Tests for getCriticalPath / hasPassedGate (H-002).
 *
 * The previous implementation used linear index comparison which gave false
 * positives: a task at 'implementation' that went classified→implementation
 * (skipping design_review) was incorrectly reported as having passed design_review.
 */

import { TaskFSM } from '../fsm';
import { createTaskContext, transitionTask, type TaskContext } from '../task-context';

function task(status: TaskContext['status'], flags: Partial<Pick<TaskContext,
    'requiresArchitectureReview' | 'requiresSecurityReview' | 'requiresQaApproval'>> = {}
): TaskContext {
    return {
        ...createTaskContext('test'),
        status,
        requiresArchitectureReview: flags.requiresArchitectureReview ?? false,
        requiresSecurityReview: flags.requiresSecurityReview ?? false,
        requiresQaApproval: flags.requiresQaApproval ?? false,
    };
}

describe('getCriticalPath (H-002)', () => {
    const fsm = new TaskFSM();

    it('returns only current status when already at commit_allowed', () => {
        expect(fsm.getCriticalPath(task('commit_allowed'))).toEqual(['commit_allowed']);
    });

    it('returns only current status when rejected', () => {
        expect(fsm.getCriticalPath(task('rejected'))).toEqual(['rejected']);
    });

    it('task with no gates: new → classified → implementation → approved → commit_allowed', () => {
        const path = fsm.getCriticalPath(task('new'));
        expect(path).toContain('classified');
        expect(path).toContain('approved');
        expect(path).toContain('commit_allowed');
        expect(path).not.toContain('design_review');
        expect(path).not.toContain('security_review');
        expect(path).not.toContain('qa_review');
    });

    // ── The core H-002 bug: false positive on hasPassedGate ──────────────────

    it('task at implementation with requiresArchitectureReview still needs design_review in path', () => {
        // classified → implementation is allowed by FSM (guard only blocks
        // non-classified/non-design_review sources), so implementation does NOT
        // guarantee design_review was visited.
        const t = task('implementation', { requiresArchitectureReview: true });
        const path = fsm.getCriticalPath(t);
        expect(path).toContain('design_review');
    });

    it('task at security_review with requiresArchitectureReview still needs design_review in path', () => {
        const t = task('security_review', { requiresArchitectureReview: true });
        const path = fsm.getCriticalPath(t);
        expect(path).toContain('design_review');
    });

    it('task at implementation with requiresSecurityReview still needs security_review in path', () => {
        const t = task('implementation', { requiresSecurityReview: true });
        const path = fsm.getCriticalPath(t);
        expect(path).toContain('security_review');
    });

    it('task at implementation with requiresQaApproval still needs qa_review in path', () => {
        const t = task('implementation', { requiresQaApproval: true });
        const path = fsm.getCriticalPath(t);
        expect(path).toContain('qa_review');
    });

    // ── Correct true positives: post-approval guarantees all gates done ───────

    it('task at approved no longer needs qa_review in path', () => {
        const t = task('approved', { requiresQaApproval: true });
        const path = fsm.getCriticalPath(t);
        expect(path).not.toContain('qa_review');
    });

    it('task at commit_planning no longer needs any gate in path', () => {
        const t = task('commit_planning', {
            requiresArchitectureReview: true,
            requiresSecurityReview: true,
            requiresQaApproval: true,
        });
        const path = fsm.getCriticalPath(t);
        expect(path).not.toContain('design_review');
        expect(path).not.toContain('security_review');
        expect(path).not.toContain('qa_review');
    });

    // ── FSM guard: security_review guarantees when requiresSecurityReview ─────

    it('task at qa_review with requiresSecurityReview no longer needs security_review in path', () => {
        // FSM guard: requiresSecurityReview && to=qa_review && status≠security_review → blocked
        // So if task is at qa_review AND requiresSecurityReview, security_review was visited.
        const t = task('qa_review', { requiresSecurityReview: true });
        const path = fsm.getCriticalPath(t);
        expect(path).not.toContain('security_review');
    });

    it('task at qa_review WITHOUT requiresSecurityReview: security_review correctly absent from path', () => {
        const t = task('qa_review', { requiresSecurityReview: false });
        const path = fsm.getCriticalPath(t);
        expect(path).not.toContain('security_review');
    });

    it('path always ends with approved and commit_allowed for in-progress tasks', () => {
        const t = task('classified', { requiresQaApproval: true });
        const path = fsm.getCriticalPath(t);
        const last = path[path.length - 1];
        const secondLast = path[path.length - 2];
        expect(last).toBe('commit_allowed');
        expect(secondLast).toBe('approved');
    });
});
