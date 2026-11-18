import { createBaseEngine } from '@backendkit-labs/agent-core';
import { Pipeline } from '@backendkit-labs/agent-coding';
import type { McpServerOptions } from "@backendkit-labs/mcp-server";

export const z = [createBaseEngine, Pipeline];
export type M = McpServerOptions;
