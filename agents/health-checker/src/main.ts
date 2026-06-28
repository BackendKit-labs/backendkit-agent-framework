// ---------------------------------------------------------------------------
// Main — Entry point: --check-now, AgentMCPServer, startStdio
// ---------------------------------------------------------------------------

import 'dotenv/config';
import { AgentMCPServer } from '@backendkit-labs/mcp-server';
import { CallbackTransport, type AgentEngine } from '@backendkit-labs/agent-core';
import { createEngine } from './engine.js';
import { tools } from './tools.js';

async function main(): Promise<void> {
  try {
    // Detectar flag --check-now
    if (process.argv.includes('--check-now')) {
      const transport = new CallbackTransport((event) => {
        if (event.type === 'token') {
          process.stdout.write(event.content);
        }
        if (event.type === 'done') {
          process.stdout.write('\n');
          process.exit(0);
        }
        if (event.type === 'error') {
          process.stderr.write(`Error: ${event.message}\n`);
          process.exit(1);
        }
      });
      const engine = createEngine(transport);
      await engine.run(
        'Ejecuta system_health: reporte completo de salud del ecosistema BackendKit'
      );
      return;
    }

    const server = new AgentMCPServer({
      name: 'health-checker',
      tools,
      engineFactory: (transport) =>
        createEngine(transport) as unknown as AgentEngine,
    });

    await server.startStdio();
  } catch (err) {
    console.error('Fatal error:', err);
    process.exit(1);
  }
}

main();
