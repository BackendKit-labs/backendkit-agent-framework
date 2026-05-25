"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.readFileTool = void 0;
const fs_1 = require("fs");
exports.readFileTool = {
    name: 'read_file',
    description: 'Read the contents of a file',
    parameters: {
        type: 'object',
        properties: {
            file_path: { type: 'string', description: 'Absolute path to the file' },
        },
        required: ['file_path'],
    },
    async execute(args) {
        const { file_path } = args;
        try {
            return (0, fs_1.readFileSync)(file_path, 'utf-8');
        }
        catch (err) {
            throw new Error(`Cannot read "${file_path}": ${err.message}`);
        }
    },
};
//# sourceMappingURL=read-file.js.map