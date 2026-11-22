/** run_command with no sandbox configured (the host): the model reads what a command prints, so the environment is scrubbed by default. */
import { runCommandTool } from '../run-command';
import { createToolContext } from '@backendkit-labs/agent-core';

const SECRET = 'sk-live-REPRO-12345';
const URLSECRET = 'postgres://app:hunter2@db.internal:5432/app';
const saved: Record<string, string | undefined> = {};
const KEYS = ['FAKE_API_KEY', 'FAKE_DATABASE_URL', 'FAKE_PLAIN', 'BK_RUN_COMMAND_ENV', 'BK_RUN_COMMAND_ENV_ALLOW', 'BK_RUN_COMMAND_SANDBOX'];

beforeEach(() => {
    for (const k of KEYS) saved[k] = process.env[k];
    process.env.FAKE_API_KEY = SECRET;
    process.env.FAKE_DATABASE_URL = URLSECRET;
    process.env.FAKE_PLAIN = 'visible';
    delete process.env.BK_RUN_COMMAND_ENV; delete process.env.BK_RUN_COMMAND_ENV_ALLOW; delete process.env.BK_RUN_COMMAND_SANDBOX;
});
afterEach(() => { for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });

// `node` is on the allow list of run_command and prints the same on every OS.
const show = (name: string) => runCommandTool.execute(
    { command: `node -e "console.log('<'+(process.env.${name}||'')+'>')"`, timeout_ms: 20000 },
    { ...createToolContext(), workingDir: process.cwd() },
);

describe('run_command on the host', () => {
    it('does not hand a credential to the command by default: the model cannot read it with printenv', async () => {
        expect(String(await show('FAKE_API_KEY'))).toBe('<>');
        expect(String(await show('FAKE_DATABASE_URL'))).toBe('<>');
        expect(String(await show('FAKE_PLAIN'))).toBe('<visible>');            // what is not a secret still reaches it
    });

    it('BK_RUN_COMMAND_ENV_ALLOW lets chosen variables through', async () => {
        process.env.BK_RUN_COMMAND_ENV_ALLOW = 'FAKE_API_KEY, FAKE_DATABASE_*';
        expect(String(await show('FAKE_API_KEY'))).toBe(`<${SECRET}>`);
        expect(String(await show('FAKE_DATABASE_URL'))).toBe(`<${URLSECRET}>`);
    });

    it('BK_RUN_COMMAND_ENV=inherit restores the old behaviour: the whole environment', async () => {
        process.env.BK_RUN_COMMAND_ENV = 'inherit';
        expect(String(await show('FAKE_API_KEY'))).toBe(`<${SECRET}>`);
    });
});
