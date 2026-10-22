import { createJobRegistry } from '@backendkit-labs/agent-core';
import { runCommandTool } from '../run-command';

function ctxWith(jobs?: ReturnType<typeof createJobRegistry>) {
    return {
        agentId: 'coder', sessionId: 'test', workingDir: process.cwd(), jobs,
        memory: { get: () => undefined, set: () => undefined, getAll: () => ({}) },
        askAgent: async () => '',
    };
}

async function waitDone(jobs: ReturnType<typeof createJobRegistry>, id: string) {
    for (let i = 0; i < 400; i++) {
        if (jobs.get(id, 'coder')?.status !== 'running') return;
        await new Promise(r => setTimeout(r, 25));
    }
    throw new Error('job did not finish');
}

describe('run_command — background', () => {
    it('starts a job, returns its id at once, and collects the output', async () => {
        const jobs = createJobRegistry();
        const started = Date.now();
        const result = await runCommandTool.execute({ command: 'node -e "console.log(\'hi from job\')"', background: true, timeout_ms: 30_000 }, ctxWith(jobs));
        expect(result).toContain('bash-1');
        expect(Date.now() - started).toBeLessThan(1500);
        await waitDone(jobs, 'bash-1');
        const out = await jobs.output('bash-1', 'coder');
        expect(out.text).toContain('hi from job');
        expect(jobs.get('bash-1', 'coder')).toMatchObject({ status: 'done', summary: 'exit 0' });
    }, 20_000);

    it('a non-zero exit marks the job failed', async () => {
        const jobs = createJobRegistry();
        await runCommandTool.execute({ command: 'node -e "process.exit(3)"', background: true, timeout_ms: 30_000 }, ctxWith(jobs));
        await waitDone(jobs, 'bash-1');
        expect(jobs.get('bash-1', 'coder')).toMatchObject({ status: 'failed', summary: 'exit 3' });
    }, 20_000);

    it('job_kill-style cancel stops a long-running command', async () => {
        const jobs = createJobRegistry();
        await runCommandTool.execute({ command: 'node -e "setTimeout(function(){},60000)"', background: true, timeout_ms: 30_000 }, ctxWith(jobs));
        expect(jobs.get('bash-1', 'coder')?.status).toBe('running');
        expect(await jobs.cancel('bash-1', 'coder')).toBe(true);
        expect(jobs.get('bash-1', 'coder')?.status).toBe('cancelled');
    }, 20_000);

    it('without ctx.jobs the flag is ignored and the command runs in the foreground', async () => {
        const result = await runCommandTool.execute({ command: 'node -e "console.log(42)"', background: true, timeout_ms: 30_000 }, ctxWith());
        expect(result).toBe('42');
    }, 20_000);
});
