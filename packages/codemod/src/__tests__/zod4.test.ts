import { zod4Text } from '../zod4';
import type { MoveReport } from '../index';

const run = (text: string, file = 'a.ts'): { out: string; report: MoveReport } => {
    const report: MoveReport = { moved: [], flagged: [] };
    return { out: zod4Text(file, text, report), report };
};

describe('zod4-record', () => {
    const cases: Array<[string, string, string]> = [
        ['one argument gets the key schema', `import { z } from 'zod';\nconst a = z.record(z.number());\n`, `import { z } from 'zod';\nconst a = z.record(z.string(), z.number());\n`],
        ['two arguments are left as they are', `import { z } from 'zod';\nconst a = z.record(z.string(), z.number());\n`, `import { z } from 'zod';\nconst a = z.record(z.string(), z.number());\n`],
        ['nested calls are both fixed', `import { z } from 'zod';\nconst a = z.record(z.record(z.number()));\n`, `import { z } from 'zod';\nconst a = z.record(z.string(), z.record(z.string(), z.number()));\n`],
        ['z from agent-core', `import { z } from '@backendkit-labs/agent-core';\nconst a = z.record(z.any());\n`, `import { z } from '@backendkit-labs/agent-core';\nconst a = z.record(z.string(), z.any());\n`],
        ['an alias keeps its own name', `import { z as zz } from 'zod';\nconst a = zz.record(zz.number());\n`, `import { z as zz } from 'zod';\nconst a = zz.record(zz.string(), zz.number());\n`],
        ['a namespace import of zod', `import * as z from 'zod';\nconst a = z.record(z.number());\n`, `import * as z from 'zod';\nconst a = z.record(z.string(), z.number());\n`],
        ['a default import of zod', `import z from 'zod';\nconst a = z.record(z.number());\n`, `import z from 'zod';\nconst a = z.record(z.string(), z.number());\n`],
        ['a file that does not get z from zod is not touched', `import { other } from 'x';\nconst a = other.record(1);\n`, `import { other } from 'x';\nconst a = other.record(1);\n`],
        ['a type-only z cannot be called, so nothing to do', `import type { z } from 'zod';\ntype T = z.infer<typeof s>;\n`, `import type { z } from 'zod';\ntype T = z.infer<typeof s>;\n`],
        ['a spread argument is not guessed', `import { z } from 'zod';\nconst a = z.record(...args);\n`, `import { z } from 'zod';\nconst a = z.record(...args);\n`],
    ];
    it.each(cases)('%s', (_n, before, after) => {
        expect(run(before).out).toBe(after);
        expect(run(after).out).toBe(after); // idempotent
    });

    it('invalid_type_error and required_error are flagged once, above their statement, not rewritten', () => {
        const before = `import { z } from 'zod';\nexport const n = z.string({ invalid_type_error: 'x', required_error: 'y' });\n`;
        const { out, report } = run(before);
        expect(out).toContain('// TODO(codemod): invalid_type_error and required_error are one `error` in zod 4');
        expect(out).toContain(`export const n = z.string({ invalid_type_error: 'x', required_error: 'y' });`);
        expect(report.flagged).toHaveLength(1);
        expect(run(out).out).toBe(out);
    });

    it('keeps CRLF', () => {
        expect(run(`import { z } from 'zod';\r\nconst a = z.record(z.number());\r\n`).out).toBe(`import { z } from 'zod';\r\nconst a = z.record(z.string(), z.number());\r\n`);
    });
});
