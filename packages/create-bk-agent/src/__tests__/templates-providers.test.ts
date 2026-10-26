import * as fs from 'fs';
import * as path from 'path';

const BASE = path.resolve(__dirname, '../../../templates/base');

function walk(dir: string, out: string[] = []): string[] {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name === 'node_modules') continue;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p, out); else out.push(p);
    }
    return out;
}

const architectures = fs.readdirSync(BASE, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name);

describe('templates use the SDK providers instead of their own copy', () => {
    it.each(architectures)('%s ships no private OpenAI-compatible provider', (arch) => {
        const own = walk(path.join(BASE, arch)).filter(f => /openai-compatible\.ts$/i.test(f));
        expect(own.map(f => path.relative(BASE, f))).toEqual([]);
    });

    it.each(architectures)('%s: every use of OpenAICompatibleProvider comes from @backendkit-labs/agent-providers and is declared', (arch) => {
        const dir = path.join(BASE, arch);
        const sources = walk(dir).filter(f => f.endsWith('.ts'));
        const users = sources.filter(f => /\bOpenAICompatibleProvider\b/.test(fs.readFileSync(f, 'utf-8')));
        if (users.length === 0) return; // this architecture does not build a provider itself

        for (const file of users) {
            const text = fs.readFileSync(file, 'utf-8');
            const imported = /import\s*\{[^}]*\bOpenAICompatibleProvider\b[^}]*\}\s*from\s*['"]([^'"]+)['"]/.exec(text);
            expect({ file: path.relative(BASE, file), from: imported?.[1] }).toEqual({ file: path.relative(BASE, file), from: '@backendkit-labs/agent-providers' });
        }

        const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf-8'));
        const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
        expect(deps['@backendkit-labs/agent-providers']).toBeDefined();
        // the SDK package brings its own openai client; a second, older pin would conflict with it
        expect(deps.openai).toBeUndefined();
    });
});
