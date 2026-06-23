import type { AgentToolDef }            from '@backendkit-labs/mcp-server';
import { securityReviewProjectTool }    from './securityReviewProject.js';
import { securityReviewTool }           from './securityReview.js';

export const SECURITY_TOOLS: AgentToolDef<any>[] = [
    securityReviewProjectTool,   // primary SDD tool
    securityReviewTool,
];
