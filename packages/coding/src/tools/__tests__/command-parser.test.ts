import { extractAllBins } from '../command-parser';
import { runCommandTool } from '../run-command';

const ctx = {
    agentId: 'coder', sessionId: 'test', workingDir: process.cwd(),
    memory: { get: () => undefined, set: () => undefined, getAll: () => ({}) },
    askAgent: async () => '',
};

describe('extractAllBins — wrappers expose the wrapped binary', () => {
    it.each([
        ['env sh -c "id"',                    ['env', 'sh']],
        ['env -i FOO=1 sh -c id',             ['env', 'sh']],
        ['env -u HOME bash',                  ['env', 'bash']],
        ['env env sh',                        ['env', 'env', 'sh']],
        ['FOO=1 env sh',                      ['env', 'sh']],
        ["env 'sh' -c id",                    ['env', 'sh']],
        ['echo x | xargs sh -c "id"',         ['echo', 'xargs', 'sh']],
        ['xargs -I{} sh -c "{}"',             ['xargs', 'sh']],
        ['xargs -n 1 -P 4 sh -c id',          ['xargs', 'sh']],
        ['timeout 5 sh -c id',                ['timeout', 'sh']],
        ['timeout -s KILL 5 sh',              ['timeout', 'sh']],
        ['find . -name x -exec sh -c id \;', ['find', 'sh']],
        ['find . -execdir bash {} +',         ['find', 'bash']],
        ['find . -delete',                    ['find', 'rm']],
        ['env find . -exec env sh {} \;',    ['env', 'find', 'env', 'sh']],
        ['/usr/bin/env sh',                   ['env', 'sh']],
    ])('%s', (command, expected) => {
        expect(extractAllBins(command)).toEqual(expected);
    });

    it('does not invent wrapped bins for plain wrappers', () => {
        expect(extractAllBins('env')).toEqual(['env']);
        expect(extractAllBins('xargs')).toEqual(['xargs']);
        expect(extractAllBins('env git log -S foo')).toEqual(['env', 'git']);
        expect(extractAllBins('find . -name "*.ts"')).toEqual(['find']);
    });

    it('flags env -S (string splitting hides the command)', () => {
        expect(extractAllBins('env -S "sh -c id"')).toContain('env -S');
    });

    it('flags command substitution inside double quotes, allows it inside single quotes', () => {
        expect(extractAllBins('echo "$(id)"')).toContain('"$(…)"');
        expect(extractAllBins('echo "`id`"')).toContain('"$(…)"');
        expect(extractAllBins("echo '$(id)'")).toEqual(['echo']);
    });

    it('still validates unquoted substitution, chains and subshells', () => {
        expect(extractAllBins('echo $(sh -c id)')).toEqual(['echo', 'sh']);
        expect(extractAllBins('(sh -c id)')).toEqual(['sh']);
        expect(extractAllBins('git status && sh')).toEqual(['git', 'sh']);
        expect(extractAllBins('git status\nsh')).toEqual(['git', 'sh']);
    });

    it('does not treat redirect targets or quoted operators as commands', () => {
        expect(extractAllBins('npm test 2>&1 | tail -5')).toEqual(['npm', 'tail']);
        expect(extractAllBins('echo hi > out.txt')).toEqual(['echo']);
        expect(extractAllBins('echo hi >> "my file.txt"')).toEqual(['echo']);
        expect(extractAllBins('git commit -m "a; b && c"')).toEqual(['git']);
        expect(extractAllBins('grep -r "a|b" src')).toEqual(['grep']);
    });
});

describe('run_command — wrapper bypasses are rejected', () => {
    it.each([
        'env sh -c "echo pwned"',
        'echo x | xargs sh -c "echo pwned"',
        'timeout 5 sh -c "echo pwned"',
        'find . -maxdepth 1 -exec sh -c "echo pwned" \;',
    ])('%s', async (command) => {
        expect(await runCommandTool.execute({ command }, ctx)).toMatch(/"sh" is not in the allowed list/);
    });

    it('blocks quoted command substitution', async () => {
        expect(await runCommandTool.execute({ command: 'echo "$(sh -c id)"' }, ctx)).toMatch(/not in the allowed list/);
    });

    it('applies the per-agent blocklist to wrapped binaries', async () => {
        const blocked = { ...ctx, blockedCommands: ['rm'] };
        expect(await runCommandTool.execute({ command: 'env rm -rf x' }, blocked)).toMatch(/"rm" is not available/);
        expect(await runCommandTool.execute({ command: 'find . -delete' }, blocked)).toMatch(/"rm" is not available/);
    });

    it('still runs a legitimate wrapped command', async () => {
        const out = await runCommandTool.execute({ command: 'env FOO=bar node -p "process.env.FOO"' }, ctx);
        expect(out).toBe('bar');
    });
});
