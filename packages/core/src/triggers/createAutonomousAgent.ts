import { createBaseEngine } from '../engine/createBaseEngine';
import type { BaseEngineOptions } from '../engine/createBaseEngine';
import type { AgentEngine } from '../engine/AgentEngine';
import { StdoutTransport } from '../transport/StdoutTransport';
import { TriggerManager } from './TriggerManager';
import type { TriggerConfig } from './types';

export interface AutonomousAgentOptions extends BaseEngineOptions {
    /**
     * Describes what the agent monitors/accomplishes.
     * Appended to the project context so agents understand their purpose.
     */
    goal?: string;
    /** Triggers that activate the agent. */
    triggers: TriggerConfig[];
    /** HTTP port for webhook triggers. Default: 3000. */
    webhookPort?: number;
}

export interface AutonomousAgent {
    /** Underlying engine — available for direct engine.run() or engine.runWorkflow() calls. */
    engine: AgentEngine;
    /** Start all trigger listeners (webhook server, cron scheduler, event subscriptions). */
    start(): Promise<void>;
    /** Stop all trigger listeners and free resources. */
    stop(): Promise<void>;
    /**
     * Emit an event on the process-wide EventBus.
     * Activates any event trigger subscribed to the given topic.
     */
    emit(topic: string, data: unknown, source?: string): void;
}

/**
 * Creates an agent that activates on external events instead of requiring
 * manual engine.run() calls.
 *
 * @example
 * const agent = createAutonomousAgent({
 *   providers: { claude: new AnthropicProvider(API_KEY) },
 *   defaultProvider: 'claude',
 *   agents: [monitorAgent],
 *   goal: 'Monitor PRs and flag security issues',
 *   triggers: [
 *     { type: 'webhook',  path: '/github/pr',   secret: GITHUB_SECRET },
 *     { type: 'schedule', cron: '0 9 * * 1-5',  task: 'Send daily digest' },
 *     { type: 'event',    topic: 'ci.failed',   source: 'github-actions' },
 *   ],
 * });
 *
 * await agent.start();
 * process.on('SIGTERM', () => agent.stop());
 */
export function createAutonomousAgent(opts: AutonomousAgentOptions): AutonomousAgent {
    const transport = opts.transport ?? new StdoutTransport();

    const projectContext = [
        opts.projectContext,
        opts.goal ? `Agent goal: ${opts.goal}` : undefined,
    ].filter(Boolean).join('\n\n') || undefined;

    const engine = createBaseEngine({ ...opts, transport, projectContext });

    const manager = new TriggerManager(
        engine,
        opts.triggers,
        opts.webhookPort ?? 3000,
        transport,
    );

    return {
        engine,
        start: () => manager.start(),
        stop: async () => {
            await manager.stop();
            // `mcpServers` are child processes this agent started: stopping the triggers must not leave them running.
            // A later run connects them again, so stop-then-start keeps working.
            await engine.getMCPManager()?.disconnect();
        },
        emit: (topic, data, source) => manager.emit(topic, data, source),
    };
}
