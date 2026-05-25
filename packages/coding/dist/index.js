"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CODING_TOOLS = exports.CODING_AGENTS = exports.DeepSeekProvider = void 0;
exports.createCodingEngine = createCodingEngine;
const agent_core_1 = require("@bk/agent-core");
const DeepSeekProvider_1 = require("./providers/DeepSeekProvider");
const profiles_1 = require("./agents/profiles");
const read_file_1 = require("./tools/read-file");
const write_file_1 = require("./tools/write-file");
const edit_file_1 = require("./tools/edit-file");
const list_directory_1 = require("./tools/list-directory");
const run_command_1 = require("./tools/run-command");
const search_files_1 = require("./tools/search-files");
var DeepSeekProvider_2 = require("./providers/DeepSeekProvider");
Object.defineProperty(exports, "DeepSeekProvider", { enumerable: true, get: function () { return DeepSeekProvider_2.DeepSeekProvider; } });
var profiles_2 = require("./agents/profiles");
Object.defineProperty(exports, "CODING_AGENTS", { enumerable: true, get: function () { return profiles_2.CODING_AGENTS; } });
__exportStar(require("./tools/read-file"), exports);
__exportStar(require("./tools/write-file"), exports);
__exportStar(require("./tools/edit-file"), exports);
__exportStar(require("./tools/list-directory"), exports);
__exportStar(require("./tools/run-command"), exports);
__exportStar(require("./tools/search-files"), exports);
exports.CODING_TOOLS = [
    read_file_1.readFileTool,
    write_file_1.writeFileTool,
    edit_file_1.editFileTool,
    list_directory_1.listDirectoryTool,
    run_command_1.runCommandTool,
    search_files_1.searchFilesTool,
];
function createCodingEngine(opts) {
    const agents = new agent_core_1.AgentRegistry();
    agents.registerAll(profiles_1.CODING_AGENTS);
    const tools = new agent_core_1.ToolRegistry();
    for (const tool of exports.CODING_TOOLS)
        tools.register(tool);
    const provider = new DeepSeekProvider_1.DeepSeekProvider({
        apiKey: opts.apiKey,
        model: opts.model,
    });
    return new agent_core_1.AgentEngine({
        model: { provider: 'deepseek', id: opts.model ?? 'deepseek-chat' },
        agents,
        tools,
        provider,
        transport: opts.transport ?? new agent_core_1.StdoutTransport(),
        defaultAgentId: opts.defaultAgent ?? 'general',
        workingDir: opts.workingDir,
        maxIterations: opts.maxIterations ?? 100,
        maxParallelAgents: opts.maxParallelAgents ?? 6,
    });
}
//# sourceMappingURL=index.js.map