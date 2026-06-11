import type { AgentEvent } from '@backendkit-labs/agent-core';
import type { WebSocket } from 'ws';

export type MonitorFrame =
    | { type: 'monitor_hello'; sessionIds: string[] }
    | { type: 'monitor_session_open'; sessionId: string }
    | { type: 'monitor_session_close'; sessionId: string }
    | ({ sessionId: string } & AgentEvent)
    | { sessionId: string; type: 'run_input'; content: string };

export class MonitorBus {
    private monitors = new Set<WebSocket>();
    private activeSessions = new Set<string>();

    subscribe(socket: WebSocket): void {
        this.monitors.add(socket);

        // Greet the new observer with currently open sessions
        const hello: MonitorFrame = { type: 'monitor_hello', sessionIds: [...this.activeSessions] };
        this.send(socket, hello);

        socket.on('close', () => this.monitors.delete(socket));
    }

    notifySessionOpen(sessionId: string): void {
        this.activeSessions.add(sessionId);
        this.fanOut({ type: 'monitor_session_open', sessionId });
    }

    notifySessionClose(sessionId: string): void {
        this.activeSessions.delete(sessionId);
        this.fanOut({ type: 'monitor_session_close', sessionId });
    }

    broadcast(sessionId: string, event: AgentEvent): void {
        this.fanOut({ sessionId, ...event } as MonitorFrame);
    }

    broadcastRunInput(sessionId: string, content: string): void {
        this.fanOut({ sessionId, type: 'run_input', content });
    }

    private fanOut(frame: MonitorFrame): void {
        const data = JSON.stringify(frame);
        for (const ws of this.monitors) {
            if (ws.readyState === 1 /* OPEN */) {
                try { ws.send(data); } catch { /* ignore — socket may be closing */ }
            }
        }
    }

    private send(socket: WebSocket, frame: MonitorFrame): void {
        if (socket.readyState === 1) {
            try { socket.send(JSON.stringify(frame)); } catch { /* ignore */ }
        }
    }

    get size(): number {
        return this.monitors.size;
    }
}
