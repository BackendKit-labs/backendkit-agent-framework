"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.searchFilesTool = void 0;
const child_process_1 = require("child_process");
exports.searchFilesTool = {
    name: 'search_files',
    description: 'Search for text patterns across files using grep. Returns matching lines with file paths and line numbers.',
    parameters: {
        type: 'object',
        properties: {
            pattern: { type: 'string', description: 'Regex or literal pattern to search for' },
            path: { type: 'string', description: 'Directory or file to search in (default: working dir)' },
            glob: { type: 'string', description: 'File glob filter (e.g. "*.ts", "**/*.json")' },
            case_insensitive: { type: 'boolean', description: 'Case-insensitive search (default: false)' },
        },
        required: ['pattern'],
    },
    async execute(args, ctx) {
        const { pattern, path, glob, case_insensitive } = args;
        const searchPath = path ?? ctx.workingDir ?? '.';
        const flags = ['-rn', '--include', glob ?? '*'].concat(case_insensitive ? ['-i'] : []);
        try {
            const cmd = `grep ${flags.join(' ')} "${pattern.replace(/"/g, '\\"')}" "${searchPath}"`;
            const output = (0, child_process_1.execSync)(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
            const lines = output.split('\n');
            return lines.slice(0, 200).join('\n') + (lines.length > 200 ? `\n[${lines.length - 200} more results]` : '');
        }
        catch (err) {
            if (err.status === 1)
                return '(no matches found)';
            throw new Error(`Search failed: ${err.message}`);
        }
    },
};
//# sourceMappingURL=search-files.js.map