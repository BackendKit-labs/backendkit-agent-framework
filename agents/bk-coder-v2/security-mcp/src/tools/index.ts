import type { AgentToolDef }            from '@backendkit-labs/mcp-server';
import { securityReviewProjectTool }    from './securityReviewProject.js';
import { executeTaskTool }              from './executeTask.js';
import { securityReviewTool }           from './securityReview.js';

export const SECURITY_TOOLS: AgentToolDef<any>[] = [
    securityReviewProjectTool,   // primary SDD tool
    executeTaskTool,              // primary ad-hoc tool (orchestrator_run)
    securityReviewTool,
];
