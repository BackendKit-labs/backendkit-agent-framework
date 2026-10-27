import * as os from 'os';
import * as path from 'path';

export function cwdToProjectKey(cwd: string): string {
    return cwd
        .replace(/[/\\]$/, '')
        .replace(/:[/\\]/g, '--')
        .replace(/[^a-zA-Z0-9-]/g, '-');
}

/** The app name becomes a directory under the home dir: only [a-zA-Z0-9_-] so it cannot climb out of it. */
function assertSafeAppName(appName: string): string {
    if (!/^[a-zA-Z0-9_-]+$/.test(appName)) {
        throw new Error(`Invalid appName: "${appName}" (only letters, digits, hyphen and underscore)`);
    }
    return appName;
}

export function getFrameworkDir(appName: string): string {
    const home = process.env.USERPROFILE ?? process.env.HOME ?? os.homedir();
    return path.join(home, `.${assertSafeAppName(appName)}`);
}

export function getProjectDir(appName: string, cwd: string = process.cwd()): string {
    return path.join(getFrameworkDir(appName), 'projects', cwdToProjectKey(cwd));
}
