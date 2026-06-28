import type { AgentToolDef }   from '@backendkit-labs/mcp-server';
import { implementPhaseTool }  from './implementPhase.js';

export const FRONTEND_TOOLS: AgentToolDef<any>[] = [
    implementPhaseTool,       // primary SDD tool
];
