import {
    AgentEngine,
    AgentRegistry,
    ToolRegistry,
    type Transport,
    StdoutTransport,
} from '@bk/agent-core';
import { DeepSeekProvider } from './providers/DeepSeekProvider';
import { CODING_AGENTS } from './agents/profiles';
import { readFileTool } from './tools/read-file';
import { writeFileTool } from './tools/write-file';
import { editFileTool } from './tools/edit-file';
import { listDirectoryTool } from './tools/list-directory';
import { runCommandTool } from './tools/run-command';
import { searchFilesTool } from './tools/search-files';

export { DeepSeekProvider } from './providers/DeepSeekProvider';
export { CODING_AGENTS } from './agents/profiles';
export * from './tools/read-file';
export * from './tools/write-file';
export * from './tools/edit-file';
export * from './tools/list-directory';
export * from './tools/run-command';
export * from './tools/search-files';

export const CODING_TOOLS = [
    readFileTool,
    writeFileTool,
    editFileTool,
    listDirectoryTool,
    runCommandTool,
    searchFilesTool,
];

export interface CodingEngineOptions {
    apiKey: string;
    model?: string;
    defaultAgent?: string;
    workingDir?: string;
    maxIterations?: number;
    maxParallelAgents?: number;
    transport?: Transport;
}

export function createCodingEngine(opts: CodingEngineOptions): AgentEngine {
    const agents = new AgentRegistry();
    agents.registerAll(CODING_AGENTS);

    const tools = new ToolRegistry();
    for (const tool of CODING_TOOLS) tools.register(tool);

    const provider = new DeepSeekProvider({
        apiKey: opts.apiKey,
        model: opts.model,
    });

    return new AgentEngine({
        model: { provider: 'deepseek', id: opts.model ?? 'deepseek-chat' },
        agents,
        tools,
        provider,
        transport: opts.transport ?? new StdoutTransport(),
        defaultAgentId: opts.defaultAgent ?? 'general',
        workingDir: opts.workingDir,
        maxIterations: opts.maxIterations ?? 100,
        maxParallelAgents: opts.maxParallelAgents ?? 6,
    });
}
