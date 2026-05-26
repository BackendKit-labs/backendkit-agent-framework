import * as os from 'os';
import * as path from 'path';

export function cwdToProjectKey(cwd: string): string {
    return cwd
        .replace(/[/\\]$/, '')
        .replace(/:[/\\]/g, '--')
        .replace(/[^a-zA-Z0-9-]/g, '-');
}

export function getFrameworkDir(appName: string): string {
    const home = process.env.USERPROFILE ?? process.env.HOME ?? os.homedir();
    return path.join(home, `.${appName}`);
}

export function getProjectDir(appName: string, cwd: string = process.cwd()): string {
    return path.join(getFrameworkDir(appName), 'projects', cwdToProjectKey(cwd));
}
