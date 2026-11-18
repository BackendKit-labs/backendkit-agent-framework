import type { MoveRule } from './move-imports';

/**
 * The transformations. Each one is data: which symbols moved where in a breaking release. The lists are not written by hand
 * from the changelog: they are the names `agent-core` exported before and no longer exports after that release, checked against
 * what the destination package exports today (SPEC-0037 §8).
 */
export interface Transform {
    name: string;
    description: string;
    /** The release that broke it, for `--list`. */
    since: string;
    rules: readonly MoveRule[];
}

const CORE = '@backendkit-labs/agent-core';
const PIPELINE = '@backendkit-labs/agent-coding/pipeline';
const CLI = '@backendkit-labs/agent-coding/cli';

/** SPEC-0015 (v0.40.0, `agent-core` 0.39): the coding pipeline leaves `agent-core`. */
const codingSplit: Transform = {
    name: 'coding-split',
    description: 'Orchestrator, QAService and the coding pipeline move from agent-core to agent-coding/pipeline',
    since: 'v0.40.0 (agent-core 0.39.0, agent-coding 0.29.0)',
    rules: [
        {
            from: CORE,
            moves: [{
                to: PIPELINE,
                symbols: ['AgentPipelinePhase', 'CapabilityMatrix', 'OrchestrationResult', 'Orchestrator', 'OrchestratorConfig', 'QAReviewResult', 'QAService', 'QAServiceOptions', 'ReviewAgentIds'],
            }],
            // Exported by agent-core before and by nobody now: nothing to move them to.
            gone: ['ProjectStoreData', 'SessionUpdates'],
        },
        // The subpath `agent-core/orchestration` is gone: its names come from the pipeline now.
        { from: `${CORE}/orchestration`, moves: [], renameRest: PIPELINE },
        // `agent-core/reflection` is gone: the hooks of the audit trail went to the pipeline, the rest is in the root.
        {
            from: `${CORE}/reflection`,
            moves: [{ to: PIPELINE, symbols: ['AuditHook', 'AgentHook', 'TestHook', 'CommitHook', 'BootstrapHook', 'HistoricalLoader', 'LessonsMemoGenerator'] }],
            renameRest: CORE,
        },
    ],
};

/** SPEC-0016 (v0.41.0, `agent-core` 0.40): the terminal app leaves `agent-core`. */
const terminalAppSplit: Transform = {
    name: 'terminal-app-split',
    description: 'Agent discovery, skill loading, built-in commands, checkpoints, workspaces and trust move from agent-core to agent-coding/cli',
    since: 'v0.41.0 (agent-core 0.40.0, agent-coding 0.30.0)',
    rules: [{
        from: CORE,
        moves: [{
            to: CLI,
            symbols: [
                'AgentDiscoveryConfig', 'AgentPackageFile', 'CheckpointSummary', 'DEFAULT_CONFIG', 'FetchOptions', 'FrameworkConfig', 'FrameworkFeatures',
                'GitHubProvider', 'InstallOptions', 'InstalledPack', 'LoadedSkills', 'LocalProvider', 'ObsidianProvider', 'ProjectLayerContents', 'ProviderConfig',
                'RemoteAgentRegistry', 'RemoteRegistryIndex', 'SeedResult', 'SkillLoader', 'SkillManager', 'SkillSourceProvider', 'SkillsShProvider', 'TRUST_FILE',
                'TrustReason', 'TrustStatus', 'WorkspaceEntry', 'WorkspaceProject', 'WorkspacesConfig', 'addProject', 'buildWorkspaceContext',
                'canonicalProjectPath', 'compactSession', 'compactSessionContent', 'createCheckpoint', 'createSkillManager', 'createWorkspace', 'deleteWorkspace',
                'deriveProjectName', 'detectCommonRoot', 'discoverAgents', 'extractSessionFromCheckpoint', 'getLatestCheckpoints', 'globalAgentsDir',
                'importProject', 'isProjectTrusted', 'listCheckpoints', 'listTrustedProjects', 'loadAgentsFromDir', 'loadFrameworkConfig', 'loadWorkspaces',
                'migrateFromLegacy', 'parseMdSkill', 'projectAgentsDir', 'projectLayerContents', 'readCheckpoint', 'registerBuiltinCommands', 'removeProject',
                'runGlobalSeed', 'saveWorkspaces', 'setActiveProject', 'setCommonRoot', 'skillToMd', 'trustFilePath', 'trustProject', 'untrustProject',
                'untrustedLayerWarning',
            ],
        }],
    }],
};

/** `@bk/*` to `@backendkit-labs/*`: the first rename of the packages. */
const scopeRename: Transform = {
    name: 'scope-rename',
    description: 'Imports of @bk/agent-core, @bk/agent-coding and @bk/mcp-server become @backendkit-labs/*',
    since: 'the rename of the npm scope',
    rules: ['agent-core', 'agent-coding', 'mcp-server'].map(pkg => ({ from: `@bk/${pkg}`, moves: [], renameRest: `@backendkit-labs/${pkg}` })),
};

export const TRANSFORMS: readonly Transform[] = [scopeRename, codingSplit, terminalAppSplit];

export const findTransform = (name: string): Transform | undefined => TRANSFORMS.find(t => t.name === name);
