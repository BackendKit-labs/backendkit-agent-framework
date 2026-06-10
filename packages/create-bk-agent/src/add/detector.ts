import * as fs from 'fs';
import * as path from 'path';

export interface BkProjectInfo {
    cwd:          string;
    architecture: 'multi-agent' | 'single' | 'enterprise' | 'unknown';
    engineFile:   string;
    indexFile:    string;
    serverFile:   string;
    pkgFile:      string;
    engineFnName: string;
    isEnterprise: boolean;
}

export function detectProject(cwd: string): BkProjectInfo | null {
    const pkgFile = path.join(cwd, 'package.json');
    if (!fs.existsSync(pkgFile)) return null;

    let pkg: Record<string, unknown>;
    try {
        pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf-8'));
    } catch {
        return null;
    }

    const deps = {
        ...((pkg.dependencies  as Record<string, string>) ?? {}),
        ...((pkg.devDependencies as Record<string, string>) ?? {}),
    };
    if (!deps['@backendkit-labs/agent-core']) return null;

    const isEnterprise = !!deps['@backendkit-labs/agent-enterprise'];

    const engineFile = path.join(cwd, 'src', 'engine.ts');
    let architecture: BkProjectInfo['architecture'] = 'unknown';
    let engineFnName = 'createEngine';

    if (fs.existsSync(engineFile)) {
        const content = fs.readFileSync(engineFile, 'utf-8');

        if (isEnterprise && content.includes('ObsidianRAGProvider')) {
            architecture = 'enterprise';
        } else if (content.includes('ORCHESTRATOR_PROFILE') || content.includes("id: 'orchestrator'")) {
            architecture = 'multi-agent';
        } else if (content.includes('export function create')) {
            architecture = 'single';
        }

        const match = content.match(/export function (\w+)\s*\(/);
        if (match) engineFnName = match[1];
    }

    return {
        cwd,
        architecture,
        engineFile,
        indexFile:    path.join(cwd, 'src', 'index.ts'),
        serverFile:   path.join(cwd, 'src', 'server.ts'),
        pkgFile,
        engineFnName,
        isEnterprise,
    };
}
