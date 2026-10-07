import type { AgentToolDef }   from '@backendkit-labs/mcp-server';
import { implementPhaseTool }  from './implementPhase.js';
import { executeTaskTool }     from './executeTask.js';

export const FRONTEND_TOOLS: AgentToolDef<any>[] = [
    implementPhaseTool,       // primary SDD tool
    executeTaskTool,          // primary ad-hoc tool (orchestrator_run)
];
