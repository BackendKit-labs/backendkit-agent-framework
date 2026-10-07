import type { AgentToolDef }      from '@backendkit-labs/mcp-server';
import { implementPhaseTool }      from './implementPhase.js';
import { executeTaskTool }         from './executeTask.js';
// Legacy tools kept for direct invocation / debugging
import { implementFeatureTool }    from './implementFeature.js';
import { readProjectFilesTool }    from './readProjectFiles.js';
import { writeCodeTool }           from './writeCode.js';
import { executeCommandTool }      from './executeCommand.js';

export const BACKEND_TOOLS: AgentToolDef<any>[] = [
    implementPhaseTool,       // primary SDD tool
    executeTaskTool,          // primary ad-hoc tool (orchestrator_run)
    implementFeatureTool,
    readProjectFilesTool,
    writeCodeTool,
    executeCommandTool,
];
