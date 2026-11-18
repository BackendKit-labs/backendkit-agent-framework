import { transformText } from '../index';
import type { MoveReport, MoveRule } from '../index';

const CORE = '@backendkit-labs/agent-core';
const PIPE = '@backendkit-labs/agent-coding/pipeline';

const rules: MoveRule[] = [
    { from: CORE, moves: [{ to: PIPE, symbols: ['Orchestrator', 'QAService'] }], gone: ['Gone'] },
    { from: `${CORE}/orchestration`, moves: [], renameRest: PIPE },
];

function run(text: string, r: readonly MoveRule[] = rules, file = 'a.ts'): { out: string; report: MoveReport } {
    const report: MoveReport = { moved: [], flagged: [] };
    return { out: transformText(file, text, r, report), report };
}

describe('transformText: what one file becomes', () => {
    const cases: Array<[string, string, string]> = [
        ['a name in the middle of a list', `import { A, Orchestrator, B } from '${CORE}';\n`, `import { A, B } from '${CORE}';\nimport { Orchestrator } from '${PIPE}';\n`],
        ['the last name of a list', `import { A, Orchestrator } from '${CORE}';\n`, `import { A } from '${CORE}';\nimport { Orchestrator } from '${PIPE}';\n`],
        ['every name: the statement goes and the new one takes its place', `import { Orchestrator, QAService } from '${CORE}';\nconst x = 1;\n`, `import { Orchestrator, QAService } from '${PIPE}';\nconst x = 1;\n`],
        ['a default import next to the moved names', `import core, { Orchestrator } from '${CORE}';\n`, `import core from '${CORE}';\nimport { Orchestrator } from '${PIPE}';\n`],
        ['an import on the last line, with no line break at the end', `import { A, Orchestrator } from '${CORE}';`, `import { A } from '${CORE}';\nimport { Orchestrator } from '${PIPE}';`],
        ['a statement without a semicolon keeps its style', `import { A, Orchestrator } from '${CORE}'\n`, `import { A } from '${CORE}'\nimport { Orchestrator } from '${PIPE}'\n`],
        ['an alias and a type-only mark inside the list', `import { A, Orchestrator as Orch, type QAService } from '${CORE}';\n`, `import { A } from '${CORE}';\nimport { Orchestrator as Orch, type QAService } from '${PIPE}';\n`],
        ['two declarations feeding one new import', `import { Orchestrator } from '${CORE}';\nimport { A, QAService } from '${CORE}';\n`, `import { Orchestrator, QAService } from '${PIPE}';\nimport { A } from '${CORE}';\n`],
        ['an import of the target that already exists is joined, not repeated', `import { X } from '${PIPE}';\nimport { A, Orchestrator } from '${CORE}';\n`, `import { X, Orchestrator } from '${PIPE}';\nimport { A } from '${CORE}';\n`],
        ['a side-effect import of a renamed module', `import '${CORE}/orchestration';\n`, `import '${PIPE}';\n`],
        ['export * from a renamed module', `export * from '${CORE}/orchestration';\n`, `export * from '${PIPE}';\n`],
        ['an import that has nothing to move', `import { A } from '${CORE}';\nimport { Orchestrator } from 'other';\n`, `import { A } from '${CORE}';\nimport { Orchestrator } from 'other';\n`],
        ['a name that is only a string or a property, not an import', `const s = 'Orchestrator'; const o = { Orchestrator: 1 };\n`, `const s = 'Orchestrator'; const o = { Orchestrator: 1 };\n`],
    ];
    it.each(cases)('%s', (_name, before, after) => {
        expect(run(before).out).toBe(after);
        // And running it on its own output changes nothing.
        expect(run(after).out).toBe(after);
    });

    it('a multi-line list loses the line of the name that moves and keeps the others and their comments', () => {
        const before = `import {\n  A, // first\n  Orchestrator,\n  B,\n} from '${CORE}';\n`;
        expect(run(before).out).toBe(`import {\n  A, // first\n  B,\n} from '${CORE}';\nimport { Orchestrator } from '${PIPE}';\n`);
    });

    it('a comment on the line of a name that moves stays where it was', () => {
        const before = `import {\n  Orchestrator, // keep me\n  A,\n} from '${CORE}';\n`;
        expect(run(before).out).toBe(`import {\n  // keep me\n  A,\n} from '${CORE}';\nimport { Orchestrator } from '${PIPE}';\n`);
    });

    it('works on JavaScript files as well', () => {
        expect(run(`import { A, Orchestrator } from '${CORE}';\n`, rules, 'a.mjs').out).toBe(`import { A } from '${CORE}';\nimport { Orchestrator } from '${PIPE}';\n`);
    });
});

describe('transformText: what it flags instead of guessing', () => {
    it('a name that no longer exists stays, with a comment above it, once', () => {
        const before = `import { Gone, Orchestrator } from '${CORE}';\n`;
        const { out, report } = run(before);
        expect(out).toBe(`// TODO(codemod): Gone no longer exists in ${CORE}; see the migration guide\nimport { Gone } from '${CORE}';\nimport { Orchestrator } from '${PIPE}';\n`);
        expect(report.flagged).toEqual(['a.ts: Gone (no destination)']);
        expect(run(out).out).toBe(out);
    });

    it('a namespace import whose use touches a moved name is flagged, and one that does not is not', () => {
        const used = run(`import * as core from '${CORE}';\nconst o = new core.Orchestrator();\n`);
        expect(used.out).toMatch(/^\/\/ TODO\(codemod\): core\.Orchestrator moved out of/);
        const unused = run(`import * as core from '${CORE}';\nconst o = core.defineTool;\n`);
        expect(unused.out).toBe(`import * as core from '${CORE}';\nconst o = core.defineTool;\n`);
    });

    it('a re-export of a moved name is flagged', () => {
        expect(run(`export { QAService } from '${CORE}';\n`).out).toMatch(/^\/\/ TODO\(codemod\): QAService moved out of/);
    });

    it('a flag keeps the indentation of its statement', () => {
        const { out } = run(`    import { Gone } from '${CORE}';\n`);
        expect(out).toBe(`    // TODO(codemod): Gone no longer exists in ${CORE}; see the migration guide\n    import { Gone } from '${CORE}';\n`);
    });
});

describe('transformText: line endings', () => {
    it('lines it adds use the line break of the file', () => {
        const { out } = run(`import { A, Orchestrator } from '${CORE}';\r\nconst x = 1;\r\n`);
        expect(out).toBe(`import { A } from '${CORE}';\r\nimport { Orchestrator } from '${PIPE}';\r\nconst x = 1;\r\n`);
        expect(out).not.toMatch(/[^\r]\n/);
    });
});
