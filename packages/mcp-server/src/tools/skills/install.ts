import { createSkillManager } from '@bk/agent-core';

export interface InstallResult {
    ok: boolean;
    pack: string;
    skillsInstalled: number;
    error?: string;
}

export async function skillsInstall(
    source: string,
    appName: string,
    options: { skill?: string; pack?: string } = {},
): Promise<InstallResult> {
    const manager = createSkillManager(appName);

    try {
        await manager.install(source, options);
        const packs = await manager.list();
        const packName = options.pack ?? derivePackName(source);
        const installed = packs.find((p: { pack: string }) => p.pack === packName);
        return {
            ok: true,
            pack: packName,
            skillsInstalled: installed?.skills.length ?? 0,
        };
    } catch (e) {
        return {
            ok: false,
            pack: options.pack ?? source,
            skillsInstalled: 0,
            error: e instanceof Error ? e.message : String(e),
        };
    }
}

function derivePackName(source: string): string {
    const match = source.match(/github\.com\/([^/]+)\//i);
    if (match) return `@${match[1]}`;
    return source;
}
