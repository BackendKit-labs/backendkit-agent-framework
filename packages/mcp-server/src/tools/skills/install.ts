import { createSkillManager } from '@backendkit-labs/agent-coding/cli';

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
    // A skill is text that goes into an agent's prompt. Through MCP the caller is a client (often a model), so a source is
    // installed only from an allowlist the operator set (audit C-09): an open install would let anyone plant instructions.
    const allowed = (process.env.BK_TRUSTED_SOURCES ?? '').split(',').map(s => s.trim()).filter(Boolean);
    if (allowed.length === 0) {
        return { ok: false, pack: '', skillsInstalled: 0, error: 'skills_install needs BK_TRUSTED_SOURCES (comma-separated source prefixes) on the server: without an allowlist no source is installed over MCP.' };
    }
    const manager = createSkillManager(appName, { allowedSources: allowed });

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
