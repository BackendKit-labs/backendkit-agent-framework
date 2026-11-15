import { readFileSync } from 'fs';
import { defineTool, z, atomicWriteSync } from '@backendkit-labs/agent-core';
import { resolveAndCheck, checkFrameworkProtection } from './path-sandbox';
import { sandboxPathError } from './sandbox-path';
import { warnIfSecrets } from './secret-scanner';

export const editFileTool = defineTool({
    name: 'edit_file',
    readOnly: false,
    description: 'Replace an exact string in a file. Safer than write_file for partial edits.',
    input: z.object({
        file_path:   z.string().describe('Path to the file'),
        old_string:  z.string().describe('Exact text to replace (must be unique in the file)'),
        new_string:  z.string().describe('Replacement text'),
        replace_all: z.boolean().default(false).describe('Replace all occurrences (default: false)'),
    }),
    execute: async ({ file_path, old_string, new_string, replace_all }, ctx) => {
        try {
            const abs = resolveAndCheck(ctx.workingDir, file_path, ctx.additionalRoots ?? []);
            const fwWarn = checkFrameworkProtection(abs, ctx.workingDir);
            if (fwWarn) return `Error: ${fwWarn}`;
            const denied = sandboxPathError(ctx, 'edit_file', abs, 'write');
            if (denied) return denied;
            const content = readFileSync(abs, 'utf-8');

            if (!content.includes(old_string)) {
                return `Error: old_string not found in "${abs}"`;
            }

            if (!replace_all) {
                const count = content.split(old_string).length - 1;
                if (count > 1) {
                    return `Error: old_string appears ${count} times in "${abs}". Use replace_all: true or provide more context.`;
                }
            }

            const updated = replace_all
                ? content.split(old_string).join(new_string)
                // a function replacer: a string one would expand `$&`, `$1`, `$$` inside new_string
                : content.replace(old_string, () => new_string);

            const warning = warnIfSecrets(abs, updated);
            atomicWriteSync(abs, updated);
            return warning ? `Edited: ${abs}\n⚠ ${warning}` : `Edited: ${abs}`;
        } catch (err) {
            return `Error: ${(err as Error).message}`;
        }
    },
});
