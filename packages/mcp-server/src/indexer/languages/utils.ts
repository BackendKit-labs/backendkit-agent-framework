import * as path from 'path';
import * as fs from 'fs';

export function resolveWasm(filename: string): string {
    let dir = __dirname;
    while (true) {
        const candidate = path.join(dir, 'node_modules', 'tree-sitter-wasms', 'out', filename);
        if (fs.existsSync(candidate)) return candidate;
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }
    throw new Error(`Cannot find ${filename}. Run: npm install tree-sitter-wasms`);
}
