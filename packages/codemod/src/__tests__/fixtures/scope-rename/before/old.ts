import { createBaseEngine } from '@bk/agent-core';
import { Pipeline } from '@bk/agent-coding';
import type { McpServerOptions } from "@bk/mcp-server";

export const z = [createBaseEngine, Pipeline];
export type M = McpServerOptions;
