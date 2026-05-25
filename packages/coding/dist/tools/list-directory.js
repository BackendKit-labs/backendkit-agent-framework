"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listDirectoryTool = void 0;
const fs_1 = require("fs");
const path_1 = require("path");
function listRecursive(dir, depth, maxDepth) {
    if (depth > maxDepth)
        return [];
    const entries = (0, fs_1.readdirSync)(dir, { withFileTypes: true });
    const lines = [];
    for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules')
            continue;
        const indent = '  '.repeat(depth);
        if (entry.isDirectory()) {
            lines.push(`${indent}${entry.name}/`);
            lines.push(...listRecursive((0, path_1.join)(dir, entry.name), depth + 1, maxDepth));
        }
        else {
            lines.push(`${indent}${entry.name}`);
        }
    }
    return lines;
}
exports.listDirectoryTool = {
    name: 'list_directory',
    description: 'List files and directories recursively',
    parameters: {
        type: 'object',
        properties: {
            path: { type: 'string', description: 'Directory path to list' },
            max_depth: { type: 'number', description: 'Max recursion depth (default: 3)' },
        },
        required: ['path'],
    },
    async execute(args) {
        const { path, max_depth = 3 } = args;
        try {
            const stat = (0, fs_1.statSync)(path);
            if (!stat.isDirectory())
                return readFileSync_fallback(path);
            const lines = listRecursive(path, 0, max_depth);
            return lines.join('\n') || '(empty directory)';
        }
        catch (err) {
            throw new Error(`Cannot list "${path}": ${err.message}`);
        }
    },
};
function readFileSync_fallback(path) {
    return `${path} (file, not a directory)`;
}
//# sourceMappingURL=list-directory.js.map