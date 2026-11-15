import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * SPEC-0015 §6: no contract of core knows the coding pipeline. The tokens below name coding tools, agents and
 * files; they belong to the vertical (agent-coding), not to the engine.
 */
const FORBIDDEN = /qa-engineer|write_file|run_command|commit_|design_review|manifest\.yaml/;

/**
 * Still in core, each waiting for the SPEC that moves or redesigns it. Shrink this list, never grow it.
 * - SPEC-0016: the seed of the global directory and the manifest stage of the context pipeline.
 * - SPEC-0017 F6: the failure catalog, pattern detector and policy promoter of `reflection/`.
 */
const PENDING = [
    path.join('bootstrap', 'GlobalSeed.ts'),
    path.join('context', 'stages', 'stage-manifest.ts'),
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

describe('core stays free of the coding vertical', () => {
    it('no source file outside the pending list mentions coding tools, agents or files', () => {
        const root = path.resolve(__dirname, '..');
        const offenders = sourceFiles(root)
            .map(f => path.relative(root, f))
            .filter(rel => !PENDING.some(p => rel === p || rel.startsWith(p)))
            .filter(rel => FORBIDDEN.test(fs.readFileSync(path.join(root, rel), 'utf8')));
        expect(offenders).toEqual([]);
    });
});
