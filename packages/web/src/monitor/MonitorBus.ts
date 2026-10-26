import type { AgentEvent } from '@backendkit-labs/agent-core';
import type { WebSocket } from 'ws';

export type MonitorFrame =
    | { type: 'monitor_hello'; sessionIds: string[] }
    | { type: 'monitor_session_open'; sessionId: string }
    | { type: 'monitor_session_close'; sessionId: string }
    | ({ sessionId: string } & AgentEvent)
    | { sessionId: string; type: 'run_input'; content: string };

/** Observers are best-effort: past this many unsent bytes their frames are skipped (1 MiB). */
const MAX_OBSERVER_BUFFERED_BYTES = 1024 * 1024;

export class MonitorBus {
    /** Frames not delivered to an observer because it was not reading. */
    droppedFrames = 0;
    /** Observer -> the only user whose sessions it may see (undefined: every session). */
    private monitors = new Map<WebSocket, string | undefined>();
    /** Open session -> its owner (undefined when the session has none, e.g. no auth configured). */
    private activeSessions = new Map<string, string | undefined>();

    /**
     * @param onlyUserId When set, the observer receives frames of that user's sessions only. A session with no
     *                   owner is visible only to an unscoped observer.
     */
    subscribe(socket: WebSocket, onlyUserId?: string): void {
        this.monitors.set(socket, onlyUserId);

        // Greet the new observer with the currently open sessions it may see
        const hello: MonitorFrame = {
            type: 'monitor_hello',
            sessionIds: [...this.activeSessions].filter(([, owner]) => canSee(onlyUserId, owner)).map(([id]) => id),
        };
        this.send(socket, hello);

        socket.on('close', () => this.monitors.delete(socket));
    }

    notifySessionOpen(sessionId: string, ownerId?: string): void {
        this.activeSessions.set(sessionId, ownerId);
        this.fanOut({ type: 'monitor_session_open', sessionId });
    }

    notifySessionClose(sessionId: string): void {
        this.fanOut({ type: 'monitor_session_close', sessionId });
        this.activeSessions.delete(sessionId);
    }

    broadcast(sessionId: string, event: AgentEvent): void {
        this.fanOut({ sessionId, ...event } as MonitorFrame);
    }

    broadcastRunInput(sessionId: string, content: string): void {
        this.fanOut({ sessionId, type: 'run_input', content });
    }

    private fanOut(frame: MonitorFrame): void {
        const sessionId = 'sessionId' in frame ? frame.sessionId : undefined;
        const data = JSON.stringify(frame);
        for (const [ws, onlyUserId] of this.monitors) {
            if (onlyUserId !== undefined && !canSee(onlyUserId, sessionId === undefined ? undefined : this.activeSessions.get(sessionId))) continue;
            if (ws.readyState === 1 /* OPEN */) {
                // A stalled observer must not accumulate every frame of every session in memory.
                if ((ws.bufferedAmount ?? 0) > MAX_OBSERVER_BUFFERED_BYTES) { this.droppedFrames++; continue; }
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

/** An unscoped observer sees everything; a scoped one only the sessions its user owns. */
function canSee(onlyUserId: string | undefined, ownerId: string | undefined): boolean {
    return onlyUserId === undefined || onlyUserId === ownerId;
}
