import { CODING_TOOLS } from '../../index';

// SPEC-0015 F3: core no longer knows tool names; the approval prompts come from the facts these tools declare.
describe('coding tools declare the facts that drive approval', () => {
    const byName = (n: string) => CODING_TOOLS.find(t => t.name === n)!;

    it.each(['write_file', 'edit_file', 'run_command'])('%s declares readOnly: false (it asks)', name => {
        expect(byName(name).readOnly).toBe(false);
    });

    it.each(['read_file', 'list_directory', 'search_files'])('%s declares readOnly: true (it never asks)', name => {
        expect(byName(name).readOnly).toBe(true);
    });

    it('run_command flags package installs with alwaysAsk, and only those', () => {
        const ask = byName('run_command').alwaysAsk!;
        expect(ask({ command: 'npm install left-pad' })).toBe(true);
        expect(ask({ command: 'cd /tmp && npm i -D foo' })).toBe(true);
        expect(ask({ command: 'npm test' })).toBe(false);
        expect(ask({ notACommand: 1 })).toBe(false);
    });
});
