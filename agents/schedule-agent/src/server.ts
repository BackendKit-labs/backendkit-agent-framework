// ---------------------------------------------------------------------------
// Server — AgentMCPServer with tool definitions
// ---------------------------------------------------------------------------

import { AgentMCPServer } from '@backendkit-labs/mcp-server';
import { CallbackTransport, type AgentEngine } from '@backendkit-labs/agent-core';
import { z } from 'zod';
import type { TaskService } from './services/task-service.js';
import { createEngine } from './engine.js';

/**
 * Builds the tool definitions array for AgentMCPServer.
 *
 * Each tool has:
 * - name: MCP tool name
 * - description: human-readable description
 * - schema: Zod schema for input validation
 * - buildPrompt: generates a prompt string that includes the tool name,
 *   which the engine's run() method uses to dispatch to the correct handler
 */
export function buildToolDefs(taskService: TaskService) {
  return [
    {
      name: 'schedule_task',
      description:
        'Schedule a one-time or cron task. Requires createdBy and userRole for authorization.',
      schema: {
        id: z.string().uuid().optional().describe('UUID. Auto-generated if not provided'),
        type: z.enum(['one_time', 'cron']).describe('Type of scheduling'),
        when: z.string().datetime().optional().describe('ISO 8601 date (required for one_time)'),
        cron: z.string().optional().describe('5-field cron expression (required for cron)'),
        timezone: z.string().optional().describe('IANA timezone (default: UTC)'),
        workflow: z.string().min(1, 'workflow cannot be empty').describe('Workflow ID to execute'),
        workflowInput: z.record(z.unknown()).optional().describe('Input parameters for the workflow'),
        createdBy: z.string().min(1).describe('User ID who creates the task'),
        userRole: z.enum(['admin', 'manager', 'user']).describe('Role of the user creating the task'),
        notifyOnFailure: z.boolean().optional().describe('Notify if execution fails'),
        notifyTo: z.array(z.string()).optional().describe('Notification recipients'),
      },
      buildPrompt: (args: Record<string, unknown>) =>
        `schedule_task ${JSON.stringify(args)}`,
    },
    {
      name: 'list_scheduled',
      description:
        'List scheduled tasks with optional filters. Non-admin/manager users must provide createdBy.',
      schema: {
        status: z
          .enum(['active', 'paused', 'completed', 'cancelled', 'failed'])
          .optional()
          .describe('Filter by status'),
        type: z.enum(['one_time', 'cron']).optional().describe('Filter by type'),
        createdBy: z.string().optional().describe('Filter by creator'),
        userRole: z
          .enum(['admin', 'manager', 'user'])
          .optional()
          .describe('Role of the user (default: user)'),
        limit: z.number().int().min(1).max(200).optional().describe('Max results (default: 50)'),
        offset: z.number().int().min(0).optional().describe('Pagination offset (default: 0)'),
      },
      buildPrompt: (args: Record<string, unknown>) =>
        `list_scheduled ${JSON.stringify(args)}`,
    },
    {
      name: 'cancel_task',
      description:
        'Cancel a scheduled task. Users can only cancel their own tasks unless admin.',
      schema: {
        id: z.string().min(1).describe('ID of the task to cancel'),
        reason: z.string().optional().describe('Reason for cancellation'),
        requestedBy: z.string().min(1).describe('User ID requesting cancellation'),
        userRole: z.enum(['admin', 'manager', 'user']).describe('Role of the user requesting cancellation'),
      },
      buildPrompt: (args: Record<string, unknown>) =>
        `cancel_task ${JSON.stringify(args)}`,
    },
    {
      name: 'reschedule',
      description:
        'Reschedule or modify an existing task. Users can only reschedule their own tasks unless admin.',
      schema: {
        id: z.string().min(1).describe('ID of the task to modify'),
        when: z.string().datetime().optional().describe('New ISO 8601 date (one_time only)'),
        cron: z.string().optional().describe('New cron expression (cron only)'),
        timezone: z.string().optional().describe('New IANA timezone'),
        workflowInput: z.record(z.unknown()).optional().describe('New workflow input parameters'),
        requestedBy: z.string().min(1).describe('User ID requesting the change'),
        userRole: z.enum(['admin', 'manager', 'user']).describe('Role of the user requesting the change'),
      },
      buildPrompt: (args: Record<string, unknown>) =>
        `reschedule ${JSON.stringify(args)}`,
    },
    {
      name: 'task_status',
      description:
        'Get detailed status of a task with execution history. Users can only view their own tasks unless admin/manager.',
      schema: {
        id: z.string().min(1).describe('ID of the task'),
        userRole: z.enum(['admin', 'manager', 'user']).optional().describe('Role of the user (default: user)'),
        requestedBy: z.string().min(1).describe('User ID requesting the status'),
      },
      buildPrompt: (args: Record<string, unknown>) =>
        `task_status ${JSON.stringify(args)}`,
    },
    {
      name: 'get_current_time',
      description:
        'Get the current system time with timezone and offset information.',
      schema: {},
      buildPrompt: () => 'get_current_time {}',
    },
    {
      name: 'get_user_timezone',
      description:
        'Get the configured timezone for a user.',
      schema: {
        userId: z.string().min(1, 'userId cannot be empty').describe('User ID'),
      },
      buildPrompt: (args: Record<string, unknown>) =>
        `get_user_timezone ${JSON.stringify(args)}`,
    },
  ];
}

/**
 * Creates an AgentMCPServer instance configured with the scheduler tools.
 */
export function createServer(taskService: TaskService): AgentMCPServer {
  const tools = buildToolDefs(taskService);

  return new AgentMCPServer({
    name: 'scheduler-agent',
    version: '1.0.0',
    tools,
    engineFactory: (transport: CallbackTransport) =>
      createEngine(transport, taskService) as unknown as AgentEngine,
  });
}
