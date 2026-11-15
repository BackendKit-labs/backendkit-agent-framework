import * as fs from 'fs/promises';
import * as path from 'path';
import { run, isOk } from '@backendkit-labs/result';

/** Detectable stacks mapped to their indicator files. */
const STACK_INDICATORS: Array<{ file: string; stack: string }> = [
    { file: 'package.json',      stack: 'node' },
    { file: 'tsconfig.json',     stack: 'typescript' },
    { file: 'requirements.txt',  stack: 'python' },
    { file: 'pyproject.toml',    stack: 'python' },
    { file: 'pom.xml',           stack: 'java' },
    { file: 'build.gradle',      stack: 'java' },
    { file: 'Cargo.toml',        stack: 'rust' },
    { file: 'go.mod',            stack: 'go' },
    { file: 'composer.json',     stack: 'php' },
    { file: 'Gemfile',           stack: 'ruby' },
    { file: 'mix.exs',           stack: 'elixir' },
];

/** Detects the project stack by checking for indicator files in `cwd`. Feeds `detectedStack` of the engine. */
export async function detectStack(cwd: string): Promise<string[]> {
    const stacks: string[] = [];
    await Promise.all(
        STACK_INDICATORS.map(async ({ file, stack }) => {
            const result = await run(() => fs.access(path.join(cwd, file)));
            if (isOk(result) && !stacks.includes(stack)) stacks.push(stack);
        }),
    );
    return stacks;
}
