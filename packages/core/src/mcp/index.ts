export { MCPClientManager, MCP_TOOL_ERROR } from './MCPClientManager';
export type { MCPServerConfig } from './types';

// ── MCP tool server: expose ToolDefinitions directly, no model in between ──────
export { createToolServer, createToolServerFactory, createToolRegistrar, hashArgs } from './tool-server';
export type { ToolServerOptions, ToolCallInfo, ToolCallRecord, ToolCallOutcome } from './tool-server';
export { startToolServerHttp, isBearerAuthorized, isLoopbackRequest } from './tool-server-http';
export type { ToolServerHttpOptions, RunningToolServer } from './tool-server-http';
export { runToolServer, parseToolServerArgs, toolServerUsage } from './tool-server-cli';
export type { ToolServerCliArgs, ToolServerCliOptions, RunningToolServerCli } from './tool-server-cli';
