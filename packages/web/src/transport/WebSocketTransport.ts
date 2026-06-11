import type { AgentEvent } from '@backendkit-labs/agent-core';
import type { Transport, Unsubscribe } from '@backendkit-labs/agent-core';
import type { WebSocket } from 'ws';

export type WsMessage =
    | { type: 'input'; content: string }
    | { type: 'approval'; decision: 'approve' | 'approve_all' | 'reject' };

export class WebSocketTransport implements Transport {
    private inputHandlers: Array<(input: string) => void> = [];
    private closed = false;

    constructor(private readonly socket: WebSocket) {
        socket.on('message', (raw: Buffer | string) => {
            try {
                const msg: WsMessage = JSON.parse(raw.toString());
                if (msg.type === 'input') {
                    for (const h of this.inputHandlers) h(msg.content);
                }
            } catch {
                // ignore malformed frames
            }
        });

        socket.on('close', () => {
            this.closed = true;
            this.inputHandlers = [];
        });
    }

    emit(event: AgentEvent): void {
        if (this.closed) return;
        try {
            this.socket.send(JSON.stringify(event));
        } catch {
            // socket may have closed between the guard and send
        }
    }

    onInput(handler: (input: string) => void): Unsubscribe {
        this.inputHandlers.push(handler);
        return () => {
            this.inputHandlers = this.inputHandlers.filter(h => h !== handler);
        };
    }

    close(): void {
        this.closed = true;
        this.inputHandlers = [];
        try {
            this.socket.close();
        } catch {
            // already closed
        }
    }

    get isOpen(): boolean {
        return !this.closed && this.socket.readyState === 1; // OPEN
    }
}
