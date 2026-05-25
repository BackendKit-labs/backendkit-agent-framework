import { AgentEngine, type Transport } from '@bk/agent-core';
export { DeepSeekProvider } from './providers/DeepSeekProvider';
export { CODING_AGENTS } from './agents/profiles';
export * from './tools/read-file';
export * from './tools/write-file';
export * from './tools/edit-file';
export * from './tools/list-directory';
export * from './tools/run-command';
export * from './tools/search-files';
export declare const CODING_TOOLS: import("@bk/agent-core").ToolDefinition[];
export interface CodingEngineOptions {
    apiKey: string;
    model?: string;
    defaultAgent?: string;
    workingDir?: string;
    maxIterations?: number;
    maxParallelAgents?: number;
    transport?: Transport;
}
export declare function createCodingEngine(opts: CodingEngineOptions): AgentEngine;
//# sourceMappingURL=index.d.ts.map