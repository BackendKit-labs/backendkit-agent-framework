import type { AgentToolDef }  from '@backendkit-labs/mcp-server';
import { generateInfraTool }   from './generateInfra.js';
import { generateDockerTool }  from './generateDocker.js';
import { generateComposeTool } from './generateCompose.js';
import { generateCICDTool }    from './generateCICD.js';
import { generateK8sTool }     from './generateK8s.js';

export const INFRA_TOOLS: AgentToolDef<any>[] = [
    generateInfraTool,    // primary SDD tool
    generateDockerTool,
    generateComposeTool,
    generateCICDTool,
    generateK8sTool,
];
