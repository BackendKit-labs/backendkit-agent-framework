import type { AgentEvent } from '@backendkit-labs/agent-core';
import type { Transport, Unsubscribe } from '@backendkit-labs/agent-core';
import type { WebSocket } from 'ws';

export type WsMessage =
    | { type: 'input'; content: string }
    | { type: 'approval'; decision: 'approve' | 'approve_all' | 'reject' };

/** Bytes a client may leave unread in the socket's send buffer before it is cut off. */
export const DEFAULT_MAX_BUFFERED_BYTES = 8 * 1024 * 1024;

export interface WebSocketTransportOptions {
    /** Close the connection when this many bytes are queued unsent (a client that cannot keep up). Default 8 MiB. */
    maxBufferedBytes?: number;
}

export class WebSocketTransport implements Transport {
    private inputHandlers: Array<(input: string) => void> = [];
    private closed = false;
    private readonly maxBufferedBytes: number;

    constructor(private readonly socket: WebSocket, opts: WebSocketTransportOptions = {}) {
        this.maxBufferedBytes = opts.maxBufferedBytes ?? DEFAULT_MAX_BUFFERED_BYTES;
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
        // ws queues what the peer has not read; a stalled client would grow that buffer without limit.
        // Dropping events would hand it a corrupt conversation, so the connection is closed instead.
        if ((this.socket.bufferedAmount ?? 0) > this.maxBufferedBytes) {
            this.closed = true;
            this.inputHandlers = [];
            try { this.socket.close(1013, 'slow consumer'); } catch { /* already closed */ }
            return;
        }
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
