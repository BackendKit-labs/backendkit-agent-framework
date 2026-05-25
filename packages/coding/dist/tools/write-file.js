"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.writeFileTool = void 0;
const fs_1 = require("fs");
const path_1 = require("path");
exports.writeFileTool = {
    name: 'write_file',
    description: 'Write or overwrite a file with the given content. Creates parent directories if needed.',
    parameters: {
        type: 'object',
        properties: {
            file_path: { type: 'string', description: 'Absolute path to the file' },
            content: { type: 'string', description: 'Content to write' },
        },
        required: ['file_path', 'content'],
    },
    async execute(args) {
        const { file_path, content } = args;
        try {
            (0, fs_1.mkdirSync)((0, path_1.dirname)(file_path), { recursive: true });
            (0, fs_1.writeFileSync)(file_path, content, 'utf-8');
            return `Written: ${file_path}`;
        }
        catch (err) {
            throw new Error(`Cannot write "${file_path}": ${err.message}`);
        }
    },
};
//# sourceMappingURL=write-file.js.map