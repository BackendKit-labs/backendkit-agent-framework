import type { AgentToolDef }      from '@backendkit-labs/mcp-server';
import { validatePhaseTool }       from './validatePhase.js';
import { executeTaskTool }         from './executeTask.js';
// Legacy tools kept for direct invocation / debugging
import { runQAPhaseTool }          from './runQAPhase.js';
import { validateAgainstSpecTool } from './validateAgainstSpec.js';
import { generateTestsTool }       from './generateTests.js';

export const QA_TOOLS: AgentToolDef<any>[] = [
    validatePhaseTool,          // primary SDD tool
    executeTaskTool,             // primary ad-hoc tool (orchestrator_run)
    runQAPhaseTool,
    validateAgainstSpecTool,
    generateTestsTool,
];
