import { AgentServer, type EngineFactory } from '@backendkit-labs/agent-web';
import { createEngine } from './engine';

// One engine per chat session, on the session's own transport (WebSocket).
const engineFactory: EngineFactory = (_sessionId, transport) => createEngine(transport);

const port = Number(process.env.PORT ?? 4001);
const server = new AgentServer({ port, engineFactory });

server.start()
    .then(() => {
        console.log(`Agent server on http://127.0.0.1:${port}`);
        console.log('  WS  /chat     streaming chat sessions');
        console.log('  WS  /monitor  read-only observer');
        console.log('  GET /health');
    })
    .catch((err: unknown) => {
        console.error(err);
        process.exit(1);
    });