import { execSync } from 'child_process';

export function getGitDiff(): string {
    try {
        return execSync('git diff --cached', {
            cwd: process.cwd(),
            timeout: 10_000,
            stdio: 'pipe',
        }).toString();
    } catch {
        return '';
    }
}
