import { TaskFSM, DEFAULT_MAX_REWORK } from '../fsm';
import { createTaskContext, transitionTask } from '../task-context';
import type { TaskContext } from '../task-context';

const inQaReview = (): TaskContext => {
    let t = createTaskContext('x');
    for (const s of ['classified', 'implementation', 'qa_review'] as const) t = transitionTask(t, s);
    return t;
};

describe('TaskFSM — approved no longer regresses to implementation', () => {
    it('refuses approved → implementation but still allows rework_required', () => {
        const fsm = new TaskFSM();
        const approved = transitionTask(inQaReview(), 'approved');
        expect(fsm.transition(approved, 'implementation').allowed).toBe(false);
        expect(fsm.getAvailableTransitions('approved')).not.toContain('implementation');
    });
});

describe('TaskFSM — rework cap', () => {
    const cycle = (fsm: TaskFSM, task: TaskContext) => {
        const back = fsm.transition(task, 'rework_required');
        if (!back.allowed) return back;
        return fsm.transition(transitionTask(back.task!, 'qa_review'), 'rework_required');
    };

    it('counts each entry into rework_required', () => {
        const fsm = new TaskFSM();
        const r = fsm.transition(inQaReview(), 'rework_required');
        expect(r.task?.reworkCount).toBe(1);
    });

    it('refuses the transition once the default limit is reached, with a clear error', () => {
        const fsm = new TaskFSM();
        let task = inQaReview();
        for (let i = 0; i < DEFAULT_MAX_REWORK; i++) {
            const r = fsm.transition(task, 'rework_required');
            expect(r.allowed).toBe(true);
            task = transitionTask(r.task!, 'qa_review');
        }
        const over = fsm.transition(task, 'rework_required');
        expect(over.allowed).toBe(false);
        expect(over.error).toMatch(/Límite de rework alcanzado \(5\)/);
        expect(fsm.transition(task, 'rejected').allowed).toBe(true);
    });

    it('the limit is configurable', () => {
        const fsm = new TaskFSM({ maxRework: 1 });
        const first = fsm.transition(inQaReview(), 'rework_required');
        expect(first.allowed).toBe(true);
        expect(cycle(fsm, first.task!).allowed).toBe(false);
    });

    it('a task never reworked starts at zero (field is optional for existing callers)', () => {
        expect(inQaReview().reworkCount).toBeUndefined();
    });
});
