/**
 * @description Library entry point — the pieces shared by every consumer of the
 * config-driven orchestration engine (dynamic planning, LLM provider, static
 * flows, run consolidation, BullMQ subtask dispatch).
 *
 * This does NOT re-export server.ts/executor.ts/audit.ts/config.ts/run-store.ts —
 * those either have side effects on import (server.ts starts the MCP server) or
 * have diverged in known consumers (bk-coder-v2/orchestrator forks them on purpose
 * for SDD-specific behavior). Only the modules with zero known divergence are
 * exported here, so a consumer can depend on this package without forking them.
 */

export type { SubTask, TaskPlan } from './planner.js';
export { TaskPlanner } from './planner.js';

export { OpenAICompatibleProvider, callLLM } from './provider.js';

export type { StaticFlow, FlowStep, FlowEntry } from './static-flow.js';
export { FlowEntrySchema, loadFlow, matchFlow, flowToTaskPlan } from './static-flow.js';

export { consolidateRun } from './consolidate.js';

export type { SubtaskJobData } from './subtask-queue.js';
export { SubtaskQueue } from './subtask-queue.js';
