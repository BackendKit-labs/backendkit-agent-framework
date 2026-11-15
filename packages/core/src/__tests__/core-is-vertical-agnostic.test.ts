import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * SPEC-0015 §6: no contract of core knows the coding pipeline. The tokens below name coding tools, agents and
 * files; they belong to the vertical (agent-coding), not to the engine.
 */
const FORBIDDEN = /qa-engineer|write_file|run_command|commit_|design_review|manifest\.yaml/;

/**
 * Still in core, waiting for the SPEC that redesigns it. Shrink this list, never grow it.
 * - SPEC-0017 F6: the failure catalog, pattern detector and policy promoter of `reflection/`.
 */
const PENDING = [
    `reflection${path.sep}`,
];

/**
 * SPEC-0016 §4: core does not read the user's home or build `~/.appName` paths. The helper that resolves
 * `~/.appName` stays only because `reflection/` still uses it (SPEC-0017 F6); then it moves with it.
 */
const HOME_PATTERN = /homedir()|`.${(?:this.)?appName}/;
const HOME_PENDING = [
    path.join('shared', 'utils', 'project-key.ts'),
    `reflection${path.sep}`,
];

function sourceFiles(dir: string, out: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name !== '__tests__') sourceFiles(full, out);
        } else if (entry.name.endsWith('.ts')) out.push(full);
    }
    return out;
}

const pending = (rel: string, list: string[]) => list.some(p => rel === p || rel.startsWith(p));

describe('core stays free of the coding vertical', () => {
    it('no source file outside the pending list mentions coding tools, agents or files', () => {
        const root = path.resolve(__dirname, '..');
        const offenders = sourceFiles(root)
            .map(f => path.relative(root, f))
            .filter(rel => !pending(rel, PENDING))
            .filter(rel => FORBIDDEN.test(fs.readFileSync(path.join(root, rel), 'utf8')));
        expect(offenders).toEqual([]);
    });

    it('no source file outside the pending list reads the home directory or builds ~/.appName paths', () => {
        const root = path.resolve(__dirname, '..');
        const offenders = sourceFiles(root)
            .map(f => path.relative(root, f))
            .filter(rel => !pending(rel, HOME_PENDING))
            .filter(rel => HOME_PATTERN.test(fs.readFileSync(path.join(root, rel), 'utf8')));
        expect(offenders).toEqual([]);
    });
});
