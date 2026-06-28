// ---------------------------------------------------------------------------
// Main — Entry point: AgentMCPServer + SchedulerEngine background
// ---------------------------------------------------------------------------

import { config } from './config.js';
import { TaskRepository } from './repository/task-repository.js';
import { TaskService } from './services/task-service.js';
import { OrchestratorClient } from './clients/orchestrator-client.js';
import { NotificationClient } from './clients/notification-client.js';
import { SchedulerEngine } from './engine/engine.js';
import { createServer } from './server.js';

async function main(): Promise<void> {
  try {
    // Initialize layers
    const repository = new TaskRepository(config.dbPath);
    await repository.initialize();
    const taskService = new TaskService(repository);

    // Initialize clients
    const orchestratorClient = new OrchestratorClient(config.orchestratorUrl);
    const notificationClient = new NotificationClient();

    // Initialize background engine
    const engine = new SchedulerEngine(
      repository,
      orchestratorClient,
      notificationClient,
      config.engineIntervalMs,
      config.engineTimeoutMs
    );

    // Create AgentMCPServer
    const server = createServer(taskService);

    console.error(
      `[scheduler-agent] Starting MCP server (db: ${config.dbPath},\n [engine] interval: ${config.engineIntervalMs}ms, orchestrator: ${config.orchestratorUrl})`
    );

    // Graceful shutdown
    const shutdown = async () => {
      console.error('[scheduler-agent] Shutting down...');
      engine.stop();
      repository.close();
      await server.stop();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    // Start engine background
    engine.start();

    // Start MCP server (blocks on stdio)
    await server.startStdio();
  } catch (error) {
    console.error('[scheduler-agent] Fatal error:', error);
    process.exit(1);
  }
}

main();
