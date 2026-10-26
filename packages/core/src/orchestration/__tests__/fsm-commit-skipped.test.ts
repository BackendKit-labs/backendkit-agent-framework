import { TaskFSM } from '../fsm';
import { createTaskContext, transitionTask } from '../task-context';

describe('TaskFSM — commit_skipped → commit_allowed', () => {
    it('is reachable: the transition is listed and no guard blocks it', () => {
        const fsm = new TaskFSM();
        let task = createTaskContext('commit sin cambios');
        task = transitionTask(task, 'commit_planning');
        task = transitionTask(task, 'commit_skipped');
        const result = fsm.transition(task, 'commit_allowed');
        expect(result.allowed).toBe(true);
        expect(result.task?.status).toBe('commit_allowed');
    });

    it('still refuses commit_allowed from states that never earned it', () => {
        const fsm = new TaskFSM();
        const task = transitionTask(createTaskContext('x'), 'classified');
        expect(fsm.transition(task, 'commit_allowed').allowed).toBe(false);
    });
});
